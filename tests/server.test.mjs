import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Store } from '../server/store.mjs';
import { Rooms } from '../server/rooms.mjs';
import { createServer } from '../server/index.mjs';
import { WebSocket } from 'ws';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'puppy-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, 'db.json'));
  const a = store.register('甲'), b = store.register('乙'), c = store.register('丙');
  let now = 0; const out = [];
  const rooms = new Rooms(store, (id, msg) => out.push({ id, ...msg }), { now: () => now });
  [a, b, c].forEach(p => rooms.connected(p.player.id));
  return { store, rooms, a: a.player.id, b: b.player.id, c: c.player.id, advance: ms => now += ms, out, file: join(dir, 'db.json') };
}
function started(x) {
  const r = x.rooms.create(x.a, '共同的小队'); x.rooms.join(x.b, r.code);
  for (const id of [x.a, x.b]) x.rooms.handle(id, { type: 'ready' }); x.rooms.handle(x.a, { type: 'start' }); x.advance(3001); x.rooms.tick(.016); return r;
}
test('room cap, host selection, preparation reset and wrong-role input rejection', t => {
  const x = setup(t), r = x.rooms.create(x.a, '共同的小队'); x.rooms.join(x.b, r.code);
  assert.throws(() => x.rooms.join(x.c, r.code)); assert.throws(() => x.rooms.handle(x.b, { type: 'configure', character: 'xiaobai' }));
  x.rooms.handle(x.a, { type: 'ready' }); x.rooms.handle(x.a, { type: 'configure', character: 'xiaobai' }); assert.ok(r.members.every(m => !m.ready));
  for (const id of [x.a, x.b]) x.rooms.handle(id, { type: 'ready' }); x.rooms.handle(x.a, { type: 'start' }); x.advance(3001); x.rooms.tick(.01);
  assert.equal(r.game.character, 'xiaobai'); assert.throws(() => x.rooms.handle(x.a, { type: 'input', action: 'dash' }));
  x.rooms.handle(x.a, { type: 'input', action: 'jump' }); assert.equal(r.game.dog.jumps, 1);
});
test('manual pause needs two confirmations; paused and countdown time excluded', t => {
  const x = setup(t), r = started(x), before = r.game.time;
  x.rooms.handle(x.a, { type: 'pause' }); x.advance(5000); x.rooms.tick(.1); assert.equal(r.game.time, before);
  x.rooms.handle(x.a, { type: 'resume' }); assert.equal(r.phase, 'paused'); x.rooms.handle(x.b, { type: 'resume' }); assert.equal(r.phase, 'countdown');
  x.rooms.tick(.1); assert.equal(r.game.time, before); x.advance(3001); x.rooms.tick(.01); assert.equal(r.phase, 'running');
});
test('disconnect freezes game; reconnect continues or preserves prior manual pause', t => {
  const x = setup(t), r = started(x); x.rooms.disconnected(x.b); assert.equal(r.phase, 'paused');
  x.advance(14999); x.rooms.tick(.1); assert.equal(r.phase, 'paused'); x.rooms.connected(x.b); assert.equal(r.phase, 'countdown');
  x.advance(3001); x.rooms.tick(.01); x.rooms.handle(x.a, { type: 'pause' }); x.rooms.disconnected(x.b); x.rooms.connected(x.b); assert.equal(r.phase, 'paused');
});
test('15 second timeout records interrupted result exactly once', t => {
  const x = setup(t), r = started(x); r.game.distance = 456; r.game.time = 12.34;
  x.rooms.disconnected(x.b); x.advance(15000); x.rooms.tick(.01);
  assert.equal(r.phase, 'ended'); assert.equal(r.result.interrupted, true); assert.equal(r.result.duration, 12340);
  const result = JSON.stringify(r.result); x.rooms.settle(r, true); assert.equal(JSON.stringify(r.result), result);
});
test('team identity survives rejoin, rename, server reload; alternate partners have separate teams', t => {
  const x = setup(t), r = started(x); r.game.distance = 250; r.game.time = 8; x.rooms.settle(r, false);
  x.rooms.leave(x.a); x.rooms.leave(x.b); const r2 = x.rooms.create(x.b, '不会覆盖旧名'); x.rooms.join(x.a, r2.code);
  assert.equal(r2.team.name, '共同的小队'); assert.equal(r2.team.best.duration, 8000);
  x.rooms.handle(x.b, { type: 'configure', name: '新的队名', character: 'xiaobai' });
  x.rooms.leave(x.a); x.rooms.leave(x.b); const r3 = x.rooms.create(x.a, '另一个小队'); x.rooms.join(x.c, r3.code);
  assert.equal(x.store.history(x.a).length, 2); assert.equal(r3.team.best, null);
  const reloaded = new Store(x.file); assert.equal(reloaded.leaderboard()[0].name, '新的队名'); assert.equal(reloaded.leaderboard()[0].character, 'xiaobai');
});
test('leaderboard binds duration to winning run, equal distance does not overwrite, server-owned avatars', t => {
  const x = setup(t), r = started(x); r.game.distance = 333.37; r.game.time = 20;
  x.store.record(r.team, r.game, false, 'first'); r.game.time = 1; x.store.record(r.team, r.game, false, 'equal');
  assert.equal(r.team.best.duration, 20000); assert.equal(r.team.best.runId, 'first');
  r.game.distance = 334; x.store.record(r.team, r.game, true, 'better'); const row = x.store.leaderboard()[0];
  assert.equal(row.best.duration, 1000); assert.equal(row.members.length, 2); assert.ok(!JSON.stringify(row).includes('tokenHash'));
  assert.throws(() => x.store.update(x.store.data.players[x.a], { avatar: 'data:image/svg+xml;base64,AA==' }));
});
test('real HTTP/WebSocket two-client flow including authentication and authoritative result', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'puppy-net-'));
  const app = createServer({ dataFile: join(dir, 'db.json'), countdownMs: 10 });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const port = app.server.address().port, url = `http://127.0.0.1:${port}`, clients = [];
  t.after(async () => { clients.forEach(c => c.ws.terminate()); await app.close(); rmSync(dir, { recursive: true, force: true }); });
  async function client(name) {
    const p = await (await fetch(url + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`), queue = [];
    ws.on('message', bytes => queue.push(JSON.parse(bytes)));
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'auth', token: p.token, deltaStates: name.includes('甲') }));
    const c = { ws, p, queue, send: msg => ws.send(JSON.stringify(msg)), wait: async fn => { const end = Date.now() + 4000; while (Date.now() < end) { const i = queue.findIndex(fn); if (i !== -1) return queue.splice(i, 1)[0]; await new Promise(r => setTimeout(r, 10)); } throw new Error('message timeout'); } }; clients.push(c); await c.wait(m => m.type === 'welcome'); return c;
  }
  const a = await client('真实客户端甲'), b = await client('真实客户端乙');
  a.send({ type: 'create', name: '网络验证队' }); const created = await a.wait(m => m.type === 'room'); b.send({ type: 'join', code: created.room.code });
  await b.wait(m => m.type === 'room' && m.room.members.length === 2); a.send({ type: 'ready' }); b.send({ type: 'ready' });
  await a.wait(m => m.type === 'room' && m.room.members.every(m => m.ready)); a.send({ type: 'start' });
  const state = await a.wait(m => m.type === 'state-delta' && m.state.status === 'running'); assert.equal(state.state.character, 'jimao');
  a.send({ type: 'input', action: 'dash' }); assert.match((await a.wait(m => m.type === 'error')).message, /搭档/);
  b.send({ type: 'leave' }); const end = await a.wait(m => m.type === 'room' && m.room.phase === 'ended'); assert.equal(end.room.result.interrupted, true);
  const board = await (await fetch(url + '/api/leaderboard')).json(); assert.equal(board[0].name, '网络验证队');
  assert.equal((await fetch(url + '/api/me')).status, 401);
  assert.equal((await fetch(url + '/')).status, 200);
});

test('solo is authoritative, allows both controls, resumes alone, and is ranked separately',t=>{
 const x=setup(t),r=x.rooms.solo(x.a,'xiaobai');x.advance(3001);x.rooms.tick(.01);
 assert.equal(r.phase,'running');assert.equal(x.rooms.snapshot(r).members[0].role,'both');
 assert.throws(()=>x.rooms.join(x.b,r.code));
 x.rooms.handle(x.a,{type:'input',action:'jump'});x.rooms.handle(x.a,{type:'input',action:'dash'});
 assert.equal(r.game.dog.jumps,1);assert.ok(r.game.dog.dash>0);
 x.rooms.handle(x.a,{type:'pause'});x.rooms.handle(x.a,{type:'resume'});assert.equal(r.phase,'countdown');
 r.game.distance=10001;x.rooms.settle(r,false);assert.equal(x.store.account(x.store.data.players[x.a]).coins,2);
 assert.equal(x.store.leaderboard('solo').length,1);assert.equal(x.store.leaderboard('duo').length,0);
 x.rooms.handle(x.a,{type:'again'});assert.equal(r.phase,'countdown');assert.equal(r.game.distance,0);
});
test('coins belong to original host despite swapped roles; thresholds and settlement are idempotent',t=>{
 const x=setup(t),r=started(x);r.members.reverse();r.game.distance=4999.9;
 assert.equal(x.store.award(r.coinOwner,r.game.distance,r.runId),0);
 r.game.distance=5000;assert.equal(x.store.award(r.coinOwner,r.game.distance,r.runId),1);
 assert.equal(x.store.award(r.coinOwner,r.game.distance,r.runId),0);
 r.game.distance=10000;x.rooms.settle(r,true);x.rooms.settle(r,true);
 assert.equal(x.store.account(x.store.data.players[x.a]).coins,2);assert.equal(x.store.account(x.store.data.players[x.b]).coins,0);
 const again=new Store(x.file);assert.equal(again.award(x.a,10000,r.runId),0);assert.equal(again.account(again.data.players[x.a]).coins,2);
 assert.equal(again.award(x.a,4999,'another-run'),0);
});
test('permanent shop validates balance and ownership, repeated purchase never charges twice',t=>{
 const x=setup(t),p=x.store.data.players[x.a];assert.throws(()=>x.store.purchase(p,'hat'));assert.throws(()=>x.store.equip(p,'hat',true));
 x.store.award(x.a,235*5000,'funded-run');
 for(const [id,remaining] of [['hat',225],['shoes',200],['shirt',100],['pants',0]]) {
  assert.equal(x.store.purchase(p,id).coins,remaining);assert.equal(x.store.purchase(p,id).coins,remaining);
 }
 x.store.equip(p,'hat',false);assert.equal(p.equipped.hat,undefined);assert.equal(p.owned.length,4);
 const db=new Store(x.file);assert.equal(db.account(db.data.players[x.a]).owned.length,4);db.equip(db.data.players[x.a],'hat',true);
 const r=x.rooms.solo(x.a,'jimao');assert.ok(r.game.equipped.shirt);
 assert.throws(()=>x.store.purchase(p,'free-crown'));assert.equal(p.coins,0);
});
test('both leaderboards keep only top 20 and solo identity survives rename/reload',t=>{
 const x=setup(t);
 for(let i=0;i<25;i++) {const p=x.store.register('跑者'+i).player;const state={distance:i*10,time:5};x.store.recordSolo(p.id,state,false,'s'+i);const team=x.store.team(p.id,x.a,'队'+i);x.store.record(team,state,false,'d'+i,x.a);}
 for(const mode of ['solo','duo']){const list=x.store.leaderboard(mode);assert.equal(list.length,20);assert.equal(list[0].best.distance,240);assert.equal(list[19].best.distance,50);}
 const id=x.store.leaderboard('solo')[0].id;x.store.update(x.store.data.players[id],{name:'新昵称'});
 assert.equal(new Store(x.file).leaderboard('solo')[0].name,'新昵称');
});
test('old v1 accounts migrate without losing teams or inventing coins',t=>{
 const x=setup(t);x.store.data.version=1;delete x.store.data.solos;delete x.store.data.rewards;delete x.store.data.settlements;x.store.save();
 const db=new Store(x.file);assert.equal(db.account(db.data.players[x.a]).coins,0);assert.deepEqual(db.account(db.data.players[x.a]).owned,[]);
 assert.equal(db.data.version,2);assert.deepEqual(db.leaderboard('solo'),[]);
});

test('shop HTTP endpoints require authentication and ignore forged coin balances',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'puppy-shop-http-'));const app=createServer({dataFile:join(dir,'db.json')});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const url=`http://127.0.0.1:${app.server.address().port}`;
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const user=app.store.register('HTTP商店测试');const headers={'Content-Type':'application/json',Authorization:`Bearer ${user.token}`};
 const post=(path,data)=>fetch(url+path,{method:'POST',headers,body:JSON.stringify(data)});
 assert.equal((await fetch(url+'/api/shop/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"id":"hat"}'})).status,401);
 await post('/api/me',{coins:999999,owned:['hat']});assert.equal((await (await fetch(url+'/api/me',{headers})).json()).coins,0);
 assert.equal((await post('/api/shop/buy',{id:'hat',price:0})).status,400);
 app.store.award(user.player.id,50000,'http-earned');
 const purchases=await Promise.all([post('/api/shop/buy',{id:'hat'}),post('/api/shop/buy',{id:'hat'})]);assert.ok(purchases.every(r=>r.status===200));
 const account=await(await fetch(url+'/api/me',{headers})).json();assert.equal(account.coins,0);assert.deepEqual(account.owned,['hat']);
 assert.equal((await(await post('/api/shop/equip',{id:'hat',enabled:false})).json()).equipped.hat,undefined);
});

