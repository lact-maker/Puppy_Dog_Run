import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, action, generateChunk, overlaps, speedAt, useItem, grantItem } from '../public/game.mjs';

function empty() { const s = createGame(1, 'jimao'); s.entities = [{ type: 'ground', x: -1000, y: 0, w: 1e7, h: 0 }]; s.nextChunk = 1e6; s.nextPortal = Infinity; return s; }
function run(s, seconds) { for (let t = 0; t < seconds - 1e-8; t += 1 / 120) step(s, Math.min(1 / 120, seconds - t)); }
test('each jump rises at most one layer; landing restores jumps and dashes', () => {
  const s = empty(); action(s, 'jump'); let max = 0;
  for (let i = 0; i < 105; i++) { step(s, 1 / 120); max = Math.max(max, s.dog.y); }
  assert.ok(max <= 90.01 && max > 89); assert.equal(s.dog.grounded, true); assert.equal(s.dog.jumps, 2);
  action(s, 'jump'); run(s, .4); const secondStart = s.dog.y; action(s, 'jump'); assert.equal(action(s, 'jump'), false);
  max = 0; for (let i = 0; i < 50; i++) { step(s, 1 / 120); max = Math.max(max, s.dog.y); }
  assert.ok(max <= secondStart + 90.01 && max > 170);
});
test('platform is one-way, side and underside do not hurt, descent lands', () => {
  const s = empty(); s.entities.push({ type: 'platform', x: 0, y: 60, w: 2000, h: 0 }); action(s, 'jump'); run(s, .45);
  assert.ok(s.dog.y > 60); run(s, .3); assert.equal(s.dog.y, 60); assert.equal(s.dog.lives, 1); assert.equal(s.dog.jumps, 2);
});
test('a platform exactly one layer higher can be reached with one jump', () => {
  const s = empty(); s.entities.push({ type: 'platform', x: 0, y: 90, w: 2000, h: 0 });
  action(s, 'jump'); run(s, .6); assert.equal(s.dog.y, 90); assert.equal(s.dog.grounded, true); assert.equal(s.dog.jumps, 2);
});
test('two airborne dashes, cooldown not reset by landing', () => {
  const s = empty(); assert.ok(action(s, 'dash')); assert.equal(action(s, 'dash'), false); run(s, .16); assert.equal(action(s, 'dash'), false);
  action(s, 'jump'); assert.ok(action(s, 'dash')); run(s, .16); assert.ok(action(s, 'dash')); run(s, .16); assert.equal(action(s, 'dash'), false);
  run(s, .49); assert.equal(s.dog.dashes, 2); assert.equal(s.dog.grounded, true); assert.ok(s.dog.groundCooldown > 0); assert.equal(action(s, 'dash'), false);
  run(s, .04); assert.equal(s.dog.groundCooldown, 0); assert.ok(action(s, 'dash'));
});
test('dash kills monsters but cannot protect from spikes; sword protects both', () => {
  for (const protection of ['none', 'dash', 'sword']) for (const type of ['monster', 'spike']) {
    const s = empty(); s.dog.lives = 3; s.dog[protection] = 1;
    s.entities.push({ type, x: 100, y: 0, w: 40, h: 60, layer: 0, drop: 0 }); step(s, 1 / 60);
    assert.equal(s.dog.lives, protection === 'sword' || (protection === 'dash' && type === 'monster') ? 3 : 2);
  }
});
test('damage cooldown prevents repeated contact draining all lives', () => {
  const s = empty(); s.dog.lives = 3; s.entities.push({ type: 'spike', x: 0, y: 0, w: 10000, h: 60 }); run(s, 1);
  assert.equal(s.dog.lives, 2); run(s, .6); assert.equal(s.dog.lives, 1);
});
test('hearts cap at 3 and swords refresh to 10 seconds rather than stack', () => {
  const s = empty(); s.dog.lives = 3; s.dog.sword = 7;
  s.entities.push({ type: 'heart', x: 100, y: 0, w: 30, h: 30 }, { type: 'sword', x: 100, y: 0, w: 30, h: 30 }); step(s, 1 / 240);
  assert.equal(s.dog.lives, 3); assert.equal(s.dog.sword, 10);
});
test('fall ends even with three lives and sword', () => { const s = empty(); s.entities = []; s.dog.lives = 3; s.dog.sword = 10; run(s, 1); assert.equal(s.reason, 'fall'); });
test('pause freezes distance, cooldowns, sword and active playtime', () => { const s = empty(); s.dog.sword = 10; s.status = 'paused'; const before = JSON.stringify(s); step(s, .1); assert.equal(JSON.stringify(s), before); });
test('random generation is deterministic, layer-constrained and pickups never overlap spikes', () => {
  assert.deepEqual(generateChunk(34, 3), generateChunk(34, 3));
  const seen = new Set();
  for (let seed = 1; seed <= 100; seed++) for (let i = 0; i < 20; i++) {
    const es = generateChunk(seed, i), spikes = es.filter(e => e.type === 'spike');
    for (const e of es) {
      if (e.type === 'spike') { assert.equal(e.y, 360); assert.equal(e.h, 90); }
      if (e.type === 'platform') assert.ok([90, 180, 270].includes(e.y));
      if (['heart', 'sword'].includes(e.type)) { seen.add(Math.floor(e.y / 90)); assert.ok(!spikes.some(sp => overlaps({ x: e.x - 7, y: e.y - 7, w: 42, h: 42 }, sp))); }
    }
  }
  assert.equal(seen.size, 5);
});
test('flying monster drops exactly one layer and retains base speed ratio', () => {
  const s = empty(); const monster = { type: 'monster', x: 500, y: 380, w: 34, h: 32, layer: 4, drop: 0 };
  s.entities.push(monster, { type: 'spike', x: 480, y: 360, w: 100, h: 90 }); run(s, .25);
  assert.equal(monster.layer, 3); assert.ok(Math.abs(monster.y - 290) < .01); assert.ok(Math.abs(monster.x - (500 - 55 * .25)) < .1);
});
test('base speed caps at 4x and max-speed dash does not tunnel through narrow spike', () => {
  assert.equal(speedAt(0), 220); assert.ok(Math.abs(speedAt(100) - 242) < 1e-9);
  assert.equal(speedAt(1000), 440); assert.equal(speedAt(3000), 880); assert.equal(speedAt(999999), 880);
  const s = empty(); s.distance = 15000; s.dog.dash = .3; s.dog.lives = 3;
  s.entities.push({ type: 'spike', x: 140, y: 0, w: 1, h: 70 }); step(s, .05); assert.equal(s.dog.lives, 2);
});
test('airborne jump spam, dash and pause cannot restore the two jump budget', () => {
  const s = empty(); action(s, 'jump'); run(s, .2); action(s, 'jump'); action(s, 'dash');
  s.status = 'paused'; assert.equal(action(s, 'jump'), false); step(s, .1); s.status = 'running';
  for (let i = 0; i < 35; i++) { assert.equal(action(s, 'jump'), false); step(s, 1 / 120); }
  assert.equal(s.dog.jumps, 0); assert.equal(s.dog.grounded, false);
  run(s, 1); assert.equal(s.dog.grounded, true); assert.ok(action(s, 'jump'));
});
test('distance-based pickups stay sparse, deterministic and inside their milestone windows', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const es = Array.from({ length: 110 }, (_, i) => generateChunk(seed, i)).flat();
    for (const [type, period] of [['heart', 1000], ['sword', 500]]) {
      const ds = es.filter(e => e.type === type).map(e => (e.x - 100) / 10).sort((a, b) => a - b);
      assert.ok(ds.length >= Math.floor(10000 / period));
      for (let i = 0; i < ds.length; i++) {
        assert.ok(Math.abs(ds[i] - (i + 1) * period) <= period * .1);
        if (i) assert.ok(ds[i] - ds[i - 1] >= period * .8 && ds[i] - ds[i - 1] <= period * 1.2);
      }
    }
  }
});

