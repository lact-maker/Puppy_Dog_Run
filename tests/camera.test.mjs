import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, action, step } from '../public/game.mjs';
import { advanceCameraLead } from '../public/camera.mjs';

test('scenery keeps 96–104% of world movement through jumps, dashes and landing', () => {
  for (const speedDistance of [0, 3000]) for (const fps of [30, 60, 120]) {
    const s=createGame(17); s.distance=speedDistance; s.dog.x=100+speedDistance*10;
    s.entities=[{type:'ground',x:-1000,y:0,w:1e7,h:0}];s.nextChunk=1e6;s.nextPortal=Infinity;
    let camera={x:s.dog.x,lead:0,time:0,seed:s.seed};
    action(s,'jump');
    for(let i=0;i<fps*3;i++) {
      if(i===Math.floor(fps*.25))action(s,'jump');
      if(i===Math.floor(fps*.4))action(s,'dash');
      const oldX=s.dog.x,oldScroll=oldX-camera.lead;
      step(s,1/fps);const next=advanceCameraLead(camera,s);
      const dx=s.dog.x-oldX,scroll=s.dog.x-next.lead-oldScroll;
      assert.ok(scroll>=dx*.96-1e-8 && scroll<=dx*1.04+1e-8);
      assert.ok(next.lead>=0 && next.lead<=12+1e-8);camera=next;
    }
    assert.equal(s.dog.grounded,true);assert.ok(camera.lead<.001);
    s.status='paused';const still=advanceCameraLead(camera,s);
    assert.equal(still.lead,camera.lead);
  }
});
