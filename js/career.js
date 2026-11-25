// Modo entrenar: tu atleta tiene cualidades que suben entrenando y cambian cómo rinde en carrera.
const KEY = 'hrAtleta';
export const STATS = [
  { id: 'motor', name: 'Motor', desc: 'Gasta menos energía corriendo y en los ergs' },
  { id: 'vel', name: 'Velocidad', desc: 'Corre más rápido cada km y en la Roxzone' },
  { id: 'fuerza', name: 'Fuerza', desc: 'Sled Push, Sled Pull y Lunges' },
  { id: 'tecnica', name: 'Técnica', desc: 'SkiErg y Row: franja verde más ancha y más metros' },
  { id: 'resis', name: 'Resistencia', desc: 'Burpees y Wall Balls, gasta menos en estaciones' },
  { id: 'agarre', name: 'Agarre', desc: 'Farmers Carry: el agarre dura más' },
  { id: 'recup', name: 'Recuperación', desc: 'Recupera más energía en Suave/Cómodo y la Roxzone' },
];
// kind: 'station' (mini-juego con la estación, una parte de la distancia) o 'tap' (mini-juego de ritmo)
export const TRAININGS = [
  { id: 'intervalos', name: 'Intervalos 6 × 400 m', kind: 'tap', reps: 6, gains: { vel: 3, motor: 1.5 }, fatigue: 24, tip: 'Pulsa ESPACIO cuando la barra esté en verde: cada acierto es un intervalo a buen ritmo.' },
  { id: 'fondo', name: 'Fondo largo 12 km', kind: 'tap', reps: 8, slow: true, gains: { motor: 3, recup: 1.5 }, fatigue: 18, tip: 'Ritmo suave y parejo: pulsa ESPACIO en verde, la barra va lenta.' },
  { id: 'ski', name: 'SkiErg técnico 300 m', kind: 'station', st: 'ski', part: 0.3, gains: { tecnica: 2.5, motor: 1 }, fatigue: 14 },
  { id: 'row', name: 'Remo 400 m', kind: 'station', st: 'row', part: 0.4, gains: { tecnica: 2.5, motor: 1 }, fatigue: 14 },
  { id: 'push', name: 'Trineo pesado 2 × 12,5 m', kind: 'station', st: 'push', part: 0.5, gains: { fuerza: 3 }, fatigue: 20 },
  { id: 'pull', name: 'Arrastre 2 × 12,5 m', kind: 'station', st: 'pull', part: 0.5, gains: { fuerza: 2, agarre: 1 }, fatigue: 18 },
  { id: 'bbj', name: 'Burpees 40 m', kind: 'station', st: 'bbj', part: 0.5, gains: { resis: 2.5, motor: 1 }, fatigue: 18 },
  { id: 'farmers', name: 'Farmers 100 m', kind: 'station', st: 'farmers', part: 0.5, gains: { agarre: 3 }, fatigue: 12 },
  { id: 'lunges', name: 'Zancadas 50 m', kind: 'station', st: 'lunges', part: 0.5, gains: { fuerza: 1.5, resis: 1.5 }, fatigue: 16 },
  { id: 'wb', name: 'Wall Balls 40 reps', kind: 'station', st: 'wb', part: 0.4, gains: { resis: 3 }, fatigue: 16 },
  { id: 'descanso', name: 'Descanso y movilidad', kind: 'rest', gains: { recup: 0.6 }, fatigue: -45 },
];

const base = () => ({ v: 1, day: 1, fatigue: 0, sessions: 0, races: 0, stats: Object.fromEntries(STATS.map(s => [s.id, 40])), log: [] });
export function loadProfile() {
  try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && p.stats) { for (const s of STATS) p.stats[s.id] ??= 40; return p; } } catch { }
  return base();
}
export function saveProfile(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { } }
export function resetProfile() { const p = base(); saveProfile(p); return p; }
export const overall = p => Math.round(STATS.reduce((a, s) => a + p.stats[s.id], 0) / STATS.length);

// cuánto sube: más difícil cerca de 100, menos si estás cansado; q = qué tan bien hiciste el mini-juego (0..1)
export function train(p, t, q) {
  q = Math.max(0, Math.min(1, q));
  const tired = Math.max(0.25, 1 - p.fatigue / 130);
  const up = {};
  for (const [k, g] of Object.entries(t.gains)) {
    const s = p.stats[k];
    const d = t.kind === 'rest' ? g : g * (0.35 + 0.65 * q) * tired * (1.15 - s / 115);
    const nv = Math.min(100, s + Math.max(0, d));
    up[k] = +(nv - s).toFixed(1); p.stats[k] = +nv.toFixed(1);
  }
  p.fatigue = Math.max(0, Math.min(100, p.fatigue + t.fatigue * (t.kind === 'rest' ? 1 : 0.7 + 0.3 * q)));
  if (t.kind !== 'rest') { p.sessions++; } else p.fatigue = Math.max(0, p.fatigue);
  p.day++;
  // los días pasan: se recupera un poco solo
  p.fatigue = Math.max(0, p.fatigue - 6);
  p.log.unshift({ day: p.day - 1, t: t.name, q: Math.round(q * 100), up });
  p.log = p.log.slice(0, 12);
  saveProfile(p);
  return up;
}
export function afterRace(p) { p.races++; p.fatigue = Math.min(100, p.fatigue + 35); p.day++; saveProfile(p); }

// multiplicador: 50 = normal (1.0)
const mul = (s, lo, hi) => s < 50 ? lo + (1 - lo) * (s / 50) : 1 + (hi - 1) * ((s - 50) / 50);
// efectos sobre un miembro del equipo en carrera
export function applyProfile(m, p) {
  const S = p.stats, tiredK = 1 - p.fatigue / 500;
  m.prof = {
    run: mul(S.vel, 0.95, 1.07) * tiredK,          // velocidad de carrera
    drain: mul(S.motor, 1.18, 0.8),                 // gasto al correr
    regen: mul(S.recup, 0.8, 1.35),                 // recuperación
    tech: mul(S.tecnica, 1.25, 0.7),                // error de tiempo en ski/row (menos = mejor)
    grip: mul(S.agarre, 0.8, 1.35),                 // duración del agarre
    fit: mul(S.resis, 1.15, 0.85),                  // gasto en estaciones
  };
  const st = (s, lo, hi) => mul(s, lo, hi) * tiredK;
  m.pow = Object.assign(m.pow || {}, {
    ski: st((S.tecnica + S.motor) / 2, 0.94, 1.07), row: st((S.tecnica + S.motor) / 2, 0.94, 1.07),
    push: st(S.fuerza, 0.92, 1.09), pull: st(S.fuerza, 0.92, 1.09), lunges: st((S.fuerza + S.resis) / 2, 0.93, 1.08),
    bbj: st((S.resis + S.motor) / 2, 0.93, 1.08), wb: st(S.resis, 0.93, 1.08), farmers: st((S.agarre + S.fuerza) / 2, 0.94, 1.07),
  });
  m.energy = Math.round(100 - p.fatigue * 0.3);
}
