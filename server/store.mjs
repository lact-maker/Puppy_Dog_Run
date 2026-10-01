import { CATALOG } from '../public/shop.mjs';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const cleanName = (value, fallback = '小狗朋友') => String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 20) || fallback;
export function validAvatar(value) {
  if (!value) return '';
  if (typeof value !== 'string' || value.length > 180000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('头像格式不支持，请选择较小的图片');
  return value;
}
export class Store {
  constructor(file) {
    this.file = file;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { players: {}, teams: {}, version: 1 };
    this.data.solos ||= {}; this.data.rewards ||= {}; this.data.settlements ||= {}; this.data.version=2;
  }
  account(p) { return { ...this.publicPlayer(p), coins:p.coins||0, owned:p.owned||[], equipped:p.equipped||{} }; }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data)); renameSync(`${this.file}.tmp`, this.file);
  }
  publicPlayer(p) { return { id: p.id, name: p.name, avatar: p.avatar }; }
  register(name, avatar = '') {
    const token = randomBytes(32).toString('hex');
    const p = { id: randomUUID(), name: cleanName(name), avatar: validAvatar(avatar), tokenHash: digest(token) };
    this.data.players[p.id] = p; this.save(); return { player: this.publicPlayer(p), token };
  }
  auth(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const hash = digest(token); return Object.values(this.data.players).find(p => p.tokenHash === hash) || null;
  }
  update(p, data) {
    const avatar = data.avatar === undefined ? p.avatar : validAvatar(data.avatar);
    p.name = cleanName(data.name, p.name); p.avatar = avatar; this.save(); return this.publicPlayer(p);
  }
  team(a, b, name) {
    const key = [a, b].sort().join(':');
    if (!this.data.teams[key]) this.data.teams[key] = { id: key, members: [a, b].sort(), name: cleanName(name, '两只小狗一起跑'), character: 'jimao', best: null };
    this.save(); return this.data.teams[key];
  }
  viewTeam(t) { return { ...t, members: t.members.map(id => this.publicPlayer(this.data.players[id])) }; }
  history(id) { return Object.values(this.data.teams).filter(t => t.members.includes(id)).map(t => this.viewTeam(t)); }
  record(t, s, interrupted, runId, owner = t.members[0]) {
    if(this.data.settlements[runId]) return this.data.settlements[runId];
    this.award(owner,s.distance,runId);
    const result = { distance: Math.floor(s.distance * 10) / 10, duration: Math.floor(s.time * 1000), at: Date.now(), interrupted, runId };
    const improved = !t.best || result.distance > t.best.distance;
    if (improved) t.best = result;
    for (const id of t.members) this.data.players[id].lastResult = { ...result, teamName: t.name };
    this.save();
    const output={ ...result, improved, best:t.best, coinsEarned:Math.floor(result.distance/5000), coinOwner:owner, kills:s.kills||0, bonusDistance:s.bonusDistance||0 };
    this.data.settlements[runId]=output; this.save(); return output;
  }
  award(id,distance,runId) {
    const amount=Math.floor(Math.max(0,distance)/5000), old=this.data.rewards[runId];
    if(old && old.player!==id) throw new Error('金币归属不一致');
    if(amount<=(old?.amount||0))return 0;
    const p=this.data.players[id];if(!p)throw new Error('账户不存在');
    const delta=amount-(old?.amount||0);p.coins=(p.coins||0)+delta;
    this.data.rewards[runId]={player:id,amount};this.save();return delta;
  }
  purchase(p,id) {
    const item=CATALOG.find(i=>i.id===id);if(!item)throw new Error('装饰不存在');
    p.owned ||= [];p.equipped ||= {};
    if(p.owned.includes(id))return this.account(p);
    if((p.coins||0)<item.price)throw new Error('金币还不够，再跑一段吧');
    p.coins-=item.price;p.owned.push(id);p.equipped[item.slot]=id;this.save();return this.account(p);
  }
  equip(p,id,enabled) {
    const item=CATALOG.find(i=>i.id===id);if(!item||!p.owned?.includes(id))throw new Error('请先购买这件装饰');
    p.equipped ||= {};if(enabled)p.equipped[item.slot]=id;else delete p.equipped[item.slot];this.save();return this.account(p);
  }
  recordSolo(id,s,interrupted,runId) {
    const p=this.data.players[id];const t=this.data.solos[id] ||= {id,members:[id],name:p.name,best:null};t.name=p.name;
    return this.record(t,s,interrupted,runId,id);
  }
  leaderboard(mode='duo') {
    if(mode==='solo')return Object.values(this.data.solos).filter(t=>t.best).sort((a,b)=>b.best.distance-a.best.distance||a.best.at-b.best.at).slice(0,20).map((t,i)=>({rank:i+1,...this.viewTeam(t),name:this.data.players[t.id].name}));
    return Object.values(this.data.teams).filter(t => t.best).sort((a, b) => b.best.distance - a.best.distance || a.best.at - b.best.at)
      .slice(0, 20).map((t, i) => ({ rank: i + 1, ...this.viewTeam(t) }));
  }
}
