// Mecánicas de cada estación (jugador) + animación de rivales en estaciones.
// Tiempo: el reloj de carrera corre K veces más rápido que el real (K ≈ 5).
// Cada acción del jugador vale varias repeticiones reales para que la carrera dure ~15 min.
import * as THREE from 'three';
import { laneOf, ST } from './world.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// Ritmo de referencia (segundos de carrera) para un atleta muy bueno, por sexo
export const REF = {
  M: { run: 238, ski: 230, push: 166, pull: 196, bbj: 142, row: 242, farmers: 98, lunges: 184, wb: 268 },
  F: { run: 262, ski: 256, push: 182, pull: 236, bbj: 192, row: 272, farmers: 118, lunges: 217, wb: 250 },
};
export const REF_LOAD = { M: { push: 152, pull: 103, farmers: 24, sandbag: 20, ball: 6 }, F: { push: 102, pull: 78, farmers: 16, sandbag: 10, ball: 4 } };
const loadF = (sex, key, kg) => Math.pow(REF_LOAD[sex][key] / kg, 0.7);    // >1 si la carga es más liviana

// Coloca un avatar mirando en la dirección dir (XZ)
export function place(av, pos, dir) {
  av.group.position.copy(pos);
  av.group.rotation.y = Math.atan2(dir.x, dir.z);
}
const FACE = {
  px: new THREE.Vector3(1, 0, 0), nx: new THREE.Vector3(-1, 0, 0), pz: new THREE.Vector3(0, 0, 1), nz: new THREE.Vector3(0, 0, -1),
};

// Medidor genérico para el HUD
function gauge(kind, o) { return { kind, ...o }; }

// =====================================================================
// Base
class Station {
  constructor(race, me, id, load, lane) {
    this.race = race; this.me = me; this.id = id; this.load = load; this.lane = lane;
    this.av = me.av; this.sex = me.sex;
    this.done = 0; this.total = race.stationDef(id).dist;
    this.K = race.K;
    this.msg = null; this.faults = 0;
    this.L = laneOf(id, lane);
    this.t = 0;
    this.ref = REF[this.sex][id] / this.K;          // segundos reales para un atleta muy bueno
    this.kw = 1;                                    // ritmo del reloj en esta estación (<1: reloj más lento para contar reps reales)
  }
  // efecto de la energía en el rendimiento
  get ef() { return this.race.energyFactor(this.me) * (this.me.pow?.[this.id] ?? 1) * (this.me.ageK || 1); }
  spend(e) { this.race.spend(this.me, e * 0.85 * (this.me.prof?.fit || 1)); }
  noRep(text) {
    this.faults++;
    this.pens = this.pens || 0;
    const pen = this.faults >= 2 && this.pens < 2 && this.id !== 'wb' && this.race.penaltiesOn ? 15 : 0;
    if (pen) { this.pens++; this.race.penalty(this.race.me, pen, 'No-rep (' + text + ')'); }
    this.race.flash(pen ? `NO REP · ${text} · +15 s` : `NO REP · ${text}${this.faults === 1 && this.id !== 'wb' ? ' (aviso)' : ''}`, 'bad');
    this.race.sfx('norep');
  }
  good(t) { this.race.flash(t, 'good'); }
  // la estación dura realT segundos reales: el reloj corre más lento para que el tiempo de carrera siga siendo real
  realBy(realT) { this.kw = Math.min(1, this.ref / realT); this.ref /= this.kw; }
  add(units) { this.done = Math.min(this.total, this.done + units); }
  get finished() { return this.done >= this.total - 1e-6; }
  hints() { return []; }
  hud() { return {}; }
  cam() { return null; }
  dispose() { }
}

// dónde cayó tu último toque en un medidor con verde (se ve 1,6 s): good = verde, meh = casi, bad = rojo
function markHit(st, val, q) {
  st.mark = clamp(val, 0, 1); st.markQ = q; st.markT = st.t;
  // racha: 3 o más verdes seguidos te motivan y recuperas un poco de energía en cada verde
  st.streak = q === 'good' ? (st.streak || 0) + 1 : 0;
  if (st.streak >= 3) {
    st.me.energy = Math.min(100, st.me.energy + Math.min(3, 0.6 * (st.streak - 1)));
    if (st.streak % 5 === 0 && st.me === st.race.active) st.race.flash(`¡RACHA x${st.streak}! más motivado: +energía`, 'good', 1);
  }
}
function markOf(st) { return { streak: st.streak || 0, ...(st.markT != null && st.t - st.markT < 1.6 ? { mark: st.mark, markQ: st.markQ } : {}) }; }

// =====================================================================
// Apretar rápido (ski, row, trineos): ALTERNA ← → lo más rápido que puedas. La misma tecla dos veces no cuenta.
// Hasta ~9 toques por segundo cuesta lo normal; más rápido te quemas (la energía baja fuerte) y pasado 10 casi no suma.
const MASH_REF = 7;             // toques por segundo = ritmo de referencia
function mashInit(st) { st.mLast = null; st.mT = -1; st.rate = 0; st.mCost = 1; }
function mashStep(st, dt, I) {
  let q = null;
  for (const k of ['L', 'R']) if (I.pressed(k)) {
    if (k === st.mLast) { if (!st._wf || st.t - st._wf > 0.8) { st._wf = st.t; st.race.flash('¡Alterna ← →!', 'meh', 0.6); } continue; }
    const gap = st.mT < 0 ? 0.15 : Math.max(0.02, st.t - st.mT);
    st.rate = st.mT < 0 ? 5 : lerp(st.rate, 1 / gap, 0.3);
    st.mLast = k; st.mT = st.t;
    q = (q || 0) + (gap < 0.1 ? 0.55 : 1);                 // más de 10 por segundo: toques cortos que casi no empujan
  }
  if (st.mT >= 0 && st.t - st.mT > 0.4) st.rate = Math.max(0, st.rate - dt * 10);
  st.mCost = 1 + Math.max(0, st.rate - 9) * 0.6;
  return q;
}
function mashGauge(st, label) {
  const hot = st.rate > 9.5;
  return gauge('speed', { val: clamp(st.v / (st.vt * 1.5), 0, 1), label: hot ? '¡TE ESTÁS QUEMANDO! baja un poco el ritmo' : label });
}

