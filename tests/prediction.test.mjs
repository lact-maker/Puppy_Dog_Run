import test from 'node:test';
import assert from 'node:assert/strict';
import { Prediction } from '../public/prediction.mjs';
import { packState, unpackState } from '../public/wire.mjs';
import { createGame, action, step } from '../public/game.mjs';
function safe() { const s=createGame(19); s.entities=[{id:'floor',type:'ground',x:-1000,y:0,w:1e7,h:0}];s.nextChunk=1e6;s.nextPortal=Infinity;return s; }
test('local jump responds in first frame without round trip, server remains unmodified',()=>{
 const server=safe(),p=new Prediction();p.receive(server,'a');p.input('jump');const visual=p.frame(1/60);
 assert.ok(visual.dog.y>0);assert.equal(server.dog.y,0);assert.equal(server.dog.jumps,2);
 p.input('jump');p.input('jump');assert.equal(p.state.dog.jumps,0);
});
test('unacknowledged inputs replay through delayed snapshots, acknowledged input never doubles',()=>{
 const server=safe(),p=new Prediction();p.receive(server,'a');const seq=p.input('jump');p.frame(.05);
 p.receive(server,'a');assert.equal(p.state.dog.jumps,1);assert.ok(p.state.dog.y>0);
 action(server,'jump');step(server,.05);server.inputAck={a:seq};p.receive(server,'a');
 assert.equal(p.pending.length,0);assert.equal(p.state.dog.jumps,1);assert.equal(p.state.dog.y,server.dog.y);
});
test('prediction bridges 150 ms jitter but caps extrapolation and clears on pause or new game',()=>{
 const server=safe(),p=new Prediction();p.receive(server,'a');const x=server.dog.x;
 for(let i=0;i<9;i++)p.frame(1/60);assert.ok(p.state.dog.x>x+30);
 for(let i=0;i<60;i++)p.frame(1/60);assert.ok(p.state.time<=.250001);
 server.status='paused';p.receive(server,'a');const frozen=JSON.stringify(p.state);p.frame(.05);assert.equal(JSON.stringify(p.state),frozen);assert.equal(p.input('jump'),null);
 server.status='running';server.seed++;p.receive(server,'a');assert.equal(p.pending.length,0);assert.equal(p.state.time,0);
});
test('entity delta restores exact snapshots, including removals and new baselines, with fewer bytes',()=>{
 const s=createGame(9);let cache,decoded,totalFull=0,totalDelta=0;
 for(let i=0;i<20;i++) {step(s,.05);const packed=packState(s,cache);cache=packed.cache;
  const message=JSON.parse(JSON.stringify(packed.message));decoded=unpackState(message,decoded);
  assert.deepEqual(decoded,JSON.parse(JSON.stringify(s)));
  totalFull+=JSON.stringify({type:'state',state:s}).length;totalDelta+=JSON.stringify(message).length;
 }
 assert.ok(totalDelta<totalFull*.8,`${totalDelta}/${totalFull}`);
 s.entities.splice(0,2);const removed=packState(s,cache);decoded=unpackState(JSON.parse(JSON.stringify(removed.message)),decoded);assert.deepEqual(decoded.entities,s.entities);
 const fresh=packState(createGame(22),removed.cache);assert.equal(fresh.message.full,true);
 console.log(`20 snapshots: full ${totalFull} bytes, delta ${totalDelta} bytes`);
});
