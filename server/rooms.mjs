import { randomInt, randomUUID } from 'node:crypto';
import { createGame, action, step, finish, useItem, grantItem, ITEM_POOL } from '../public/game.mjs';
import { cleanName } from './store.mjs';

export class Rooms {
  constructor(store, emit = () => {}, { now = () => Date.now(), countdownMs = 3000, reconnectMs = 15000 } = {}) {
    this.store = store; this.emit = emit; this.now = now; this.countdownMs = countdownMs; this.reconnectMs = reconnectMs;
    this.rooms = new Map(); this.memberRoom = new Map(); this.online = new Set();
  }
  member(id) { return { id, ready: false, resume: false, online: this.online.has(id), deadline: null }; }
  find(id) { return this.rooms.get(this.memberRoom.get(id)); }
  snapshot(r) {
    return { mode:r.mode||'duo', code: r.code, host: r.host, name: r.team?.name || r.name, character: r.character,
      teamId: r.team?.id, best: r.team?.best || null, phase: r.phase, manualPause: r.manualPause,
      countdown: r.phase === 'countdown' ? Math.max(0, Math.ceil((r.until - this.now()) / 1000)) : null,
      reconnect: r.members.some(m => m.deadline) ? Math.max(0, Math.ceil((Math.min(...r.members.filter(m => m.deadline).map(m => m.deadline)) - this.now()) / 1000)) : null,
      members: r.members.map((m, i) => ({ ...this.store.publicPlayer(this.store.data.players[m.id]), ready: m.ready, resume: m.resume, online: m.online, role: r.mode==='solo'?'both':i === 0 ? 'jump' : 'dash' })),
      shop: r.shop ? { visit: r.shop.visit, picked: r.shop.picked, reward: r.shop.reward } : null,
      result: r.result || null };
  }
  publish(r) { const room = this.snapshot(r); for (const m of r.members) this.emit(m.id, { type: 'room', room }); }
  connected(id) {
    this.online.add(id); const r = this.find(id); if (!r) return;
    const m = r.members.find(m => m.id === id); m.online = true; m.deadline = null;
    if (r.phase === 'paused' && !r.manualPause && r.members.every(m => m.online)) { if (r.shop) { r.phase = 'shop'; r.game.status = 'shop'; } else this.countdown(r); }
    this.publish(r); if (r.game) this.emit(id, { type: 'state', state: r.game });
  }
  disconnected(id) {
    this.online.delete(id); const r = this.find(id); if (!r) return;
    const m = r.members.find(m => m.id === id); m.online = false; m.deadline = this.now() + this.reconnectMs;
    if (['running', 'countdown', 'paused', 'shop'].includes(r.phase)) { r.phase = 'paused'; r.game.status = 'paused'; r.game.dog.jumpHeld = false; }
    this.publish(r);
  }
  create(id, name) {
    if (this.find(id)) throw new Error('请先退出当前房间');
    if (this.rooms.size >= 100) throw new Error('房间已满，请稍后重试');
    let code; do { code = String(randomInt(100000, 1000000)); } while (this.rooms.has(code));
    const r = { code, host: id, members: [this.member(id)], name: cleanName(name, '两只小狗一起跑'), character: 'jimao', phase: 'lobby', manualPause: false };
    this.rooms.set(code, r); this.memberRoom.set(id, code); this.publish(r); return r;
  }
  join(id, code) {
    const current = this.find(id); if (current?.code === code) { this.publish(current); return; }
    if (current) throw new Error('请先退出当前房间');
    const r = this.rooms.get(code); if (!r) throw new Error('没有找到这个房间');
    if (r.mode==='solo' || r.members.length === 2 || r.phase !== 'lobby') throw new Error('房间已经满员或正在游戏');
    r.members.push(this.member(id)); this.memberRoom.set(id, code);
    r.team = this.store.team(r.members[0].id, id, r.name); r.character = r.team.character;
    r.members.forEach(m => m.ready = false); this.publish(r);
  }
  startRun(r) {
    r.shop=null;r.eggs=null;r.game=createGame(randomInt(0x7fffffff),r.character);r.runId=randomUUID();r.coinOwner=r.host;
    r.game.equipped={...(this.store.data.players[r.host].equipped||{})};r.result=null;r.recorded=false;r.manualPause=false;this.countdown(r);
  }
  solo(id,character) {
    if(!['jimao','xiaobai'].includes(character))throw new Error('未知角色');
    const r=this.create(id,this.store.data.players[id].name);r.mode='solo';r.character=character;this.startRun(r);this.publish(r);return r;
  }
  countdown(r) { r.phase = 'countdown'; r.game.status = 'paused'; r.game.dog.jumpHeld = false; r.until = this.now() + this.countdownMs; r.members.forEach(m => m.resume = false); }
  handle(id, msg) {
    if (msg.type === 'solo') return this.solo(id,msg.character||'jimao');
    if (msg.type === 'create') return this.create(id, msg.name);
    if (msg.type === 'join') return this.join(id, String(msg.code));
    const r = this.find(id); if (!r) throw new Error('请先加入房间');
    const m = r.members.find(m => m.id === id);
    if (msg.type === 'leave') return this.leave(id);
    if (['egg', 'shop-continue', 'use-item'].includes(msg.type)) {
      const controller = msg.type === 'use-item' && msg.item === 'wings' ? 0 : 1;
      if (r.mode !== 'solo' && r.members[controller]?.id !== id) throw new Error(controller === 0 ? '天使之翼由跳跃方使用' : '由冲刺方使用道具和选择金蛋');
      if (!r.members.every(m => m.online)) throw new Error('等待搭档重新连接');
      if (msg.type === 'use-item') { if (r.phase === 'running') useItem(r.game, msg.item); }
      else if (r.phase === 'shop' && r.shop && msg.visit === r.shop.visit) {
        if (msg.type === 'egg' && r.shop.picked === null && Number.isInteger(msg.index) && msg.index >= 0 && msg.index < 3) {
          r.shop.picked = msg.index; r.shop.reward = r.eggs[msg.index]; grantItem(r.game, r.shop.reward);
        } else if (msg.type === 'shop-continue' && r.shop.picked !== null) { r.shop = null; r.eggs = null; this.countdown(r); }
      }
      this.publish(r); for (const member of r.members) this.emit(member.id, { type: 'state', state: r.game }); return;
    }
    if (msg.type === 'configure' && r.phase === 'lobby') {
      if (id !== r.host) throw new Error('由房主选择角色和修改队名');
      if (msg.character && !['jimao', 'xiaobai'].includes(msg.character)) throw new Error('未知角色');
      if (msg.character) r.character = msg.character;
      if (msg.name !== undefined) r.name = cleanName(msg.name, r.name);
      if (r.team) { r.team.character = r.character; r.team.name = msg.name === undefined ? r.team.name : r.name; this.store.save(); }
      r.members.forEach(m => m.ready = false);
    } else if (msg.type === 'swap' && r.phase === 'lobby' && id === r.host) {
      r.members.reverse(); r.members.forEach(m => m.ready = false);
    } else if (msg.type === 'ready' && r.phase === 'lobby') {
      if (r.members.length !== 2) throw new Error('等待搭档加入后再准备');
      m.ready = !m.ready;
    } else if (msg.type === 'start' && r.phase === 'lobby' && id === r.host) {
      if (r.members.length !== 2 || !r.members.every(m => m.ready && m.online)) throw new Error('需要双方在线并准备');
      this.startRun(r);
    } else if (msg.type === 'input' && r.phase === 'running') {
      const role = r.members[0].id === id ? 'jump' : 'dash';
      if (!['jump','jump-release','dash'].includes(msg.action) || (r.mode!=='solo' && (msg.action === 'jump-release' ? 'jump' : msg.action) !== role)) throw new Error('该按钮由搭档控制');
      if (Number.isSafeInteger(msg.seq) && msg.seq > 0) {
        r.game.inputAck ||= {};
        if (msg.seq <= (r.game.inputAck[id] || 0)) return;
        r.game.inputAck[id] = msg.seq;
      }
      action(r.game, msg.action); return;
    } else if (msg.type === 'pause' && ['running', 'countdown'].includes(r.phase)) {
      r.manualPause = true; r.phase = 'paused'; r.game.status = 'paused'; r.game.dog.jumpHeld = false; r.members.forEach(m => m.resume = false);
    } else if (msg.type === 'resume' && r.phase === 'paused') {
      m.resume = true;
      if (r.members.length === (r.mode==='solo'?1:2) && r.members.every(m => m.resume && m.online)) { r.manualPause = false; this.countdown(r); }
    } else if (msg.type === 'again' && r.phase === 'ended') {
      if(r.mode==='solo')this.startRun(r);else { r.phase = 'lobby'; r.game = null; r.result = null; r.members.forEach(m => m.ready = false); }
    }
    this.publish(r);
  }
  settle(r, interrupted) {
    if (!r.game || r.recorded) return;
    r.recorded = true; r.phase = 'ended'; finish(r.game, interrupted ? 'interrupted' : r.game.reason);
    r.result = r.mode==='solo'?this.store.recordSolo(r.coinOwner,r.game,interrupted,r.runId):this.store.record(r.team, r.game, interrupted, r.runId,r.coinOwner); this.publish(r);
    this.emit(r.coinOwner,{type:'account',account:this.store.account(this.store.data.players[r.coinOwner])});
    for (const m of r.members) this.emit(m.id, { type: 'state', state: r.game });
  }
  leave(id) {
    const r = this.find(id); if (!r) return;
    if (['running', 'paused', 'countdown', 'shop'].includes(r.phase)) this.settle(r, true);
    r.members = r.members.filter(m => m.id !== id); this.memberRoom.delete(id);
    this.emit(id, { type: 'left' });
    if (!r.members.length) { this.rooms.delete(r.code); return; }
    if (r.host === id) r.host = r.members[0].id;
    if (r.phase === 'lobby') { r.team = null; r.members.forEach(m => m.ready = false); }
    this.publish(r);
  }
  tick(dt) {
    for (const r of [...this.rooms.values()]) {
      for (const m of [...r.members]) if (m.deadline && m.deadline <= this.now()) this.leave(m.id);
      if (!this.rooms.has(r.code)) continue;
      if (r.phase === 'countdown' && this.now() >= r.until) { r.phase = 'running'; r.game.status = 'running'; this.publish(r); }
      if (r.phase === 'running') { step(r.game, dt);
        if (r.game.status === 'shop') {
          r.phase = 'shop'; r.shop = { visit: `${r.runId}:${r.game.portalVisit}`, picked: null, reward: null };
          r.game.dog.jumpHeld = false; r.eggs = [...ITEM_POOL];
          for (let i = r.eggs.length - 1; i > 0; i--) { const j = randomInt(i + 1); [r.eggs[i], r.eggs[j]] = [r.eggs[j], r.eggs[i]]; }
          r.eggs = r.eggs.slice(0, 3); this.publish(r);
        }
        if(this.store.award(r.coinOwner,r.game.distance,r.runId))this.emit(r.coinOwner,{type:'account',account:this.store.account(this.store.data.players[r.coinOwner])}); if (r.game.status === 'ended') this.settle(r, false); }
    }
  }
}
