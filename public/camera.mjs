// Limit visual lead changes to 4% of travelled distance. The environment keeps
// at least 96% of its forward scrolling speed during takeoff and double jumps.
export function advanceCameraLead(previous, game) {
  const dx=Math.max(0,game.dog.x-previous.x);
  const target=game.dog.grounded?0:Math.min(12,Math.max(0,game.dog.x-(game.dog.airStartX??game.dog.x))*.05);
  const delta=Math.max(-dx*.04,Math.min(dx*.04,target-previous.lead));
  return {x:game.dog.x,lead:previous.lead+delta,time:game.time,seed:game.seed};
}
