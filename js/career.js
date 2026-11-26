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
];

const base = () => ({ v: 3, day: 1, fatigue: 0, sessions: 0, races: 0, stats: Object.fromEntries(STATS.map(s => [s.id, 50])), log: [] });
export function loadProfile() {
  try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && p.stats) {
    // descansar = que pase el tiempo: la fatiga baja 10 puntos por hora
    const now = Date.now(); if (p.fatT) p.fatigue = Math.max(0, p.fatigue - (now - p.fatT) / 3600e3 * 10); if (!p.fatT || now - p.fatT > 60e3) saveProfile(p); for (const s of STATS) p.stats[s.id] ??= 50; if ((p.v || 1) < 2) { for (const s of STATS) p.stats[s.id] = Math.min(100, p.stats[s.id] + 10); p.v = 2; saveProfile(p); } if (p.v < 3) { p.day = 1; p.log = []; if (!p.todayN) delete p.today; p.v = 3; saveProfile(p); } return p; } } catch { }
  return base();
}
export function saveProfile(p) { p.fatT = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { } }
export function resetProfile() { const p = base(); saveProfile(p); return p; }
export const overall = p => Math.round(STATS.reduce((a, s) => a + p.stats[s.id], 0) / STATS.length);

// entrenos limitados: se ganan en carrera. 1.º +3, 2.º +2, 3.º +1. Empiezas con 3.
export const DAILY = 3, PRIZE = [3, 2, 1];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
export const COOLDOWN_H = 3;   // horas hasta poder repetir el mismo drill
export function drillWait(p, t) { const at = p.lastT?.[t.id] || 0; return Math.max(0, at + COOLDOWN_H * 3600e3 - Date.now()); }
export function trainsLeft(p) { return Math.max(0, p.tokens ?? DAILY); }

// cuánto sube: más difícil cerca de 100, menos si estás cansado; q = qué tan bien hiciste el mini-juego (0..1)
export function train(p, t, q) {
  q = Math.max(0, Math.min(1, q));
  const tired = Math.max(0.25, 1 - p.fatigue / 130);
  const up = {}, before = overall(p);
  if (drillWait(p, t) > 0) { p.lastOvr = [before, before]; p.noQuota = true; return {}; }
  if (t.kind !== 'rest') {
    if (trainsLeft(p) <= 0) { p.lastOvr = [before, before]; p.noQuota = true; return {}; }   // sin entrenos (p. ej. otra pestaña)
    if (p.today !== today()) { if (p.today) p.day++; p.today = today(); }   // "Día" = días reales en que entrenaste
    p.tokens = trainsLeft(p) - 1;
  }
  p.noQuota = false;
  p.lastT = { ...(p.lastT || {}), [t.id]: Date.now() };
  for (const [k, g] of Object.entries(t.gains)) {
    const s = p.stats[k];
    const d = t.kind === 'rest' ? g : g * 1.6 * (0.35 + 0.65 * q) * tired * (1.15 - s / 115);
    const nv = Math.min(100, s + Math.max(0, d));
    up[k] = +(nv - s).toFixed(1); p.stats[k] = +nv.toFixed(1);
  }
  // un entreno bien hecho siempre te sube al menos 1 de nivel (hasta 95)
  if (t.kind !== 'rest' && q >= 0.35 && before < 95 && overall(p) <= before) {
    for (let i = 0; i < 80 && overall(p) <= before; i++) {
      let keys = Object.keys(t.gains).filter(k => p.stats[k] < 100);
      if (!keys.length) keys = STATS.map(s => s.id).filter(k => p.stats[k] < 100);   // si esa cualidad ya está al máximo, sube otra
      if (!keys.length) break;
      for (const k of keys) { const s0 = p.stats[k]; p.stats[k] = +Math.min(100, s0 + 0.5).toFixed(1); up[k] = +((up[k] || 0) + p.stats[k] - s0).toFixed(1); }
    }
  }
  p.lastOvr = [before, overall(p)];
  p.fatigue = Math.max(0, Math.min(100, p.fatigue + t.fatigue * (t.kind === 'rest' ? 1 : 0.7 + 0.3 * q)));
  if (t.kind !== 'rest') { p.sessions++; } else p.fatigue = Math.max(0, p.fatigue);
  // los días pasan: se recupera un poco solo
  p.fatigue = Math.max(0, p.fatigue - 6);
  p.log.unshift({ day: p.day, t: t.name, q: Math.round(q * 100), up });
  p.log = p.log.slice(0, 12);
  saveProfile(p);
  return up;
}
export function afterRace(p, pos = 99) { const won = PRIZE[pos - 1] || 0; p.races++; p.tokens = trainsLeft(p) + won; p.fatigue = Math.min(100, p.fatigue + 35); saveProfile(p); return won; }

