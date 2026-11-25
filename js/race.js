import { seeded } from './online.js';
// Motor de la carrera: reloj (K× más rápido que el real), rivales con IA, energía, Roxzone, vueltas y penalizaciones.
import * as THREE from 'three';
import { STATIONS, SPLITS, PAPA, NAMES, COUNTRIES, PENALTY, LAPS_PER_KM, fieldDistribution, fmt } from './data.js';
import { TRACK, trackPos, trackDir, ROX, IN_S, OUT_S, LANES, laneOf } from './world.js';
import { Athlete, ACTIONS } from './athlete.js';
import { CTRL, REF, aiStation, stationEntry, stationExit, place } from './stations.js';
import { Cable, MAT } from './equipment.js';
import { Autopilot } from './auto.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const RUNVIS = LAPS_PER_KM * TRACK.P - 9;                 // metros visuales de un "km"
const GEARS = [
  { name: 'SUAVE', mul: 0.74, drain: -0.12 },
  { name: 'CÓMODO', mul: 0.86, drain: -0.05 },
  { name: 'RITMO', mul: 1.0, drain: 0.015 },
  { name: 'FUERTE', mul: 1.1, drain: 0.10 },
  { name: 'SPRINT', mul: 1.22, drain: 0.28 },
];
export { GEARS };
const SEG_NAMES = [];
for (let i = 0; i < 8; i++) { SEG_NAMES.push(`Run ${i + 1}`); SEG_NAMES.push(STATIONS[i].name); }
export { SEG_NAMES };
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// Splits de un rival a partir de su tiempo final (seg) y su sexo/nivel
function aiSplits(total, sex, stationBias = 0) {
  const E = SPLITS[sex].elite, A = SPLITS[sex].avg;
  const eT = 8 * E.run + STATIONS.reduce((s, st) => s + E[st.id], 0) + E.rox;
  const aT = 8 * A.run + STATIONS.reduce((s, st) => s + A[st.id], 0) + A.rox;
  const lam = clamp((total - eT) / (aT - eT), -0.4, 1.8);
  const g = k => Math.max(E[k] * 0.8, E[k] + lam * (A[k] - E[k]));
  const seg = [];
  const kmShape = [0.95, 0.98, 1.01, 1.02, 0.99, 1.0, 1.03, 1.05];
  for (let i = 0; i < 8; i++) {
    seg.push(g('run') * kmShape[i] * (1 + gauss() * 0.025));
    seg.push(g(STATIONS[i].id) * (1 + gauss() * 0.07 + stationBias * (i % 2 ? 1 : -1) * 0.05));
  }
  const rox = g('rox');
  const sum = seg.reduce((a, b) => a + b, 0) + rox;
  const k = total / sum;
  return { seg: seg.map(x => x * k), rox: Array.from({ length: 16 }, () => rox * k / 16 * (0.8 + Math.random() * 0.4)) };
}

