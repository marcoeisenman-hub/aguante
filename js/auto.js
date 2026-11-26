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
    if (id === 'ski' || id === 'row' || id === 'push' || id === 'pull') {
      // timing: toca cuando la aguja llega a su objetivo (cerca del inicio del verde, con error según su nivel)
      if (this.tgt == null || ctl.bT < this.lastB) { const [a, b] = ctl.bZ; this.tgt = a + (b - a) * 0.3 + this.jitter(0.14); }
      this.lastB = ctl.bT;
      if (ctl.bT >= this.tgt) { I.tap('A'); this.tgt = null; this.lastB = 0; }
      return I;
    } else if (id === 'push' || id === 'pull' || id === 'farmers') {
      if (id === 'farmers') {
        if (!ctl.down && ctl.grip < 0.18 + this.jitter(0.05)) { I.tap('A'); I.release('R'); return I; }
        if (ctl.down) { I.release('R'); if (ctl.grip > 0.85) I.tap('A'); return I; }
        I.press('R'); return I;
      }
      const rate = (id === 'farmers' ? 3.6 : (id === 'push' || id === 'pull') ? 7 : 4.4) * (0.9 + this.skill * 0.12);
      if (this.t >= this.next) { I.tap(this.alt); this.alt = this.alt === 'L' ? 'R' : 'L'; this.next = this.t + 1 / rate * (1 + this.jitter(0.25)); }
    } else if (id === 'bbj') {
      // burpee; al saltar pulsa cerca del centro del verde (con error según su nivel). Muy cansado: respira de pie
      if (ctl.me.energy < 18) this.rest = true; else if (ctl.me.energy > 35) this.rest = false;
      if (ctl.stage === 'stand' && !this.rest && this.t >= this.next) { I.tap('A'); this.next = this.t + 0.05; this.tgt = null; }
      if (ctl.stage === 'aim') {
        if (this.tgt == null) { const [a, b] = ctl.zone(); this.tgt = (a + b) / 2 + this.jitter(0.16); }
        if (ctl.aim >= this.tgt) { I.tap('A'); this.tgt = null; }
      }
    } else if (id === 'lunges') {
      const k = ctl.leg;
      if (ctl.st === 'stand') { I.release(k === 'L' ? 'R' : 'L'); I.press(k); this.tgt = null; }
      else if (ctl.st === 'down') {
        if (this.tgt == null) { const [a, b] = ctl.zone(); this.tgt = (a + b) / 2 + this.jitter(0.12); }
        if (ctl.depth >= this.tgt) I.release(k); else I.press(k);
      } else { I.release('L'); I.release('R'); }
    } else if (id === 'wb') {
      if ((ctl.state === 'ready' || ctl.state === 'catch') && this.t >= this.next) { I.tap('A'); this.next = this.t + 0.05 + Math.max(0, this.jitter(0.15)); this.tgt = null; }
      else if (ctl.state === 'squat') {
        if (this.tgt == null) { const [a, b] = ctl.zone(); this.tgt = (a + b) / 2 + this.jitter(0.14); }
        if (ctl.squat >= Math.max(0.36, this.tgt)) { I.tap('A'); this.tgt = 1e9; }
      }
    }
    return I;
  }
}