test('jump follows gravity while advancing at current run speed; second jump preserves forward momentum', () => {
  const slow = empty(), fast = empty(); fast.distance = 3000; fast.dog.x = 30100;
  const starts = [slow.dog.x, fast.dog.x];
  for (const s of [slow, fast]) { action(s, 'jump'); run(s, .3); }
  const expectedY = Math.sqrt(2 * 1100 * 90) * .3 - .5 * 1100 * .3 ** 2;
  assert.ok(Math.abs(slow.dog.y - expectedY) < 1e-7);
  assert.ok(Math.abs(fast.dog.y - expectedY) < 1e-7);
  const dxSlow = slow.dog.x - starts[0], dxFast = fast.dog.x - starts[1];
  assert.ok(dxSlow > 66 && dxSlow < 67); assert.ok(Math.abs(dxFast - 264) < 1e-6);
  assert.ok(dxFast > dxSlow * 3.9);
  const takeoff = fast.dog.airStartX, before = fast.dog.x;
  action(fast, 'jump'); run(fast, .1);
  assert.equal(fast.dog.airStartX, takeoff); assert.ok(fast.dog.x > before + 87);
});

test('protected monster kills add exactly 5m each without teleporting the dog',()=>{
 for(const shield of ['dash','sword']) {
  const s=empty();s.dog[shield]=1;const start=s.dog.x;
  s.entities.push(...[1,2].map(i=>({id:i,type:'monster',x:100,y:0,w:40,h:50,layer:0,drop:0})));
  step(s,1/240);assert.equal(s.kills,2);assert.equal(s.bonusDistance,10);
  assert.ok(s.dog.x-start<3);assert.ok(Math.abs(s.distance-s.runDistance-10)<1e-9);
  step(s,1/60);assert.equal(s.kills,2);assert.equal(s.bonusDistance,10);
 }
});

