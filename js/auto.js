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
      const rate = 7 * (0.9 + this.skill * 0.12);
      if (this.t >= this.next) { I.tap(this.alt); this.alt = this.alt === 'L' ? 'R' : 'L'; this.next = this.t + 1 / rate * (1 + this.jitter(0.25)); }
    } else if (id === 'push' || id === 'pull' || id === 'farmers') {
      if (id === 'farmers') {
        if (!ctl.down && ctl.grip < 0.18 + this.jitter(0.05)) { I.tap('A'); I.release('R'); return I; }
        if (ctl.down) { I.release('R'); if (ctl.grip > 0.85) I.tap('A'); return I; }
        I.press('R'); return I;
      }
      const rate = (id === 'farmers' ? 3.6 : (id === 'push' || id === 'pull') ? 7 : 4.4) * (0.9 + this.skill * 0.12);
      if (this.t >= this.next) { I.tap(this.alt); this.alt = this.alt === 'L' ? 'R' : 'L'; this.next = this.t + 1 / rate * (1 + this.jitter(0.25)); }
    } else if (id === 'bbj') {
      // mantiene; si está muy cansado respira un poco de pie
      if (ctl.me.energy < 18) this.rest = true; else if (ctl.me.energy > 35) this.rest = false;
      if (this.rest) I.release('A'); else I.press('A');
    } else if (id === 'lunges') {
      const ready = ctl.st === 'stand' || (ctl.st === 'up' && ctl.timer > 0.09);
      if (ready && !ctl.queued && this.t >= this.next) { I.tap(ctl.leg === 'L' ? 'L' : 'R'); this.next = this.t + 0.05 + Math.max(0, this.jitter(0.15)); }
    } else if (id === 'wb') {
      if ((ctl.state === 'ready' || ctl.state === 'catch') && this.t >= this.next) { I.tap('A'); this.next = this.t + 0.05 + Math.max(0, this.jitter(0.15)); }
    }
    return I;
  }
}