// =====================================================================
// Máquinas (SkiErg y Row): timing de jalón (ver arriba).
// ↑ ↓ ajusta el damper como en la máquina real: alto = cada jalón rinde más pero cansa más; bajo = más liviano.
function ergInit(st, cycle) {
  st.cycle = cycle; st.v = 0; st.vt = st.total / st.ref; st.c1 = 1.1; st.c0 = 0.35 * st.vt;
  mashInit(st);
  st.imp = (st.c0 + st.c1 * st.vt) / MASH_REF;           // ~7 toques por segundo = ritmo de referencia (damper 5)
  st.damper = st.me.damper ?? 6; st.lastT = -1; st.ph = 0; st.pace = 0; st.spm = 0; st.rate = 0;
}
function ergStep(st, dt, I) {
  if (I.pressed('U') && st.damper < 10) { st.damper++; st.race.sfx('ui'); }
  if (I.pressed('D') && st.damper > 1) { st.damper--; st.race.sfx('ui'); }
  st.me.damper = st.damper;
  const d = st.damper, g = 0.75 + 0.05 * d, k = 0.8 + 0.04 * d;
  const tech = 1 + (1 - (st.me.prof?.tech || 1)) * 0.15;  // técnica entrenada: rinde un poco más cada jalón
  let q = mashStep(st, dt, I);
  if (q) {
    if (st.v < 0.1 * st.vt) q *= 0.7;
    st.v += st.imp * q * g * tech * st.ef;
    st.spend(0.05 * (0.6 + 0.08 * d) * q * st.mCost);
  }
  st.v = Math.max(0, st.v - (st.c0 + st.c1 * st.v) * k * dt);
  st.add(st.v * dt);
  const r = st.v / st.vt, prev = st.ph;
  st.ph = (st.ph + dt * r / st.cycle) % 1;
  if (st.ph < prev && r > 0.15) st.race.sfx('stroke', { power: clamp(r, 0.3, 1) });
  st.pace = st.v > 0.02 * st.vt ? (500 / st.v) * st.K : 0;
  st.spm = r * (st.id === 'row' ? 28 : 34);
  st.race.loop('flywheel', 0.35, 0.3 + 0.5 * clamp(r, 0, 1.5));
}
function ergHud(st) {
  return { gauge: mashGauge(st, `VELOCIDAD · ALTERNA ← → RÁPIDO · DAMPER ${st.damper}`), big: Math.floor(st.done) + ' m', sub: (st.pace ? fmtS(st.pace) + ' /500m · ' : '') + `damper ${st.damper} (↑ ↓)` };
}
function ergHints(st) { return [['← → ← →', 'alterna lo más rápido que puedas'], ['↑ ↓', `damper ${st.damper}: alto = más fuerza por jalón, cansa más`]]; }

class Ski extends Station {
  constructor(...a) {
    super(...a);
    this.m = this.race.world.eq.ski[this.lane];
    ergInit(this, 1.05);
    place(this.av, _v.copy(this.L.pos).addScaledVector(FACE.pz, -0.05 * ST.ski.side).add(new THREE.Vector3(0, 0, 0.5 * ST.ski.side)), this.L.face);
    this.av.group.position.set(this.L.pos.x, 0, this.L.pos.z + 0.12 * ST.ski.side);
  }
  update(dt, I) {
    this.t += dt;
    ergStep(this, dt, I);
    this.av.set('ski', this.ph, {});
    this.syncMachine();
  }
  syncMachine() {
    const ud = this.m.userData;
    this.av.update(0); // pose ya aplicada; asegurar huesos al día
    for (let i = 0; i < 2; i++) {
      const hp = this.av.handPos(i ? 'R' : 'L', _v);
      ud.handles[i].position.copy(this.m.worldToLocal(hp.clone()));
      const top = ud.top[i];
      ud.cables[i].set(top, ud.handles[i].position, 0);
    }
    const d = Math.round(this.done);
    if ((this._md ?? -1) !== d) { this._md = d; ud.monitor.userData.draw([this.pace ? fmtS(this.pace) : '--:--', d + ' m', '/500m']); }
  }
  hud() { return ergHud(this); }
  hints() { return ergHints(this); }
  cam() { return { pos: _v.set(this.L.pos.x + 2.6, 1.7, this.L.pos.z - 2.6 * ST.ski.side), look: _w.set(this.L.pos.x, 1.1, this.L.pos.z) }; }
}

// =====================================================================
// Remo: timing de palada como en el SkiErg; ↑ ↓ damper.
class Row extends Station {
  constructor(...a) {
    super(...a);
    this.m = this.race.world.eq.row[this.lane];
    ergInit(this, 1.35);
    this.base = this.m.position.clone();
  }
  update(dt, I) {
    this.t += dt;
    ergStep(this, dt, I);
    this.av.set('row', this.ph, { ground: false });
    this.sync();
  }
  sync() {
    // el asiento sigue a la cadera; el atleta se sienta en el riel
    const av = this.av;
    const seatZ = this.seatZ(this.ph);
    const ud = this.m.userData;
    ud.seat.position.z = seatZ;
    // el atleta mira hacia -z (hacia el volante)
    av.group.rotation.y = Math.PI;
    av.group.position.set(this.base.x, 0, this.base.z + seatZ + 0.05);
    av.model.position.y = 0.48 - 0.9 + 0.08;          // cadera a la altura del asiento
    av.update(0);
    const hl = av.handPos('L', new THREE.Vector3()), hr = av.handPos('R', new THREE.Vector3());
    const hm = hl.add(hr).multiplyScalar(0.5);
    ud.handle.position.copy(this.m.worldToLocal(hm));
    ud.chain.set(ud.chainStart, ud.handle.position, 0);
    const d = Math.round(this.done);
    if ((this._md ?? -1) !== d) { this._md = d; ud.monitor.userData.draw([this.pace ? fmtS(this.pace) : '--:--', d + ' m', Math.round(this.spm || 0) + ' s/m']); }
  }
  seatZ(p) {   // 0 = catch (adelante), 0.35 final
    if (p <= 0.35) return lerp(0.05, 0.62, Math.sin(p / 0.35 * Math.PI / 2));
    return lerp(0.62, 0.05, (p - 0.35) / 0.65);
  }
  hud() { return ergHud(this); }
  hints() { return ergHints(this); }
  cam() { return { pos: _v.set(this.base.x + 2.8, 1.5, this.base.z + 1.6), look: _w.set(this.base.x, 0.7, this.base.z + 0.2) }; }
}

