import { SPRITE_FRAMES } from './sprites.mjs';
import { advanceCameraLead } from './camera.mjs';
// Generated reference-based sprite atlas, with Canvas scenery and animation.
const ink = '#685c4c';
function ellipse(c, x, y, rx, ry, fill, stroke = true) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); if (stroke) c.stroke();
}
function path(c, commands, fill) { c.beginPath(); commands(c); if (fill) { c.fillStyle = fill; c.fill(); } c.stroke(); }
const sprites = typeof Image !== 'undefined' ? new Image() : null;
export const artReady = sprites ? new Promise((resolve,reject)=> {
  sprites.onload=()=>resolve(); sprites.onerror=()=>reject(new Error('小狗素材加载失败，请重新打开游戏'));
  sprites.src=new URL('./assets/dog-sprites.png',import.meta.url).href;
}) : Promise.resolve();
export function drawDog(c,x,y,scale=1,character='jimao',t=0,pose='idle',equipped={}) {
  if(!sprites?.complete || !sprites.naturalWidth) return;
  const white=character==='xiaobai', run=pose==='run', dash=pose==='dash', jump=pose==='jump';
  const phase=Math.sin(t*(dash?24:12));
  let frame=run ? 2+Math.floor(t*10)%2 : dash ? 6+Math.floor(t*14)%2 : jump ? 4 : Math.floor(t*1.5)%4===0?1:0;
  if(pose==='heart')frame=1;
  const [sx,sy,sw,sh]=SPRITE_FRAMES[frame+(white?8:0)];
  const size=.255, dw=sw*size, dh=sh*size;
  c.save();c.translate(x,y-(run?Math.abs(phase)*1.5:dash?Math.sin(t*24)*.8:jump?0:Math.sin(t*2.5)*.6));c.scale(scale,scale);
  // Frame changes carry limb movement; gentle breathing avoids a cutout bob.
  const breath=run||dash||jump?1:1+Math.sin(t*2.5)*.008;
  c.scale(1,breath);c.drawImage(sprites,sx,sy,sw,sh,-dw/2+(dash?4:0),-dh,dw,dh);
  drawOutfit(c,equipped,pose);
  if(pose==='heart')drawHeart(c,17,-29,9,'#e7a399');
  c.restore();
}
function drawOutfit(c,eq={},pose='idle') {
  c.save();c.strokeStyle='#665e54';c.lineWidth=1.2;c.lineJoin='round';
  const dash=pose==='dash';
  if(eq.shirt){c.save();if(dash){c.translate(-8,3);c.rotate(-.3);}path(c,p=>{p.moveTo(-12,-28);p.lineTo(-18,-23);p.lineTo(-14,-18);p.lineTo(-10,-20);p.lineTo(-10,-12);p.quadraticCurveTo(0,-9,11,-12);p.lineTo(11,-20);p.lineTo(15,-18);p.lineTo(19,-23);p.lineTo(12,-28);p.quadraticCurveTo(1,-22,-12,-28);},'#a7c5ad');drawHeart(c,2,-18,4,'#fff5de');c.restore();}
  if(eq.pants){c.save();if(dash){c.translate(-18,-10);c.rotate(.5);}path(c,p=>{p.moveTo(-12,-14);p.lineTo(12,-14);p.lineTo(14,-3);p.lineTo(3,-3);p.lineTo(0,-7);p.lineTo(-3,-3);p.lineTo(-14,-3);p.closePath();},'#d6bd91');c.restore();}
  if(eq.shoes){for(const x of [-9,10]){ellipse(c,x+(dash?x*.6:0),-2,7,3.3,'#d99787');c.beginPath();c.moveTo(x-3,-3);c.lineTo(x+2,-3);c.stroke();}}
  if(eq.hat){c.save();if(dash)c.translate(23,22);ellipse(c,0,-58,16,5,'#d99787');path(c,p=>{p.moveTo(-12,-58);p.quadraticCurveTo(-15,-76,0,-74);p.quadraticCurveTo(14,-74,12,-58);p.closePath();},'#e5b3a0');c.fillStyle='#fff0ad';c.font='11px sans-serif';c.textAlign='center';c.fillText('★',0,-61);c.restore();}
  c.restore();
}
export function drawShopItem(canvas,id) {const {c,w,h}=fitCanvas(canvas);if(!w)return;c.clearRect(0,0,w,h);c.save();c.translate(w/2,h/2);const scale=Math.min(w/55,h/36)*.9;c.scale(scale,scale);c.translate(0,({hat:64,shirt:20,pants:9,shoes:2})[id]||0);drawOutfit(c,{[id]:id});c.restore();}
export function drawHeart(c, x, y, size = 18, fill = '#df9f94') {
  c.save(); c.translate(x, y); c.scale(size / 20, size / 20); c.fillStyle = fill;
  c.beginPath(); c.moveTo(0, 7); c.bezierCurveTo(-22, -6, -9, -18, 0, -8); c.bezierCurveTo(9, -18, 22, -6, 0, 7); c.fill(); c.restore();
}
function cloud(c, x, y, size = 1) { c.save(); c.translate(x, y); c.scale(size, size); c.fillStyle = '#fffdf4b8'; c.beginPath(); c.moveTo(-40, 8); c.bezierCurveTo(-60, -12, -24, -26, -12, -15); c.bezierCurveTo(-10, -48, 40, -41, 38, -13); c.bezierCurveTo(63, -18, 75, 11, 51, 12); c.closePath(); c.fill(); c.restore(); }
function flower(c, x, y, scale = 1) { c.save(); c.translate(x, y); c.scale(scale, scale); c.lineWidth = 1.5; c.strokeStyle = '#a7ad8c'; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -13); c.stroke(); for (let i = 0; i < 5; i++) { const a = i * Math.PI * .4; ellipse(c, Math.cos(a) * 4, -16 + Math.sin(a) * 4, 3.1, 3.1, '#fffdf1', false); } ellipse(c, 0, -16, 2.3, 2.3, '#d7bb78', false); c.restore(); }
export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, canvas.id === 'game-canvas' ? 1.25 : 1.5);
  if (canvas.width !== Math.round(rect.width * ratio) || canvas.height !== Math.round(rect.height * ratio)) { canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio); }
  const c = canvas.getContext('2d'); c.setTransform(ratio, 0, 0, ratio, 0, 0); return { c, w: rect.width, h: rect.height };
}
export function drawHero(canvas, t = 0, equipped = {}) {
  const { c, w, h } = fitCanvas(canvas); if (!w) return;
  c.clearRect(0, 0, w, h);
  cloud(c, w * .64, h * .3, 1.1); cloud(c, w * .2, h * .41, .6);
  c.fillStyle = '#e2e5cb'; c.beginPath(); c.ellipse(w * .7, h * 1.09, w * .74, h * .5, -.1, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#d6dfbb'; c.beginPath(); c.ellipse(w * .73, h * 1.2, w * .61, h * .56, .16, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#a7b494'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(w * .1, h * .81); c.quadraticCurveTo(w * .55, h * .84, w * .97, h * .78); c.stroke();
  const sc = Math.min(w / 175, h / 106);
  const hop = Math.max(0, Math.sin(t * 2)) * 10;
  drawDog(c, w * .39 + Math.sin(t * 2) * 5, h * .82 - hop, sc, 'jimao', t, hop > 7 ? 'jump' : 'idle', equipped);
  drawDog(c, w * .74, h * .82, sc * .96, 'xiaobai', t + .8, t % 8 < 4 ? 'heart' : 'run', equipped);
  drawHeart(c, w * .57, h * .26 + Math.sin(t * 2) * 5, 14, '#cba58f');
  c.fillStyle = '#97a283'; c.font = '10px sans-serif'; c.fillText('JI MAO', w * .39 - 20, h * .94); c.fillText('XIAO BAI', w * .74 - 22, h * .94);
  for (const [x, y, s] of [[.2, .88, 1], [.84, .88, 1.2], [.92, .8, .65], [.33, .95, .8]]) flower(c, w * x, h * y, s);

}
export function drawPortrait(canvas, character, t = 0, equipped = {}) { const { c, w, h } = fitCanvas(canvas); c.clearRect(0, 0, w, h); drawDog(c, w / 2, h - 4, Math.min(w / 72, h / 84), character, t, 'idle', equipped); }
export function drawSticker(canvas, scene, t) {
  const {c,w,h}=fitCanvas(canvas); if(!w||!h)return; c.clearRect(0,0,w,h);
  const sc=Math.min(w/105,h/90);
  c.save();c.translate(w/2,h*.88);c.scale(sc,sc);
  if(scene==='duo') {
    drawDog(c,-21,0,.7,'jimao',t,'idle');drawDog(c,21,0,.7,'xiaobai',t+.5,'heart');
    drawHeart(c,0,-58+Math.sin(t*2)*3,9);
  } else if(scene==='fly') {
    c.save();c.translate(Math.sin(t*2)*5,-10+Math.sin(t*3)*3);c.rotate(-.12);
    drawDog(c,-5,0,.9,'xiaobai',t,'dash');c.restore();
  } else {
    drawDog(c,0,0,.88,'xiaobai',t,scene==='heart'?'heart':'idle');
    if(scene==='heart')for(let i=0;i<3;i++) {
      const f=(t*.4+i/3)%1;c.globalAlpha=1-f;drawHeart(c,-25+i*23,-50-f*20,5+f*2);c.globalAlpha=1;
    }
    if(scene==='happy') {
      c.strokeStyle='#dfcb84';c.lineWidth=2;
      for(let i=0;i<5;i++){const a=Math.PI+i*Math.PI/4;const r=35+Math.sin(t*4)*3;
        c.beginPath();c.moveTo(Math.cos(a)*r,-35+Math.sin(a)*r);c.lineTo(Math.cos(a)*(r+7),-35+Math.sin(a)*(r+7));c.stroke();}
    }
  }
  c.restore();
}
const cameraStates=new WeakMap();
function updateCameraLead(canvas,s) {
  let state=cameraStates.get(canvas);
  if(!state || s.time<state.time || s.seed!==state.seed) state={x:s.dog.x,lead:0,time:s.time,seed:s.seed};
  state=advanceCameraLead(state,s); cameraStates.set(canvas,state); return state.lead;
}
export function renderGame(canvas, s, visualTime) {
  const { c, w, h } = fitCanvas(canvas); if (!w || !s) return;
  c.fillStyle = '#f7f6e9'; c.fillRect(0, 0, w, h);
  const top = h < 500 ? 55 : 80, bottom = h < 500 ? 95 : 142;
  const scale = Math.max(.25, (h - top - bottom) / 450), floor = top + 450 * scale;
  const lead = updateCameraLead(canvas, s);
  const anchor = Math.min(w * .25, 250) + lead * scale, camera = s.dog.x - anchor / scale;
  cloud(c, ((210 - s.dog.x * .05) % (w + 200) + w + 200) % (w + 200) - 70, h * .23, .75);
  cloud(c, ((w * .8 - s.dog.x * .04) % (w + 200) + w + 200) % (w + 200) - 70, h * .43, 1.3);
  c.fillStyle = '#eaecd7'; c.beginPath(); c.moveTo(0, floor); c.bezierCurveTo(w * .2, floor - 90, w * .4, floor - 60, w * .58, floor); c.bezierCurveTo(w * .7, floor - 160, w * .88, floor - 75, w, floor - 25); c.lineTo(w, h); c.lineTo(0, h); c.fill();
  c.save(); c.translate(-camera * scale, floor); c.scale(scale, -scale);
  c.lineCap = 'round';
  for (const e of s.entities) {
    if (e.dead || e.x + e.w < camera - 100 || e.x > camera + w / scale + 100) continue;
    if (e.type === 'ground') {
      c.fillStyle = '#dce4ca'; c.fillRect(e.x, -500, e.w, 498); c.strokeStyle = '#8e9d79'; c.lineWidth = 4; c.beginPath(); c.moveTo(e.x, 0); c.lineTo(e.x + e.w, 0); c.stroke();
      // World-space tufts make continuous ground movement visible, even on flat terrain.
      c.strokeStyle='#acba94';c.lineWidth=1.4;
      for(let gx=Math.ceil(Math.max(e.x,camera-30)/85)*85;gx<Math.min(e.x+e.w,camera+w/scale+30);gx+=85){c.beginPath();c.moveTo(gx,-13);c.lineTo(gx+4,-9);c.moveTo(gx+4,-13);c.lineTo(gx+9,-10);c.stroke();}
    } else if (e.type === 'platform') {
      c.strokeStyle = e.bridge ? '#77b5b2' : '#9ba582'; c.lineWidth = 5; c.beginPath(); c.moveTo(e.x, e.y); c.lineTo(e.x + e.w, e.y); c.stroke();
      c.strokeStyle = '#d0d6bb'; c.lineWidth = 2; c.beginPath(); c.moveTo(e.x + 5, e.y - 5); c.lineTo(e.x + e.w - 5, e.y - 5); c.stroke();
    } else if (e.type === 'fireball') {
      c.save(); c.translate(e.x+12,e.y+10);c.strokeStyle='#df8552';c.lineWidth=1.5;
      path(c,p=>{p.moveTo(10,0);p.quadraticCurveTo(0,20,-27,9);p.lineTo(-18,0);p.lineTo(-28,-7);p.quadraticCurveTo(0,-15,10,0);},'#eeaa69');
      ellipse(c,0,0,10,9,'#fff0a5');c.restore();
    } else if (e.type === 'portal') {
      c.save(); c.translate(e.x + e.w / 2, e.y + e.h / 2);
      c.fillStyle = '#332e49'; c.beginPath(); c.ellipse(0,0,28,40,0,0,Math.PI*2); c.fill();
      for (let i=0;i<3;i++) { c.strokeStyle=['#bba0d9','#ddd0ed','#8e79b3'][i]; c.lineWidth=3; c.beginPath(); c.ellipse(0,0,30+i*4,40+i*3,Math.sin(visualTime*2+i)*.15,visualTime*2+i,visualTime*2+i+4.7); c.stroke(); }
      c.restore();
    } else if (e.type === 'spike') {
      c.fillStyle = '#c1b3a9'; c.strokeStyle = '#8e7f78'; c.lineWidth = 2;
      const count = Math.max(2, Math.ceil(e.w / 26));
      for (let i = 0; i < count; i++) { c.beginPath(); c.moveTo(e.x + e.w * i / count, 450); c.lineTo(e.x + e.w * (i + .5) / count, 360); c.lineTo(e.x + e.w * (i + 1) / count, 450); c.closePath(); c.fill(); c.stroke(); }
    } else {
      c.save(); c.translate(e.x + e.w / 2, e.y + e.h / 2); c.scale(1, -1);
      if (e.type === 'monster') {
        c.strokeStyle = '#877784'; c.lineWidth = 1.6;
        const wing = Math.sin((s.monsterTime ?? visualTime) * 20) * 6;
        path(c, p => { p.moveTo(-10, 0); p.quadraticCurveTo(-36, -20 + wing, -28, -3); p.quadraticCurveTo(-21, 12, -10, 5); }, '#e2d2dd');
        path(c, p => { p.moveTo(10, 0); p.quadraticCurveTo(36, -20 + wing, 28, -3); p.quadraticCurveTo(21, 12, 10, 5); }, '#e2d2dd');
        ellipse(c, 0, 0, 16, 16, '#b6a3b4'); ellipse(c, -6, -1, 2, 3, '#fcf8f2', false); ellipse(c, 5, -1, 2, 3, '#fcf8f2', false);
        c.beginPath(); c.moveTo(-4, 7); c.lineTo(4, 7); c.stroke();
      } else {
        c.translate(0, Math.sin(visualTime * 3 + e.x) * 3);
        c.strokeStyle = e.type === 'heart' ? '#e2beb0' : '#b3c6a0'; c.lineWidth = 1.2; ellipse(c, 0, 0, 20, 20, '#fffdf1cf');
        if (e.type === 'heart') drawHeart(c, 0, 4, 17); else drawSword(c, 0, 0, .85);
      }
      c.restore();
    }
  }
  c.restore();
  const dog = s.dog, y = floor - dog.y * scale;
  if (dog.dash > 0) { c.strokeStyle = '#c9ae87'; c.lineWidth = 2; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(anchor - (35 + i * 8) * scale, y - (10 + i * 13) * scale); c.lineTo(anchor - (70 + i * 8) * scale, y - (10 + i * 13) * scale); c.stroke(); } }
  if (s.companion) drawDog(c, anchor-50*scale, y, scale*.5, s.character==='xiaobai'?'jimao':'xiaobai',visualTime, dog.wings>0?'jump':dog.dash>0?'dash':!dog.grounded?'jump':'run');
  if (dog.wings>0) {
    c.save(); c.translate(anchor-8*scale,y-30*scale); c.scale(scale,scale);c.strokeStyle='#c3bacb';c.lineWidth=1.8;
    const flap=Math.sin(visualTime*13)*9;
    for(const side of [-1,1]){c.save();c.scale(side,1);path(c,p=>{p.moveTo(0,6);p.bezierCurveTo(10,-20,35,-38+flap,38,-30+flap);p.quadraticCurveTo(35,-10,28,-3);p.lineTo(30,2);p.quadraticCurveTo(18,15,0,6);},'#fffdf5');c.restore();}
    c.restore();
  }
  c.save(); if (dog.hurt > 0 && Math.floor(visualTime * 12) % 2) c.globalAlpha = .45;
  drawDog(c, anchor, y, scale * .85, s.character, visualTime, dog.dash > 0 ? 'dash' : !dog.grounded ? 'jump' : 'run', s.equipped || {}); c.restore();
  if (dog.sword > 0) {
    c.strokeStyle = '#a4b58b77'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(anchor, y - 25 * scale, 52 * scale, 52 * scale, 0, 0, Math.PI * 2); c.stroke();
    for (let i = 0; i < 5; i++) { const a = visualTime * 2.5 + i * Math.PI * .4; c.save(); c.translate(anchor + Math.cos(a) * 52 * scale, y - 25 * scale + Math.sin(a) * 52 * scale); c.rotate(a + Math.PI / 2); drawSword(c, 0, 0, scale * .7); c.restore(); }
  }
  c.fillStyle = '#a6ac8e'; c.font = '10px sans-serif'; c.textAlign = 'right';
  for (let i = 1; i <= 5; i++) c.fillText(String(i).padStart(2, '0'), w - 10, floor - (i - .5) * 90 * scale);
  c.textAlign = 'left';
}
function drawSword(c, x, y, scale) { c.save(); c.translate(x, y); c.scale(scale, scale); c.lineWidth = 1.6; c.strokeStyle = '#7c8d76'; path(c, p => { p.moveTo(-4, 5); p.lineTo(-4, -13); p.lineTo(0, -21); p.lineTo(4, -13); p.lineTo(4, 5); p.closePath(); }, '#d4dec4'); path(c, p => { p.moveTo(-9, 5); p.lineTo(9, 5); p.moveTo(0, 5); p.lineTo(0, 15); }, null); c.restore(); }