// ---------- Nivel de los bots: misma escala que tu atleta ----------
// Un atleta nivel 50 que hace bien las estaciones termina cerca del punto medio entre el mejor y la mediana del campo.
// Cada punto arriba de 50 equivale a lo que te dan las cualidades (nivel 100 ≈ 14 % más rápido).
export function ovrFor(dist, minutes) {
  const [best, med, worst] = dist, t50 = best + (med - best) * 0.5;
  const x = Math.log(t50 / minutes);
  const v = x >= 0 ? 50 + x * (50 / Math.log(1.14)) : 50 + x * (50 / Math.log(worst / t50));
  // sin comprimir: así un 70 de bot es lo mismo que un 70 tuyo. Los que pasan de 99 (élite) se muestran como 99+
  return Math.round(Math.max(1, v));   // valor real; se muestra 99+ solo al dibujarlo
}
// rango de niveles de un heat (el mismo cálculo con que se arma el heat en race.js)
export function heatRange(dist, level, scale = null) {
  const [best, med, worst] = dist;
  const r = level === 'amateur' ? [med * 0.88, worst * 0.92] : level === 'elite' ? [best, best + (med - best) * 0.45] : [best + (med - best) * 0.25, med * 1.05];
  return [ovrFor(scale || dist, r[1]), ovrFor(scale || dist, r[0])];
}

// multiplicador: 50 = normal (1.0)
const mul = (s, lo, hi) => s < 50 ? lo + (1 - lo) * (s / 50) : 1 + (hi - 1) * ((s - 50) / 50);
// efectos sobre un miembro del equipo en carrera
export function applyProfile(m, p) {
  const S = p.stats, tiredK = 1 - p.fatigue / 500;
  m.prof = {
    run: tiredK,                                    // la velocidad de carrera sale de tu nivel (race.js); aquí solo el cansancio
    drain: mul(S.motor, 1.18, 0.8),                 // gasto al correr
    regen: mul(S.recup, 0.8, 1.35),                 // recuperación
    tech: mul(S.tecnica, 1.25, 0.7),                // error de tiempo en ski/row (menos = mejor)
    grip: mul(S.agarre, 0.8, 1.35),                 // duración del agarre
    fit: mul(S.resis, 1.15, 0.85),                  // gasto en estaciones
  };
  const st = (s, lo, hi) => mul(s, lo, hi) * tiredK;
  m.pow = Object.assign(m.pow || {}, {
    ski: st((S.tecnica + S.motor) / 2, 0.87, 1.13), row: st((S.tecnica + S.motor) / 2, 0.87, 1.13),
    push: st(S.fuerza, 0.87, 1.13), pull: st(S.fuerza, 0.87, 1.13), lunges: st((S.fuerza + S.resis) / 2, 0.87, 1.13),
    bbj: st((S.resis + S.motor) / 2, 0.87, 1.13), wb: st(S.resis, 0.87, 1.13), farmers: st((S.agarre + S.fuerza) / 2, 0.87, 1.13),
  });
  m.energy = Math.round(100 - p.fatigue * 0.3);
}
