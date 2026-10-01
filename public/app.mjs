import { Prediction } from './prediction.mjs';
import { unpackState } from './wire.mjs';
const prediction = new Prediction();
let lastHudAt = 0, predictionEnabled = false;
import { CATALOG } from './shop.mjs';
import { GameAudio } from './audio.mjs';
import { createGame, action, step, finish } from './game.mjs';
import { artReady, drawHero, drawPortrait, drawSticker, drawShopItem, renderGame } from './art.mjs';

const $ = id => document.getElementById(id), esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
let profile = read('puppy.profile', { name: '小狗朋友', avatar: '' }), character = read('puppy.character', 'jimao');
let base = read('puppy.server', location.hostname === 'appassets.androidplatform.net' ? '' : location.origin);
let identities = read('puppy.identities', {}), token = identities[base]?.token || '', me = null;
let socket, connectionPromise, reconnectTimer, intentionalClose = false, online = false, room = null, currentPage = 'home';
let game = null, practice = false, gameVisible = false, localCountdown = 0, lastFrame = performance.now(), receivedAt = 0;
let overlayKey = '', toastTimer, localBest = read('puppy.practiceBest', null), lastLife = 1;
const audio = new GameAudio({muted:read('puppy.muted',false),onMute:value=>{try{save('puppy.muted',value);}catch{} updateMusicButton();}});
let lastAudioState=null;
function updateMusicButton(){const b=$('music-toggle');b.textContent=audio.muted?'♫̸':'♫';b.setAttribute('aria-label',audio.muted?'开启声音':'静音');b.setAttribute('aria-pressed',String(audio.muted));b.title=audio.muted?'开启声音':'静音';}
$('music-toggle').onclick=()=>{audio.unlock();audio.setMuted(!audio.muted);};
document.addEventListener('pointerdown',()=>audio.unlock(),{once:true});
document.addEventListener('keydown',()=>audio.unlock(),{once:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.setActive(false);});
updateMusicButton();
const duration = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600); return h ? `${h}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const avatar = p => `<span class="avatar">${p?.avatar ? `<img src="${esc(p.avatar)}" alt="${esc(p.name)}的头像">` : '🐾'}</span>`;
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200); }
function dialog(title, content) { $('dialog-content').innerHTML = `<div class="dialog-title"><h2>${esc(title)}</h2><button class="close-dialog" aria-label="关闭">×</button></div>${content}`; $('dialog-content').querySelector('.close-dialog').onclick = () => $('dialog').close(); if (!$('dialog').open) $('dialog').showModal(); }
function status(ok, label) { online = ok; $('connection-dot').classList.toggle('online', ok); $('connection-label').textContent = label; }
function updateProfile() { $('my-name').textContent = profile.name; $('my-avatar').innerHTML = profile.avatar ? `<img src="${esc(profile.avatar)}" alt="我的头像">` : '🐾'; }
async function api(path, data) {
  if (!base) throw new Error('请先设置联机服务器');
  const res = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(8000) });
  const result = await res.json(); if (!res.ok) { const e = new Error(result.error || '服务器暂时不可用'); e.status = res.status; throw e; } return result;
}
async function connect() {
  if (online && socket?.readyState === WebSocket.OPEN) return;
  if (connectionPromise) return connectionPromise;
  connectionPromise = (async () => {
    status(false, '连接中');
    if (token) {
      try { me = await api('/api/me'); } catch (e) { if (e.status !== 401) throw e; token = ''; }
    }
    if (!token) { const result = await api('/api/register', profile); token = result.token; me = result.player; identities[base] = { token }; save('puppy.identities', identities); }
    profile = { name: me.name, avatar: me.avatar }; save('puppy.profile', profile); updateProfile();
    await new Promise((resolve, reject) => {
      intentionalClose = false;
      const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws'); socket = ws;
      const timeout = setTimeout(() => { ws.close(); reject(new Error('连接超时，请检查服务器地址')); }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token, deltaStates: true }));
      ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'welcome') {
          predictionEnabled = msg.prediction === true; prediction.reset(); clearTimeout(timeout); updateAccount(msg.player); status(true, '已连接');
          if (room && !msg.inRoom && !practice) { room = null; hideGame(); showPage('home'); toast(msg.lastResult ? `上局已结算：${msg.lastResult.distance.toFixed(1)} 米 · ${duration(msg.lastResult.duration)}` : '原房间已结束，可以重新邀请搭档'); }
          resolve();
        }
        else if (msg.type === 'room') { room = msg.room; if (!gameVisible || room.phase === 'lobby') renderRoom(); if (['running', 'countdown', 'paused', 'shop', 'ended'].includes(room.phase)) { if (!practice) showGame(false); } }
        else if (['state','state-delta'].includes(msg.type) && !practice) { game = msg.type === 'state-delta' ? unpackState(msg, game) : msg.state; prediction.receive(game, me?.id); receivedAt = performance.now(); if (game.dog.lives < lastLife) vibrate(); lastLife = game.dog.lives; }
        else if (msg.type === 'account') updateAccount(msg.account);
        else if (msg.type === 'error') toast(msg.message);
        else if (msg.type === 'left') { room = null; if (!practice) { hideGame(); showPage('home'); } }
      };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('无法连接服务器，请检查地址和网络')); };
      ws.onclose = e => {
        clearTimeout(timeout); if (socket !== ws) return;
        status(false, '连接已断开'); reject(new Error('连接已断开'));
        if (e.code === 4001) { intentionalClose = true; toast('此身份已在其他窗口连接'); }
        if (!intentionalClose) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => connect().catch(() => {}), 1200); }
      };
    });
  })().catch(e => {
    status(false, '单机可玩');
    if (room && !intentionalClose) { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(() => connect().catch(() => {}), 1000); }
    throw e;
  }).finally(() => connectionPromise = null);
  return connectionPromise;
}
function send(msg) { if (!online || socket?.readyState !== WebSocket.OPEN) { toast('正在连接搭档，请稍候'); return false; } socket.send(JSON.stringify(msg)); return true; }
async function needOnline(fn) {
  if (!base) { serverDialog(); return; }
  try { await connect(); fn(); } catch (e) { toast(e.message); serverDialog(); }
}
function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('hidden', el.id !== `${page}-page`));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  $('page-title').innerHTML = `${({ home: '跑酷大厅', teams: '我们的小队', ranking: '里程排行榜', room: '小狗房间', wardrobe:'小狗衣橱' })[page]}<span class="title-dot">✦</span>`;
  if (page === 'home') requestAnimationFrame(redrawArt);
  if(page==='wardrobe')loadWardrobe(); if (page === 'teams') loadTeams(); if (page === 'ranking') loadRanking();
}
document.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { if (room) { showPage('room'); toast('先退出当前房间，再逛逛大厅'); return; } showPage(b.dataset.page); });
document.querySelector('.brand').onclick = e => { e.preventDefault(); showPage(room ? 'room' : 'home'); };
function selectCharacter(value) { character = value; save('puppy.character', value); document.querySelectorAll('#home-characters [data-character]').forEach(b => b.classList.toggle('selected', b.dataset.character === value)); }
document.querySelectorAll('#home-characters [data-character]').forEach(b => b.onclick = () => selectCharacter(b.dataset.character));
document.querySelectorAll('#room-characters [data-character]').forEach(b => b.onclick = () => send({ type: 'configure', character: b.dataset.character }));
let lastArtFrame = 0;
function redrawArt(now = performance.now()) { const t = typeof now === 'number' ? now / 1000 : performance.now() / 1000; drawHero($('hero-art'), t,me?.equipped||{}); document.querySelectorAll('canvas[data-dog]').forEach(c => { if (c.getBoundingClientRect().width) drawPortrait(c, c.dataset.dog, t, c.dataset.outfit==='yes' ? me?.equipped : {}); }); document.querySelectorAll('canvas[data-scene]').forEach(c => { if(c.getBoundingClientRect().width) drawSticker(c,c.dataset.scene,t); }); document.querySelectorAll('canvas[data-item]').forEach(c=>drawShopItem(c,c.dataset.item)); }
window.addEventListener('resize', redrawArt);

$('profile-button').onclick = () => {
  dialog('我的小狗名片', `<div class="form-grid"><div class="avatar-upload"><span class="avatar" id="avatar-preview">${profile.avatar ? `<img src="${esc(profile.avatar)}" alt="头像预览">` : '🐾'}</span><div><label for="avatar-file">从手机选择头像</label><input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp"></div></div><label for="profile-name">怎么称呼你？</label><input id="profile-name" maxlength="20" value="${esc(profile.name)}"><p class="muted">不用微信授权。头像与昵称会显示在房间和排行榜中。</p><button id="save-profile" class="primary">保存名片</button></div>`);
  let pendingAvatar = profile.avatar;
  $('avatar-file').onchange = async e => {
    try {
      const file = e.target.files[0]; if (!file) return; if (file.size > 12 * 1024 * 1024) throw new Error('请选择小于 12 MB 的图片');
      const url = URL.createObjectURL(file), img = new Image();
      try { img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = c.height = 192; const ctx = c.getContext('2d'); const side = Math.min(img.width, img.height); ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 192, 192); pendingAvatar = c.toDataURL('image/jpeg', .8); $('avatar-preview').innerHTML = `<img src="${pendingAvatar}" alt="新头像预览">`; } finally { URL.revokeObjectURL(url); }
    } catch (e) { toast(e.message || '无法读取这张图片'); }
  };
  $('save-profile').onclick = async () => {
    const name = $('profile-name').value.trim(); if (!name) return toast('给自己取个名字吧');
    try { const next = { name, avatar: pendingAvatar }; if (token && base) await api('/api/me', next); profile = next; save('puppy.profile', profile); updateProfile(); $('dialog').close(); toast('名片保存好了'); } catch (e) { toast(e.message); }
  };
};
function serverDialog() {
  dialog('连接你们的冒险', `<div class="form-grid"><p class="muted">两台手机填写同一个服务器地址，即可通过房间码相遇。同一 Wi-Fi 下可填写电脑的局域网地址。</p><label for="server-url">服务器地址</label><input id="server-url" type="url" inputmode="url" placeholder="http://192.168.1.10:8787" value="${esc(base)}"><button id="connect-server" class="primary">连接服务器</button><p class="muted">单人上榜、双人联机和金币衣橱都需要连接服务器。</p></div>`);
  $('connect-server').onclick = async () => {
    try {
      if (room) throw new Error('请先退出当前房间再更换服务器');
      const url = new URL($('server-url').value.trim()); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('请填写 http(s) 开头的服务器根地址');
      intentionalClose = true; clearTimeout(reconnectTimer); socket?.close(); socket = null; online = false;
      base = url.origin; save('puppy.server', base); token = identities[base]?.token || ''; connectionPromise = null;
      $('connect-server').disabled = true; await connect(); $('dialog').close(); toast('已连接，可以邀请搭档啦');
    } catch (e) { toast(e.message); if ($('connect-server')) $('connect-server').disabled = false; }
  };
}
$('server-button').onclick = serverDialog;
$('rules-button').onclick = () => dialog('玩法小纸条', `<ol class="help-list"><li>一人跳跃，一人冲刺。每跳一层，空中最多两跳。</li><li>冲刺挡怪物；宝剑挡怪物与尖刺，持续 10 秒。</li></ol>`);
$('create-room').onclick = () => needOnline(() => {
  if (room) return showPage('room');
  dialog('给冒险起个名字', `<div class="form-grid"><label for="new-team-name">小队名称</label><input id="new-team-name" maxlength="20" value="两只小狗一起跑"><button id="confirm-create" class="primary">创建房间 →</button></div>`);
  $('confirm-create').onclick = () => { if (send({ type: 'create', name: $('new-team-name').value })) { send({ type: 'configure', character }); $('dialog').close(); } };
});
$('join-room').onclick = () => needOnline(() => {
  if (room) return showPage('room');
  dialog('搭档在等你', `<div class="form-grid"><label for="join-code">输入 6 位房间码</label><input id="join-code" class="code-input" maxlength="6" inputmode="numeric" autocomplete="off" placeholder="000000"><button id="confirm-join" class="primary">加入房间 →</button></div>`);
  $('confirm-join').onclick = () => { const code = $('join-code').value.trim(); if (!/^\d{6}$/.test(code)) return toast('请输入 6 位数字房间码'); if (send({ type: 'join', code })) $('dialog').close(); };
});
function renderRoom() {
  if (!room) return;
  if (room.phase === 'lobby' && !practice) { hideGame(); if (currentPage !== 'room') showPage('room'); }
  $('room-name').textContent = room.name; $('room-code').textContent = room.code;
  const host = room.host === me?.id, mine = room.members.find(m => m.id === me?.id);
  if (document.activeElement !== $('team-name')) $('team-name').value = room.name;
  $('team-name').disabled = !host; $('save-team').disabled = !host;
  $('room-members').innerHTML = [0, 1].map(i => {
    const m = room.members[i]; return `<div class="member-card">${avatar(m)}<h3>${m ? esc(m.name) + (m.id === me?.id ? ' · 你' : '') : '等待另一只小狗'}</h3><span class="role-tag">${i === 0 ? '↑ 负责跳跃 · 二段跳' : '➜ 负责冲刺 · 二段冲刺'}</span><p>${!m ? '把房间码分享给搭档吧' : !m.online ? '暂时离线，等待回来' : m.ready ? '✓ 准备好一起出发了' : '正在做出发准备…'}</p></div>`;
  }).join('');
  document.querySelectorAll('#room-characters [data-character]').forEach(b => { b.classList.toggle('selected', b.dataset.character === room.character); b.disabled = !host; });
  $('swap-role').disabled = !host || room.members.length !== 2; $('ready-button').disabled = room.members.length !== 2;
  $('ready-button').textContent = mine?.ready ? '取消准备' : '我准备好了';
  $('start-button').classList.toggle('hidden', !host); $('start-button').disabled = room.members.length !== 2 || !room.members.every(m => m.ready && m.online);
  $('room-hint').textContent = room.members.length < 2 ? '等待另一只小狗加入…' : room.best ? `已找回你们的小队 · 最佳 ${room.best.distance.toFixed(1)} 米 · ${duration(room.best.duration)}` : '双方准备后，由房主开始这场冒险';
}
$('save-team').onclick = () => send({ type: 'configure', name: $('team-name').value });
$('swap-role').onclick = () => send({ type: 'swap' }); $('ready-button').onclick = () => send({ type: 'ready' }); $('start-button').onclick = () => send({ type: 'start' });
$('leave-room').onclick = () => { if (online) send({ type: 'leave' }); else { room = null; showPage('home'); } };
$('invite-button').onclick = async () => {
  const text = `来和我玩《小狗双人跑酷》吧！小队：${room.name}，房间码：${room.code}。服务器：${base}`;
  try { await navigator.clipboard.writeText(text); toast('邀请已复制，去微信发给搭档吧'); }
  catch { dialog('把邀请发给搭档', `<p class="muted">长按选择并复制下面的文字：</p><p style="user-select:text;line-height:1.9;margin-top:15px">${esc(text)}</p>`); }
};
async function loadRanking() {
  $('ranking-list').innerHTML = '<div class="empty">正在找寻大家的足迹…</div>';
  try {
    const mode=rankingMode; const list = await api('/api/leaderboard?mode='+mode); if(mode!==rankingMode)return;
    $('ranking-list').innerHTML = list.length ? `<div class="rank-row rank-head"><span>名次</span><span>${rankingMode==='solo'?'头像':'两位搭档'}</span><span>${rankingMode==='solo'?'玩家昵称':'队名'}</span><span>最佳里程</span><span>该局用时</span></div>` + list.map(t => `<div class="rank-row"><strong>${String(t.rank).padStart(2, '0')}</strong><div class="duo-avatars">${t.members.map(avatar).join('')}</div><div><b>${esc(t.name)}</b><small>${t.members.map(m => esc(m.name)).join(' & ')}${t.best.interrupted ? ' · 中断局' : ''}</small></div><b>${t.best.distance.toFixed(1)} m</b><span>${duration(t.best.duration)}</span></div>`).join('') : '<div class="empty"><span>♧</span>第一份纪录，等你们来创造。<br>完成这个模式的游戏后，就会出现在这里。</div>';
  } catch (e) { $('ranking-list').innerHTML = `<div class="empty"><span>♧</span>${esc(e.message)}<br>连接服务器后查看全服榜单。</div>`; }
}
async function loadTeams() {
  $('team-list').innerHTML = '<div class="empty">正在找回你们的小队…</div>';
  try {
    await connect(); const list = await api('/api/teams');
    $('team-list').innerHTML = list.length ? list.map(t => `<div class="team-item"><div class="duo-avatars">${t.members.map(avatar).join('')}</div><div><h3>${esc(t.name)}</h3><p class="muted">${t.members.map(m => esc(m.name)).join(' & ')}<br>${t.best ? `最佳 ${t.best.distance.toFixed(1)} 米 · ${duration(t.best.duration)}` : '还没有一起出发的纪录'}</p></div><button class="primary team-invite" data-team="${esc(t.name)}">再次邀请 ↗</button></div>`).join('') : '<div class="empty"><span>♡</span>还没有一起奔跑的搭档。<br>两个人加入房间后，我们会记住你们。</div>';
    document.querySelectorAll('.team-invite').forEach(b => b.onclick = () => { send({ type: 'create', name: b.dataset.team }); toast('房间已创建，复制邀请给原搭档即可恢复小队'); });
  } catch (e) { $('team-list').innerHTML = `<div class="empty"><span>♡</span>${esc(e.message)}</div>`; }
}
$('refresh-ranking').onclick = loadRanking; $('refresh-teams').onclick = loadTeams;