// =====================================================================
// Sled Push: alterna ← → (pasos). Si se para, cuesta arrancarlo. 4 × 12,5 m.
class Push extends Station {
  constructor(...a) {
    super(...a);
    this.sled = this.race.world.eq.push[this.lane];
    this.v = 0; this.x = 0; this.leg = 0; this.lastKey = null; this.lastT = -1; this.ph = 0; this.dirn = 1; this.laneN = 0; this.turn = 0;
    this.lf = loadF(this.sex, 'push', this.load.push);
    // calibración: 4.5 pasos/s sostenidos ≈ tiempo de referencia
    this.vt = 50 / this.ref;               // velocidad visual objetivo (m/s)
    this.c1 = 1.1; this.c0 = 0.35 * this.vt; mashInit(this); this.imp = (this.c0 + this.c1 * this.vt) / MASH_REF;   // ~7 toques por segundo = ritmo de referencia
  }
  update(dt, I) {
    this.t += dt;
    if (this.turn > 0) {                      // dar la vuelta al trineo
      this.turn -= dt; this.av.set('walk', (this.t * 1.6) % 1, {}); this.placeTurn(); if (this.turn <= 0) this.dirn *= -1; return;
    }
    // cada paso: alterna ← → lo más rápido que puedas
    let q = mashStep(this, dt, I);
    if (q) {
      if (this.v < 0.15) q *= 0.6;                                   // arrancar desde parado cuesta
      this.v += this.imp * q * this.lf * this.ef;
      this.spend(0.085 * this.lf ** -0.5 * 0.6 * q * this.mCost);
      this.race.sfx('step');
    }
    this.v = Math.max(0, this.v - (this.c0 + this.c1 * this.v) * dt);
    if (this.v < 0.02) this.v = 0;
    const dx = this.v * dt;
    this.x += dx; this.add(dx);
    this.ph = (this.ph + dx / 1.25) % 1;
    this.av.set('push', this.ph, { effort: clamp(this.v / this.vt, 0.3, 1.2) });
    if (this.x >= 12.5 && !this.finished) { this.x = 0; this.laneN++; this.turn = 0.7; this.race.sfx('good'); this.good(`Carril ${this.laneN}/4`); }
    this.race.loop('sled', 0.6, this.v / this.vt);
    this.placeSled();
  }
  sledPos() {
    const start = this.L.pos.x + 1.0, end = this.L.pos.x + 12.5 + 1.0;
    return this.dirn > 0 ? start + this.x : end - this.x;
  }
  placeSled() {
    const sx = this.sledPos();
    this.sled.position.set(sx, 0, this.L.pos.z);
    this.sled.rotation.y = this.dirn > 0 ? Math.PI / 2 : -Math.PI / 2;   // postes hacia el atleta
    // el atleta va detrás de los postes
    place(this.av, _v.set(sx - this.dirn * 1.18, 0, this.L.pos.z), this.dirn > 0 ? FACE.px : FACE.nx);
  }
  placeTurn() {
    const sx = this.sledPos();
    const k = 1 - this.turn / 0.7;
    const a = Math.PI * k;
    const r = 1.2;
    const cx = sx, cz = this.L.pos.z;
    const ang = (this.dirn > 0 ? Math.PI : 0) + a;
    place(this.av, _v.set(cx + Math.cos(ang) * r * -1, 0, cz + Math.sin(ang) * 0.55), _w.set(-Math.sin(ang) * -1, 0, Math.cos(ang)).normalize());
  }
  hud() { return { gauge: mashGauge(this, 'VELOCIDAD · ALTERNA ← → RÁPIDO'), big: this.done.toFixed(1) + ' m', sub: `Carril ${Math.min(4, this.laneN + 1)}/4 · ${this.load.push} kg` }; }
  hints() { return [['← → ← →', 'alterna lo más rápido que puedas'], ['', 'si se para, arrancar cuesta']]; }
  cam() { const sx = this.sledPos(); return { pos: _v.set(sx - this.dirn * 3.5, 2.0, this.L.pos.z + 3.4 * (this.L.pos.z < 0 ? 1 : -1)), look: _w.set(sx, 0.6, this.L.pos.z) }; }
}

// =====================================================================
// Sled Pull: mano sobre mano alternando ← →, desde la caja. Luego corres al otro lado.
class Pull extends Station {
  constructor(...a) {
    super(...a);
    this.sled = this.race.world.eq.pull[this.lane];
    this.v = 0; this.x = 0; this.lastKey = null; this.lastT = -1; this.ph = 0; this.side = 0; this.laneN = 0; this.walk = 0;
    this.lf = loadF(this.sex, 'pull', this.load.pull);
    this.vt = 50 / (this.ref * 0.82);
    this.c1 = 0.9; this.c0 = 0.4 * this.vt; mashInit(this); this.imp = (this.c0 + this.c1 * this.vt) / MASH_REF;   // ~7 jalones por segundo = ritmo de referencia
    this.rope = null;
    this.rope = new (this.race.Cable)(0.017, this.race.MAT.rope, 16, 0.08);
    this.race.world.scene.add(this.rope.mesh);
  }
  ends() { const a = this.L.pos.x - 0.4, b = this.L.pos.x + 12.5 + 0.4; return this.side ? [b, a] : [a, b]; }   // [donde está el atleta, donde arranca el trineo]
  update(dt, I) {
    this.t += dt;
    const [ax, bx] = this.ends(), dir = Math.sign(bx - ax);
    if (this.walk > 0) {                      // correr al otro extremo
      this.walk -= dt;
      const k = 1 - this.walk / 1.5;
      const x = lerp(bx + dir * 0.0, ax + dir * 0.0, 0) ; // no usado
      const from = this.prevA, to = ax;
      place(this.av, _v.set(lerp(from, to, k), 0, this.L.pos.z + 0.7), _w.set(Math.sign(to - from), 0, 0));
      this.av.set('run', (this.t * 2.2) % 1, { speed: 0.7 });
      this.ropeUpdate();
      return;
    }
    // mano sobre mano: alterna ← → lo más rápido que puedas
    let q = mashStep(this, dt, I);
    if (q) {
      if (this.v < 0.12) q *= 0.6;
      this.v += this.imp * q * this.lf * this.ef;
      this.spend(0.08 * this.lf ** -0.5 * 0.6 * q * this.mCost);
      this.race.sfx('rope'); this.ph = (this.ph + 0.5) % 1;
    }
    this.v = Math.max(0, this.v - (this.c0 + this.c1 * this.v) * dt);
    if (this.v < 0.02) this.v = 0;
    const dx = this.v * dt; this.x += dx; this.add(dx);
    this.ph2 = lerp(this.ph2 ?? 0, this.ph, 0.25);
    this.av.set('pull', this.ph2, {});
    place(this.av, _v.set(ax - dir * 0.3, 0, this.L.pos.z), _w.set(dir, 0, 0));   // mirando al trineo
    this.race.loop('sled', 0.5, this.v / this.vt);
    if (this.x >= 12.5 && !this.finished) {
      this.x = 0; this.laneN++; this.prevA = ax; this.side ^= 1; this.walk = 1.5; this.good(`Carril ${this.laneN}/4`);
    }
    this.ropeUpdate();
  }
  sledX() { const [ax, bx] = this.ends(); const dir = Math.sign(bx - ax); return this.walk > 0 ? ax + dir * 0.0 + (this.side ? 0 : 0) : bx - dir * this.x; }
  ropeUpdate() {
    const [ax, bx] = this.ends(); const dir = Math.sign(bx - ax);
    let sx = this.walk > 0 ? this.prevA + Math.sign(this.prevA - ax) * -0 : bx - dir * this.x;
    if (this.walk > 0) sx = this.prevA;                 // el trineo quedó donde estaba el atleta
    this.sled.position.set(sx + (this.walk > 0 ? -Math.sign(ax - this.prevA) * 0.0 : 0), 0, this.L.pos.z);
    this.sled.rotation.y = (this.walk > 0 ? Math.sign(ax - this.prevA) : -dir) > 0 ? Math.PI / 2 : -Math.PI / 2;
    this.av.update(0);
    const h = this.av.handPos('L', new THREE.Vector3()).add(this.av.handPos('R', new THREE.Vector3())).multiplyScalar(0.5);
    const ring = this.sled.localToWorld(this.sled.userData.ring.clone());
    this.rope.set(h, ring, this.v > 0.2 ? 0.06 : 0.25);
  }
  dispose() { this.race.world.scene.remove(this.rope.mesh); }
  hud() { return { gauge: mashGauge(this, 'TIRÓN · ALTERNA ← → RÁPIDO'), big: this.done.toFixed(1) + ' m', sub: `Carril ${Math.min(4, this.laneN + 1)}/4 · ${this.load.pull} kg` }; }
  hints() { return [['← → ← →', 'mano sobre mano, lo más rápido que puedas']]; }
  cam() {
    const [ax, bx] = this.ends(), dir = Math.sign(bx - ax), zs = this.L.pos.z < 0 ? 1 : -1;
    if (this.walk > 0) { const x = this.av.group.position.x; return { pos: _v.set(x - 1.5, 2.3, this.L.pos.z + 4.2 * zs), look: _w.set(x, 0.8, this.L.pos.z) }; }
    return { pos: _v.set(ax - dir * 3.0, 2.2, this.L.pos.z + 2.4 * zs), look: _w.set(ax + dir * 5, 0.6, this.L.pos.z) };
  }
}