export class Race {
  constructor(o) {
    this.world = o.world; this.div = o.div; this.K = o.K || 5;
    this.Cable = Cable; this.MAT = MAT;
    this.audio = o.audio; this.events = o.events || (() => { });
    this.penaltiesOn = true;
    this.input = o.input;
    this.twoP = !!o.twoP;
    this.practice = o.practice ?? null;          // id de estación para practicar
    this.clock = 0; this.real = 0; this.started = false; this.countdown = o.practice ? 2.0 : 4.2;
    this.flashes = [];
    this.entries = [];
    this.setup(o);
  }
  stationDef(id) { return STATIONS.find(s => s.id === id); }
  // ---------- montaje ----------
  setup(o) {
    // online: todos generan el mismo heat con la misma semilla
    const rnd0 = Math.random;
    if (o.seed != null) Math.random = seeded(o.seed);
    try { this._setup(o); } finally { Math.random = rnd0; }
  }
  _setup(o) {
    const div = this.div, team = div.team;
    const remotes = o.remotes || [];
    this.online = remotes.length > 0 || o.seed != null;
    const [best, med, worst] = fieldDistribution(div);
    const heat = this.practice ? 1 : Math.max(1, (div.elite ? 15 : 8) - remotes.length);
    const level = o.level || 'comp';     // 'amateur' | 'comp' | 'elite'
    const used = new Set();
    const pick = sex => { let n, tries = 0; do n = NAMES[sex][(Math.random() * NAMES[sex].length) | 0]; while (used.has(n) && ++tries < 60); used.add(n); return n; };
    // tiempos del campo
    const totals = [];
    for (let i = 0; i < heat - 1; i++) {
      let m;
      if (level === 'amateur') m = lerp(med * 0.88, worst * 0.92, Math.random());
      else if (level === 'elite') m = lerp(best, best + (med - best) * 0.45, Math.random());
      else m = lerp(best + (med - best) * 0.25, med * 1.05, i / Math.max(1, heat - 2) * 0.85 + Math.random() * 0.15);
      totals.push(m * 60);
    }
    // jugador
    const me = {
      id: 0, isPlayer: true, name: o.name || 'Tú', country: o.country || 'PAN', lane: (o.lane ?? 3) % LANES, kit: o.kit ?? 0,
      members: div.sexes.map((sex, k) => ({ sex, load: div.loads[k], energy: 100, hr: 92, name: k ? (this.twoP && k === 1 ? 'Jugador 2' : pick(sex)) : (o.name || 'Tú') })),
      seg: 0, phase: 'start', splits: [], rox: [], pens: [], total: 0, finished: false,
    };
    // Doubles con papá: su ritmo sale de su carrera real (Tampa 2026, 1:33:20)
    if (o.partner === 'papa' && div.format === 'doubles' && div.sexes[1] === 'M') {
      const pm = me.members[1];
      const runs = PAPA.seg.filter((_, i) => i % 2 === 0), avg = runs.reduce((a, b) => a + b, 0) / runs.length;
      pm.name = 'Papá'; pm.papa = true;
      pm.runMul = (avg * 0.93) / REF.M.run; pm.maxMul = 1.06;
      pm.pow = {}; STATIONS.forEach((st, i) => pm.pow[st.id] = Math.min(1, (REF.M[st.id] / PAPA.seg[2 * i + 1]) * 1.1));
    }
    me.members.forEach((m, k) => {
      m.av = new Athlete(m.sex, m.papa ? 2 : me.kit); this.world.scene.add(m.av.group);
      const set0 = m.av.set.bind(m.av);
      m.av.set = (a, ph, op = {}) => { m.av.last = [a, ph, { speed: op.speed, load: op.load, effort: op.effort, fatigue: op.fatigue }]; return set0(a, ph, op); };
    });
    this.me = me; this.entries.push(me);
    // amigos conectados: cada uno en su carril (el suyo propio), movidos por lo que mandan
    const usedLanes = new Set([me.lane]);
    this.remotes = new Map();
    remotes.forEach((r, i) => {
      const e = { id: 200 + i, isPlayer: false, isRemote: true, rid: r.id, name: r.name || 'Amigo', country: r.country || 'PAN', lane: r.lane % LANES, kit: r.kit ?? 0, members: [], finished: false, prog: 0, label: 'Run 1' };
      e.members = [{ sex: div.sexes[0], name: e.name }];
      e.members[0].av = new Athlete(e.members[0].sex, e.kit); this.world.scene.add(e.members[0].av.group);
      usedLanes.add(e.lane); this.remotes.set(r.id, e); this.entries.push(e);
    });
    let lane = 0;
    for (let i = 0; i < heat - 1; i++) {
      while (usedLanes.has(lane % LANES) && usedLanes.size < LANES) lane++;
      const e = { id: i + 1, isPlayer: false, lane: lane % LANES, kit: (i + 1 + (o.kit ?? 0)) % 10, country: COUNTRIES[(Math.random() * COUNTRIES.length) | 0], members: [], finished: false };
      e.members = div.sexes.map((sex, k) => ({ sex, load: div.loads[k], name: pick(sex) }));
      e.name = e.members.map(m => m.name).join(' / ');
      const sex = div.format === 'relay' ? (div.cat === 'W' ? 'F' : 'M') : (div.cat === 'W' ? 'F' : 'M');
      const sp = aiSplits(totals[i], div.cat === 'X' ? 'M' : sex, gauss());
      e.segT = sp.seg; e.roxT = sp.rox; e.total = sp.seg.reduce((a, b) => a + b, 0) + sp.rox.reduce((a, b) => a + b, 0);
      this.buildTimeline(e);
      e.members.forEach(m => { m.av = new Athlete(m.sex, e.kit); this.world.scene.add(m.av.group); });
      this.entries.push(e); lane++;
    }
    if (o.ghost && !this.practice) {
      const g = { id: 99, isPlayer: false, ghost: true, lane: (me.lane + 4) % LANES, kit: 2, country: 'PAN', name: 'Papá · Tampa', members: [{ sex: 'M', name: 'Papá' }], finished: false };
      g.segT = PAPA.seg.slice(); g.roxT = Array(16).fill(PAPA.rox); g.total = PAPA.total;
      // en otras divisiones el fantasma corre igual (su carrera real de Men Open)
      this.buildTimeline(g);
      g.members[0].av = new Athlete('M', 2); this.world.scene.add(g.members[0].av.group);
      this.entries.push(g); this.ghost = g;
    }
    // asignar estado de inicio
    const st = trackPos(OUT_S + 6);
    this.entries.forEach((e, i) => {
      e.members.forEach((m, k) => {
        const p = trackPos(OUT_S + 6 - 1.5 - Math.floor(i / 4) * 1.4 - k * 0.3, -1.8 + (i % 4) * 1.2 + k * 0.6);
        m.av.group.position.copy(p); m.av.group.rotation.y = Math.atan2(trackDir(OUT_S).x, trackDir(OUT_S).z);
        m.av.set('stand', 0, {}); m.av.blend = null;
      });
    });
    // estado del jugador
    me.s = OUT_S + 6 - 1.5; me.sRun = 0; me.lat = -1.8 + 0 * 1.2; me.gear = 2; me.v = 0; me.passes = 0; me.active = 0;
    if (div.format === 'relay') me.members.forEach((m, k) => { if (k) m.av.group.visible = false; });
    me.relayPos = 0;
    if (this.practice) { me.seg = STATIONS.findIndex(s => s.id === this.practice) * 2 + 1; }
    // pista de carga para la IA de estaciones
    this.lastBoard = 0;
  }
  ghostify(av) {
    av.model.traverse(o => { if (o.isMesh) { o.material = [].concat(o.material).map(m => { const c = m.clone(); c.transparent = true; c.opacity = 0.38; c.depthWrite = false; c.emissive = new THREE.Color(0x6fb7ff); c.emissiveIntensity = 0.35; return c; }); if (o.material.length === 1) o.material = o.material[0]; o.castShadow = false; } });
  }
  buildTimeline(e) {
    // orden: run1, rox, st1, rox, run2, rox, st2 ... rox(16) = de wb a la meta
    const tl = []; let t = 0;
    for (let i = 0; i < 8; i++) {
      tl.push({ k: 'run', i, a: t, b: t += e.segT[2 * i] });
      tl.push({ k: 'roxIn', i, a: t, b: t += e.roxT[2 * i] });
      tl.push({ k: 'st', i, a: t, b: t += e.segT[2 * i + 1] });
      tl.push({ k: i < 7 ? 'roxOut' : 'toFinish', i, a: t, b: t += e.roxT[2 * i + 1] });
    }
    e.tl = tl; e.total = t;
  }
  // ---------- utilidades para estaciones ----------
  energyFactor(m) { const e = m.energy; return e > 40 ? 1 : e > 10 ? lerp(0.74, 1, (e - 10) / 30) : lerp(0.62, 0.74, e / 10); }
  spend(m, e) { m.energy = clamp(m.energy - e * (m.fit || 1), 0, 100); m.effort = Math.min(1.3, (m.effort || 0) + e * 0.6); }
  penalty(e, sec, why) { e.pens.push({ sec, why, seg: e.seg }); this.flash(`PENALIZACIÓN +${fmt(sec)} · ${why}`, 'bad', 3); this.sfx('whistle'); }
  flash(text, kind = 'good', dur = 1.4) { this.flashes.push({ text, kind, t: dur }); if (this.flashes.length > 3) this.flashes.shift(); }
  sfx(n, o) { this.audio?.sfx(n, o); }
  loop(n, v, r) { this.loops = this.loops || {}; this.loops[n] = [v, r]; }
  say(t, o) { this.audio?.say(t, o); }
  get active() { return this.me.members[this.me.active]; }
  // segmento del jugador: 0..15 → índice de estación
  stationOf(seg) { return STATIONS[(seg - 1) / 2 | 0]; }

