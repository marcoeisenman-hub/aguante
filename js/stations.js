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
  }
  // efecto de la energía en el rendimiento
  get ef() { return this.race.energyFactor(this.me) * (this.me.pow?.[this.id] ?? 1); }
  spend(e) { this.race.spend(this.me, e * 0.85); }
  noRep(text) {
    this.faults++;
    this.pens = this.pens || 0;
    const pen = this.faults >= 2 && this.pens < 2 && this.id !== 'wb' && this.race.penaltiesOn ? 15 : 0;
    if (pen) { this.pens++; this.race.penalty(this.race.me, pen, 'No-rep (' + text + ')'); }
    this.race.flash(pen ? `NO REP · ${text} · +15 s` : `NO REP · ${text}${this.faults === 1 && this.id !== 'wb' ? ' (aviso)' : ''}`, 'bad');
    this.race.sfx('norep');
  }
  good(t) { this.race.flash(t, 'good'); }
  add(units) { this.done = Math.min(this.total, this.done + units); }
  get finished() { return this.done >= this.total - 1e-6; }
  hints() { return []; }
  hud() { return {}; }
  cam() { return null; }
  dispose() { }
}

// =====================================================================
// SkiErg: mantén ESPACIO para jalar, suelta cuando la aguja está en verde. La recuperación es automática.
class Ski extends Station {
  constructor(...a) {
    super(...a);
    this.m = this.race.world.eq.ski[this.lane];
    this.state = 'ready'; this.ph = 0; this.hold = 0; this.rec = 0;
    this.cycle = 1.05;                              // seg reales por jalón ideal
    this.per = this.total / (this.ref / this.cycle);
    this.last = 0; this.spm = 0; this.pace = 0;
    place(this.av, _v.copy(this.L.pos).addScaledVector(FACE.pz, -0.05 * ST.ski.side).add(new THREE.Vector3(0, 0, 0.5 * ST.ski.side)), this.L.face);
    this.av.group.position.set(this.L.pos.x, 0, this.L.pos.z + 0.12 * ST.ski.side);
  }
  update(dt, I) {
    this.t += dt;
    const win = 0.42 - (1 - this.ef) * 0.08;      // momento ideal para soltar (seg sosteniendo)
    if (this.state === 'ready' || this.state === 'rec') {
      if (this.state === 'rec') { this.rec += dt; this.ph = lerp(0.45, 1, clamp(this.rec / 0.5, 0, 1)); if (this.rec >= 0.5) this.state = 'ready'; }
      if (I.pressed('A')) {
        if (this.state === 'rec' && this.rec < 0.3) { if (!this._wf || this.t - this._wf > 1) { this._wf = this.t; this.race.flash('Espera que suban las manos', 'meh', 0.9); } }
        else {
          const early = this.state === 'rec' ? clamp(1 - this.rec / 0.5, 0, 1) : 0;   // jalar antes de que suban del todo: jalón corto
          this.state = 'drive'; this.hold = 0; this.early = early; this.race.sfx('stroke', { power: 0.6 });
        }
      }
    }
    if (this.state === 'drive') {
      this.hold += dt;
      this.ph = clamp(this.hold / win, 0, 1) * 0.43;
      if (I.released('A') || this.hold > win * 1.8) {
        const err = Math.abs(this.hold - win) / win;
        let q = this.hold < win * 0.45 ? 0.08 : clamp(1 - err * 1.6, 0.25, 1) * (1 - this.early * 0.5);
        if (this.hold > win * 1.8) q = 0.35;
        const m = this.per * q * this.ef;
        this.add(m);
        const now = this.t; if (this.last) { this.spm = 60 / ((now - this.last) * this.K) * 3.6; } this.last = now;
        this.pace = m > 0 ? (500 / m) * (this.cycle * this.K) / 1 : 0;
        this.spend(0.30 * q + 0.08);
        this.q = q;
        if (q > 0.9) this.good('JALÓN PERFECTO'); else if (q < 0.5) this.race.flash(this.hold < win ? 'Muy corto' : 'Te pasaste', 'meh');
        this.state = 'rec'; this.rec = 0;
        this.race.sfx('good', { q });
      }
    }
    this.av.set('ski', this.ph, {});
    this.race.loop('flywheel', 0.35, 0.4 + (this.state === 'drive' ? 0.6 : 0.2));
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
  hud() {
    const win = 0.42 - (1 - this.ef) * 0.08;
    return { gauge: gauge('timing', { val: this.state === 'drive' ? this.hold / (win * 1.8) : 0, zone: [(win * 0.82) / (win * 1.8), (win * 1.18) / (win * 1.8)], label: 'JALÓN' }), big: Math.floor(this.done) + ' m', sub: this.pace ? fmtS(this.pace) + ' /500m' : '' };
  }
  hints() { return [['ESPACIO', 'mantén para jalar · suelta en verde']]; }
  cam() { return { pos: _v.set(this.L.pos.x + 2.6, 1.7, this.L.pos.z - 2.6 * ST.ski.side), look: _w.set(this.L.pos.x, 1.1, this.L.pos.z) }; }
}

// =====================================================================
// Remo: mantén ESPACIO durante el jalón (piernas-espalda-brazos), suelta en verde y deja que la recuperación dure.
class Row extends Station {
  constructor(...a) {
    super(...a);
    this.m = this.race.world.eq.row[this.lane];
    this.state = 'ready'; this.ph = 0; this.hold = 0; this.rec = 0;
    this.cycle = 1.35;
    this.per = this.total / (this.ref / this.cycle);
    this.pace = 0; this.last = 0; this.spm = 0;
    this.base = this.m.position.clone();
  }
  update(dt, I) {
    this.t += dt;
    const win = 0.5 - (1 - this.ef) * 0.08;
    if (this.state === 'rec' || this.state === 'ready') {
      if (this.state === 'rec') { this.rec += dt; this.ph = lerp(0.35, 1, clamp(this.rec / 0.75, 0, 1)); if (this.rec >= 0.75) { this.state = 'ready'; this.ph = 0; } }
      if (I.pressed('A') && this.state === 'rec' && this.rec < 0.4) { if (!this._wf || this.t - this._wf > 1) { this._wf = this.t; this.race.flash('Espera que vuelva el asiento', 'meh', 0.9); } }
      else if (I.pressed('A')) {
        this.rush = this.state === 'rec' ? clamp(1 - this.rec / 0.75, 0, 1) : 0;
        if (this.rush > 0.3) this.race.flash('Recuperación muy rápida', 'meh');
        this.state = 'drive'; this.hold = 0; this.race.sfx('stroke', { power: 0.7 });
      }
    }
    if (this.state === 'drive') {
      this.hold += dt;
      this.ph = clamp(this.hold / win, 0, 1) * 0.35;
      if (I.released('A') || this.hold > win * 1.8) {
        const err = Math.abs(this.hold - win) / win;
        let q = this.hold < win * 0.45 ? 0.08 : clamp(1 - err * 1.5, 0.25, 1) * (1 - this.rush * 0.45);
        if (this.hold > win * 1.8) q = 0.35;
        const m = this.per * q * this.ef;
        this.add(m);
        if (this.last) this.spm = clamp(60 / ((this.t - this.last)) / 2.1, 16, 40); this.last = this.t;
        this.pace = (500 / m) * this.cycle * this.K;
        this.spend(0.28 * q + 0.08);
        if (q > 0.9) this.good('REMADA PERFECTA'); else if (q < 0.5) this.race.flash(this.hold < win ? 'Jalón corto' : 'Te pasaste', 'meh');
        this.state = 'rec'; this.rec = 0;
      }
    }
    this.av.set('row', this.ph, { ground: false });
    this.race.loop('flywheel', 0.4, 0.5 + (this.state === 'drive' ? 0.5 : 0.15));
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
  hud() {
    const win = 0.5 - (1 - this.ef) * 0.08;
    return { gauge: gauge('timing', { val: this.state === 'drive' ? this.hold / (win * 1.8) : 0, zone: [(win * 0.82) / (win * 1.8), (win * 1.18) / (win * 1.8)], label: 'JALÓN', rec: this.state === 'rec' ? this.rec / 0.75 : null }), big: Math.floor(this.done) + ' m', sub: this.pace ? fmtS(this.pace) + ' /500m · ' + Math.round(this.spm) + ' s/m' : '' };
  }
  hints() { return [['ESPACIO', 'mantén = jalón · suelta en verde'], ['', 'espera que vuelva el asiento']]; }
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
    this.c1 = 1.1; this.c0 = 0.35 * this.vt; this.imp = (this.c0 + this.c1 * this.vt) / 4.0;
  }
  update(dt, I) {
    this.t += dt;
    if (this.turn > 0) {                      // dar la vuelta al trineo
      this.turn -= dt; this.av.set('walk', (this.t * 1.6) % 1, {}); this.placeTurn(); if (this.turn <= 0) this.dirn *= -1; return;
    }
    for (const k of ['L', 'R']) if (I.pressed(k)) {
      const good = k !== this.lastKey;
      const gap = this.t - this.lastT;
      if (!good) { this.v *= 0.92; this.race.flash('Alterna las piernas', 'meh'); }
      else {
        let q = cadQ(gap, 0.2, this);                                          // demasiado rápido = patina
        if (this.v < 0.15) q *= 0.55;                                  // arrancar desde parado cuesta
        this.v += this.imp * q * this.lf * this.ef;
        this.spend(0.085 * this.lf ** -0.5);
        this.race.sfx('step');
      }
      this.lastKey = k; this.lastT = this.t;
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
    this.sled.rotation.y = this.dirn > 0 ? -Math.PI / 2 : Math.PI / 2;
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
  hud() { return { gauge: gauge('speed', { val: clamp(this.v / (this.vt * 1.4), 0, 1), zone: [0.6, 0.85], label: 'VELOCIDAD' }), big: this.done.toFixed(1) + ' m', sub: `Carril ${Math.min(4, this.laneN + 1)}/4 · ${this.load.push} kg` }; }
  hints() { return [['← →', 'alterna rápido, sin pararte']]; }
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
    this.c1 = 0.9; this.c0 = 0.4 * this.vt; this.imp = (this.c0 + this.c1 * this.vt) / 4.2;
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
    for (const k of ['L', 'R']) if (I.pressed(k)) {
      if (k === this.lastKey) { this.race.flash('Mano sobre mano: alterna', 'meh'); this.v *= 0.9; }
      else {
        const gap = this.t - this.lastT;
        let q = cadQ(gap, 0.2, this); if (this.v < 0.12) q *= 0.6;
        this.v += this.imp * q * this.lf * this.ef;
        this.spend(0.08 * this.lf ** -0.5);
        this.race.sfx('rope');
        this.ph = (this.ph + 0.5) % 1;
      }
      this.lastKey = k; this.lastT = this.t;
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
  hud() { return { gauge: gauge('speed', { val: clamp(this.v / (this.vt * 1.4), 0, 1), zone: [0.6, 0.85], label: 'TIRÓN' }), big: this.done.toFixed(1) + ' m', sub: `Carril ${Math.min(4, this.laneN + 1)}/4 · ${this.load.pull} kg` }; }
  hints() { return [['← →', 'mano sobre mano, alterna']]; }
  cam() {
    const [ax, bx] = this.ends(), dir = Math.sign(bx - ax), zs = this.L.pos.z < 0 ? 1 : -1;
    if (this.walk > 0) { const x = this.av.group.position.x; return { pos: _v.set(x - 1.5, 2.3, this.L.pos.z + 4.2 * zs), look: _w.set(x, 0.8, this.L.pos.z) }; }
    return { pos: _v.set(ax - dir * 3.0, 2.2, this.L.pos.z + 2.4 * zs), look: _w.set(ax + dir * 5, 0.6, this.L.pos.z) };
  }
}

// =====================================================================
// Burpee Broad Jump: ↓ pecho al piso, ↑ arriba, ESPACIO mantener y soltar para saltar.
class BBJ extends Station {
  constructor(...a) {
    super(...a);
    this.vis = 4;                         // 1 m visual = 4 m de carrera
    this.stage = 'stand'; this.ph = 0; this.x = 0; this.timer = 0; this.charge = 0;
    this.cyc = 1.7;
    this.per = this.total / (this.ref / this.cyc);   // m de carrera por burpee perfecto
  }
  update(dt, I) {
    this.t += dt;
    const s = this.stage;
    const ef = this.ef;
    if (s === 'stand' && I.pressed('D')) { this.stage = 'down'; this.timer = 0; this.wantUp = I.pressed('U'); }
    else if (s === 'stand' && (I.pressed('A') || I.pressed('U'))) { this.race.flash('Primero ↓: pecho al piso', 'meh', 1); }
    else if (s === 'down') {
      this.timer += dt; this.ph = lerp(0, 0.4, clamp(this.timer / (0.32 / ef ** 0.5), 0, 1));
      if (this.ph >= 0.4 && !this.thud) { this.thud = true; this.race.sfx('thud'); }
      if (I.pressed('U')) this.wantUp = true;
      if (this.wantUp && this.ph >= 0.4) { this.wantUp = false; this.stage = 'up'; this.timer = 0; this.invalid = false; this.thud = false; }
    } else if (s === 'up') {
      this.timer += dt; this.ph = lerp(0.4, 0.62, clamp(this.timer / (0.3 / ef ** 0.5), 0, 1));
      if (this.ph >= 0.62) { this.stage = 'set'; this.charge = 0; }
    } else if (s === 'set') {
      this.ph = 0.66;
      if (I.down('A')) { this.charge = Math.min(1.15, this.charge + dt * 1.6); }
      const maxed = this.charge >= 1.15;
      if ((I.released('A') && this.charge > 0.05) || maxed) {
        const c = this.charge;
        let q;
        if (maxed) { this.noRep('pies no paralelos al caer'); q = 0; }
        else if (c > 1.0) { q = 0.5; this.race.flash('Te pasaste: salto corto', 'meh', 1); }
        else q = c < 0.75 ? 0.35 + c * 0.6 : lerp(0.8, 1, (c - 0.75) / 0.25);
        if (this.invalid) q = 0;
        this.jump = { from: this.x, q, t: 0 };
        this.stage = 'jump'; this.spend(0.5 * (0.6 + c * 0.4));
      }
    } else if (s === 'jump') {
      const j = this.jump; j.t += dt;
      const k = clamp(j.t / 0.42, 0, 1);
      this.ph = lerp(0.7, 1.0, k);
      const dist = (this.per / this.vis) * j.q * ef;
      this.xv = j.from + dist * Math.sin(k * Math.PI / 2);
      if (k >= 1) {
        this.x = j.from + dist; this.add(dist * this.vis); this.stage = 'stand'; this.ph = 0; this.race.sfx('land');
        if (j.q > 0.9) this.good('SALTO LARGO');
      }
    }
    const x = this.stage === 'jump' ? this.xv : this.x;
    this.av.set('burpee', this.ph % 1, { blend: 0.1 });
    place(this.av, _v.set(this.L.pos.x + x + 0.3, 0, this.L.pos.z), FACE.px);
    if (this.stage === 'jump') this.av.group.position.y = Math.sin(clamp(this.jump.t / 0.42, 0, 1) * Math.PI) * 0.28;
  }
  hud() {
    const map = { stand: '↓ al piso', down: '↑ arriba', up: '…', set: 'ESPACIO: saltar', jump: '' };
    return { gauge: this.stage === 'set' ? gauge('charge', { val: this.charge / 1.15, zone: [0.75 / 1.15, 1.0 / 1.15], label: 'SALTO' }) : gauge('steps', { steps: ['↓', '↑', '⎵'], at: { stand: 0, down: 1, up: 1, set: 2, jump: 2 }[this.stage], label: map[this.stage] }), big: this.done.toFixed(0) + ' m', sub: 'de 80 m' };
  }
  hints() { return [['↓', 'pecho al piso'], ['↑', 'levántate'], ['ESPACIO', 'carga y suelta en verde']]; }
  cam() { return { pos: _v.set(this.L.pos.x + this.x - 2.6, 1.9, this.L.pos.z + 3.6 * (this.L.pos.z < 0 ? 1 : -1)), look: _w.set(this.L.pos.x + this.x + 1.2, 0.5, this.L.pos.z) }; }
}

// =====================================================================
// Farmers Carry: alterna ← → para caminar. El agarre se gasta; ESPACIO para soltar y recuperar.
class Farmers extends Station {
  constructor(...a) {
    super(...a);
    this.vis = 5;                              // 200 m = 2 × 20 m visuales
    this.kb = this.race.world.eq.kb[this.lane];
    this.grip = 1; this.v = 0; this.x = 0; this.dirn = 1; this.lastKey = null; this.lastT = -1; this.ph = 0;
    this.down = true; this.pick = 0;
    this.lf = loadF(this.sex, 'farmers', this.load.farmers);
    this.vt = (this.total / this.vis) / (this.ref * 0.92);
    this.c1 = 1.8; this.c0 = 0.25 * this.vt; this.imp = (this.c0 + this.c1 * this.vt) / 3.6;
  }
  update(dt, I) {
    this.t += dt;
    if (this.down) {                                   // pesas en el piso
      this.grip = Math.min(1, this.grip + dt * 0.55);
      this.av.set('crouch', 0, { blend: 0.2 });
      if (I.pressed('A') || I.pressed('L') || I.pressed('R')) { this.down = false; this.pick = 0.35; this.race.sfx('kbPick'); }
    } else {
      if (this.pick > 0) this.pick -= dt;
      if (I.pressed('A')) { this.down = true; this.v = 0; this.race.sfx('kbDrop'); }
      for (const k of ['L', 'R']) if (I.pressed(k) && this.pick <= 0) {
        if (k === this.lastKey) this.v *= 0.9;
        else { const gap = this.t - this.lastT; this.v += this.imp * cadQ(gap, 0.24, this) * this.ef; this.spend(0.05 / this.lf); this.race.sfx('step'); }
        this.lastKey = k; this.lastT = this.t;
      }
      this.v = Math.max(0, this.v - (this.c0 + this.c1 * this.v) * dt);
      this.grip -= dt * (0.035 + 0.06 * this.v / this.vt) / this.lf * (1.3 - this.ef * 0.3);
      if (this.grip <= 0) { this.grip = 0; this.down = true; this.v = 0; this.race.flash('¡Se te soltaron!', 'bad'); this.race.sfx('kbDrop'); }
      const dx = this.v * dt; this.x += dx; this.add(dx * this.vis);
      if (this.x >= 20 && this.dirn > 0 && !this.finished) { this.x = 0; this.dirn = -1; this.good('Vuelta · 100 m'); }
      this.ph = (this.ph + dx / 1.1) % 1;
      this.av.set(this.v > 0.05 || this.pick > 0 ? 'walk' : 'stand', this.ph, { load: 1, blend: 0.2 });
    }
    this.placeAll();
  }
  pos() { return this.dirn > 0 ? this.L.pos.x + this.x : this.L.pos.x + 20 - this.x; }
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
  hud() { return { gauge: gauge('grip', { val: this.grip, label: this.down ? 'AGARRE (descansando)' : 'AGARRE' }), big: this.done.toFixed(0) + ' m', sub: `de 200 m · 2 × ${this.load.farmers} kg` }; }
  hints() { return [['← →', 'camina'], ['ESPACIO', 'soltar / levantar']]; }
  cam() { const x = this.pos(); return { pos: _v.set(x - this.dirn * 3.2, 2.0, this.L.pos.z - 3.4 * (this.L.pos.z > 0 ? -1 : 1)), look: _w.set(x + this.dirn, 0.8, this.L.pos.z) }; }
}

// =====================================================================
// Sandbag Lunges: mantén ← (pierna izq) hasta que la rodilla toque, suelta para subir; luego →.
class Lunges extends Station {
  constructor(...a) {
    super(...a);
    this.vis = 5; this.bag = this.race.world.eq.bag[this.lane];
    this.x = 0; this.leg = null; this.depth = 0; this.next = 'L'; this.ph = 0; this.rising = 0;
    this.lf = loadF(this.sex, 'sandbag', this.load.sandbag);
    this.cyc = 0.7;
    this.per = (this.total / this.vis) / (this.ref / this.cyc);   // m visuales por zancada perfecta
  }
  update(dt, I) {
    this.t += dt;
    const ef = this.ef;
    if (!this.leg && !this.rising) {
      for (const k of ['L', 'R']) if (I.pressed(k)) {
        if (k !== this.next) { this.race.flash('Alterna la pierna', 'meh'); continue; }
        this.leg = k; this.depth = 0; this.x0 = this.x;
      }
    }
    if (this.leg) {
      this.depth = Math.min(1.08, this.depth + dt / (0.36 / ef ** 0.6));
      if (this.depth >= 1 && !this.touch) { this.touch = true; this.race.sfx('thud', { soft: true }); }
      if (I.released(this.leg) || this.depth >= 1.08) {
        const ok = this.depth >= 0.95;
        if (!ok && this.depth >= 0.6) this.race.flash('Más abajo: la rodilla tiene que tocar', 'meh', 1.2);
        else if (!ok) this.noRep('la rodilla no tocó');
        else { this.next = this.leg === 'L' ? 'R' : 'L'; }
        this.rising = 0.3; this.leg2 = this.leg; this.ok = ok; this.leg = null; this.touch = false;
        this.spend((0.13 + this.depth * 0.05) / this.lf);
      }
    }
    if (this.rising > 0) {
      this.rising -= dt;
      if (this.rising <= 0) { this.rising = 0; if (this.ok) { const d = this.per * ef; this.x += d; this.add(d * this.vis); } }
    }
    // fase visual: 0 de pie, 0.25 abajo (pierna izq) / 0.75 abajo (der)
    const L2 = this.leg || this.leg2 || 'L';
    let d = this.leg ? Math.min(1, this.depth) : this.rising > 0 ? this.rising / 0.3 * (this.ok ? 1 : 0.7) : 0;
    const base = L2 === 'L' ? 0 : 0.5;
    this.ph = base + d * 0.25;
    this.av.set('lunge', this.ph, { blend: 0.08 });
    const move = this.rising > 0 && this.ok ? (1 - this.rising / 0.3) * this.per * ef : 0;
    place(this.av, _v.set(this.L.pos.x + this.x + move, 0, this.L.pos.z), FACE.px);
    this.av.update(0);
    // saco sobre los hombros
    const n = this.av.bonePos('neck', _v);
    this.bag.position.set(n.x - 0.04, n.y - 0.02, n.z);
    this.bag.rotation.set(0, Math.PI / 2, 0);
  }
  hud() { return { gauge: this.leg ? gauge('depth', { val: this.depth / 1.08, zone: [0.95 / 1.08, 1], label: 'RODILLA AL PISO' }) : gauge('steps', { steps: ['←', '→'], at: this.next === 'L' ? 0 : 1, label: 'pierna ' + (this.next === 'L' ? 'izquierda' : 'derecha') }), big: this.done.toFixed(0) + ' m', sub: `de 100 m · saco ${this.load.sandbag} kg` }; }
  hints() { return [['← / →', 'mantén hasta tocar con la rodilla, suelta'], ['', 'alterna piernas']]; }
  cam() { return { pos: _v.set(this.L.pos.x + this.x + 2.4, 1.6, this.L.pos.z + 3.2 * (this.L.pos.z < 0 ? 1 : -1)), look: _w.set(this.L.pos.x + this.x, 0.9, this.L.pos.z) }; }
}

// =====================================================================
// Wall Balls: mantén ESPACIO = sentadilla; abajo, la barra de fuerza sube y baja; suelta en la franja.
class WallBalls extends Station {
  constructor(...a) {
    super(...a);
    this.ball = this.race.world.eq.ball[this.lane];
    this.tg = this.race.world.eq.wb[this.lane];
    this.state = 'ready'; this.ph = 0; this.squat = 0; this.pw = 0; this.pt = 0; this.fly = 0;
    this.repsPer = 2;
    this.lf = loadF(this.sex, 'ball', this.load.ball);
    this.side = ST.wb.side;
    place(this.av, _v.set(this.L.pos.x, 0, this.L.pos.z - 0.4 * this.side), _w.set(0, 0, this.side));
  }
  update(dt, I) {
    this.t += dt;
    const ef = this.ef;
    if (this.state === 'ready') {
      this.ph = 0;
      if (I.pressed('A')) { this.state = 'squat'; this.squat = 0; this.pt = 0.3; }
    } else if (this.state === 'squat') {
      this.squat = Math.min(1, this.squat + dt / (0.3 / ef ** 0.5));
      if (this.squat >= 1) { this.pt += dt * (2.3 + (1 - ef) * 0.8); this.pw = 0.5 - 0.5 * Math.cos(this.pt * Math.PI); }
      else this.pw = 0;
      this.ph = this.squat * 0.33;
      if (I.released('A')) {
        if (this.squat < 0.8) { this.noRep('sentadilla sin profundidad'); this.state = 'ready'; return; }
        const p = this.pw;
        this.throwQ = p; this.state = 'throw'; this.fly = 0; this.spend((0.2 + p * 0.12) / this.lf); this.race.sfx('ballThrow');
      }
    } else if (this.state === 'throw') {
      this.fly += dt;
      this.ph = lerp(0.33, 0.62, clamp(this.fly / 0.16, 0, 1));
      const T = 0.48;
      if (this.fly >= T) {
        const p = this.throwQ, z = this.zone();
        if (p < z[0]) this.noRep('no llegó al blanco');
        else { this.add(this.repsPer); if (p <= z[1]) this.good(this.done >= this.total ? '¡100!' : this.done + ' REPS'); this.race.sfx('ballCatch'); }
        this.state = 'catch'; this.fly = 0;
      }
    } else if (this.state === 'catch') {
      this.fly += dt; this.ph = lerp(0.85, 1, clamp(this.fly / 0.12, 0, 1));
      if (this.fly >= 0.12) this.state = 'ready';
    }
    this.av.set('wallball', this.ph % 1, { blend: 0.08 });
    this.av.update(0);
    this.placeBall();
  }
  zone() { const w = 0.24 + 0.06 * this.ef; const c = 0.7; return [c - w / 2, c + w / 2]; }
  placeBall() {
    const b = this.ball;
    if (this.state === 'throw' && this.fly > 0.08) {
      const T = 0.48, k = clamp((this.fly - 0.08) / (T - 0.08), 0, 1);
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
    const z = this.zone();
    return { gauge: this.state === 'squat' && this.squat >= 1 ? gauge('power', { val: this.pw, zone: z, label: 'FUERZA' }) : gauge('depth', { val: this.state === 'squat' ? this.squat : 0, zone: [0.8, 1], label: 'SENTADILLA' }), big: this.done + ' / 100', sub: `${this.load.ball} kg · blanco ${String(this.load.target ?? (this.sex === 'F' ? 2.7 : 3)).replace('.', ',')} m` };
  }
  hints() { return [['ESPACIO', 'mantén = sentadilla · suelta en la franja']]; }
  cam() { return { pos: _v.set(this.L.pos.x + 2.6, 1.9, this.L.pos.z - 3.4 * this.side), look: _w.set(this.L.pos.x, 1.7, this.L.pos.z + 0.4 * this.side) }; }
}

export const CTRL = { ski: Ski, push: Push, pull: Pull, bbj: BBJ, row: Row, farmers: Farmers, lunges: Lunges, wb: WallBalls };

// calidad del paso según la cadencia: el ritmo ideal da 1; aplastar teclas rinde menos
function cadQ(gap, ideal, st) { if (st && gap < ideal * 0.6 && (!st._sp || st.t - st._sp > 1.5)) { st._sp = st.t; st.race.flash('Muy rápido: pasos firmes, no aplastes', 'meh', 1.1); } if (gap >= ideal) return 1; if (gap <= ideal * 0.55) return 0.12; return lerp(0.12, 1, (gap - ideal * 0.55) / (ideal * 0.45)); }

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
      const s = world.eq.push[lane]; s.position.set(sx, 0, L.pos.z); s.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
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
      const x = f * 20;
      av.group.position.set(L.pos.x + x + 0.3, 0, L.pos.z); av.group.rotation.y = Math.PI / 2;
      const p = cyc(0.75); av.set('burpee', p, {});
      if (p > 0.72 && p < 0.95) av.group.position.y = Math.sin((p - 0.72) / 0.23 * Math.PI) * 0.25;
      return;
    }
    case 'farmers': {
      const d = f * 40; const out = d < 20; const x = out ? L.pos.x + d : L.pos.x + 40 - d;
      av.group.position.set(x, 0, L.pos.z); av.group.rotation.y = out ? Math.PI / 2 : -Math.PI / 2;
      av.set('walk', (d / 1.1) % 1, { load: 1 }); av.update(0);
      const kb = world.eq.kb[lane];
      for (let i = 0; i < 2; i++) { const h = av.handPos(i ? 'R' : 'L', _v); kb[i].position.set(h.x, Math.max(0, h.y - kb[i].userData.handleY), h.z); }
      return;
    }
    case 'lunges': {
      const x = f * 20;
      av.group.position.set(L.pos.x + x, 0, L.pos.z); av.group.rotation.y = Math.PI / 2;
      av.set('lunge', cyc(0.6), {}); av.update(0);
      const n = av.bonePos('neck', _v); const bag = world.eq.bag[lane]; bag.position.set(n.x - 0.04, n.y - 0.02, n.z); bag.rotation.set(0, Math.PI / 2, 0);
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
  if (id === 'bbj' || id === 'lunges') return new THREE.Vector3(L.pos.x + L.len + 0.6, 0, L.pos.z);
  return stationEntry(id, lane);
}