// =====================================================================
// Burpee Broad Jump: ESPACIO = burpee (pecho al piso). Al subir aparece el medidor de salto:
// ESPACIO otra vez con la aguja en verde = salto largo (~2 m). Fuera del verde saltas menos y necesitas más burpees.
// 80 m reales = 4 carriles de 20 m. Cansado, la aguja va más rápido y el verde es más chico.
class BBJ extends Station {
  constructor(...a) {
    super(...a);
    this.stage = 'stand'; this.ph = 0; this.x = 0; this.timer = 0; this.aim = 0; this.jq = 1;
    this.cyc = 1.3;
    this.realBy(this.total / 2.0 * this.cyc);          // ~2 m por burpee bien saltado, como en la competencia (40 saltos)
    this.per = this.total / (this.ref / this.cyc);   // m por burpee perfecto
  }
  zone() { const w = 0.2 * lerp(0.65, 1, clamp(this.ef, 0, 1)); return [0.7 - w / 2, 0.7 + w / 2]; }
  update(dt, I) {
    this.t += dt;
    const ef = this.ef, tD = 0.27 / ef ** 0.5, tU = 0.23 / ef ** 0.5, tJ = 0.38, tA = 0.62 * lerp(0.75, 1, clamp(ef, 0, 1));
    const press = tapAny(I), hold = I.down('A') || I.down('L') || I.down('R') || I.down('U') || I.down('D');
    if (this.stage === 'stand') {
      this.ph = 0;
      if (press || hold || this.queued) { this.queued = false; this.stage = 'down'; this.timer = 0; }
      else this.me.energy = Math.min(100, this.me.energy + dt * this.K * this.kw * 0.06);   // de pie recuperas
    } else if (this.stage === 'down') {
      this.timer += dt; this.ph = lerp(0, 0.4, clamp(this.timer / tD, 0, 1));
      if (this.timer >= tD) { this.race.sfx('thud'); this.stage = 'up'; this.timer = 0; }
    } else if (this.stage === 'up') {
      this.timer += dt; this.ph = lerp(0.4, 0.66, clamp(this.timer / tU, 0, 1));
      if (this.timer >= tU) { this.stage = 'aim'; this.aim = 0; }
    } else if (this.stage === 'aim') {
      // agachado listo para saltar: la aguja sube; ESPACIO en verde = salto largo
      this.aim += dt / tA; this.ph = 0.66 + 0.04 * Math.min(1, this.aim);
      if (press || this.aim >= 1) {
        const [a, b] = this.zone(), c = (a + b) / 2, hw = (b - a) / 2, d = Math.abs(Math.min(1, this.aim) - c);
        this.jq = press ? (d <= hw ? 1 : Math.max(0.55, 1 - (d - hw) * 1.6)) : 0.55;
        markHit(this, this.aim, this.jq >= 1 ? 'good' : this.jq >= 0.8 ? 'meh' : 'bad');
        if (!press) this.race.flash('Salto corto: pulsa en verde', 'meh', 0.8);
        else if (this.jq >= 1) this.race.sfx('ui');
        this.stage = 'jump'; this.jump = { from: this.x, t: 0, d: Math.min(this.per * ef * this.jq, this.total - this.x) }; this.xv = this.x;
        this.spend(0.5 * this.kw);
      }
    } else if (this.stage === 'jump') {
      const j = this.jump; j.t += dt;
      const k = clamp(j.t / tJ, 0, 1);
      this.ph = lerp(0.7, 1.0, k);
      this.xv = j.from + j.d * Math.sin(k * Math.PI / 2);
      if (press && k > 0.5) this.queued = true;     // al caer ya puedes pedir el siguiente
      if (k >= 1) { this.x = j.from + j.d; this.add(j.d); this.stage = 'stand'; this.ph = 0; this.race.sfx('land'); if (Math.floor(this.x / 20) > Math.floor(j.from / 20) && !this.finished) this.good(Math.floor(this.x / 20) * 20 + ' m · vuelta'); }
    }
    const d = this.stage === 'jump' ? this.xv : this.x;
    // al llegar al final del carril se da vuelta
    const sh = shuttle(Math.min(d, this.total - 1e-3));
    this.av.set('burpee', this.ph % 1, { blend: 0.1 });
    place(this.av, _v.set(this.L.pos.x + sh.x + 0.3 * sh.dir, 0, this.L.pos.z), sh.dir > 0 ? FACE.px : FACE.nx);
    if (this.stage === 'jump') this.av.group.position.y = Math.sin(clamp(this.jump.t / tJ, 0, 1) * Math.PI) * 0.28;
    this.sh = sh;
  }
  hud() {
    const aiming = this.stage === 'aim';
    return { gauge: gauge('timing', { ...markOf(this), val: aiming ? Math.min(1, this.aim) : 0, zone: this.zone(), label: aiming ? 'SALTO · ¡ESPACIO EN VERDE!' : 'ESPACIO = BURPEE · luego salta en verde' }), big: this.done.toFixed(0) + ' m', sub: `de 80 m · carril ${Math.min(4, (this.sh?.lap ?? 0) + 1)}/4` };
  }
  hints() { return [['ESPACIO', 'burpee'], ['ESPACIO en verde', 'salto largo (~2 m)']]; }
  cam() { const sh = this.sh || { x: 0, dir: 1 }; const x = this.L.pos.x + sh.x; return { pos: _v.set(x - sh.dir * 2.6, 1.9, this.L.pos.z + 3.6 * (this.L.pos.z < 0 ? 1 : -1)), look: _w.set(x + sh.dir * 1.2, 0.5, this.L.pos.z) }; }
}