test('portal milestones spawn once, entry freezes all active simulation', () => {
 const s=empty();s.nextPortal=300;s.distance=299;step(s,.01);assert.ok(!s.entities.some(e=>e.type==='portal'));
 for(const milestone of [300,1100,1900,2700]) {s.distance=milestone;step(s,.01);assert.equal(s.entities.filter(e=>e.type==='portal').length,(milestone-300)/800+1);}
 step(s,.01);assert.equal(s.nextPortal,3500);
 const portal=s.entities.find(e=>e.type==='portal');portal.x=s.dog.x;portal.y=0;step(s,.01);assert.equal(s.status,'shop');
 const frozen=JSON.stringify(s);step(s,.1);assert.equal(JSON.stringify(s),frozen);
});
test('stopwatch freezes monster motion including falling for five active seconds only',()=>{
 const s=empty();const m={type:'monster',x:3000,y:380,w:34,h:32,layer:3,drop:.2,targetY:290};s.entities.push(m);s.items.stopwatch=2;
 assert.ok(useItem(s,'stopwatch'));assert.equal(s.items.stopwatch,1);const start=s.dog.x;run(s,2);assert.equal(m.x,3000);assert.equal(m.y,380);assert.ok(s.dog.x>start);
 s.status='paused';run(s,10);assert.ok(Math.abs(s.freeze-3)<.001);s.status='running';run(s,3);assert.ok(Math.abs(m.x-3000)<.001);run(s,.1);assert.ok(m.x<3000 && m.y<380);
});
test('bridge consumes one charge, stands under dog and restores both action budgets',()=>{
 const s=empty();s.items.bridge=2;s.dog.y=150;s.dog.grounded=false;s.dog.jumps=0;s.dog.dashes=0;s.dog.vy=-100;
 assert.ok(useItem(s,'bridge'));assert.equal(s.items.bridge,1);assert.equal(s.dog.y,150);assert.equal(s.dog.grounded,true);assert.equal(s.dog.jumps,2);assert.equal(s.dog.dashes,2);
 step(s,.01);assert.equal(s.dog.y,150);assert.ok(action(s,'jump'));s.status='paused';assert.equal(useItem(s,'bridge'),false);assert.equal(s.items.bridge,1);
});
test('talisman revives a fall once on safe footing, never protects from lethal monsters',()=>{
 const s=empty();s.entities=[];s.items.talisman=1;s.dog.y=-111;s.dog.grounded=false;step(s,.01);
 assert.equal(s.status,'running');assert.equal(s.items.talisman,0);assert.equal(s.dog.y,0);assert.equal(s.dog.jumps,2);assert.ok(s.entities.some(e=>e.bridge));
 s.dog.y=-111;s.dog.grounded=false;step(s,.01);assert.equal(s.reason,'fall');
 const b=empty();b.items.talisman=1;b.entities.push({type:'monster',x:100,y:0,w:35,h:49,layer:0});step(b,.01);assert.equal(b.reason,'lives');assert.equal(b.items.talisman,1);
});