function enterShop(x,r,fixed=true) {
 r.game.entities=[{type:'ground',x:-1000,y:0,w:1e7,h:0},{type:'portal',x:r.game.dog.x,y:r.game.dog.y,w:65,h:85}];
 x.rooms.tick(.01);assert.equal(r.phase,'shop');
 if(fixed)r.eggs=['stopwatch','bridge','talisman'];
}
test('gold eggs are private, distinct, role-checked, single choice and stack across visits',t=>{
 const x=setup(t),r=started(x);enterShop(x,r);const visit=r.shop.visit;
 assert.equal(new Set(r.eggs).size,3);assert.ok(!JSON.stringify(x.rooms.snapshot(r)).includes('stopwatch'));
 assert.throws(()=>x.rooms.handle(x.a,{type:'egg',visit,index:0}));
 const reward=r.eggs[0];x.rooms.handle(x.b,{type:'egg',visit,index:0});assert.equal(r.game.items[reward],1);
 x.rooms.handle(x.b,{type:'egg',visit,index:1});assert.equal(r.game.items[reward],1);
 x.rooms.handle(x.b,{type:'shop-continue',visit});assert.equal(r.phase,'countdown');
 x.advance(3001);x.rooms.tick(.01);enterShop(x,r);
 x.rooms.handle(x.b,{type:'egg',visit,index:0});assert.equal(r.shop.picked,null);
 x.rooms.handle(x.b,{type:'egg',visit:r.shop.visit,index:r.eggs.indexOf(reward)});assert.equal(r.game.items[reward],2);
});
test('shop reconnect retains choice and inventory; timeout settles interrupted',t=>{
 const x=setup(t),r=started(x);enterShop(x,r);const time=r.game.time,visit=r.shop.visit;
 x.rooms.disconnected(x.b);x.advance(10000);x.rooms.tick(.1);assert.equal(r.game.time,time);
 x.rooms.connected(x.b);assert.equal(r.phase,'shop');assert.equal(r.shop.visit,visit);
 x.rooms.handle(x.b,{type:'egg',visit,index:1});const reward=r.shop.reward;
 x.rooms.disconnected(x.a);x.rooms.connected(x.a);assert.equal(r.shop.reward,reward);assert.equal(r.game.items[reward],1);
 x.rooms.disconnected(x.a);x.advance(15001);x.rooms.tick(.1);assert.equal(r.phase,'ended');assert.equal(r.result.interrupted,true);
});
test('solo can claim and use items; duo active item buttons belong only to dash player',t=>{
 const x=setup(t);const r=x.rooms.solo(x.a,'xiaobai');x.advance(3001);x.rooms.tick(.01);enterShop(x,r);
 x.rooms.handle(x.a,{type:'egg',visit:r.shop.visit,index:r.eggs.indexOf('bridge')});x.rooms.handle(x.a,{type:'shop-continue',visit:r.shop.visit});x.advance(3001);x.rooms.tick(.01);
 x.rooms.handle(x.a,{type:'use-item',item:'bridge'});assert.equal(r.game.items.bridge,0);assert.ok(r.game.entities.some(e=>e.bridge));
 x.rooms.leave(x.a);const duo=started(x);duo.game.items.stopwatch=1;
 assert.throws(()=>x.rooms.handle(x.a,{type:'use-item',item:'stopwatch'}));x.rooms.handle(x.b,{type:'use-item',item:'stopwatch'});assert.equal(duo.game.freeze,5);
});