  // ---------- bucle ----------
  update(dt, I) {
    this.loops = {};
    for (const f of this.flashes) f.t -= dt; this.flashes = this.flashes.filter(f => f.t > 0);
    if (!this.started) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0 && after <= 3) { this.sfx('beep'); this.events('count', after); }
      if (this.countdown <= 0) { this.started = true; this.sfx('go'); this.events('go'); if (!this.practice) this.say('¡Arrancan! Primer kilómetro.'); }
      this.updateAI(0);
      this.animIdle(dt);
      for (const e of this.entries) for (const m of e.members) m.av.update(dt);
      return;
    }
    // en la Roxzone el reloj corre más lento (si no, los caminos largos del pabellón inflan el tiempo)
    const rox = this.me.phase === 'roxIn' || this.me.phase === 'roxOut' || this.me.phase === 'toFinish';
    const simDt = dt * this.K * (rox ? 0.55 : 1);
    this.real += dt;
    if (!this.me.finished) this.clock += simDt;
    this.updatePlayer(dt, simDt, I);
    this.updateAI(dt);
    this.updateRemotes(dt);
    for (const e of this.entries) for (const m of e.members) if (m.av.group.visible) m.av.update(dt);
  }
  // ---------- online ----------
  snapshot() {
    const me = this.me, av = this.active.av, st = this.standings().find(x => x.e === me);
    const now = performance.now(), last = av.last || ['stand', 0, {}];
    let rate = 0;
    if (this._snap && this._snap.a === last[0]) { let d = last[1] - this._snap.ph; if (d < -0.5) d += 1; rate = clamp(d / Math.max(0.03, (now - this._snap.t) / 1000), -4, 4); }
    this._snap = { a: last[0], ph: last[1], t: now };
    const p = av.group.position;
    return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), r: +av.group.rotation.y.toFixed(3), a: last[0], ph: +last[1].toFixed(3), rate: +rate.toFixed(3), o: last[2], prog: +st.prog.toFixed(3), lbl: st.label, fin: me.finished, tot: me.total, clk: this.clock };
  }
  applyRemote(rid, m) {
    const e = this.remotes?.get(rid); if (!e || !m || !Number.isFinite(m.x) || !Number.isFinite(m.z)) return;
    const num = (v, d = 0) => Number.isFinite(v) ? v : d;
    m.y = num(m.y); m.r = num(m.r); m.ph = num(m.ph); m.rate = num(m.rate);
    if (e.left) { e.left = false; e.members[0].av.group.visible = true; }
    m.lbl = String(m.lbl || '').slice(0, 12); m.prog = Number(m.prog) || 0; if (typeof m.a !== 'string' || !(m.a in ACTIONS)) m.a = 'run';
    e.tgt = m; e.tgtT = performance.now(); e.prog = m.prog; e.label = m.lbl;
    if (m.fin && !e.finished && Number.isFinite(m.tot)) { e.finished = true; e.total = m.tot; this.flash(`${e.name} terminó · ${fmt(m.tot)}`, 'meh', 2.5); this.audio?.cheer(0.5); }
    if (!e.seenOnce) { e.seenOnce = true; e.members[0].av.group.position.set(m.x, m.y, m.z); }
  }
  dropRemote(rid) { const e = this.remotes?.get(rid); if (e && !e.finished) { e.left = true; e.label = 'salió'; e.members[0].av.group.visible = false; } }
  updateRemotes(dt) {
    if (!this.remotes) return;
    const now = performance.now();
    for (const e of this.remotes.values()) {
      const m = e.tgt; if (!m || e.left) continue;
      const av = e.members[0].av, g = av.group;
      const k = 1 - Math.exp(-dt * 10);
      g.position.x += (m.x - g.position.x) * k; g.position.y += (m.y - g.position.y) * k; g.position.z += (m.z - g.position.z) * k;
      let dr = m.r - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); g.rotation.y += dr * k;
      const age = Math.min(0.4, (now - e.tgtT) / 1000);
      let ph = m.ph + m.rate * age;
      ph = ph - Math.floor(ph);
      av.set(m.a, ph, m.o || {});
    }
  }
  animIdle(dt) {
    for (const e of this.entries) for (const m of e.members) m.av.set('stand', 0, {});
  }

  // ---------- IA ----------
  updateAI(dt) {
    const t = this.clock;
    for (const e of this.entries) {
      if (e.isPlayer) continue;
      if (!e.tl) continue;
      let ph = e.tl.find(p => t < p.b);
      if (!ph) {   // terminó
        if (!e.finished) { e.finished = true; e.finishClock = e.total; if (!e.ghost) this.audio?.cheer(0.4); this.events('aiFinish', e); }
        e.members.forEach((m, k) => this.placeFinished(m.av, e.id + k * 0.5));
        continue;
      }
      const f = clamp((t - ph.a) / (ph.b - ph.a), 0, 1);
      e.cur = ph; e.f = f;
      e.prog = this.progressIndex(ph, f);
      const ms = e.members;
      // en relevo: solo el atleta activo se ve
      const relay = this.div.format === 'relay';
      const activeK = relay ? Math.floor(ph.i / 2) : 0;
      ms.forEach((m, k) => {
        if (relay) { m.av.group.visible = k === activeK; if (k !== activeK) return; }
        const off = k * 0.9;
        this.placeAI(e, m, k, ph, f, this.real + e.id * 0.37 + k * 0.21, off);   // animación a ritmo real (el reloj de carrera va K× más rápido)
      });
    }
  }
  progressIndex(ph, f) {        // 0..32 para ordenar posiciones
    const order = { run: 0, roxIn: 1, st: 2, roxOut: 3, toFinish: 3 };
    return ph.i * 4 + order[ph.k] + f;
  }
  placeAI(e, m, k, ph, f, t, off) {
    const av = m.av;
    if (ph.k === 'run') {
      const s0 = ph.i === 0 ? OUT_S + 6 - 1.5 - Math.floor(e.id / 4) * 1.4 : OUT_S;
      const s = s0 + f * (RUNVIS - (s0 - OUT_S));
      const pace = (ph.b - ph.a);                      // seg/km
      const lat = (pace < 240 ? -1.6 : 0.4) + ((e.id * 0.618) % 1) * 1.6 - 0.8 + k * 0.7;
      const p = trackPos(s - k * 0.6, lat, av.group.position);
      const d = trackDir(s - k * 0.6);
      av.group.rotation.y = Math.atan2(d.x, d.z);
      const vis = (RUNVIS / pace) * this.K;            // m/s visuales
      av.runPh = ((av.runPh || 0) + 0.016 * vis / 2.6) % 1;
      av.set('run', this.runPhase(av, vis), { speed: clamp(vis / 7, 0.6, 1.3), fatigue: ph.i / 10 });
    } else if (ph.k === 'roxIn' || ph.k === 'roxOut' || ph.k === 'toFinish') {
      const st = STATIONS[ph.i].id;
      const path = this.roxPath(ph.k, st, e.lane, k);
      const p = this.alongPath(path, f);
      av.group.position.copy(p.pos); av.group.rotation.y = Math.atan2(p.dir.x, p.dir.z);
      const vis = path.len / Math.max(0.5, (ph.b - ph.a) / this.K);
      av.set('run', this.runPhase(av, vis), { speed: clamp(vis / 7, 0.5, 1.1) });
    } else if (ph.k === 'st') {
      const st = STATIONS[ph.i].id;
      if (this.div.format === 'doubles') {
        // You Go / I Go: se turnan cada cuarto
        const worker = Math.floor(f * 4) % 2;
        if (k !== worker) { this.restBehind(e, m, st, k); return; }
      }
      aiStation(this.world, av, st, e.lane, f, t, 1 + (e.id % 3) * 0.05);
    }
  }
  runPhase(av, vis) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - (av._rt || now)); av._rt = now;
    const freq = clamp(1.25 + vis * 0.075, 1.3, 1.85);   // zancadas/seg
    av._ph = ((av._ph || 0) + dt * freq) % 1;
    return av._ph;
  }
  restBehind(e, m, st, k) {
    const L = laneOf(st, e.lane);
    const p = L.len ? new THREE.Vector3(L.pos.x - 1.4, 0, L.pos.z + 0.6) : new THREE.Vector3(L.pos.x + 0.9, 0, L.pos.z - (L.face ? L.face.z : 1) * 1.4);
    m.av.group.position.copy(p); m.av.group.rotation.y = Math.atan2(L.pos.x - p.x, L.pos.z - p.z);
    m.av.set('rest', 0, {});
  }
  placeFinished(av, i) {
    const x = ROX.finishX + 2.5 + (i % 3) * 0.9, z = -2 + ((i * 1.37) % 4);
    av.group.position.set(x, 0, z); av.group.rotation.y = -Math.PI / 2;
    av.set(i % 2 ? 'rest' : 'stand', 0, {});
  }
  // ---------- caminos de Roxzone ----------
  roxPath(kind, st, lane, k = 0) {
    const key = kind + st + lane + '_' + k;
    this._paths = this._paths || {};
    if (this._paths[key]) return this._paths[key];
    const side = ['ski', 'push', 'pull', 'bbj'].includes(st) ? -1 : 1;
    const off = (k ? 0.5 : 0) + (lane % 3) * 0.25 - 0.25;
    let pts;
    if (kind === 'roxIn') {
      const a = trackPos(IN_S - 3, -2.2);
      const en = stationEntry(st, lane);
      pts = [a, new THREE.Vector3(ROX.inX - 0.5, 0, -1.25), new THREE.Vector3(ROX.inX + 2, 0, side * 0.8 + off * side), new THREE.Vector3(en.x, 0, side * (0.8 + off)), en];
    } else if (kind === 'roxOut') {
      const ex = stationExit(st, lane);
      pts = [ex, new THREE.Vector3(ex.x, 0, side * (0.8 + off)), new THREE.Vector3(ROX.inX + 2, 0, 1.0 + off * 0.3), new THREE.Vector3(ROX.inX - 0.5, 0, 1.25), trackPos(OUT_S + 1, -1.8)];
    } else {
      const ex = stationExit(st, lane);
      pts = [ex, new THREE.Vector3(ex.x, 0, 0.3), new THREE.Vector3(ROX.finishX, 0, off), new THREE.Vector3(ROX.finishX + 2.5, 0, off)];
    }
    let len = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = pts[i].distanceTo(pts[i - 1]); seg.push(d); len += d; }
    return (this._paths[key] = { pts, seg, len });
  }
  alongPath(path, f) {
    let d = clamp(f, 0, 1) * path.len;
    for (let i = 0; i < path.seg.length; i++) {
      if (d <= path.seg[i] || i === path.seg.length - 1) {
        const k = clamp(d / path.seg[i], 0, 1);
        const pos = new THREE.Vector3().lerpVectors(path.pts[i], path.pts[i + 1], k);
        const dir = new THREE.Vector3().subVectors(path.pts[i + 1], path.pts[i]).normalize();
        return { pos, dir };
      }
      d -= path.seg[i];
    }
  }

  // ---------- jugador ----------
  updatePlayer(dt, simDt, I) {
    const me = this.me;
    if (me.finished) { me.members.forEach((m, k) => { if (m.av.group.visible) { this.placeFinished(m.av, k * 2 + 0.5); m.av.set('cheer', 0, {}); } }); return; }
    // estados: start→run→roxIn→station→roxOut→run… ; me.seg 0..15 (pares = run)
    for (const m of me.members) { m.effort = Math.max(0, (m.effort || 0) - dt * 0.8); }
    if (this.practice && !me.ctl) this.beginStation();
    if (me.phase === 'start') { me.phase = 'run'; this.beginRun(); }
    if (me.phase === 'run') this.playerRun(dt, simDt, I);
    else if (me.phase === 'roxIn' || me.phase === 'roxOut' || me.phase === 'toFinish') this.playerRox(dt, simDt, I);
    else if (me.phase === 'station') this.playerStation(dt, simDt, I);
    // ritmo cardíaco
    for (const m of me.members) {
      const target = 88 + clamp(m.intensity ?? 0.5, 0, 1.3) * 92 + (100 - m.energy) * 0.12;
      m.hr = lerp(m.hr, target, dt * 0.6);
    }
  }
  beginRun() {
    const me = this.me;
    me.segStart = this.clock; me.sRun = 0; me.passes = 0; me.lapWarned = false; me.extraLaps = 0;
    me.s = me.seg === 0 ? me.s : OUT_S;
    if (me.seg > 0) me.lat = -1.6;
    me.compromised = me.seg === 4 || me.seg === 6 || me.seg === 14 ? 1 : 0;    // después de trineos/zancadas
    const km = me.seg / 2 + 1;
    this.events('seg', { kind: 'run', km });
    if (me.seg > 0) this.say(km === 8 ? 'Último kilómetro. ¡Con todo!' : `Kilómetro ${km}.`);
    if (this.div.format === 'doubles') { me.partnerS = me.s - 0.8; me.splitPen = false; }
  }
  playerRun(dt, simDt, I) {
    const me = this.me, m = this.active;
    if (I.pressed('U')) { me.gear = Math.min(4, me.gear + 1); this.sfx('ui'); }
    if (I.pressed('D')) { me.gear = Math.max(0, me.gear - 1); this.sfx('ui'); }
    const G = GEARS[me.gear];
    const ref = REF[m.sex].run;                                  // seg/km a ritmo "RITMO"
    let vSim = (1000 / ref) * G.mul * this.energyFactor(m);
    if (me.compromised > 0) { vSim *= lerp(1, 0.9, me.compromised); me.compromised = Math.max(0, me.compromised - simDt / 120); }
    // dobles: el compañero
    let mate = null;
    if (this.div.format === 'doubles') mate = me.members[1];
    m.energy = clamp(m.energy - G.drain * simDt * (m.fit || 1), 0, 100);
    m.intensity = 0.35 + me.gear * 0.18;
    const vVis = vSim * this.K * RUNVIS / 1000;
    // dirección lateral
    const steer = (I.down('R') ? 1 : 0) - (I.down('L') ? 1 : 0);
    me.lat = clamp(me.lat + steer * dt * 3.2, -TRACK.W / 2 + 0.3, TRACK.W / 2 - 0.3);
    // choques con rivales
    let slow = 1;
    for (const e of this.entries) {
      if (e.isPlayer || e.cur?.k !== 'run') continue;
      for (const om of e.members) {
        if (!om.av.group.visible) continue;
        const p = om.av.group.position;
        const mp = trackPos(me.s, me.lat);
        const dx = p.x - mp.x, dz = p.z - mp.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.36) {
          const dir = trackDir(me.s); const ahead = dx * dir.x + dz * dir.z;
          if (ahead > 0) { slow = 0.82; me.lat += (me.lat < 0 ? 0.7 : -0.7) * dt; if (!me.bumpT || this.real - me.bumpT > 1.5) { me.bumpT = this.real; this.flash('Tráfico: pasa por un lado', 'meh', 1); } }
        }
      }
    }
    const ds = vVis * dt * slow;
    const prevS = me.sRun;
    me.s += ds; me.sRun += ds;
    me.v = vVis * slow; me.vSim = vSim * slow;
    // vueltas: cruce de la alfombra (s ≡ 0)
    const lapNow = Math.floor((me.s) / TRACK.P), lapPrev = Math.floor((me.s - ds) / TRACK.P);
    if (lapNow > lapPrev) { me.passesMat = (me.passesMat || 0) + 1; this.sfx('mat'); }
    // ¿llegó a la entrada de la Roxzone?
    const sIn = (IN_S - (me.seg === 0 ? OUT_S + 6 - 1.5 : OUT_S));
    const passNo = Math.floor((me.sRun - sIn) / TRACK.P) + 1;          // 1 = primera vez que pasa la entrada
    const prevPass = Math.floor((prevS - sIn) / TRACK.P) + 1;
    me.lapsDone = Math.max(0, Math.floor((me.sRun + (me.seg === 0 ? 0 : 0)) / TRACK.P + 0.03));
    me.lapOf = Math.min(LAPS_PER_KM, Math.floor(me.sRun / TRACK.P) + 1);
    me.nearIn = passNo + 1 >= 1 && (sIn + Math.max(0, passNo) * TRACK.P - me.sRun) < 30 && (sIn + Math.max(0, passNo) * TRACK.P - me.sRun) > 0;
    me.finalLap = Math.max(0, passNo) + 1 >= LAPS_PER_KM;
    if (passNo > prevPass && passNo >= 1) {
      const inside = me.lat < -1.3;
      if (inside) {
        if (mate && me.gapSec > 0.5) { me.waitMate = me.gapSec; }
        const missing = LAPS_PER_KM - passNo;
        if (missing > 0) this.penalty(me, PENALTY.missedLap * missing, `faltó ${missing} vuelta`);
        this.endRun();
        return;
      } else if (passNo >= LAPS_PER_KM) {
        me.extraLaps++; this.flash('Te pasaste la entrada: otra vuelta', 'bad', 2.2); this.sfx('bad');
      }
    }
    // dobles: el compañero sigue tu ritmo hasta donde le da (si se separan más de 10 s: +1 min)
    if (mate) {
      const mf = this.energyFactor(mate);
      const mateRef = REF[mate.sex].run * (mate.runMul || 1);
      const vOwn = 1000 / mateRef;                                   // su ritmo "RITMO" en m/s
      const r = Math.min(vSim, vOwn * (mate.maxMul || 1.12)) / vOwn;  // qué tan exigido va
      const mateMax = vOwn * r * mf;
      const mateDrain = r < 0.8 ? -0.12 : r < 0.93 ? -0.05 : r < 1.05 ? 0.015 : r < 1.15 ? 0.10 : 0.28;
      mate.energy = clamp(mate.energy - mateDrain * simDt, 0, 100);
      mate.intensity = m.intensity;
      const gapM = me.s - me.partnerS;
      // si va atrás, apura un poco para alcanzarte
      const mVis = mateMax * this.K * RUNVIS / 1000 * (gapM > 1.2 ? 1.06 : 1);
      const vMate = gapM > 0.8 ? mVis : Math.min(mVis, vVis * slow);
      me.partnerS += vMate * dt;
      if (me.partnerS > me.s - 0.6) me.partnerS = me.s - 0.6;
      me.gapSec = Math.max(0, (me.s - me.partnerS - 0.8) / Math.max(0.1, vVis) * this.K);
      if (me.gapSec > 7 && !me.gapWarn) { me.gapWarn = true; this.flash(`${mate.name} se queda atrás: baja el ritmo`, 'meh', 2); }
      if (me.gapSec < 4) me.gapWarn = false;
      if (me.gapSec > 10 && !me.splitPen) { me.splitPen = true; this.penalty(me, PENALTY.doublesSplit, 'pareja separada (> 10 s)'); }
      const mp = trackPos(me.partnerS, clamp(me.lat + 0.75, -2.2, 2.2));
      const md = trackDir(me.partnerS);
      mate.av.group.position.copy(mp); mate.av.group.rotation.y = Math.atan2(md.x, md.z);
      mate.av.set('run', this.runPhase(mate.av, vMate), { speed: clamp(vMate / 7, 0.6, 1.3), fatigue: (100 - mate.energy) / 100 });
    }
    const p = trackPos(me.s, me.lat, m.av.group.position);
    const d = trackDir(me.s);
    m.av.group.rotation.y = Math.atan2(d.x + steer * 0.15 * d.z, d.z - steer * 0.15 * d.x);
    m.av.set('run', this.runPhase(m.av, me.v), { speed: clamp(me.v / 7, 0.6, 1.3), fatigue: (100 - m.energy) / 100 });
    this.loop('breath', 0.25 + me.gear * 0.08, 0.4 + me.gear * 0.15);
    // ritmo para el HUD
    me.paceKm = 1000 / Math.max(0.1, me.vSim);
  }
  endRun() {
    const me = this.me;
    if (me.waitMate) { this.clock += me.waitMate; me.waitMate = 0; }
    me.splits[me.seg] = this.clock - me.segStart;
    this.events('split', { seg: me.seg, t: me.splits[me.seg] });
    me.phase = 'roxIn'; me.roxStart = this.clock; me.roxF = 0;
    me.roxKind = 'roxIn';
    this.sfx('mat');
  }
  playerRox(dt, simDt, I) {
    const me = this.me, m = this.active;
    const st = this.stationOf(me.phase === 'roxIn' ? me.seg + 1 : me.seg).id;
    const path = this.roxPath(me.phase, st, me.lane, 0);
    const fast = I.down('U') || I.down('A');
    const vSim = (1000 / REF[m.sex].run) * (fast ? 1.05 : 0.82) * this.energyFactor(m);
    if (fast) m.energy = clamp(m.energy - 0.06 * simDt, 0, 100); else m.energy = clamp(m.energy + 0.05 * simDt, 0, 100);
    m.intensity = fast ? 0.9 : 0.6;
    const vVis = vSim * this.K * RUNVIS / 1000 * 0.75;
    me.roxF += vVis * dt / path.len;
    const p = this.alongPath(path, me.roxF);
    m.av.group.position.copy(p.pos); m.av.group.rotation.y = Math.atan2(p.dir.x, p.dir.z);
    m.av.set('run', this.runPhase(m.av, vVis), { speed: clamp(vVis / 7, 0.5, 1.0) });
    if (this.div.format === 'doubles') {
      const mate = me.members[1]; const pm = this.alongPath(this.roxPath(me.phase, st, me.lane, 1), Math.max(0, me.roxF - 0.03));
      mate.av.group.position.copy(pm.pos); mate.av.group.rotation.y = Math.atan2(pm.dir.x, pm.dir.z);
      mate.av.set('run', this.runPhase(mate.av, vVis), { speed: 0.8 });
      mate.energy = clamp(mate.energy + 0.05 * simDt, 0, 100);
    }
    if (me.roxF >= 1) {
      me.rox.push(this.clock - me.roxStart);
      if (me.phase === 'roxIn') { me.seg++; this.beginStation(); }
      else if (me.phase === 'toFinish') { this.finish(); }
      else {
        // relevo: cambio de atleta cada 2 bloques
        if (this.div.format === 'relay' && me.seg % 4 === 3) this.relayTag();
        me.seg++; me.phase = 'run'; this.beginRun();
      }
    }
  }
  relayTag() {
    const me = this.me;
    const prev = me.active; me.active = Math.min(3, prev + 1);
    const a = me.members[prev], b = me.members[me.active];
    b.av.group.visible = true; a.av.group.visible = false;
    b.av.group.position.copy(a.av.group.position);
    this.sfx('tag'); this.flash(`¡CAMBIO! Sale ${b.name}`, 'good', 2);
    this.say(`Relevo para ${b.name}.`);
  }
  beginStation() {
    const me = this.me, st = this.stationOf(me.seg);
    me.phase = 'station'; me.segStart = this.clock;
    me.worker = me.active;
    const m = me.members[me.worker];
    me.ctl = new CTRL[st.id](this, m, st.id, m.load, me.lane);
    me.auto = null;
    this.events('seg', { kind: 'station', st });
    this.say(`${st.name}.`);
    if (this.div.format === 'doubles') this.placeRestMate();
  }
  placeRestMate() {
    const me = this.me, st = this.stationOf(me.seg);
    const k = me.worker ? 0 : 1, m = me.members[k];
    const L = laneOf(st.id, me.lane);
    const p = L.len ? new THREE.Vector3(L.pos.x - 1.4, 0, L.pos.z + 0.65) : new THREE.Vector3(L.pos.x + 0.95, 0, L.pos.z - (L.face?.z || 1) * 1.3);
    m.av.group.position.copy(p); m.av.group.rotation.y = Math.atan2(L.pos.x - p.x, L.pos.z - p.z) || 0;
    m.av.set('rest', 0, {});
  }
  swap() {
    // You Go / I Go: el otro toma la estación donde quedó
    const me = this.me, old = me.ctl, st = this.stationOf(me.seg);
    me.worker = me.worker ? 0 : 1;
    const m = me.members[me.worker];
    const c = new CTRL[st.id](this, m, st.id, m.load, me.lane);
    for (const k of ['done', 'x', 'laneN', 'dirn', 'side', 'next', 'faults', 'grip']) if (k in old) c[k] = old[k];
    if ('down' in old) { c.down = true; }
    old.dispose?.();
    me.ctl = c;
    me.auto = (me.worker === 1 && !this.twoP) ? new Autopilot(me.members[1].papa ? 0.8 : 0.84) : null;
    this.placeRestMate();
    this.sfx('tag'); this.flash(me.worker === 0 ? 'Te toca' : (this.twoP ? 'Le toca a Jugador 2' : `Le toca a ${me.members[1].name}`), 'good', 1.2);
  }
  playerStation(dt, simDt, I) {
    const me = this.me;
    const c = me.ctl;
    const doubles = this.div.format === 'doubles';
    if (doubles && (I.pressed('S') || (this.twoP && I.p2?.pressed('S')))) this.swap();
    let input = I;
    if (doubles && me.worker === 1) input = me.auto ? me.auto.step(me.ctl, dt) : (I.p2 || I);
    me.ctl.update(dt, input);
    // energía: pequeña recuperación pasiva; el que descansa en dobles recupera más
    for (let k = 0; k < me.members.length; k++) {
      const m = me.members[k];
      if (k === me.worker) { m.energy = clamp(m.energy + 0.012 * simDt, 0, 100); m.intensity = 0.55 + Math.min(0.6, (m.effort || 0)); }
      else if (doubles) { m.energy = clamp(m.energy + 0.22 * simDt, 0, 100); m.intensity = 0.3; m.av.set('rest', 0, {}); }
    }
    if (me.ctl.finished) {
      me.splits[me.seg] = this.clock - me.segStart;
      this.events('split', { seg: me.seg, t: me.splits[me.seg] });
      me.ctl.dispose?.();
      me.ctl = null;
      this.sfx('good'); this.audio?.cheer(0.5);
      if (this.practice) { this.finish(); return; }
      if (doubles && me.worker === 1) { me.worker = 0; }
      me.roxStart = this.clock; me.roxF = 0;
      me.phase = me.seg === 15 ? 'toFinish' : 'roxOut';
      if (me.seg === 15) this.say('¡A la meta!', { priority: true });
    }
  }
  finish() {
    const me = this.me;
    me.finished = true;
    const pen = me.pens.reduce((a, p) => a + p.sec, 0);
    me.total = this.clock + pen; me.finishClock = this.clock;
    me.penTotal = pen;
    this.sfx('finish'); this.audio?.cheer(1);
    this.events('finish', me);
  }
  // ---------- tabla ----------
  standings() {
    const list = this.entries.map(e => {
      let prog, label;
      if (e.isPlayer) {
        const me = e;
        const segF = me.phase === 'run' ? clamp(me.sRun / RUNVIS, 0, 0.99) : me.phase === 'station' && me.ctl ? me.ctl.done / me.ctl.total : me.roxF || 0;
        const i = Math.floor(me.seg / 2);
        const order = me.phase === 'run' ? 0 : me.phase === 'roxIn' ? 1 : me.phase === 'station' ? 2 : 3;
        prog = me.finished ? 100 : i * 4 + order + segF;
        label = me.finished ? fmt(me.total) : me.phase === 'run' ? `Run ${i + 1}` : me.phase === 'station' ? STATIONS[i].short : 'ROX';
      } else if (e.isRemote) {
        prog = e.finished ? 100 : e.left ? -1 : e.prog ?? 0;
        label = e.finished ? fmt(e.total) : e.label;
      } else {
        prog = e.finished ? 100 : e.prog ?? 0;
        label = e.finished ? fmt(e.total) : !e.cur ? 'Run 1' : e.cur.k === 'run' ? `Run ${e.cur.i + 1}` : e.cur.k === 'st' ? STATIONS[e.cur.i].short : 'ROX';
      }
      const time = e.finished ? (e.isPlayer ? e.total : e.total) : null;
      return { e, prog, label, time };
    });
    list.sort((a, b) => {
      if (a.time != null && b.time != null) return a.time - b.time;
      if (a.time != null) return -1; if (b.time != null) return 1;
      return b.prog - a.prog;
    });
    return list;
  }
  dispose() {
    for (const e of this.entries) for (const m of e.members) this.world.scene.remove(m.av.group);
    this.me.ctl?.dispose?.();
  }
}
