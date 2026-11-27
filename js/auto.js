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

const MASH_AI = 7;   // toques por segundo del piloto (ritmo de referencia)
// skill 0..1: qué tan bien ejecuta (precisión y ritmo)
export class Autopilot {
  constructor(skill = 0.85) { this.skill = skill; this.I = new VirtualInput(); this.t = 0; this.next = 0; this.alt = 'L'; this.tgt = 0; }
  jitter(a) { return (Math.random() * 2 - 1) * a * (1.2 - this.skill); }
  // error de timing como una persona: casi siempre cerca, a veces se equivoca (y de vez en cuando bastante)
  miss() {
    if (this.perfect) return this.jitter(0.1);
    const u = Math.max(1e-6, Math.random()), g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
    const big = Math.random() < 0.07 ? (Math.random() < 0.5 ? -1 : 1) * (0.18 + Math.random() * 0.15) : 0;
    return g * 0.085 * (1.6 - this.skill) + big;
  }
  step(ctl, dt) {
    const I = this.I; I.frame(); this.t += dt;
    const id = ctl.id;
    if (id === 'push' || id === 'pull' || id === 'ski' || id === 'row') {
      // alterna ← → a su ritmo; a veces se traba un momento (como una persona)
      if (this.t >= this.next) {
        if (!this.perfect && Math.random() < 0.025) { this.next = this.t + 0.25 + Math.random() * 0.3; return I; }
        I.tap(this.alt); this.alt = this.alt === 'L' ? 'R' : 'L';
        this.next = this.t + 1 / (MASH_AI * (0.9 + this.skill * 0.12)) * (1 + this.jitter(0.25));
      }
      return I;
    } else if (id === 'farmers') {
      if (!ctl.down && ctl.grip < 0.18 + this.jitter(0.05)) { I.tap('A'); I.release('R'); return I; }
      if (ctl.down) { I.release('R'); if (ctl.grip > 0.85) I.tap('A'); return I; }
      I.press('R'); return I;
    } else if (id === 'bbj') {
      // burpee; al saltar pulsa cerca del centro del verde (con error según su nivel). Muy cansado: respira de pie
      if (ctl.me.energy < 18) this.rest = true; else if (ctl.me.energy > 35) this.rest = false;
      if (ctl.stage === 'stand' && !this.rest && this.t >= this.next) { I.tap('A'); this.next = this.t + 0.05; this.tgt = null; }
      if (ctl.stage === 'aim') {
        if (this.tgt == null) { const [a, b] = ctl.zone(); this.tgt = (a + b) / 2 + this.miss(); }
        if (ctl.aim >= this.tgt) { I.tap('A'); this.tgt = null; }
      }
    } else if (id === 'lunges') {
      const k = ctl.leg;
      if (ctl.st === 'stand') { I.release(k === 'L' ? 'R' : 'L'); I.press(k); this.tgt = null; }
      else if (ctl.st === 'down') {
        if (this.tgt == null) { const [a, b] = ctl.zone(); this.tgt = Math.min(0.98, (a + b) / 2 + this.miss()); }   // la barra no pasa de 1
        if (ctl.depth >= this.tgt) I.release(k); else I.press(k);
      } else { I.release('L'); I.release('R'); }
    } else if (id === 'wb') {
      if ((ctl.state === 'ready' || ctl.state === 'catch') && this.t >= this.next) { I.tap('A'); this.next = this.t + 0.05 + Math.max(0, this.jitter(0.15)); this.tgt = null; }
      else if (ctl.state === 'squat') {
        if (this.tgt == null) { const [a, b] = ctl.zone(); this.tgt = (a + b) / 2 + this.miss(); }
        if (ctl.squat >= Math.max(0.36, this.tgt)) { I.tap('A'); this.tgt = 1e9; }
      }
    }
    return I;
  }
}
