// WebSocket is ordered/reliable. Each connection starts with a complete baseline.
export function packState(state, previous) {
  const current = new Map(state.entities.map(e=>[e.id,JSON.stringify(e)]));
  const full = !previous || previous.seed !== state.seed;
  const updates = state.entities.filter(e=>full || previous.entities.get(e.id)!==current.get(e.id));
  const removed = full ? [] : [...previous.entities.keys()].filter(id=>!current.has(id));
  const {entities,...header}=state;
  return {message:{type:'state-delta',state:header,full,updates,removed},cache:{seed:state.seed,entities:current}};
}
export function unpackState(message, previous) {
  const entities = message.full ? new Map() : new Map((previous?.entities||[]).map(e=>[e.id,e]));
  for(const id of message.removed)entities.delete(id);
  for(const e of message.updates)entities.set(e.id,e);
  return {...message.state,entities:[...entities.values()]};
}
