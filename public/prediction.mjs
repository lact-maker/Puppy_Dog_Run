import { action, step } from './game.mjs';
// Presentation-only simulation. Scores and rewards always use server snapshots.
export class Prediction {
  constructor() { this.sequence = Date.now(); this.reset(); }
  reset() { this.state = null; this.pending = []; this.age = 0; this.offset = {x:0,y:0}; }
  advance(seconds) {
    let remaining = Math.min(.25 - this.age, Math.max(0, seconds));
    this.age += remaining;
    while (remaining > 1e-8 && this.state?.status === 'running') { const dt = Math.min(remaining, .05); step(this.state, dt); remaining -= dt; }
  }
  receive(server, playerId) {
    const previous = this.state, same = previous?.seed === server.seed;
    const x = previous ? previous.dog.x + this.offset.x : server.dog.x;
    const y = previous ? previous.dog.y + this.offset.y : server.dog.y;
    this.pending = same && server.status === 'running' ? this.pending.filter(p => p.seq > (server.inputAck?.[playerId] || 0)) : [];
    this.state = structuredClone(server); this.age = 0;
    if (server.status === 'running') {
      const target = same ? Math.min(server.time + .25, Math.max(server.time, previous.time)) : server.time;
      for (const input of this.pending) {
        this.advance(Math.max(0, Math.min(input.at, target) - this.state.time));
        action(this.state, input.kind);
      }
      this.advance(Math.max(0, target - this.state.time));
    }
    // Smooth small reconciliation errors; never blend across pause, death or revival.
    const blend = same && server.status === 'running' && previous.status === 'running' && Math.abs(x-this.state.dog.x)<180 && Math.abs(y-this.state.dog.y)<100;
    this.offset = blend ? {x:x-this.state.dog.x,y:y-this.state.dog.y} : {x:0,y:0};
  }
  input(kind) {
    if (!this.state || this.state.status !== 'running' || this.pending.length >= 20) return null;
    const seq = ++this.sequence;
    this.pending.push({seq,kind,at:this.state.time}); action(this.state,kind); return seq;
  }
  frame(dt) {
    if (!this.state) return null;
    this.advance(dt); const decay = Math.exp(-Math.max(0,dt)/.065);
    this.offset.x *= decay; this.offset.y *= decay;
    return {...this.state,dog:{...this.state.dog,x:this.state.dog.x+this.offset.x,y:this.state.dog.y+this.offset.y}};
  }
}
