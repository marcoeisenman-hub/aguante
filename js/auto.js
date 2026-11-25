// Piloto automático: genera "teclas" para que el compañero de Doubles use las mismas mecánicas que el jugador.
export class VirtualInput {
  constructor() { this.d = new Set(); this.p = new Set(); this.r = new Set(); }
  down(k) { return this.d.has(k); }
  pressed(k) { return this.p.has(k); }
  released(k) { return this.r.has(k); }
  press(k) { if (!this.d.has(k)) { this.d.add(k); this.p.add(k); } }
  release(k) { if (this.d.has(k)) { this.d.delete(k); this.r.add(k); } }
  tap(k) { this.p.add(k); this.r.add(k); }
  frame() { this.p.clear(); this.r.clear(); }
}

// skill 0..1: qué tan bien ejecuta (precisión y ritmo)
export class Autopilot {
  constructor(skill = 0.85) { this.skill = skill; this.I = new VirtualInput(); this.t = 0; this.next = 0; this.alt = 'L'; this.tgt = 0; }
  jitter(a) { return (Math.random() * 2 - 1) * a * (1.2 - this.skill); }
  step(ctl, dt) {
    const I = this.I; I.frame(); this.t += dt;
    const id = ctl.id;
    if (id === 'ski' || id === 'row') {
      const win = (id === 'ski' ? 0.42 : 0.5) - (1 - ctl.ef) * 0.08;
      const recT = id === 'ski' ? 0.5 : 0.75;
      if (ctl.state === 'ready' || (ctl.state === 'rec' && ctl.rec >= recT * (0.92 + this.jitter(0.1)))) { if (!I.down('A')) { I.press('A'); this.tgt = win * (1 + this.jitter(0.35)); } }
      if (ctl.state === 'drive' && ctl.hold >= this.tgt) I.release('A');
    } else if (id === 'push' || id === 'pull' || id === 'farmers') {
      if (id === 'farmers') {
        if (!ctl.down && ctl.grip < 0.18 + this.jitter(0.05)) { I.tap('A'); return I; }
        if (ctl.down) { if (ctl.grip > 0.85) I.tap('A'); return I; }
      }
      const rate = (id === 'farmers' ? 3.6 : 4.4) * (0.9 + this.skill * 0.12);
      if (this.t >= this.next) { I.tap(this.alt); this.alt = this.alt === 'L' ? 'R' : 'L'; this.next = this.t + 1 / rate * (1 + this.jitter(0.25)); }
    } else if (id === 'bbj') {
      if (this.t < this.next) return I;
      if (ctl.stage === 'stand') { I.tap('D'); this.next = this.t + 0.05; }
      else if (ctl.stage === 'down' && ctl.ph >= 0.4) { I.tap('U'); this.next = this.t + 0.05 + Math.max(0, this.jitter(0.1)); }
      else if (ctl.stage === 'set') {
        if (!I.down('A')) { I.press('A'); this.tgt = 0.88 + this.jitter(0.12); }
        else if (ctl.charge >= Math.min(0.99, this.tgt)) I.release('A');
      }
    } else if (id === 'lunges') {
      if (!ctl.leg && !ctl.rising && !I.down(ctl.next)) { if (this.t >= this.next) I.press(ctl.next); }
      else if (ctl.leg && ctl.depth >= 1.0 + Math.max(0, this.jitter(0.02))) { I.release(ctl.leg); this.next = this.t + 0.04; }
      for (const k of ['L', 'R']) if (I.down(k) && !ctl.leg && ctl.rising) I.release(k);
    } else if (id === 'wb') {
      if (ctl.state === 'ready' && !I.down('A')) { I.press('A'); this.tgt = 0.72 + this.jitter(0.09); }
      if (ctl.state === 'squat' && ctl.squat >= 1 && Math.abs(ctl.pw - this.tgt) < 0.03) I.release('A');
      if (ctl.state !== 'squat' && I.down('A') && ctl.state !== 'ready') I.release('A');
    }
    return I;
  }
}