// =====================================================================
// Farmers Carry: mantén → (o ←) para caminar. El agarre se gasta; ESPACIO suelta / levanta. 200 m = 10 carriles de 20 m.
class Farmers extends Station {
  constructor(...a) {
    super(...a);
    this.kb = this.race.world.eq.kb[this.lane];
    this.grip = 1; this.v = 0; this.x = 0; this.dirn = 1; this.ph = 0;
    this.down = true; this.pick = 0;
    this.lf = loadF(this.sex, 'farmers', this.load.farmers);
    this.realBy(this.total / 4.5);                   // ~45 s reales para los 200 m
    this.vt = this.total / this.ref;
  }
  update(dt, I) {
    this.t += dt;
    if (this.down) {                                   // pesas en el piso
      this.grip = Math.min(1, this.grip + dt * 0.55);
      this.v = 0;
      this.av.set('crouch', 0, { blend: 0.2 });
      // vuelves a levantarlas con un toque, o solas si sigues manteniendo la flecha y ya recuperaste el agarre
      if (I.pressed('A') || I.pressed('L') || I.pressed('R') || (this.autoDrop && (I.down('R') || I.down('L')) && this.grip >= 0.6)) { this.down = false; this.autoDrop = false; this.pick = 0.35; this.race.sfx('kbPick'); }
    } else {
      if (this.pick > 0) this.pick -= dt;
      if (I.pressed('A')) { this.down = true; this.autoDrop = false; this.v = 0; this.race.sfx('kbDrop'); }
      const walk = (I.down('R') || I.down('L')) && this.pick <= 0 && !this.down;
      const tv = walk ? this.vt * this.ef * lerp(0.75, 1, this.grip) : 0;     // con poco agarre caminas más lento
      this.v += (tv - this.v) * (1 - Math.exp(-dt * 5));
      if (walk) this.spend(0.5 * this.kw * dt / this.lf);
      if (!this.down) this.grip -= dt * this.kw * (0.03 + 0.05 * this.v / this.vt) / this.lf * (1.3 - this.ef * 0.3) / (this.me.prof?.grip || 1);
      if (this.grip <= 0 && !this.down) { this.grip = 0; this.down = true; this.autoDrop = true; this.v = 0; this.race.flash('¡Se te soltaron!', 'bad'); this.race.sfx('kbDrop'); }
      const before = this.x;
      const dx = this.v * dt; this.x = Math.min(this.total, this.x + dx); this.add(this.x - before);
      if (Math.floor(this.x / 20) > Math.floor(before / 20) && !this.finished) this.good(Math.floor(this.x / 20) * 20 + ' m');
      if (Math.floor(this.t * 3) !== Math.floor((this.t - dt) * 3) && this.v > 0.3) this.race.sfx('step');
      this.ph = (this.ph + dx / 1.1) % 1;
      this.av.set(this.v > 0.05 || this.pick > 0 ? 'walk' : 'stand', this.ph, { load: 1, blend: 0.2 });
    }
    this.dirn = shuttle(Math.min(this.x, this.total - 1e-3)).dir;
    this.placeAll();
  }
  pos() { return this.L.pos.x + shuttle(Math.min(this.x, this.total - 1e-3)).x; }
  placeAll() {
    const x = this.pos();
    place(this.av, _v.set(x, 0, this.L.pos.z), this.dirn > 0 ? FACE.px : FACE.nx);
    this.av.update(0);
    for (let i = 0; i < 2; i++) {
      const kb = this.kb[i];
      if (this.down && !this.pick) { kb.position.set(x + this.dirn * 0.05, 0, this.L.pos.z + (i ? 0.28 : -0.28)); }
      else {
        const h = this.av.handPos(i ? 'R' : 'L', _v);
        kb.position.set(h.x, h.y - kb.userData.handleY, h.z);
        if (kb.position.y < 0) kb.position.y = 0;
      }
    }
  }
  hud() { return { gauge: gauge('grip', { val: this.grip, label: this.down ? 'AGARRE (descansando)' : 'AGARRE' }), big: this.done.toFixed(0) + ' m', sub: `de 200 m · 2 × ${this.load.farmers} kg · carril ${Math.min(10, Math.floor(this.x / 20) + 1)}/10` }; }
  hints() { return [['mantén →', 'camina'], ['ESPACIO', 'soltar / levantar para recuperar el agarre']]; }
  cam() { const x = this.pos(); return { pos: _v.set(x - this.dirn * 3.2, 2.0, this.L.pos.z - 3.4 * (this.L.pos.z > 0 ? -1 : 1)), look: _w.set(x + this.dirn, 0.8, this.L.pos.z) }; }
}