function showGame(isPractice) {
  if (!gameVisible && !isPractice) { game = null; overlay('', ''); }
  practice = isPractice; gameVisible = true; $('app').classList.add('hidden'); $('game-screen').classList.remove('hidden');
  const role = room?.members.find(m => m.id === me?.id)?.role;
  $('jump-button').classList.toggle('hidden', !practice && room?.mode!=='solo' && role !== 'jump'); $('dash-button').classList.toggle('hidden', !practice && room?.mode!=='solo' && role !== 'dash');
  $('game-mode').textContent = practice ? '离线试跑' : room?.mode==='solo'?'单人模式':`你负责${role === 'jump' ? '跳跃' : '冲刺'}`;
  $('game-team-label').textContent = practice ? '先和小狗熟悉一下' : room?.name || '我们的冒险';
}
function hideGame() { audio.setActive(false); gameVisible = false; $('app').classList.remove('hidden'); $('game-screen').classList.add('hidden'); overlayKey = ''; requestAnimationFrame(redrawArt); }
function startPractice() {
  needOnline(()=>{
    if(room)return toast('请先退出当前房间');
    dialog('一个人，也能跑很远',`<div class="form-grid"><label for="solo-name">你的跑酷昵称</label><input id="solo-name" maxlength="20" value="${esc(profile.name)}"><p class="muted">成绩计入单人榜，金币存入你的账户。</p><button id="start-solo" class="primary">开始单人模式 →</button></div>`);
    $('start-solo').onclick=async()=>{const name=$('solo-name').value.trim();if(!name)return toast('先起一个可爱的名字吧');$('start-solo').disabled=true;try {await api('/api/me',{name});profile.name=name;save('puppy.profile',profile);updateProfile();if(send({type:'solo',character}))$('dialog').close();}catch(e){toast(e.message);$('start-solo').disabled=false;}};
  });
}
$('practice').onclick=startPractice;
let rankingMode='solo';
document.querySelectorAll('[data-ranking]').forEach(b=>b.onclick=()=>{rankingMode=b.dataset.ranking;document.querySelectorAll('[data-ranking]').forEach(x=>x.classList.toggle('selected',x===b));loadRanking();});
function updateAccount(account){me={...me,...account};$('coin-balance').textContent=String(me.coins||0);if(currentPage==='wardrobe')renderWardrobe();}
async function loadWardrobe(){try{await connect();updateAccount(await api('/api/me'));renderWardrobe();}catch(e){$('shop-items').innerHTML=`<p class="empty">${esc(e.message)}<br>连接服务器后，来给小狗挑衣服吧。</p>`;}}
function renderWardrobe(){
  $('wardrobe-balance').textContent=String(me?.coins||0);
  $('shop-items').innerHTML=CATALOG.map(item=>{const owned=me?.owned?.includes(item.id),wearing=me?.equipped?.[item.slot]===item.id;return `<article class="shop-item"><canvas data-item="${item.id}" aria-label="${item.name}"></canvas><h3>${item.name}</h3><p>${owned?'已永久拥有':`${item.price} 金币 · 永久`}</p><button class="${owned?'secondary':'primary'}" data-buy="${item.id}" ${!owned&&(me?.coins||0)<item.price?'disabled':''}>${owned?(wearing?'脱下':'穿上'):(me?.coins||0)<item.price?'金币不足':'购买并穿上'}</button></article>`;}).join('');
  document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const id=b.dataset.buy,owned=me.owned?.includes(id);updateAccount(await api(owned?'/api/shop/equip':'/api/shop/buy',owned?{id,enabled:me.equipped?.[id]!==id}:{id}));toast(owned?'穿搭保存好了':'购买成功，永久拥有啦');}catch(e){toast(e.message);renderWardrobe();}});
  redrawArt();
}
function input(kind) { if (!gameVisible || $('dialog').open) return; if (kind !== 'jump-release') sound(kind); if (practice) action(game, kind); else if (online && room?.phase === 'running') { if (!predictionEnabled) send({type:'input',action:kind}); else { const seq = prediction.input(kind); if (seq !== null) send({ type: 'input', action: kind, seq }); } } }
$('jump-button').onpointerdown = e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); input('jump'); };
for (const event of ['pointerup','pointercancel','lostpointercapture']) $('jump-button').addEventListener(event, () => releaseJump());
let jumpPressed = false;
function releaseJump() { if (!jumpPressed) return; jumpPressed = false; input('jump-release'); }
$('jump-button').addEventListener('pointerdown',()=>jumpPressed=true);
document.addEventListener('keyup',e=>{if(e.code==='Space')releaseJump();});
window.addEventListener('blur',releaseJump);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseJump();}); $('dash-button').onpointerdown = e => { e.preventDefault(); input('dash'); };
document.addEventListener('keydown', e => { if (!gameVisible || e.repeat || $('dialog').open) return; if (e.code === 'Space') { e.preventDefault(); jumpPressed = true; input('jump'); } if (['KeyD', 'ArrowRight'].includes(e.code)) { e.preventDefault(); input('dash'); } if (e.code === 'Escape') pause(); });
function pause() { audio.setActive(false); if (!gameVisible || game?.status === 'ended') return; if (practice) { game.status = 'paused'; localCountdown = 0; } else send({ type: 'pause' }); }
$('pause-button').onclick = pause;
document.addEventListener('visibilitychange', () => { if (document.hidden && gameVisible && game?.status === 'running') pause(); });
document.addEventListener('puppy-background', () => { if (gameVisible && game?.status === 'running') pause(); });
document.addEventListener('puppy-back', () => { if ($('dialog').open) $('dialog').close(); else if (gameVisible) $('exit-game').click(); else if (room) $('leave-room').click(); else showPage('home'); });
$('exit-game').onclick = () => {
  if (game?.status === 'ended') return leaveGame();
  pause(); dialog('结束这次冒险？', `<p class="muted">已跑过的里程会结算。双人游戏将标记为中断，并通知搭档。</p><div class="overlay-actions" style="margin-top:22px"><button class="secondary" id="cancel-exit">再陪小狗一会儿</button><button class="primary" id="confirm-exit">结束并退出</button></div>`);
  $('cancel-exit').onclick = () => { $('dialog').close(); toast('点击继续即可恢复游戏'); }; $('confirm-exit').onclick = () => { $('dialog').close(); leaveGame(); };
};
function leaveGame() {
  if (practice) { if (game?.status !== 'ended') finish(game, 'interrupted'); practice = false; hideGame(); showPage('home'); }
  else if (online) send({ type: 'leave' }); else { room = null; hideGame(); showPage('home'); }
}
function overlay(key, html, wire) {
  if (overlayKey === key) return; overlayKey = key; $('game-overlay').classList.toggle('hidden', !key);
  $('game-overlay').innerHTML = key ? `<div class="overlay-card">${html}</div>` : ''; wire?.();
}
function renderOverlay(now) {
  if (!gameVisible) return;
  if (!practice && !online) return overlay('disconnected', '<div class="big-number">♡</div><h2>正在找回搭档…</h2><p>游戏已停止操作，正在重新连接。<br>服务器会等待 15 秒，超时后结算。</p>');
  const countdown = practice ? localCountdown ? Math.max(0, Math.ceil((localCountdown - now) / 1000)) : 0 : room?.phase === 'countdown' ? room.countdown : 0;
  if (countdown) return overlay(`count:${countdown}`, `<span class="eyebrow">READY, PUPPY?</span><div class="big-number">${countdown}</div><p>${room?.mode==='solo'?'跳跃、冲刺，向前出发。':'你跳跃，我冲刺，一起向前。'}</p>`);
  if (room?.phase === 'shop' && room.shop) {
    const shop = room.shop, canChoose = room.mode === 'solo' || room.members.find(m => m.id === me?.id)?.role === 'dash';
    const names = { stopwatch: '秒表', bridge: '浮桥', talisman: '护身符', fireball: '火焰球', puppy: '小小狗', wings: '天使之翼' };
    const descriptions = { stopwatch: '让怪物停下 5 秒，世界继续向前。', bridge: '脚下铺出浮桥，恢复二段跳与二段冲刺。', talisman: '掉下断崖时，自动消耗一个并复活。', fireball: '继续游戏后自动向前发射火球 5 秒，重复获得累加时长。', puppy: '另一只小狗跟在身后，为你抵挡一次怪物或尖刺伤害，重复获得不叠加。', wings: '由跳跃方使用：长按上升，松开下降，持续 10 秒。' };
    return overlay(`shop:${shop.visit}:${shop.picked}:${canChoose}`, `<span class="eyebrow">A LITTLE LUCK</span><h2>${shop.reward ? `获得${names[shop.reward]}！` : '黑洞里的金蛋小店'}</h2><p>${shop.reward ? descriptions[shop.reward] : canChoose ? '三枚金蛋，敲开一份小幸运。' : '等冲刺搭档敲开一枚金蛋 ♡'}</p><div class="gold-eggs">${[0,1,2].map(i => `<button class="gold-egg ${shop.picked === i ? 'cracked' : ''}" data-egg="${i}" aria-label="敲第${i+1}枚金蛋" ${!canChoose || shop.picked !== null ? 'disabled' : ''}><span>${shop.picked === i ? '✦' : '?'}</span></button>`).join('')}</div><p>${shop.reward ? (shop.reward === 'puppy' ? '小伙伴已就位 · 最多跟随一只' : shop.reward === 'fireball' ? '已增加 5 秒火力 · 回到跑道自动生效' : '已放入本局道具袋 · 次数可叠加') : '六种小幸运，随机藏入三枚金蛋。免费选一次。'}</p>${shop.reward && canChoose ? '<button class="primary" id="shop-continue">带上幸运，继续跑 →</button>' : shop.reward ? '<p>等搭档准备好，一起继续。</p>' : ''}`, () => {
      document.querySelectorAll('[data-egg]').forEach(button => button.onclick = () => { sound('heart'); send({ type: 'egg', visit: shop.visit, index: Number(button.dataset.egg) }); });
      if ($('shop-continue')) $('shop-continue').onclick = () => send({ type: 'shop-continue', visit: shop.visit });
    });
  }
  if (!practice && room?.phase === 'lobby') return;
  if ((practice && game?.status === 'ended') || (!practice && room?.phase === 'ended')) {
    let result = room?.result;
    if (practice) result = { distance: game.distance, duration: game.time * 1000, best: localBest, improved: game.newBest };
    if (!result) return;
    overlay(`result:${result.distance}`, `<span class="eyebrow">OUR LITTLE ADVENTURE</span><h2>${result.improved ? (room?.mode==='solo'?'新的纪录，你做到啦！':'新的纪录，一起做到啦！') : '每一步，都算数。'}</h2><p>${practice ? '离线试跑' : result.interrupted ? '本局已中断，跑过的路已记下' : game?.reason === 'fall' ? '下次再跨过那道断崖吧' : '休息一下，再跑远一点'}</p><div class="result-metrics"><div><b>${result.distance.toFixed(1)}<small>米</small></b><small>本局里程</small></div><div><b>${duration(result.duration)}</b><small>实际游玩时间</small></div></div><p>击败 ${result.kills||0} 只怪物 · 奖励 ${result.bonusDistance||0} 米<br>本局 ${result.coinsEarned||0} 金币${room?.mode==='solo'?'':' · 记入房主账户'}</p><p>历史最佳 ${result.best?.distance?.toFixed(1) || '0.0'} 米</p><div class="overlay-actions"><button id="result-back" class="secondary">返回大厅</button><button id="result-again" class="primary">再来一局 →</button></div>`, () => { $('result-back').onclick = leaveGame; $('result-again').onclick = () => practice ? startPractice() : send({ type: 'again' }); }); return;
  }
  if ((practice && game?.status === 'paused') || (!practice && room?.phase === 'paused')) {
    const reconnect = !practice && room?.reconnect != null, mine = room?.members.find(m => m.id === me?.id);
    return overlay(`paused:${reconnect ? room.reconnect : mine?.resume}`, `<div style="font-size:35px">☁</div><h2>${reconnect ? room?.mode==='solo'?'等待重新连接':'等搭档回来' : '停一下，也没关系。'}</h2><p>${reconnect ? `还可等待 ${room.reconnect} 秒，重连后一起继续。` : practice ? '小狗也需要喘口气，准备好再出发。' : room?.mode==='solo'?'点击继续，倒数后出发。':'两个人都点击继续后，会倒数恢复。'}</p>${reconnect ? '' : `<button id="resume-button" class="primary" ${!practice && mine?.resume ? 'disabled' : ''}>${!practice && mine?.resume ? '已准备，等待搭档' : '我准备好继续啦'}</button>`}`, () => { if ($('resume-button')) $('resume-button').onclick = () => { if (practice) localCountdown = performance.now() + 3000; else send({ type: 'resume' }); }; });
  }
  overlay('', '');
}
function sound(kind) { audio.unlock();audio.effect(kind); }
function updateAudioState(){
  audio.setActive(gameVisible && game?.status==='running' && (practice||online&&room?.phase==='running') && !document.hidden);
  if(!gameVisible||!game){lastAudioState=null;return;}
  if(lastAudioState && lastAudioState.seed===game.seed && game.time>=lastAudioState.time){
    if(game.dog.lives<lastAudioState.lives)audio.effect('hurt');
    else if(game.dog.lives>lastAudioState.lives)audio.effect('heart');
    if(game.dog.sword>lastAudioState.sword+.05)audio.effect('sword');
    if(game.status==='ended' && lastAudioState.status!=='ended')audio.effect('end');
  }
  lastAudioState={seed:game.seed,time:game.time,lives:game.dog.lives,sword:game.dog.sword,status:game.status};
}
function vibrate() { navigator.vibrate?.(45); }
function frame(now) {
  if (!gameVisible && !document.hidden && now - lastArtFrame >= 1000 / 30) { redrawArt(now); lastArtFrame = now; }
  const dt = Math.min(.05, (now - lastFrame) / 1000); lastFrame = now;
  if (gameVisible && game) {
    if (practice) {
      if (localCountdown && now >= localCountdown) { localCountdown = 0; game.status = 'running'; }
      if (game.status === 'running') {
        step(game, dt);
        if (game.dog.lives < lastLife) vibrate(); lastLife = game.dog.lives;
        if (game.status === 'ended') { game.newBest = !localBest || game.distance > localBest.distance; if (game.newBest) { localBest = { distance: game.distance, duration: game.time * 1000 }; save('puppy.practiceBest', localBest); } }
      }
    }
    // Short visual extrapolation only; collision, score and state remain server-owned.
    let visual = game;
    if (!practice && online && room?.phase === 'running' && game.status === 'running') visual = prediction.frame(dt) || game;
    renderGame($('game-canvas'), visual, visual.time);
    if (now - lastHudAt >= 100) { lastHudAt = now;
    $('distance-label').textContent = `${(Math.floor(game.distance * 10) / 10).toFixed(1)} m`; $('time-label').textContent = duration(game.time * 1000);
    $('life-label').textContent = '♥ '.repeat(Math.max(0, game.dog.lives)) + '♡ '.repeat(3 - Math.max(0, game.dog.lives));
    $('power-label').textContent = game.dog.sword > 0 ? `⚔ 宝剑 ${game.dog.sword.toFixed(1)} s` : '';
    const itemBag = game.items || {};
    $('consumables').classList.remove('hidden');
    const myRole = room?.members.find(m => m.id === me?.id)?.role;
    for (const item of ['stopwatch', 'bridge', 'wings']) {
      const button = $(`${item}-button`); button.classList.toggle('hidden', !itemBag[item] || (room?.mode !== 'solo' && myRole !== (item === 'wings' ? 'jump' : 'dash')));
      button.disabled = room?.phase !== 'running' || (item === 'wings' && game.dog.wings > 0); button.querySelector('b').textContent = itemBag[item] || 0;
    }
    $('power-label').textContent += `${game.freeze > 0 ? ` · ⏱ 怪物暂停 ${game.freeze.toFixed(1)}s` : ''}${itemBag.talisman ? ` · ♧ 护身符 ×${itemBag.talisman}` : ''}`;
    $('power-label').textContent += `${game.fire > 0 ? ` · 🔥 ${game.fire.toFixed(1)}s` : ''}${game.companion ? ' · 小小狗 ♥ +1' : ''}${game.dog.wings > 0 ? ` · 翅膀 ${game.dog.wings.toFixed(1)}s` : ''}`;
    $('jump-button').querySelector('b').textContent = game.dog.wings > 0 ? '长按飞翔' : '跳跃';
    $('speed-label').textContent = `跑速 ×${(game.speed / 220).toFixed(2)} · 击杀 +${game.bonusDistance||0}m · 本局 ${Math.floor(game.distance/5000)} 金币`;
    $('jump-button').querySelector('small').textContent = game.dog.wings > 0 ? '松开下降' : '● '.repeat(game.dog.jumps) + '○ '.repeat(2 - game.dog.jumps);
    $('dash-button').querySelector('small').textContent = game.dog.grounded && game.dog.groundCooldown > 0 ? `${game.dog.groundCooldown.toFixed(1)}s` : '● '.repeat(game.dog.dashes) + '○ '.repeat(2 - game.dog.dashes);
  }
  }
  updateAudioState(); renderOverlay(now); requestAnimationFrame(frame);
}
selectCharacter(character); updateProfile(); requestAnimationFrame(redrawArt); requestAnimationFrame(frame);
if (base) connect().catch(() => {});

artReady.then(()=>redrawArt()).catch(e=>toast(e.message));

for (const item of ['stopwatch', 'bridge', 'wings']) $(`${item}-button`).onclick = () => { sound('heart'); send({ type: 'use-item', item }); };
