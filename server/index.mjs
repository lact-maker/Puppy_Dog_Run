import { packState } from '../public/wire.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from './store.mjs';
import { Rooms } from './rooms.mjs';

const root = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
export function createServer({ dataFile = resolve('data/store.json'), reconnectMs = 15000, countdownMs = 3000 } = {}) {
  const store = new Store(dataFile), peers = new Map(), buckets = new Map();
  const rooms = new Rooms(store, (id, msg) => { const ws = peers.get(id); if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < (msg.type === 'state' ? 64 * 1024 : 1024 * 1024)) {
    if (msg.type === 'state' && ws.deltaStates) { const packed = packState(msg.state, ws.stateCache); ws.stateCache = packed.cache; ws.send(JSON.stringify(packed.message)); }
    else ws.send(JSON.stringify(msg));
  } }, { reconnectMs, countdownMs });
  const send = (res, status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
  async function body(req) {
    let text = ''; for await (const chunk of req) { text += chunk; if (text.length > 200000) throw new Error('上传内容过大'); }
    return JSON.parse(text || '{}');
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const ip = req.socket.remoteAddress, now = Date.now(); let b = buckets.get(ip);
        if (!b || now - b.at > 60000) { b = { at: now, count: 0 }; buckets.set(ip, b); }
        if (++b.count > 150) return send(res, 429, { error: '请求太频繁，请稍后再试' });
        if (url.pathname === '/api/health') return send(res, 200, { ok: true, version: '0.8.0' });
        if (url.pathname === '/api/register' && req.method === 'POST') { const b = await body(req); return send(res, 201, store.register(b.name, b.avatar)); }
        if (url.pathname === '/api/leaderboard' && req.method === 'GET') return send(res, 200, store.leaderboard(url.searchParams.get('mode')||'duo'));
        const p = store.auth(req.headers.authorization?.replace(/^Bearer /, ''));
        if (!p) return send(res, 401, { error: '请重新连接玩家身份' });
        if (url.pathname === '/api/me' && req.method === 'GET') return send(res, 200, store.account(p));
        if (url.pathname === '/api/me' && req.method === 'POST') { const profile = store.update(p, await body(req)); const r = rooms.find(p.id); if (r) rooms.publish(r); return send(res, 200, profile); }
        if (url.pathname === '/api/shop/buy' && req.method === 'POST') { const b=await body(req); return send(res,200,store.purchase(p,b.id)); }
        if (url.pathname === '/api/shop/equip' && req.method === 'POST') { const b=await body(req); return send(res,200,store.equip(p,b.id,Boolean(b.enabled))); }
        if (url.pathname === '/api/teams' && req.method === 'GET') return send(res, 200, store.history(p.id));
        return send(res, 404, { error: '接口不存在' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!path.startsWith(root + sep)) return send(res, 403, { error: 'Forbidden' });
      const data = await readFile(path);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' })[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (e) { if (!res.headersSent) send(res, e.code === 'ENOENT' ? 404 : 400, { error: e.code === 'ENOENT' ? 'Not found' : e.message }); }
  });
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', ws => {
    let player = null, count = 0, windowAt = Date.now(); ws.alive = true;
    const authTimer = setTimeout(() => { if (!player) ws.close(1008, 'auth required'); }, 5000);
    ws.on('pong', () => ws.alive = true);
    ws.on('message', raw => {
      try {
        if (Date.now() - windowAt > 1000) { count = 0; windowAt = Date.now(); }
        if (++count > 40) throw new Error('操作过于频繁');
        const msg = JSON.parse(raw);
        if (!player) {
          if (msg.type !== 'auth' || !(player = store.auth(msg.token))) { ws.close(1008, 'invalid identity'); return; }
          ws.deltaStates = msg.deltaStates === true;
          clearTimeout(authTimer); const old = peers.get(player.id); peers.set(player.id, ws); if (old && old !== ws) old.close(4001, 'replaced');
          ws.send(JSON.stringify({ type: 'welcome', prediction: true, player: store.account(player), inRoom: !!rooms.find(player.id), lastResult: player.lastResult || null })); rooms.connected(player.id);
        } else rooms.handle(player.id, msg);
      } catch (e) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: e.message })); }
    });
    ws.on('error', () => {});
    ws.on('close', () => { clearTimeout(authTimer); if (player && peers.get(player.id) === ws) { peers.delete(player.id); rooms.disconnected(player.id); } });
  });
  let previous = performance.now();
  const simulation = setInterval(() => { const now = performance.now(); rooms.tick(Math.min(.1, (now - previous) / 1000)); previous = now; }, 1000 / 60);
  let frame = 0;
  const broadcast = setInterval(() => {
    for (const r of rooms.rooms.values()) {
      if (r.game && ['running', 'countdown', 'paused', 'shop'].includes(r.phase)) {
        const msg = { type: 'state', state: r.game }; for (const m of r.members) rooms.emit(m.id, msg);
      }
      if (++frame % 20 === 0 || r.phase === 'countdown') rooms.publish(r);
    }
  }, 50);
  const heartbeat = setInterval(() => { for (const ws of wss.clients) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; ws.ping(); } }, 5000);
  const cleanup = setInterval(() => { for (const [ip, b] of buckets) if (Date.now() - b.at > 60000) buckets.delete(ip); }, 60000);
  return { server, store, rooms, close: async () => {
    clearInterval(simulation); clearInterval(broadcast); clearInterval(heartbeat); clearInterval(cleanup);
    for (const r of rooms.rooms.values()) if (r.game && !r.recorded) rooms.settle(r, true);
    for (const ws of wss.clients) ws.terminate(); wss.close(); await new Promise(resolve => server.close(resolve));
  } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createServer({ dataFile: process.env.DATA_FILE || resolve('data/store.json') });
  const port = Number(process.env.PORT || 8787);
  app.server.listen(port, '0.0.0.0', () => console.log(`小狗双人跑酷 → http://localhost:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