test('fireball shoots forward, kills once for 5m and repeated rewards extend active duration',()=>{
 const s=empty();grantItem(s,'fireball');grantItem(s,'fireball');assert.equal(s.fire,10);
 s.entities.push({id:'target',type:'monster',x:230,y:20,w:34,h:32,layer:0,drop:0});run(s,.2);
 assert.equal(s.kills,1);assert.equal(s.bonusDistance,5);assert.ok(s.fire>9.79&&s.fire<9.81);
 s.status='shop';const fire=s.fire;run(s,2);assert.equal(s.fire,fire);s.status='running';
 run(s,10);assert.equal(s.fire,0);assert.ok(!s.entities.some(e=>e.type==='fireball'));assert.equal(s.kills,1);
});
test('companion grants one extra hit even at full hearts, never stacks and respects protection',()=>{
 for(const type of ['monster','spike']) {
  const s=empty();s.dog.lives=3;grantItem(s,'puppy');grantItem(s,'puppy');assert.equal(s.companion,true);
  s.entities.push({id:'hit',type,x:100,y:0,w:35,h:49,layer:0});step(s,.01);
  assert.equal(s.companion,false);assert.equal(s.dog.lives,3);s.dog.hurt=0;s.entities[1].x=s.dog.x;step(s,.01);assert.equal(s.dog.lives,2);
 }
 const s=empty();grantItem(s,'puppy');s.dog.sword=2;s.entities.push({type:'spike',x:100,y:0,w:35,h:49});step(s,.01);assert.equal(s.companion,true);
});
test('wings rise and fall at equal fixed speeds independent of run speed and expire after 10s',()=>{
 for(const distance of [0,3000]) {
  const s=empty();s.distance=distance;s.dog.y=180;s.dog.grounded=false;grantItem(s,'wings');grantItem(s,'wings');
  assert.ok(useItem(s,'wings'));assert.equal(s.items.wings,1);assert.equal(useItem(s,'wings'),false);assert.equal(s.items.wings,1);
  const start=s.dog.x;action(s,'jump');run(s,.2);assert.ok(Math.abs(s.dog.y-216)<.001);assert.ok(s.dog.x>start);assert.equal(s.dog.jumps,2);
  action(s,'jump-release');run(s,.2);assert.ok(Math.abs(s.dog.y-180)<.001);
  s.status='paused';const time=s.dog.wings;run(s,2);assert.equal(s.dog.wings,time);s.status='running';run(s,9.7);assert.equal(s.dog.wings,0);
  assert.ok(action(s,'jump'));assert.equal(s.dog.jumps,1);
 }
});
test('flight respects ceiling and spikes, expiry returns to gravity without teleport',()=>{
 const s=empty();grantItem(s,'wings');useItem(s,'wings');action(s,'jump');run(s,3);assert.ok(Math.abs(s.dog.y-401)<.001);
 s.dog.wings=.001;action(s,'jump-release');const before=s.dog.y;step(s,.02);assert.ok(s.dog.y<before && s.dog.y>before-5);
 const b=empty();grantItem(b,'wings');useItem(b,'wings');b.dog.y=365;b.entities.push({type:'spike',x:100,y:360,w:50,h:90});step(b,.01);assert.equal(b.reason,'lives');
});
