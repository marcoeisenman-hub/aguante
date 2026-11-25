import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, trackPos, trackDir, TRACK, ROX, OUT_S } from './world.js';
import { loadAthletes } from './athlete.js';
import { Race, GEARS, SEG_NAMES } from './race.js';
import { division, validDivision, STATIONS, RECORDS, fmt, COUNTRIES, fieldDistribution, PAPA, LOADS } from './data.js';
import { Audio } from './audio.js';
import { Room, newCode } from './online.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

// ---------------- Entrada ----------------
const KEYS1 = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R', ArrowUp: 'U', KeyW: 'U', ArrowDown: 'D', KeyS: 'D', Space: 'A', Enter: 'A', KeyE: 'S', Tab: 'S', ShiftLeft: 'S', ShiftRight: 'S' };
const KEYS_P1 = { KeyA: 'L', KeyD: 'R', KeyW: 'U', KeyS: 'D', Space: 'A', KeyE: 'S', ShiftLeft: 'S' };
const KEYS_P2 = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D', Enter: 'A', ShiftRight: 'S', Slash: 'S', NumpadEnter: 'A' };
class Pad {
  constructor() { this.d = new Set(); this.p = new Set(); this.r = new Set(); this.qp = new Set(); this.qr = new Set(); }
  kd(k) { if (!this.d.has(k)) { this.d.add(k); this.qp.add(k); } }
  ku(k) { if (this.d.has(k)) { this.d.delete(k); this.qr.add(k); } }
  frame() { this.p = this.qp; this.r = this.qr; this.qp = new Set(); this.qr = new Set(); }
  down(k) { return this.d.has(k); } pressed(k) { return this.p.has(k); } released(k) { return this.r.has(k); }
  clear() { for (const k of this.d) this.qr.add(k); this.d.clear(); }
}
const pad1 = new Pad(), pad2 = new Pad();
pad1.p2 = pad2;
let twoP = false;
addEventListener('keydown', e => {
  if (e.repeat) { if (state === 'race' && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab')) e.preventDefault(); return; }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'race') pauseGame(); else if (state === 'paused') resume(); return; }
  if (state !== 'race') return;
  if (twoP) { if (KEYS_P1[e.code]) pad1.kd(KEYS_P1[e.code]); if (KEYS_P2[e.code]) pad2.kd(KEYS_P2[e.code]); }
  else if (KEYS1[e.code]) pad1.kd(KEYS1[e.code]);
  if (KEYS1[e.code] || KEYS_P2[e.code]) e.preventDefault();
});
addEventListener('keyup', e => {
  if (twoP) { if (KEYS_P1[e.code]) pad1.ku(KEYS_P1[e.code]); if (KEYS_P2[e.code]) pad2.ku(KEYS_P2[e.code]); }
  else if (KEYS1[e.code]) pad1.ku(KEYS1[e.code]);
});
addEventListener('blur', () => { pad1.clear(); pad2.clear(); });
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
for (const b of $$('#touch button')) {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); pad1.kd(k); b.classList.add('on'); };
  const off = e => { e.preventDefault(); pad1.ku(k); b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
}

// ---------------- Render ----------------
const canvas = $('#c');
let Q = +store.get('aguanteQ', 2);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q >= 1, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = Q >= 1; renderer.shadowMap.type = THREE.PCFShadowMap;
const camera = new THREE.PerspectiveCamera(55, 1, 0.08, 260);
let composer, bloom;
function setQuality(q) {
  Q = q; store.set('aguanteQ', q);
  renderer.setPixelRatio(Math.min(devicePixelRatio, q >= 2 ? 1.5 : q === 1 ? 1.15 : 0.85));
  renderer.shadowMap.enabled = q >= 1;
  resize();
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 70 : 55; camera.updateProjectionMatrix();
  composer?.setSize(w, h);
}
addEventListener('resize', resize);

let world;
const camPos = new THREE.Vector3(0, 8, 30), camLook = new THREE.Vector3();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

// ---------------- Estado ----------------
let state = 'loading', race = null, demo = null, lastSetup = null;
const S = store.get('aguanteSetup', { format: 'singles', cat: 'M', level: 'open', heat: 'comp', partner: 'ai', name: '', country: 'PAN', age: 16, kit: 0, ghost: true });
let K = +store.get('aguanteK', 5);

async function boot() {
  const bar = $('#loadbar'), txt = $('#loadtxt');
  const step = (p, t) => { bar.style.width = p + '%'; if (t) txt.textContent = t; };
  step(10, 'Montando el pabellón…');
  await document.fonts?.load('800 40px Barlow').catch(() => { });
  world = new World(renderer, Q);
  step(35, 'Encendiendo las luces…');
  await world.env();
  step(55, 'Llamando a los atletas…');
  await loadAthletes();
  step(85, 'Calentando…');
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(world.scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.5, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  setQuality(Q);
  world.setLoads(division(S.format, S.cat, S.level).loads);
  startDemo();
  renderer.compile(world.scene, camera);
  step(100);
  const qs = new URLSearchParams(location.search).get('sala');
  setTimeout(() => { if (qs) { show('online'); openRoom(qs); } else show('home'); }, 200);
  state = 'menu';
  requestAnimationFrame(loop);
}

// ---------------- Pantallas ----------------
function show(id) {
  $$('.screen').forEach(s => s.classList.toggle('show', s.id === id));
  if (id === 'setup') renderSetup();
  if (id === 'records') renderRecords();
  if (id === 'practice') renderPractice();
}
for (const b of $$('[data-go]')) b.addEventListener('click', () => { initAudio(); Audio.sfx('ui'); show(b.dataset.go); });
function initAudio() {
  Audio.init();
  Audio.setMuted(!$('#optSound').checked);
  if (state === 'menu') Audio.music(1);
  Audio.crowd(0.25);
}
$('#optSound').checked = !store.get('aguanteMute', false);
$('#optSound').addEventListener('change', e => { Audio.setMuted(!e.target.checked); });
$('#optVoice').checked = store.get('aguanteVoice', true);
$('#optVoice').addEventListener('change', e => store.set('aguanteVoice', e.target.checked));
$('#optQ').value = String(Q); $('#optQ').addEventListener('change', e => setQuality(+e.target.value));
$('#optK').value = String(K); $('#optK').addEventListener('change', e => { K = +e.target.value; store.set('aguanteK', K); });

const KIT_COLORS = ['#2a55b8', '#d82219', '#121214', '#f26b0d', '#1a7339', '#8c8f94', '#ebcc19', '#661f8c', '#0d4da6', '#d9d9db'];
function segBind(id, key, after) {
  const el = $('#' + id);
  for (const b of el.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === S[key]);
    b.onclick = () => { if (b.disabled) return; S[key] = b.dataset.v; Audio.sfx('ui'); renderSetup(); after?.(); };
  }
}
function renderSetup() {
  // validar combinaciones
  if (S.format === 'singles' && S.cat === 'X') S.cat = 'M';
  if (!validDivision(S.format, S.cat, S.level)) S.level = 'open';
  segBind('fFormat', 'format'); segBind('fCat', 'cat'); segBind('fLevel', 'level'); segBind('fHeat', 'heat'); segBind('fPartner', 'partner');
  $('#fCat [data-v=X]').disabled = S.format === 'singles';
  $('#fLevel [data-v=pro]').disabled = !validDivision(S.format, S.cat, 'pro');
  $('#fLevel [data-v=elite]').disabled = !validDivision(S.format, S.cat, 'elite');
  $('#fPartnerBox').hidden = S.format !== 'doubles';
  $('#fPartner [data-v=papa]').disabled = S.cat !== 'M';
  if (S.partner === 'papa' && S.cat !== 'M') { S.partner = 'ai'; return renderSetup(); }
  $('#fPartnerNote').textContent = S.partner === 'papa' ? 'Papá corre con su ritmo real de Tampa (~5:10/km en dobles) y es más fuerte en Wall Balls y Lunges que en BBJ. Ajusta tu ritmo para no separarte.' : S.partner === 'p2' ? 'J1: WASD + ESPACIO + E · J2: flechas + ENTER + SHIFT derecho.' : S.cat === 'M' ? 'Solo Doubles Men: papá puede ser tu pareja.' : '';
  const d = division(S.format, S.cat, S.level);
  $('#divName').textContent = d.name;
  const notes = {
    singles: S.level === 'elite' ? 'Elite 15: la oleada de los 15 mejores del ranking Pro, con pesos Pro.' : 'Tú solo: 8 km y las 8 estaciones.',
    doubles: S.cat === 'X' ? 'Doubles Mixed (hombre + mujer): pesos de Men Open; el blanco de wall balls va según quién lanza.' : 'Corren juntos los 8 km y se reparten las estaciones (You Go / I Go).',
    relay: 'Equipo de 4. Cada uno: 2 × (1 km + estación). Solo pesos Open; en Mixed cada atleta con los de su sexo.',
  };
  $('#fNote').textContent = notes[S.format];
  // tabla de pesos
  const uniq = [...new Map(d.loads.map((l, i) => [l.key + d.sexes[i], { l, sex: d.sexes[i] }])).values()];
  const col = (f) => uniq.map(u => f(u.l, u.sex)).filter((v, i, a) => a.indexOf(v) === i).join(' / ');
  const rows = [
    ['SkiErg', '1.000 m'], ['Sled Push', col(l => l.push + ' kg') + ' · 4 × 12,5 m'], ['Sled Pull', col(l => l.pull + ' kg') + ' · 4 × 12,5 m'],
    ['Burpee Broad Jump', '80 m'], ['Row', '1.000 m'], ['Farmers Carry', col(l => '2 × ' + l.farmers + ' kg') + ' · 200 m'],
    ['Sandbag Lunges', col(l => l.sandbag + ' kg') + ' · 100 m'], ['Wall Balls', col(l => l.ball + ' kg') + ' · 100 reps · ' + col((l, s) => (l.target ?? (s === 'F' ? 2.7 : 3)).toFixed(2).replace('.', ',') + ' m')],
  ];
  $('#loads').innerHTML = rows.map((r, i) => `<tr><td>${i + 1}. ${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  const recKey = d.format === 'singles' ? `${S.cat === 'W' ? 'Women' : 'Men'} ${S.level === 'open' ? 'Open' : 'Pro'}` : d.format === 'doubles' ? `Doubles ${S.cat === 'W' ? 'Women' : S.cat === 'M' ? 'Men' : 'Mixed'}${d.pro && S.cat === 'M' ? ' Pro' : ''}` : `Relay ${S.cat === 'W' ? 'Women' : S.cat === 'M' ? 'Men' : 'Mixed'}`;
  const r = RECORDS[recKey];
  const mine = store.get('aguanteRecords', {})[d.name];
  $('#divRec').innerHTML = (r ? `Récord mundial: <b>${r[0]}</b> · ${r[1]}` : '') + (mine ? `<br>Tu mejor: <b>${fmt(mine.best)}</b>` : '');
  // atleta
  const sel = $('#pCountry'); if (!sel.options.length) sel.innerHTML = COUNTRIES.map(c => `<option>${c}</option>`).join('');
  sel.value = S.country; sel.onchange = () => S.country = sel.value;
  const nm = $('#pName'); nm.value = S.name; nm.oninput = () => S.name = nm.value.trim();
  const ag = $('#pAge'); ag.value = S.age; ag.onchange = () => S.age = clamp(+ag.value || 16, 16, 89);
  $('#kits').innerHTML = KIT_COLORS.map((c, i) => `<button style="background:${c}" data-i="${i}" class="${i === S.kit ? 'on' : ''}"></button>`).join('');
  for (const b of $$('#kits button')) b.onclick = () => { S.kit = +b.dataset.i; renderSetup(); };
  const g = $('#pGhost'); g.checked = S.ghost; g.onchange = () => S.ghost = g.checked;
  store.set('aguanteSetup', S);
}
$('#goRace').addEventListener('click', () => {
  initAudio(); store.set('aguanteSetup', S);
  if (room) { room.me.name = S.name || 'Atleta'; room.me.kit = S.kit; room.me.country = S.country; room.hello(); if (room.isHost) room.send({ t: 'cfg', cfg: hostCfg() }); show('online'); renderLobby(); return; }
  startRace();
});

// ---------------- Online ----------------
let room = null, roomCfg = null, onlineRace = false, sendT = 0;
const hostCfg = () => ({ format: S.format, cat: S.cat, level: S.level, heat: S.heat, K });
function divLabel(c) { return division(c.format, c.cat, c.level).name; }
function openRoom(code) {
  room?.leave();
  room = new Room(code, { name: S.name || 'Atleta', kit: S.kit, country: S.country, host: false });
  roomCfg = null;
  $('#oOff').hidden = true; $('#oOn').hidden = false;
  $('#oCodeShow').textContent = room.code;
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('sala', room.code); $('#oUrl').value = u.href;
  history.replaceState(null, '', '?sala=' + room.code);
  room.on('status', st => { $('#oStatus').textContent = st === 'ok' ? 'Conectado. Manda el link a tus amigos.' : st === 'lost' ? 'Se cortó la conexión. Reintentando…' : 'No logro conectar con el servidor de salas. Revisa el internet.'; renderLobby(); });
  room.on('peers', () => { renderLobby(); if (room.isHost) room.send({ t: 'cfg', cfg: hostCfg() }); if (race?.online) for (const id of race.remotes.keys()) if (!room.peers.has(id)) race.dropRemote(id); });
  const fromLeader = m => room.list()[0]?.id === m.from;
  room.on('cfg', (m, p) => { if (!room.isHost && fromLeader(m)) { roomCfg = m.cfg; Object.assign(S, { format: m.cfg.format, cat: m.cfg.cat, level: m.cfg.level, heat: m.cfg.heat }); if (S.format === 'doubles' && S.partner === 'p2') S.partner = 'ai'; renderLobby(); } });
  room.on('start', m => { if (!fromLeader(m) || (state === 'race' && race?.online)) return; if (!Array.isArray(m.people) || !Array.isArray(m.lanes) || !m.cfg) return; launchOnline(m); });
  room.on('st', (m, p) => { if (race?.online) race.applyRemote(m.from, m.s); });
  const myRoom = room; room.connect().catch(e => { if (room === myRoom) $('#oStatus').textContent = e.message; });
  renderLobby();
}
function leaveRoom() { room?.leave(); room = null; history.replaceState(null, '', location.pathname); $('#oOff').hidden = false; $('#oOn').hidden = true; }
function renderLobby() {
  if (!room) return;
  const L = room.list();
  $('#oPlayers').innerHTML = L.map((p, i) => `<div><i style="background:${KIT_COLORS[p.kit ?? 0]}"></i>${escapeHtml(p.name || 'Atleta')}${p.id === room.me.id ? ' (tú)' : ''}<small>${i === 0 ? 'líder' : ''}</small></div>`).join('');
  const host = room.isHost;
  const c = host ? hostCfg() : roomCfg;
  $('#oDiv').textContent = c ? divLabel(c) : 'esperando al líder…';
  $('#oDur').textContent = c ? (c.K >= 8 ? 'corta (~9 min)' : 'normal (~15 min)') : '';
  $('#oGo').hidden = !host; $('#oGo').disabled = !room.ok;
  $('#oEdit').textContent = host ? 'Cambiar división y atleta' : 'Cambiar mi atleta';
  const myIdx = L.findIndex(p => p.id === room.me.id);
  $('#oHint').textContent = !host && myIdx >= 8 ? 'Sala llena (máx. 8): esperas la próxima carrera.' : host ? (L.length < 2 ? 'Cuando entren tus amigos, dale a la salida. También puedes correr solo.' : (L.length > 8 ? `Hay ${L.length}: solo corren los 8 primeros en entrar.` : `${L.length} atletas listos. El resto del heat se llena con rivales IA.`)) : 'El líder elige la división y da la salida.';
}
setInterval(() => { if (room?.ok && room.isHost && state !== 'race') room.send({ t: 'cfg', cfg: hostCfg() }); }, 2000);
const escapeHtml = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
$('#oNew').onclick = () => { initAudio(); openRoom(newCode()); };
$('#oJoin').onclick = () => { const c = $('#oCode').value.trim().toUpperCase(); if (c.length >= 4) { initAudio(); openRoom(c); } };
$('#oCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#oUrl').value); $('#oCopy').textContent = '¡Copiado!'; setTimeout(() => $('#oCopy').textContent = 'Copiar link', 1400); } catch { $('#oUrl').select(); } };
$('#oBack').onclick = () => { leaveRoom(); show('home'); };
$('#oEdit').onclick = () => show('setup');
$('#oGo').onclick = () => {
  if (!room?.isHost) return;
  const L = room.list().slice(0, 8);
  const m = { t: 'start', cfg: hostCfg(), seed: (Math.random() * 2 ** 31) | 0, at: Date.now() + 2500, lanes: L.map((p, i) => [p.id, [1, 3, 5, 7, 0, 2, 4, 6][i % 8]]), people: L.slice(0, 8).map(p => ({ id: p.id, name: String(p.name || 'Atleta').slice(0, 16), kit: (p.kit | 0) % 10, country: String(p.country || 'PAN').slice(0, 3) })) };
  room.send(m); launchOnline(m);
};
function launchOnline(m) {
  if (!m.people.some(p => p.id === room.me.id)) { $('#oStatus').textContent = 'La sala está llena (máx. 8): esta carrera arrancó sin ti.'; return; }
  const c = m.cfg; Object.assign(S, { format: c.format, cat: c.cat, level: c.level, heat: c.heat });
  if (S.format === 'doubles' && S.partner === 'p2') S.partner = 'ai';
  const lanes = new Map(m.lanes);
  const remotes = m.people.filter(p => p.id !== room.me.id).map(p => ({ ...p, lane: lanes.get(p.id) ?? 0 }));
  const wait = Math.max(0, m.at - Date.now());
  startRace(null, { seed: m.seed, K: c.K, remotes, lane: lanes.get(room.me.id) ?? 3, wait });
}

function renderPractice() {
  const d = division(S.format, S.cat, S.level);
  $('#pList').innerHTML = STATIONS.map((s, i) => `<button class="btn" data-id="${s.id}">${i + 1}. ${s.name}<small>${s.dist} ${s.unit === 'reps' ? 'reps' : 'm'} · ${d.name}</small></button>`).join('');
  for (const b of $$('#pList button')) b.onclick = () => { initAudio(); startRace(b.dataset.id); };
}
function renderRecords() {
  const rec = store.get('aguanteRecords', {});
  const ks = Object.keys(rec);
  $('#recList').innerHTML = ks.length ? `<table class="loads">${ks.map(k => `<tr><td>${k}<div class="note">${rec[k].date} · ${rec[k].runs} carreras</div></td><td>${fmt(rec[k].best)}</td></tr>`).join('')}</table>` : '<p class="note">Todavía no terminaste ninguna carrera.</p>';
  $('#wrList').innerHTML = Object.entries(RECORDS).map(([k, v]) => `<tr><td>${k}<div class="note">${v[1]}</div></td><td>${v[0]}</td></tr>`).join('');
}

// ---------------- Demo de fondo (menú) ----------------
function startDemo() {
  demo?.dispose();
  const d = division('singles', 'M', 'open');
  world.setLoads(d.loads);
  demo = new Race({ world, div: d, K: 5, audio: null, level: 'comp' });
  demo.me.members.forEach(m => m.av.group.visible = false);
  demo.started = true; demo.clock = 380;
}
function demoUpdate(dt, t) {
  demo.clock += dt * 5;
  if (demo.clock > demo.entries[1].total + 200) demo.clock = 200;
  demo.updateAI(dt);
  for (const e of demo.entries) if (!e.isPlayer) for (const m of e.members) if (m.av.group.visible) m.av.update(dt);
  // cámara: recorre el pabellón siguiendo a un rival
  const e = demo.entries[1 + (Math.floor(t / 14) % (demo.entries.length - 1))];
  const p = e.members[0].av.group.position;
  const a = t * 0.12;
  tmpA.set(p.x + Math.cos(a) * 7, 2.6 + Math.sin(t * 0.2) * 0.6, p.z + Math.sin(a) * 7);
  tmpB.set(p.x, 1.1, p.z);
  camPos.lerp(tmpA, 1 - Math.exp(-dt * 1.2)); camLook.lerp(tmpB, 1 - Math.exp(-dt * 2));
  world.update(dt, t, p);
}

// ---------------- Carrera ----------------
function startRace(practice = null, on = null) {
  onlineRace = !!on;
  demo?.dispose(); demo = null;
  race?.dispose();
  const d = division(S.format, S.cat, S.level);
  world.setLoads(d.loads);
  twoP = !on && S.format === 'doubles' && S.partner === 'p2';
  lastSetup = practice;
  race = new Race({
    world, div: d, K: on?.K ?? K, seed: on?.seed, remotes: on?.remotes, lane: on?.lane, audio: { sfx: (n, o) => Audio.sfx(n, o), cheer: s => Audio.cheer(s), say: (t, o) => { if ($('#optVoice').checked) Audio.say(t, o); } },
    level: S.heat, name: S.name || 'Tú', country: S.country, kit: S.kit, ghost: S.ghost && !(d.format === 'doubles' && S.partner === 'papa'), twoP, partner: S.partner, practice, events: onRaceEvent,
  });
  race.me.age = S.age;
  if (on) race.countdown += (on.wait || 0) / 1000;
  hudInit();
  show(null); $('#hud').hidden = false; $('#touch').hidden = !isTouch;
  $('#tSwap').style.display = d.format === 'doubles' ? '' : 'none';
  state = 'race';
  Audio.music(2); Audio.crowd(0.55);
  pad1.clear(); pad2.clear();
  camPos.set(0, 6, 0);
  // cámara inicial
  const st = trackPos(OUT_S + 6); camPos.set(st.x + 8, 3, st.z + 6); camLook.set(st.x, 1, st.z);
  lastPhase = null;
}
function pauseGame() { if (state !== 'race') return; state = 'paused'; show('pause'); if (!onlineRace) Audio.music(1); pad1.clear(); pad2.clear(); }
function resume() { state = 'race'; show(null); Audio.music(2); pad1.clear(); }
$('#pResume').onclick = resume;
$('#pRestart').onclick = () => { if (onlineRace) { quitToMenu(); show('online'); renderLobby(); return; } startRace(lastSetup); };
$('#pQuit').onclick = quitToMenu;
$('#hPause').onclick = pauseGame;
$('#rMenu').onclick = quitToMenu;
$('#rAgain').onclick = () => { if (onlineRace && room) { quitToMenu(); show('online'); renderLobby(); return; } startRace(lastSetup); };
function quitToMenu() {
  race?.dispose(); race = null; state = 'menu';
  $('#hud').hidden = true; $('#touch').hidden = true;
  startDemo(); show('home'); Audio.music(1); Audio.crowd(0.25);
  Audio.loop('sled', 0); Audio.loop('flywheel', 0); Audio.loop('breath', 0);
}

let lastPhase = null, cardT = 0;
function onRaceEvent(type, data) {
  if (type === 'count') { const c = $('#hCount'); c.textContent = data; c.style.opacity = 1; }
  if (type === 'go') { const c = $('#hCount'); c.textContent = '¡YA!'; setTimeout(() => c.textContent = '', 700); Audio.music(2); }
  if (type === 'finish') setTimeout(showResults, 2600);
  if (type === 'split') onSplit(data);
}
function onSplit({ seg, t }) {
  if (!race.ghost || race.practice) return;
  // comparación con papá al final de cada tramo
  const g = race.ghost; let gt = 0;
  for (let i = 0; i <= seg; i++) gt += g.segT[i] + g.roxT[i] * (i < seg ? 1 : 0.5);
  const diff = race.clock - gt;
  race.flash(`vs Papá ${diff < 0 ? '−' : '+'}${fmt(Math.abs(diff))}`, diff < 0 ? 'good' : 'meh', 2.2);
}

// ---------------- HUD ----------------
function hudInit() {
  const d = race.div;
  $('#strip').innerHTML = SEG_NAMES.map((n, i) => `<i class="${i % 2 ? 'st' : ''}" title="${n}"></i>`).join('');
  $('#hDiv').textContent = d.name + (race.practice ? ' · práctica' : '');
  $('#hMateBox').hidden = d.format !== 'doubles';
  $('#hCard').classList.remove('show');
  $('#hFlash').innerHTML = ''; $('#hCount').textContent = '';
}
let hudT = 0;
function hudUpdate(dt) {
  hudT += dt; if (hudT < 0.05) return; hudT = 0;
  const me = race.me, m = race.active;
  $('#hClock').textContent = fmt(race.clock + me.pens.reduce((a, p) => a + p.sec, 0));
  const segName = me.phase === 'run' ? `Run ${me.seg / 2 + 1} · vuelta ${Math.min(2, (me.lapOf || 1))}/2` : me.phase === 'station' ? `${me.seg / 2 + 0.5 | 0 + 1}` : 'Roxzone';
  const stI = (me.seg - 1) / 2;
  $('#hSeg').textContent = me.finished ? 'Meta' : me.phase === 'run' ? `Run ${me.seg / 2 + 1} de 8 · vuelta ${Math.min(2, me.lapOf || 1)}/2` : me.phase === 'station' ? `${stI + 1}. ${STATIONS[stI].name}` : me.phase === 'toFinish' ? 'A la meta' : 'Roxzone';
  // tira de tramos
  const ii = $$('#strip i');
  ii.forEach((el, i) => { el.className = (i % 2 ? 'st ' : '') + (i < me.seg || me.finished ? 'done' : i === me.seg ? 'now' : ''); });
  // energía
  const e = m.energy; const eb = $('#hEnergy'); eb.style.width = e + '%'; eb.style.background = e > 40 ? 'var(--good)' : e > 15 ? 'var(--meh)' : 'var(--bad)';
  $('#hEnergyN').textContent = Math.round(e);
  $('#hHR').textContent = Math.round(m.hr);
  $('#hWho').textContent = race.div.format === 'relay' ? `${m.name} · atleta ${me.active + 1}/4` : race.div.format === 'doubles' ? (me.phase === 'station' ? (me.worker === 0 ? `${me.members[0].name} trabajando` : `${me.members[1].name} trabajando · E para cambiar`) : `${me.members[0].name} + ${me.members[1].name}`) : m.name;
  if (race.div.format === 'doubles') {
    const mt = me.members[1]; $('#hMate').style.width = mt.energy + '%'; $('#hMateName').textContent = mt.name.split(' ')[0].toUpperCase();
    $('#hGap').textContent = me.phase === 'run' && me.gapSec > 1 ? `${me.gapSec.toFixed(0)} s` : Math.round(mt.energy);
    $('#hGap').style.color = me.gapSec > 7 ? 'var(--bad)' : '';
  }
  // centro
  const big = $('#hBig'), sub = $('#hSub'), gEl = $('#hGauge'), keys = $('#hKeys');
  if (me.phase === 'run') {
    const kmDone = clamp(me.sRun / (2 * TRACK.P - 9), 0, 1) * 1000;
    big.textContent = `${Math.round(kmDone)} m`;
    sub.textContent = `${fmt(me.paceKm)} /km`;
    gEl.innerHTML = `<div class="gears">${GEARS.map((g, i) => `<b class="${i === me.gear ? 'on' + (i >= 3 ? ' hot' : '') : ''}">${g.name}</b>`).join('')}</div>`;
    const inHint = me.nearIn ? (me.finalLap ? '<b style="color:var(--acc)">← ROXZONE: pégate a la izquierda</b>' : '<span style="color:var(--meh)">Falta 1 vuelta: no entres</span>') : '';
    keys.innerHTML = inHint || `<span><kbd>↑↓</kbd>ritmo</span><span><kbd>←→</kbd>carril</span>` + (me.paceKm <= 240 && me.lat > -0.5 ? '<span style="color:var(--meh)">Ritmo ≤ 4:00/km: usa el Fast Lane (izquierda)</span>' : '');
  } else if (me.phase === 'station' && me.ctl) {
    const h = me.ctl.hud();
    big.textContent = h.big || ''; sub.textContent = h.sub || '';
    gEl.innerHTML = drawGauge(h.gauge);
    keys.innerHTML = me.ctl.hints().map(([k, t]) => `<span>${k ? `<kbd>${k}</kbd>` : ''}${t}</span>`).join('') + (race.div.format === 'doubles' ? '<span><kbd>E</kbd>cambio</span>' : '');
  } else if (me.phase === 'roxIn' || me.phase === 'roxOut' || me.phase === 'toFinish') {
    big.textContent = me.phase === 'toFinish' ? 'META' : 'ROXZONE'; sub.textContent = me.phase === 'roxIn' ? `a ${STATIONS[(me.seg) / 2 | 0].name}` : me.phase === 'roxOut' ? 'a la pista' : '';
    gEl.innerHTML = ''; keys.innerHTML = `<span><kbd>↑</kbd>mantén para apurar</span>`;
  } else { big.textContent = ''; sub.textContent = ''; gEl.innerHTML = ''; keys.innerHTML = ''; }
  if (me.finished) { big.textContent = fmt(me.total); sub.textContent = '¡Terminaste!'; gEl.innerHTML = ''; keys.innerHTML = ''; }
  // flashes
  $('#hFlash').innerHTML = race.flashes.map(f => `<div class="${f.kind}">${f.text}</div>`).join('');
  // tabla
  const st = race.standings();
  const myPos = st.findIndex(x => x.e.isPlayer) + 1;
  const n = st.length;
  $('#hBoard').innerHTML = `<div class="hd"><span>HEAT · ${race.div.name}</span><span>P${myPos}/${n}</span></div>` +
    st.slice(0, 9).map((x, i) => `<div class="r ${x.e.isPlayer ? 'me' : ''} ${x.e.ghost ? 'gh' : ''}"><span>${i + 1}</span><span>${escapeHtml(x.e.name.length > 22 ? x.e.name.slice(0, 21) + '…' : x.e.name)}${x.e.isRemote ? ' ●' : ''}</span><span>${escapeHtml(x.label)}</span></div>`).join('');
  // tarjeta de estación
  const phase = me.phase + me.seg;
  if (phase !== lastPhase) {
    lastPhase = phase;
    if (me.phase === 'roxIn' || (race.practice && me.phase === 'station' && !cardShown)) showCard();
    if (me.phase === 'run' || me.phase === 'roxOut') $('#hCard').classList.remove('show');
  }
  if (cardT > 0) { cardT -= 0.05; if (cardT <= 0) $('#hCard').classList.remove('show'); }
}
let cardShown = false;
function showCard() {
  const me = race.me; const idx = race.practice ? (me.seg - 1) / 2 : me.seg / 2 | 0;
  const st = STATIONS[idx]; const l = race.active.load; const sex = race.active.sex;
  const spec = {
    ski: ['1.000 m', 'damper 6'], push: [l.push + ' kg', '4 × 12,5 m'], pull: [l.pull + ' kg', '4 × 12,5 m', 'desde la caja'], bbj: ['80 m', 'pecho al piso'],
    row: ['1.000 m', 'damper 6'], farmers: ['2 × ' + l.farmers + ' kg', '200 m'], lunges: [l.sandbag + ' kg', '100 m', 'rodilla al piso'], wb: ['100 reps', l.ball + ' kg', 'blanco ' + (l.target ?? (sex === 'F' ? 2.7 : 3)).toFixed(2).replace('.', ',') + ' m'],
  }[st.id];
  const how = {
    ski: 'Mantén ESPACIO para jalar y suelta cuando la aguja esté en verde. Deja que suban las manos.',
    push: 'Alterna ← → parejo. No dejes que se pare el trineo: arrancarlo de nuevo cuesta.',
    pull: 'Mano sobre mano alternando ← →. Al pasar los 12,5 m corres al otro lado.',
    bbj: '↓ pecho al piso, ↑ arriba, ESPACIO carga el salto y suelta en verde.',
    row: 'Mantén ESPACIO durante el jalón, suelta en verde. Recuperación tranquila.',
    farmers: 'Alterna ← →. Si el agarre se acaba, se caen: suéltalas antes con ESPACIO.',
    lunges: 'Mantén ← hasta que la rodilla toque, suelta; luego →. Siempre alternando.',
    wb: 'Mantén ESPACIO para bajar; abajo suelta cuando la fuerza esté en la franja.',
  }[st.id];
  $('#hCard').innerHTML = `<div class="n">ESTACIÓN ${idx + 1} DE 8</div><h3>${st.name}</h3><div class="spec">${spec.map(s => `<span>${s}</span>`).join('')}</div><p>${how}</p>`;
  $('#hCard').classList.add('show'); cardT = race.practice ? 5 : 6; cardShown = true;
}
function drawGauge(g) {
  if (!g) return '';
  if (g.kind === 'steps') return `<div class="g-label">${g.label || ''}</div><div class="g-steps" style="padding-top:16px">${g.steps.map((s, i) => `<b class="${i === g.at ? 'on' : ''}">${s}</b>`).join('')}</div>`;
  const zone = g.zone ? `<div class="g-zone" style="left:${g.zone[0] * 100}%;width:${(g.zone[1] - g.zone[0]) * 100}%"></div>` : '';
  const fill = g.kind === 'grip' || g.kind === 'speed' || g.kind === 'depth' || g.kind === 'charge' ? `<div class="g-fill" style="width:${clamp(g.val, 0, 1) * 100}%;background:${g.kind === 'grip' ? (g.val > 0.35 ? 'var(--good)' : g.val > 0.15 ? 'var(--meh)' : 'var(--bad)') : 'rgba(255,255,255,.85)'}"></div>` : '';
  const needle = g.kind === 'timing' || g.kind === 'power' ? `<div class="g-needle" style="left:${clamp(g.val, 0, 1) * 100}%"></div>` : '';
  const rec = g.rec != null ? `<div class="g-fill" style="width:${clamp(g.rec, 0, 1) * 100}%;background:rgba(255,255,255,.25)"></div>` : '';
  return `<div class="g-label">${g.label || ''}</div><div class="g-bar">${rec}${zone}${fill}</div>${needle}`;
}

// ---------------- Resultados ----------------
function showResults() {
  if (!race || state !== 'race') return;
  state = 'results';
  const me = race.me, d = race.div;
  Audio.music(1);
  $('#touch').hidden = true;
  $('#rDiv').textContent = d.name + (race.practice ? ' · práctica' : '') + ' · AGUANTE';
  $('#rTime').textContent = fmt(me.total);
  if (race.practice) {
    const st = STATIONS[(me.seg - 1) / 2];
    $('#rPos').textContent = `${st.name}: ${fmt(me.splits[me.seg])}`;
    $('#rSplits').innerHTML = ''; $('#rHeat').innerHTML = ''; $('#rBadges').innerHTML = '';
    $('#rPens').textContent = me.pens.length ? me.pens.map(p => `+${fmt(p.sec)} ${p.why}`).join(' · ') : 'Ninguna';
    show('results'); return;
  }
  const st = race.standings();
  const pos = st.findIndex(x => x.e.isPlayer) + 1;
  // estimación en toda la división
  const [best, med, worst] = fieldDistribution(d);
  const sig = (Math.log(worst) - Math.log(best)) / 4;
  const z = (Math.log(me.total / 60) - Math.log(med)) / sig;
  const pct = 0.5 * (1 + erf(z / Math.SQRT2));
  const size = d.elite ? 15 : d.format === 'singles' ? (S.cat === 'M' ? (d.pro ? 260 : 1150) : (d.pro ? 130 : 720)) : d.format === 'doubles' ? 420 : 160;
  const est = Math.max(1, Math.round(pct * size));
  const ag = ageGroup(me.age || 16);
  $('#rPos').innerHTML = `Puesto <b>${pos}</b> de ${st.length} en el heat · aprox. <b>${est}</b> de ${size} en ${d.name}${d.format === 'singles' && !d.elite ? ` · grupo ${ag}: aprox. <b>${Math.max(1, Math.round(est * 0.1))}</b>` : ''}`;
  // badges
  const badges = [];
  const rec = store.get('aguanteRecords', {});
  const prev = rec[d.name];
  if (!prev || me.total < prev.best) badges.push(['¡Mejor marca!', 'acc']);
  rec[d.name] = { best: Math.min(prev?.best ?? Infinity, me.total), date: new Date().toLocaleDateString('es'), runs: (prev?.runs || 0) + 1 };
  store.set('aguanteRecords', rec);
  if (race.ghost) { const df = me.total - PAPA.total; badges.push([`vs Papá ${df < 0 ? '−' : '+'}${fmt(Math.abs(df))}`, df < 0 ? 'acc' : '']); }
  const runT = me.splits.filter((_, i) => i % 2 === 0).reduce((a, b) => a + (b || 0), 0);
  const roxT = me.rox.reduce((a, b) => a + b, 0);
  badges.push([`Carrera ${fmt(runT)}`, '']); badges.push([`Roxzone ${fmt(roxT)}`, '']);
  $('#rBadges').innerHTML = badges.map(([t, c]) => `<span class="${c}">${t}</span>`).join('');
  // tramos
  let rows = '';
  for (let i = 0; i < 16; i++) {
    const t = me.splits[i] || 0;
    let gd = '';
    if (race.ghost) { const g = race.ghost.segT[i]; const df = t - g; gd = `<span class="d ${df < 0 ? 'up' : 'dn'}">${df < 0 ? '−' : '+'}${fmt(Math.abs(df))}</span>`; }
    rows += `<tr class="${i % 2 ? 'st' : ''}"><td>${SEG_NAMES[i]}</td><td class="r">${fmt(t)}</td><td class="r">${gd}</td></tr>`;
  }
  rows += `<tr><td>Roxzone (16 pasos)</td><td class="r">${fmt(roxT)}</td><td></td></tr>`;
  if (me.penTotal) rows += `<tr><td>Penalizaciones</td><td class="r">+${fmt(me.penTotal)}</td><td></td></tr>`;
  $('#rSplits').innerHTML = rows;
  // heat: termina la simulación de la IA para mostrar todos
  $('#rHeat').innerHTML = race.entries.map(e => ({ e, t: e.isRemote && !e.finished ? Infinity : e.total })).sort((a, b) => a.t - b.t)
    .map((x, i) => `<tr class="${x.e.isPlayer ? 'me' : ''} ${x.e.ghost ? 'gh' : ''}"><td>${i + 1}</td><td>${escapeHtml(x.e.name)} <span class="d">${escapeHtml(x.e.country)}</span></td><td class="r">${x.t === Infinity ? (x.e.left ? 'salió' : 'en carrera') : fmt(x.t)}</td></tr>`).join('');
  $('#rPens').textContent = me.pens.length ? me.pens.map(p => `+${fmt(p.sec)} · ${p.why}`).join('  ·  ') : 'Ninguna. Carrera limpia.';
  show('results');
}
function ageGroup(a) { if (a < 25) return '16–24'; const b = Math.floor(a / 5) * 5; return `${b}–${b + 4}`; }
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }

// ---------------- Cámara de carrera ----------------
function raceCamera(dt) {
  const me = race.me, m = race.active, av = m.av;
  const p = av.group.position;
  let pos, look, k = 3.5;
  if (!race.started) {
    const a = race.countdown * 0.35;
    pos = tmpA.set(p.x + Math.cos(a) * 6, 2.2, p.z + Math.sin(a) * 6); look = tmpB.set(p.x, 1.1, p.z); k = 2;
  } else if (me.finished) {
    const a = race.real * 0.3; pos = tmpA.set(p.x + Math.cos(a) * 5, 2.0, p.z + Math.sin(a) * 5); look = tmpB.set(p.x, 1.2, p.z); k = 2;
  } else if (me.phase === 'run') {
    const d = trackDir(me.s);
    pos = tmpA.set(p.x - d.x * 5.2, 2.4, p.z - d.z * 5.2);
    // un poco hacia afuera de la pista
    const out = new THREE.Vector3(d.z, 0, -d.x).multiplyScalar(-0.8);
    pos.add(out);
    look = tmpB.set(p.x + d.x * 5, 1.1, p.z + d.z * 5); k = 4;
  } else if (me.phase === 'station' && me.ctl?.cam()) {
    const c = me.ctl.cam(); pos = tmpA.copy(c.pos); look = tmpB.copy(c.look); k = 2.5;
  } else {
    const yaw = av.group.rotation.y; const dx = Math.sin(yaw), dz = Math.cos(yaw);
    pos = tmpA.set(p.x - dx * 4.2, 2.3, p.z - dz * 4.2); look = tmpB.set(p.x + dx * 3, 1.0, p.z + dz * 3); k = 3;
  }
  camPos.lerp(pos, 1 - Math.exp(-dt * k)); camLook.lerp(look, 1 - Math.exp(-dt * k * 1.3));
}

// ---------------- Bucle ----------------
let last = performance.now(), T = 0, slowT = 0, boardT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min(0.05, (now - last) / 1000); last = now; T += dt;
  if (state === 'menu' && demo) demoUpdate(dt, T);
  if ((state === 'race' || (state === 'paused' && onlineRace)) && race) {
    pad1.frame(); pad2.frame();
    if (room && onlineRace) { sendT -= dt; if (sendT <= 0 && race.started) { sendT = 0.12; room.send({ t: 'st', s: race.snapshot() }); } }
    race.update(dt, pad1);
    // sonidos continuos
    const L = race.loops || {};
    for (const n of ['sled', 'flywheel', 'breath']) Audio.loop(n, L[n]?.[0] || 0, L[n]?.[1] || 0);
    Audio.music(race.me.phase === 'run' && race.me.gear >= 3 ? 3 : 2);
    raceCamera(dt);
    hudUpdate(dt);
    world.update(dt, T, race.active.av.group.position);
    boardT -= dt; if (boardT <= 0) { boardT = 1; drawJumbo(); }
  } else if ((state === 'results' || state === 'paused') && race) {
    if (room && onlineRace && state === 'results') { sendT -= dt; if (sendT <= 0) { sendT = 1; room.send({ t: 'st', s: race.snapshot() }); } race.updateRemotes(dt); }
    if (state === 'results') { race.clock += dt * race.K; race.updateAI(dt); for (const e of race.entries) for (const m of e.members) if (m.av.group.visible) m.av.update(dt); raceCamera(dt); }
  }
  camera.position.copy(camPos); camera.lookAt(camLook);
  if (composer && Q >= 2) composer.render(); else renderer.render(world.scene, camera);
  // calidad automática si va lento
  if (state === 'race') { if (dt > 0.034) slowT += dt; else slowT = Math.max(0, slowT - dt * 0.5); if (slowT > 4 && Q > 0) { setQuality(Q - 1); $('#optQ').value = String(Q); slowT = 0; } }
}
function drawJumbo() {
  const st = race.standings();
  world.drawScreen(st.slice(0, 8).map(x => ({ name: x.e.isPlayer ? x.e.name.toUpperCase() : x.e.name, where: x.label, time: x.time ? fmt(x.time) : '', me: x.e.isPlayer })), race.div.name.toUpperCase(), fmt(race.clock));
}

resize();
boot().catch(e => { console.error(e); $('#loadtxt').textContent = 'Error al cargar: ' + e.message; });
window.__game = { get room() { return room; }, openRoom, get race() { return race; }, get state() { return state; }, startRace, show, pad1, pad2, S, setQuality };
