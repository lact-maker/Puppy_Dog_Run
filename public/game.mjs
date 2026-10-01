// Shared deterministic simulation. The server is authoritative in network games.
export const RULES = Object.freeze({ layer: 90, layers: 5, gravity: 1100, baseSpeed: 220,
  maxLives: 3, dogWidth: 30, dogHeight: 49, swordSeconds: 10, hurtSeconds: 1.5,
  dashSeconds: .3, dashGap: .15, groundCooldown: 1, reconnectSeconds: 15, flightSpeed: 180 });

export const ITEM_POOL = Object.freeze(['stopwatch', 'bridge', 'talisman', 'fireball', 'puppy', 'wings']);

export function random(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
export function dogBox(d) { return { x: d.x - RULES.dogWidth / 2, y: d.y, w: RULES.dogWidth, h: RULES.dogHeight }; }
export function speedAt(distance) { return RULES.baseSpeed * Math.min(4, 1 + .1 * distance / 100); }
export function createGame(seed = 42, character = 'jimao') {
  const s = { seed: seed >>> 0, character, time: 0, distance: 0, runDistance: 0, bonusDistance: 0, kills: 0, speed: RULES.baseSpeed,
    items: { stopwatch: 0, bridge: 0, talisman: 0, wings: 0 }, fire: 0, fireCooldown: 0, shotId: 0, companion: false, freeze: 0, monsterTime: 0, nextPortal: 300, portalVisit: 0,
    status: 'running', reason: '', nextChunk: 0, entities: [], events: [],
    dog: { x: 100, airStartX: 100, y: 0, vy: 0, grounded: true, jumps: 2, dashes: 2, jumpCeiling: 90,
      wings: 0, jumpHeld: false, lives: 1, sword: 0, hurt: 0, dash: 0, dashGap: 0, groundCooldown: 0 } };
  s.entities.push({ id: 'start', type: 'ground', x: -500, y: 0, w: 1800, h: 0 });
  ensureWorld(s); return s;
}
export function generateChunk(seed, index) {
  const rng = random((seed ^ Math.imul(index + 1, 2654435761)) >>> 0);
  const start = 1300 + index * 1000, entities = [];
  let n = 0;
  const put = (type, x, y, w, h, extra = {}) => entities.push({ id: `${index}:${n++}`, type, x, y, w, h, ...extra });
  const wide = index % 4 === 2;
  const gapStart = start + 330 + rng() * 100, gapWidth = wide ? 480 : 135 + rng() * 125;
  put('ground', start, 0, gapStart - start, 0);
  put('ground', gapStart + gapWidth, 0, start + 1000 - gapStart - gapWidth, 0);
  if (wide) {
    put('platform', gapStart - 75, 90, 105, 0);
    put('platform', gapStart + 130, 180, 105, 0);
    put('platform', gapStart + 320, 90, 110, 0);
  }
  for (let level = 1; level <= 3; level++) {
    put('platform', start + 70 + rng() * 210, level * 90, 85 + rng() * 65, 0);
    if (rng() < .7) put('platform', start + 540 + rng() * 220, level * 90, 90 + rng() * 55, 0);
  }
  if (rng() < .85) put('spike', start + 180 + rng() * 600, 360, 65 + rng() * 95, 90);
  // Include the entire icon, hit area and idle-bob envelope in exclusion checks.
  // One pickup per jittered distance milestone, independent of obstacle RNG.
  // Consecutive spacing: hearts 800–1200 m; swords 400–600 m.
  for (const [type, period, salt] of [['heart', 1000, 773], ['sword', 500, 991]]) {
    const first = Math.max(1, Math.floor((start - 100) / 10 / period));
    const last = Math.ceil((start + 1000 - 100) / 10 / period);
    for (let k = first; k <= last; k++) {
      const pick = random((seed ^ Math.imul(k, 1597334677) ^ salt) >>> 0);
      const x = 100 + (k * period + (pick() - .5) * period * .2) * 10;
      if (x < start || x >= start + 1000) continue;
      let layer = Math.floor(pick() * 5);
      const envelope = { x: x - 7, y: layer * 90 + 21, w: 42, h: 42 };
      if (entities.some(e => e.type === 'spike' && overlaps(envelope, e))) layer = Math.floor(pick() * 4);
      put(type, x, layer * 90 + 28, 28, 28);
    }
  }
  for (let i = 0; i < 2 + Math.floor(rng() * 2); i++) {
    const layer = Math.floor(rng() * 5);
    put('monster', start + 220 + rng() * 700, layer * 90 + 20, 34, 32,
      { layer, drop: 0, targetY: layer * 90 + 20 });
  }
  return entities;
}
export function ensureWorld(s) {
  while (1300 + s.nextChunk * 1000 < s.dog.x + 2300) {
    s.entities.push(...generateChunk(s.seed, s.nextChunk++));
  }
  s.entities = s.entities.filter(e => !e.dead && e.x + e.w > s.dog.x - 500);
}
export function action(s, type) {
  if (s.status !== 'running') return false;
  const d = s.dog;
  if (type === 'jump-release') { d.jumpHeld = false; return true; }
  if (type === 'jump') {
    d.jumpHeld = true;
    if (d.wings > 0) { d.grounded = false; return true; }
  }
  if (type === 'jump' && d.jumps > 0) {
    if (d.grounded) d.airStartX = d.x;
    d.jumps--; d.vy = Math.sqrt(2 * RULES.gravity * RULES.layer);
    d.jumpCeiling = d.y + RULES.layer; d.grounded = false;
    s.events.push('jump'); return true;
  }
  if (type === 'dash' && d.dashGap <= 0) {
    if (d.grounded) {
      if (d.groundCooldown > 0) return false;
      d.groundCooldown = RULES.groundCooldown;
    } else {
      if (d.dashes <= 0) return false;
      d.dashes--;
    }
    d.dash += RULES.dashSeconds; d.dashGap = RULES.dashGap;
    s.events.push('dash'); return true;
  }
  return false;
}
function bridge(s) {
  const d = s.dog; d.y = Math.max(0, d.y); d.vy = 0; d.grounded = true;
  d.jumps = 2; d.dashes = 2; d.dashGap = 0; d.groundCooldown = 0; d.dash = 0;
  for (let i = 0; i < 3; i++) s.entities.push({ id: `bridge:${s.time}:${i}`, type: 'platform', bridge: true, x: d.x - 45 + i * 110, y: d.y - i * 15, w: 115, h: 0 });
}
export function grantItem(s, item) {
  if (!ITEM_POOL.includes(item)) return false;
  if (item === 'fireball') s.fire += 5;
  else if (item === 'puppy') s.companion = true;
  else s.items[item] = (s.items[item] || 0) + 1;
  return true;
}
export function useItem(s, item) {
  if (s.status !== 'running' || !['stopwatch', 'bridge', 'wings'].includes(item) || !(s.items[item] > 0)) return false;
  if (item === 'wings' && s.dog.wings > 0) return false;
  s.items[item]--;
  if (item === 'stopwatch') s.freeze = 5;
  else if (item === 'wings') { s.dog.wings = 10; s.dog.vy = 0; s.dog.jumpCeiling = 450; }
  else bridge(s);
  return true;
}
export function finish(s, reason) { s.status = 'ended'; s.reason = reason; }
function hurt(s) {
  const d = s.dog;
  if (d.hurt > 0) return;
  if (s.companion) { s.companion = false; d.hurt = RULES.hurtSeconds; s.events.push('companion'); return; }
  d.lives--; d.hurt = RULES.hurtSeconds; s.events.push('hurt');
  if (d.lives <= 0) finish(s, 'lives');
}
export function step(s, dt) {
  if (s.status !== 'running') return;
  // Small fixed substeps provide swept movement at maximum dash speed.
  let remaining = Math.max(0, Math.min(dt, .1));
  const surfaces = s.entities.filter(e => e.type === 'ground' || e.type === 'platform');
  const spikes = s.entities.filter(e => e.type === 'spike');
  while (remaining > 1e-8 && s.status === 'running') {
    const h = Math.min(remaining, 1 / 240); remaining -= h; tick(s, h, surfaces, spikes);
  }
  ensureWorld(s);
  s.events = s.events.slice(-8);
}
function kill(s, monster) {
  if (monster.dead) return;
  monster.dead = true; s.kills++; s.bonusDistance += 5; s.distance += 5; s.events.push('kill');
}
function tick(s, dt, surfaces, spikes) {
  const d = s.dog, oldX = d.x, oldY = d.y;
  const wasDash = d.dash > 0, flying = d.wings > 0;
  const monsterDt = Math.max(0, dt - s.freeze); s.freeze = Math.max(0, s.freeze - dt); s.monsterTime += monsterDt;
  for (const key of ['sword', 'hurt', 'dash', 'dashGap', 'groundCooldown', 'wings']) d[key] = Math.max(0, d[key] - dt);
  s.time += dt; s.speed = speedAt(s.distance);
  d.x += s.speed * (wasDash ? 2 : 1) * dt;
  if (d.grounded && !surfaces.some(e => Math.abs(d.y - e.y) < .1 && d.x + 13 > e.x && d.x - 13 < e.x + e.w)) {
    d.airStartX = oldX; d.grounded = false; d.vy = 0;
  }
  if (flying) {
    d.vy = d.jumpHeld ? RULES.flightSpeed : -RULES.flightSpeed;
    d.y = Math.min(450 - RULES.dogHeight, d.y + d.vy * dt); d.grounded = false;
    if (!d.jumpHeld) {
      const landing = surfaces.filter(e => oldY >= e.y - .001 && d.y <= e.y && d.x + 13 > e.x && d.x - 13 < e.x + e.w);
      if (landing.length) { d.y = Math.max(...landing.map(e=>e.y)); d.vy = 0; d.grounded = true; d.jumps = 2; d.dashes = 2; }
    }
    d.jumpCeiling = 450;
  } else if (!d.grounded) {
    const nextY = d.y + d.vy * dt - .5 * RULES.gravity * dt * dt;
    const oldVy = d.vy;
    d.vy -= RULES.gravity * dt;
    d.y = Math.min(nextY, d.jumpCeiling);
    // Snap the analytically reached apex so a platform exactly one layer up
    // remains landable even when no frame happens at the exact apex instant.
    if (oldVy > 0 && d.vy <= 0) d.y = d.jumpCeiling;
    if (nextY > d.jumpCeiling) d.vy = Math.min(0, d.vy);
    if (d.vy <= 0) {
      const landings = surfaces.filter(e => oldY >= e.y - .001 && d.y <= e.y && d.x + 13 > e.x && d.x - 13 < e.x + e.w);
      if (landings.length) {
        d.y = Math.max(...landings.map(e => e.y)); d.vy = 0; d.grounded = true; d.jumps = 2; d.dashes = 2;
      }
    }
  }
  s.runDistance = Math.max(s.runDistance || 0, (d.x - 100) / 10);
  s.distance = Math.max(s.distance, s.runDistance + (s.bonusDistance || 0));
  if (d.y < -110) {
    if (s.items.talisman > 0) { s.items.talisman--; bridge(s); d.hurt = RULES.hurtSeconds; s.events.push('revive'); surfaces.push(...s.entities.filter(e => e.bridge && !surfaces.includes(e))); return; }
    finish(s, 'fall'); return;
  }
  while (s.distance >= s.nextPortal) {
    const milestone = s.nextPortal; s.nextPortal += 800;
    const rng = random(s.seed ^ milestone);
    s.entities.push({ id: `portal:${milestone}`, type: 'portal', x: d.x + 260 + rng() * 120, y: Math.floor(rng() * 4) * 90, w: 65, h: 85 });
  }
  if (s.fire > 0) {
    s.fireCooldown -= dt;
    if (s.fireCooldown <= 0) {
      s.fireCooldown = .3;
      s.entities.push({id:`fire:${s.shotId++}`,type:'fireball',x:d.x+18,y:d.y+20,w:24,h:20,ttl:.9});
    }
    s.fire = Math.max(0, s.fire - dt);
  }
  for (const shot of s.entities) if (shot.type === 'fireball' && !shot.dead) {
    if (s.fire <= 0) { shot.dead = true; continue; }
    const from = shot.x; shot.x += (s.speed * 2 + 600) * dt; shot.ttl -= dt;
    const sweep = {x:from,y:shot.y,w:shot.x-from+shot.w+s.speed*.25*monsterDt,h:shot.h};
    for (const target of s.entities) if (target.type === 'monster' && !target.dead && overlaps(sweep,target)) { kill(s,target);shot.dead=true;break; }
    if (shot.ttl <= 0) shot.dead = true;
  }
  const swept = { x: Math.min(oldX, d.x) - 15, y: Math.min(oldY, d.y), w: Math.abs(d.x - oldX) + 30, h: Math.abs(d.y - oldY) + 49 };
  for (const e of s.entities) {
    if (e.dead) continue;
    if (e.type === 'monster') {
      e.x -= s.speed * .25 * monsterDt;
      if (monsterDt > 0 && e.layer === 4 && !e.drop && spikes.some(sp => overlaps(e, sp))) {
        e.layer = 3; e.drop = .2; e.targetY = e.y - 90;
      }
      if (e.drop > 0 && monsterDt > 0) {
        const move = Math.min(monsterDt, e.drop); e.y -= 450 * move; e.drop = Math.max(0, e.drop - monsterDt);
        if (!e.drop) e.y = e.targetY;
      }
    }
    if (e.type === 'portal' && overlaps(swept, e)) { e.dead = true; s.portalVisit++; s.status = 'shop'; return; }
    if (!['spike', 'monster', 'heart', 'sword'].includes(e.type) || !overlaps(swept, e)) continue;
    if (e.type === 'heart') { d.lives = Math.min(3, d.lives + 1); e.dead = true; s.events.push('heart'); }
    else if (e.type === 'sword') { d.sword = 10; e.dead = true; s.events.push('sword'); }
    else if (e.type === 'monster') {
      if (d.sword > 0 || wasDash) { kill(s, e); } else hurt(s);
    } else if (d.sword <= 0) hurt(s);
    if (s.status === 'ended') break;
  }
}