// =====================================================================
// Sandbag Lunges: mantén ← (pierna izquierda) o → (derecha) para bajar; suelta cuando la barra está en verde
// (la rodilla toca el piso). Si sueltas antes: NO REP. Si te quedas abajo, pierdes tiempo. Hay que alternar piernas.
// 100 m = 5 carriles de 20 m.
class Lunges extends Station {
  constructor(...a) {
    super(...a);
    this.bag = this.race.world.eq.bag[this.lane];
    this.x = 0; this.st = 'stand'; this.leg = 'L'; this.timer = 0; this.ph = 0; this.depth = 0; this.slowUp = false;
    this.lf = loadF(this.sex, 'sandbag', this.load.sandbag);
    this.cyc = 0.55;
    this.realBy(this.total / 1.2 * this.cyc);          // ~1,2 m por zancada (≈83 zancadas)
    this.per = this.total / (this.ref / this.cyc);
  }
  zone() { return [0.74, 0.92]; }
  update(dt, I) {
    this.t += dt;
    const ef = this.ef, tD = 0.32 / ef ** 0.6, tU = this.slowUp ? 0.32 : 0.19;
    const key = this.leg, other = key === 'L' ? 'R' : 'L';
    if (this.st === 'stand') {
      if (I.down(key)) { this.st = 'down'; this.depth = 0; this.bottomT = 0; }
      else if (I.pressed(other) || I.pressed('A')) { if (!this._wf || this.t - this._wf > 0.8) { this._wf = this.t; this.race.flash(`Ahora la pierna ${key === 'L' ? 'izquierda ←' : 'derecha →'}`, 'meh', 0.7); } }
    } else if (this.st === 'down') {
      const held = I.down(key);
      if (held) {
        this.depth = Math.min(1, this.depth + dt / tD);
        if (this.depth >= 1) { this.bottomT += dt; this.spend(0.12 * this.kw * dt / this.lf); }   // quedarse abajo cansa
      } else {
        const [a, zb] = this.zone();
        markHit(this, this.depth, this.depth < a ? 'bad' : this.depth <= zb ? 'good' : 'meh');
        this.st = 'up'; this.timer = 0;
        if (this.depth < a) { this.step = 0; this.slowUp = false; this.noRep('la rodilla no tocó el piso'); }
        else { this.race.sfx('thud', { soft: true }); this.spend((0.18 / this.lf) * this.kw); this.step = Math.min(this.per * ef, this.total - this.x); this.slowUp = this.bottomT > 0.12; }
        this.d0 = this.depth;
      }
    } else if (this.st === 'up') {
      this.timer += dt;
      if (this.timer >= tU) {
        const b0 = this.x; this.x += this.step; this.add(this.step); this.st = 'stand';
        if (this.step > 0) this.leg = this.leg === 'L' ? 'R' : 'L';      // si fue no-rep, repites con la misma pierna
        if (Math.floor(this.x / 20) > Math.floor(b0 / 20) && !this.finished) this.good(Math.floor(this.x / 20) * 20 + ' m');
      }
    }
    // fase visual: 0 de pie, 0.25 abajo (pierna izq) / 0.75 abajo (der)
    const dep = this.st === 'down' ? this.depth : this.st === 'up' ? (this.d0 || 1) * (1 - this.timer / tU) : 0;
    this.ph = (this.leg === 'L' ? 0 : 0.5) + clamp(dep, 0, 1) * 0.25;
    this.av.set('lunge', this.ph, { blend: 0.08 });
    const move = this.st === 'up' ? clamp(this.timer / tU, 0, 1) * this.step : 0;
    const sh = shuttle(Math.min(this.x + move, this.total - 1e-3)); this.sh = sh;
    place(this.av, _v.set(this.L.pos.x + sh.x, 0, this.L.pos.z), sh.dir > 0 ? FACE.px : FACE.nx);
    this.av.update(0);
    // saco sobre los hombros
    const n = this.av.bonePos('neck', _v);
    this.bag.position.set(n.x - 0.04, n.y - 0.02, n.z);
    this.bag.rotation.set(0, (this.sh?.dir ?? 1) > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
  }
  hud() {
    const down = this.st === 'down';
    return { gauge: gauge('depth', { ...markOf(this), val: down ? this.depth : 0, zone: this.zone(), label: down ? 'RODILLA AL PISO · ¡SUELTA EN VERDE!' : `MANTÉN ${this.nextLeg === 'L' ? '←' : '→'} PARA BAJAR` }), big: this.done.toFixed(0) + ' m', sub: `de 100 m · saco ${this.load.sandbag} kg · carril ${Math.min(5, (this.sh?.lap ?? 0) + 1)}/5` };
  }
  // pierna del próximo toque: de pie o bajando, la actual; subiendo, la otra (si la zancada contó)
  get nextLeg() { return this.st === 'up' && this.step > 0 ? (this.leg === 'L' ? 'R' : 'L') : this.leg; }
  hints() { return [[this.nextLeg === 'L' ? 'MANTÉN ←' : 'MANTÉN →', `bajas con la pierna ${this.nextLeg === 'L' ? 'izquierda' : 'derecha'}`], ['SUELTA en verde', 'rodilla al piso (antes = no rep)']]; }
  cam() { const sh = this.sh || { x: 0, dir: 1 }; const x = this.L.pos.x + sh.x; return { pos: _v.set(x + sh.dir * 2.4, 1.6, this.L.pos.z + 3.2 * (this.L.pos.z < 0 ? 1 : -1)), look: _w.set(x, 0.9, this.L.pos.z) }; }
}

// =====================================================================
// Wall Balls: mantén ESPACIO = sentadilla; abajo, la barra de fuerza sube y baja; suelta en la franja.
class WallBalls extends Station {
  constructor(...a) {
    super(...a);
    this.ball = this.race.world.eq.ball[this.lane];
    this.tg = this.race.world.eq.wb[this.lane];
    this.state = 'ready'; this.ph = 0; this.squat = 0; this.pw = 0; this.pt = 0; this.fly = 0;
    this.repsPer = 1;                       // 100 reps reales: cada lanzamiento cuenta 1
    this.kw = Math.min(1, this.ref / 60);   // ~0,6 s por rep con el medidor: 100 reps en ~1 min
    this.lf = loadF(this.sex, 'ball', this.load.ball);
    this.side = ST.wb.side;
    place(this.av, _v.set(this.L.pos.x, 0, this.L.pos.z - 0.4 * this.side), _w.set(0, 0, this.side));
  }
  update(dt, I) {
    this.t += dt;
    const ef = this.ef, T = 0.27;
    // ESPACIO = bajas a la sentadilla; la aguja de fuerza sube: ESPACIO otra vez en verde = la pelota pega en el blanco.
    // Fuera del verde: no llega (no rep). Si la dejas pasar, lanzas sin fuerza.
    const tap = I.pressed('A') || I.pressed('D') || I.pressed('L') || I.pressed('R');
    const tW = 0.42 * lerp(0.8, 1, clamp(ef, 0, 1));
    if (tap) {
      if (this.state === 'ready' || this.state === 'catch' || (this.state === 'throw' && this.fly > T - 0.12)) this.queued = true;
      else if (this.state === 'squat' && this.squat >= 0.35) this.fire = true;
    }
    if (this.state === 'ready') {
      this.ph = 0;
      if (this.queued) { this.queued = false; this.state = 'squat'; this.squat = 0; this.fire = false; }
    } else if (this.state === 'squat') {
      if (!this.fire) this.squat = Math.min(1.1, this.squat + dt / tW);   // al tocar, vale la aguja que se veía
      this.ph = Math.min(1, this.squat) * 0.33;
      if (this.fire || this.squat >= 1.1) {
        const [a, b] = this.zone(), x = Math.min(1, this.squat);
        markHit(this, x, this.fire && x >= a && x <= b ? 'good' : 'bad');
        this.throwQ = this.fire && x >= a && x <= b ? 0.7 : 0.3;          // fuera del verde no llega: no rep
        this.state = 'throw'; this.fly = 0; this.spend(0.142 / this.lf); this.race.sfx('ballThrow');
      }
    } else if (this.state === 'throw') {
      this.fly += dt;
      this.ph = lerp(0.33, 0.62, clamp(this.fly / 0.1, 0, 1));
      if (this.fly >= T) {
        if (this.throwQ < this.zone()[0]) this.noRep('no llegó al blanco: lanza en verde');
        else { this.add(this.repsPer); if (this.done % 10 === 0 || this.done >= this.total) this.good(this.done >= this.total ? '¡100!' : this.done + ' REPS'); this.race.sfx('ballCatch'); }
        this.state = 'catch'; this.fly = 0;
      }
    } else if (this.state === 'catch') {
      this.fly += dt; this.ph = lerp(0.85, 1, clamp(this.fly / 0.06, 0, 1));
      if (this.fly >= 0.06) this.state = 'ready';
    }
    this.av.set('wallball', this.ph % 1, { blend: 0.08 });
    this.av.update(0);
    this.placeBall();
  }
  zone() { const w = 0.24 + 0.06 * this.ef; const c = 0.7; return [c - w / 2, c + w / 2]; }
  placeBall() {
    const b = this.ball;
    if (this.state === 'throw' && this.fly > 0.05) {
      const T = 0.27, k = clamp((this.fly - 0.05) / (T - 0.05), 0, 1);
      const p = this.throwQ, h = this.tg.userData.target.y;
      const peak = 1.6 + p * (h - 1.6) / 0.72 + 0.1;
      const start = this.handMid(_w);
      const tgt = this.tg.localToWorld(this.tg.userData.target.clone());
      const up = k < 0.55 ? k / 0.55 : 1 - (k - 0.55) / 0.45 * 0.6;
      b.position.set(lerp(start.x, tgt.x, Math.min(1, k * 1.6) * 0.75), lerp(start.y, peak, Math.sin(up * Math.PI / 2)), lerp(start.z, tgt.z, Math.min(1, k * 1.6) * 0.8));
      if (!this.hitSnd && k > 0.5 && p >= this.zone()[0]) { this.hitSnd = true; this.race.sfx('ballHit'); }
    } else {
      this.hitSnd = false;
      const m = this.handMid(_w);
      const fwd = new THREE.Vector3(0, 0, this.side);
      b.position.copy(m).addScaledVector(fwd, 0.12);
    }
  }
  handMid(o) { return this.av.handPos('L', o).add(this.av.handPos('R', _v)).multiplyScalar(0.5); }
  hud() {
    const sq = this.state === 'squat';
    return { gauge: gauge('timing', { ...markOf(this), val: sq ? Math.min(1, this.squat) : 0, zone: this.zone(), label: sq ? 'LANZA EN VERDE' : 'ESPACIO = SENTADILLA · luego lanza en verde' }), big: this.done + ' / 100', sub: `${this.load.ball} kg · blanco ${String(this.load.target ?? (this.sex === 'F' ? 2.7 : 3)).replace('.', ',')} m` };
  }
  hints() { return [['ESPACIO', 'sentadilla'], ['ESPACIO en verde', 'lanzas y pega en el blanco']]; }
  cam() { return { pos: _v.set(this.L.pos.x + 2.6, 1.9, this.L.pos.z - 3.4 * this.side), look: _w.set(this.L.pos.x, 1.7, this.L.pos.z + 0.4 * this.side) }; }
}

export const CTRL = { ski: Ski, push: Push, pull: Pull, bbj: BBJ, row: Row, farmers: Farmers, lunges: Lunges, wb: WallBalls };

// calidad del paso según la cadencia: el ritmo ideal da 1; aplastar teclas rinde menos
function cadQ(gap, ideal, st) { if (st && gap < ideal * 0.6 && (!st._sp || st.t - st._sp > 1.5)) { st._sp = st.t; st.race.flash('Muy rápido: pasos firmes, no aplastes', 'meh', 1.1); } if (gap >= ideal) return 1; if (gap <= ideal * 0.55) return 0.12; return lerp(0.12, 1, (gap - ideal * 0.55) / (ideal * 0.45)); }

// carril de 20 m: avanzas d metros reales yendo y volviendo
function shuttle(d, len = 20) { const lap = Math.floor(d / len), w = d - lap * len, out = lap % 2 === 0; return { x: out ? w : len - w, dir: out ? 1 : -1, lap }; }
// estaciones al ritmo: un toque = una rep; si tocas al final de la rep anterior, encadenas sin pausa
function tapAny(I) { return I.pressed('A') || I.pressed('L') || I.pressed('R') || I.pressed('D') || I.pressed('U'); }

function fmtS(s) { if (!isFinite(s) || s <= 0) return '--:--'; const m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ':' + String(x).padStart(2, '0'); }

// =====================================================================
// Rivales en estación: posición y pose según el avance (0..1) y el tiempo
export function aiStation(world, av, id, lane, f, t, rate = 1) {
  const L = laneOf(id, lane);
  const side = ST[id].side;
  const cyc = (k) => (t * rate * k) % 1;
  switch (id) {
    case 'ski': {
      av.group.position.set(L.pos.x, 0, L.pos.z + 0.12 * side); av.group.rotation.y = Math.atan2(0, side);
      av.set('ski', cyc(0.85), {}); av.update(0);
      const m = world.eq.ski[lane], ud = m.userData;
      for (let i = 0; i < 2; i++) { const hp = av.handPos(i ? 'R' : 'L', _v); ud.handles[i].position.copy(m.worldToLocal(hp.clone())); ud.cables[i].set(ud.top[i], ud.handles[i].position, 0); }
      return;
    }
    case 'row': {
      const m = world.eq.row[lane], ud = m.userData;
      const p = cyc(0.72);
      const seatZ = p <= 0.35 ? lerp(0.05, 0.62, Math.sin(p / 0.35 * Math.PI / 2)) : lerp(0.62, 0.05, (p - 0.35) / 0.65);
      ud.seat.position.z = seatZ;
      av.set('row', p, { ground: false });
      av.group.rotation.y = Math.PI; av.group.position.set(m.position.x, 0, m.position.z + seatZ + 0.05);
      av.update(0); av.model.position.y = 0.48 - 0.9 + 0.08; av.group.updateMatrixWorld(true);
      const hm = av.handPos('L', new THREE.Vector3()).add(av.handPos('R', new THREE.Vector3())).multiplyScalar(0.5);
      ud.handle.position.copy(m.worldToLocal(hm)); ud.chain.set(ud.chainStart, ud.handle.position, 0);
      return;
    }
    case 'push': {
      const d = f * 50, n = Math.min(3, Math.floor(d / 12.5)), x = d - n * 12.5, dir = n % 2 ? -1 : 1;
      const sx = dir > 0 ? L.pos.x + 1 + x : L.pos.x + 13.5 - x;
      const s = world.eq.push[lane]; s.position.set(sx, 0, L.pos.z); s.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      av.group.position.set(sx - dir * 1.18, 0, L.pos.z); av.group.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      av.set('push', (d / 1.25) % 1, { effort: 1 });
      return;
    }
    case 'pull': {
      const d = f * 50, n = Math.min(3, Math.floor(d / 12.5)), x = d - n * 12.5;
      const a = L.pos.x - 0.4, b = L.pos.x + 12.9; const [ax, bx] = n % 2 ? [b, a] : [a, b]; const dir = Math.sign(bx - ax);
      const s = world.eq.pull[lane];
      const pullPart = x / 12.5 < 0.85;
      if (pullPart) {
        const k = x / (12.5 * 0.85);
        s.position.set(bx - dir * k * 12.5, 0, L.pos.z); s.rotation.y = -dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        av.group.position.set(ax - dir * 0.3, 0, L.pos.z); av.group.rotation.y = Math.atan2(dir, 0);
        av.set('pull', cyc(1.6), {});
      } else {
        const k = (x / 12.5 - 0.85) / 0.15;
        s.position.set(ax, 0, L.pos.z);
        av.group.position.set(lerp(ax, bx, k), 0, L.pos.z + 0.7); av.group.rotation.y = Math.atan2(dir, 0);
        av.set('run', cyc(2.2), { speed: 0.7 });
      }
      return;
    }
    case 'bbj': {
      const sh = shuttle(Math.min(f, 0.9999) * 80);
      av.group.position.set(L.pos.x + sh.x + 0.3 * sh.dir, 0, L.pos.z); av.group.rotation.y = sh.dir * Math.PI / 2;
      const p = cyc(0.75); av.set('burpee', p, {});
      if (p > 0.72 && p < 0.95) av.group.position.y = Math.sin((p - 0.72) / 0.23 * Math.PI) * 0.25;
      return;
    }
    case 'farmers': {
      const d = Math.min(f, 0.9999) * 200, sh = shuttle(d); const x = L.pos.x + sh.x;
      av.group.position.set(x, 0, L.pos.z); av.group.rotation.y = sh.dir * Math.PI / 2;
      av.set('walk', (d / 1.1) % 1, { load: 1 }); av.update(0);
      const kb = world.eq.kb[lane];
      for (let i = 0; i < 2; i++) { const h = av.handPos(i ? 'R' : 'L', _v); kb[i].position.set(h.x, Math.max(0, h.y - kb[i].userData.handleY), h.z); }
      return;
    }
    case 'lunges': {
      const sh = shuttle(Math.min(f, 0.9999) * 100);
      av.group.position.set(L.pos.x + sh.x, 0, L.pos.z); av.group.rotation.y = sh.dir * Math.PI / 2;
      av.set('lunge', cyc(0.6), {}); av.update(0);
      const n = av.bonePos('neck', _v); const bag = world.eq.bag[lane]; bag.position.set(n.x - 0.04, n.y - 0.02, n.z); bag.rotation.set(0, sh.dir * Math.PI / 2, 0);
      return;
    }
    case 'wb': {
      av.group.position.set(L.pos.x, 0, L.pos.z - 0.4 * side); av.group.rotation.y = Math.atan2(0, side);
      const p = cyc(0.8); av.set('wallball', p, {}); av.update(0);
      const ball = world.eq.ball[lane];
      const hm = av.handPos('L', new THREE.Vector3()).add(av.handPos('R', _v)).multiplyScalar(0.5);
      if (p > 0.6 && p < 0.92) { const k = (p - 0.6) / 0.32; const tg = world.eq.wb[lane]; const tp = tg.localToWorld(tg.userData.target.clone()); ball.position.set(lerp(hm.x, tp.x, Math.sin(k * Math.PI) * 0.8), lerp(hm.y, tp.y, Math.sin(k * Math.PI)), lerp(hm.z, tp.z, Math.sin(k * Math.PI) * 0.8)); }
      else ball.position.copy(hm).add(_w.set(0, 0, 0.12 * side));
      return;
    }
  }
}

// Punto de entrada/salida del carril de cada estación (para la Roxzone)
export function stationEntry(id, lane) {
  const L = laneOf(id, lane);
  const side = ST[id].side;
  if (id === 'ski') return new THREE.Vector3(L.pos.x, 0, L.pos.z - 1.0 * side);
  if (id === 'row') return new THREE.Vector3(L.pos.x + 0.7, 0, L.pos.z + 0.4);
  if (id === 'wb') return new THREE.Vector3(L.pos.x, 0, L.pos.z - 1.2 * side);
  return new THREE.Vector3(L.pos.x - 0.6, 0, L.pos.z);
}
export function stationExit(id, lane) {
  const L = laneOf(id, lane);
  if (id === 'pull') return new THREE.Vector3(L.pos.x + 13.5, 0, L.pos.z);
  if (id === 'push' || id === 'farmers') return stationEntry(id, lane);
  if (id === 'lunges') return new THREE.Vector3(L.pos.x + L.len + 0.6, 0, L.pos.z);   // 5 carriles: terminas al otro lado
  if (id === 'bbj') return stationEntry(id, lane);                                       // 4 carriles: terminas donde empezaste
  return stationEntry(id, lane);
}
