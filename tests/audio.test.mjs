import test from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../public/audio.mjs';
function context(){
  const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  return {currentTime:0,destination:{},resume:async()=>{},createGain:()=>({gain:param(),connect(){},disconnect(){}}),
    createOscillator:()=>({frequency:param(),connect(){},disconnect(){},start(){},stop(){this.onended?.();}})};
}
test('music starts on gameplay, mute stops music/effects, resume does not duplicate timers',()=>{
  let saved;const audio=new GameAudio({contextFactory:context,onMute:v=>saved=v});
  audio.unlock();assert.equal(audio.timer,null);audio.setActive(true);assert.ok(audio.timer);
  const timer=audio.timer;audio.setActive(true);audio.unlock();assert.equal(audio.timer,timer);
  audio.setMuted(true);assert.equal(saved,true);assert.equal(audio.master.gain.value,0);assert.equal(audio.timer,null);
  audio.effect('jump');assert.equal(audio.voices.size,0);
  audio.setMuted(false);assert.equal(saved,false);assert.equal(audio.master.gain.value,1);assert.ok(audio.timer);
  audio.setActive(false);assert.equal(audio.timer,null);assert.equal(audio.voices.size,0);
});
test('unavailable audio cannot block gameplay and muted preference survives unlock',()=>{
  const unavailable=new GameAudio({contextFactory:()=>{throw new Error('no audio');}});
  assert.doesNotThrow(()=>{unavailable.unlock();unavailable.setActive(true);unavailable.effect('dash');});
  const muted=new GameAudio({muted:true,contextFactory:context});muted.unlock();muted.setActive(true);
  assert.equal(muted.timer,null);assert.equal(muted.master.gain.value,0);
  muted.effect('jump');assert.equal(muted.voices.size,0);muted.setActive(false);
});