test('sequenced input acknowledgement prevents duplicate jumps without trusting client state',t=>{
 const x=setup(t),r=started(x);x.rooms.handle(x.a,{type:'input',action:'jump',seq:1});
 assert.equal(r.game.dog.jumps,1);assert.equal(r.game.inputAck[x.a],1);
 x.rooms.handle(x.a,{type:'input',action:'jump',seq:1});assert.equal(r.game.dog.jumps,1);
 x.rooms.handle(x.a,{type:'input',action:'jump',seq:2});assert.equal(r.game.dog.jumps,0);
 x.rooms.handle(x.a,{type:'input',action:'jump',seq:3});assert.equal(r.game.dog.jumps,0);assert.equal(r.game.inputAck[x.a],3);
});

test('shop draws three distinct hidden items from the six-item pool',t=>{
 const x=setup(t),r=started(x);enterShop(x,r,false);
 assert.equal(r.eggs.length,3);assert.equal(new Set(r.eggs).size,3);
 for(const item of r.eggs)assert.ok(['stopwatch','bridge','talisman','fireball','puppy','wings'].includes(item));
 assert.equal(x.rooms.snapshot(r).shop.reward,null);assert.ok(!JSON.stringify(x.rooms.snapshot(r)).includes('eggs'));
});
test('wings and flight release belong to jump role, pause and disconnect release held flight',t=>{
 const x=setup(t),r=started(x);r.game.items.wings=2;
 assert.throws(()=>x.rooms.handle(x.b,{type:'use-item',item:'wings'}));
 x.rooms.handle(x.a,{type:'use-item',item:'wings'});assert.equal(r.game.dog.wings,10);assert.equal(r.game.items.wings,1);
 x.rooms.handle(x.a,{type:'input',action:'jump'});assert.equal(r.game.dog.jumpHeld,true);
 assert.throws(()=>x.rooms.handle(x.b,{type:'input',action:'jump-release'}));
 x.rooms.handle(x.a,{type:'input',action:'jump-release'});assert.equal(r.game.dog.jumpHeld,false);
 x.rooms.handle(x.a,{type:'input',action:'jump'});x.rooms.handle(x.a,{type:'pause'});assert.equal(r.game.dog.jumpHeld,false);
 x.rooms.handle(x.a,{type:'resume'});x.rooms.handle(x.b,{type:'resume'});x.advance(3001);x.rooms.tick(.01);
 x.rooms.handle(x.a,{type:'input',action:'jump'});x.rooms.disconnected(x.b);assert.equal(r.game.dog.jumpHeld,false);
});
test('new egg rewards grant once, survive reconnect, and do not create invalid inventory',t=>{
 const x=setup(t),r=started(x);enterShop(x,r);r.eggs=['fireball','puppy','wings'];
 x.rooms.handle(x.b,{type:'egg',visit:r.shop.visit,index:0});x.rooms.handle(x.b,{type:'egg',visit:r.shop.visit,index:0});assert.equal(r.game.fire,5);
 x.rooms.disconnected(x.b);x.rooms.connected(x.b);assert.equal(r.game.fire,5);assert.equal(r.shop.reward,'fireball');
});
