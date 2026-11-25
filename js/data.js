// Datos de la competencia (reglamento oficial 2026/27; pesos iguales que en 2025/26).
// Fuentes: hyrox.com/rulebook (Singles, Doubles, Relay) · ver docs/REGLAS.md

export const STATIONS = [
  { id: 'ski', name: 'SkiErg', dist: 1000, unit: 'm', short: 'SKI' },
  { id: 'push', name: 'Sled Push', dist: 50, unit: 'm', short: 'PUSH', lanes: 4 },
  { id: 'pull', name: 'Sled Pull', dist: 50, unit: 'm', short: 'PULL', lanes: 4 },
  { id: 'bbj', name: 'Burpee Broad Jump', dist: 80, unit: 'm', short: 'BBJ' },
  { id: 'row', name: 'Row', dist: 1000, unit: 'm', short: 'ROW' },
  { id: 'farmers', name: 'Farmers Carry', dist: 200, unit: 'm', short: 'FARM' },
  { id: 'lunges', name: 'Sandbag Lunges', dist: 100, unit: 'm', short: 'LUNG' },
  { id: 'wb', name: 'Wall Balls', dist: 100, unit: 'reps', short: 'WB' },
];

// Pesos por perfil (kg). push/pull incluyen el trineo. farmers = cada pesa.
export const LOADS = {
  WO: { push: 102, pull: 78, farmers: 16, sandbag: 10, ball: 4, target: 2.70, label: 'Women Open' },
  MO: { push: 152, pull: 103, farmers: 24, sandbag: 20, ball: 6, target: 3.00, label: 'Men Open' },
  WP: { push: 152, pull: 103, farmers: 24, sandbag: 20, ball: 6, target: 2.70, label: 'Women Pro' },
  MP: { push: 202, pull: 153, farmers: 32, sandbag: 30, ball: 9, target: 3.00, label: 'Men Pro' },
  MIX: { push: 152, pull: 103, farmers: 24, sandbag: 20, ball: 6, target: null, label: 'Mixed (Men Open)' },
};

// Divisiones. team: tamaño del equipo. sexes: sexo de cada atleta. load(i): perfil de pesos del atleta i.
export const FORMATS = {
  singles: { name: 'Singles', team: 1, desc: 'Tú solo. 8 km y 8 estaciones.' },
  doubles: { name: 'Doubles', team: 2, desc: 'Corren juntos los 8 km; las estaciones se reparten (You Go / I Go).' },
  relay: { name: 'Relay', team: 4, desc: 'Equipo de 4: cada uno hace 2 × (1 km + estación).' },
};

export function division(format, cat, level) {
  // cat: 'W' | 'M' | 'X' (mixto) · level: 'open' | 'pro' | 'elite'
  const f = FORMATS[format];
  const pro = level !== 'open';
  let sexes, loads, name;
  if (format === 'singles') {
    sexes = [cat === 'W' ? 'F' : 'M'];
    loads = [cat === 'W' ? (pro ? 'WP' : 'WO') : (pro ? 'MP' : 'MO')];
  } else if (format === 'doubles') {
    if (cat === 'X') { sexes = ['M', 'F']; loads = ['MIX', 'MIX']; }
    else { const k = cat === 'W' ? (pro ? 'WP' : 'WO') : (pro ? 'MP' : 'MO'); sexes = [cat === 'W' ? 'F' : 'M', cat === 'W' ? 'F' : 'M']; loads = [k, k]; }
  } else {
    // Relay: solo pesos Open; en mixto cada atleta con los de su sexo (2 mujeres y 2 hombres)
    if (cat === 'X') { sexes = ['F', 'M', 'F', 'M']; loads = ['WO', 'MO', 'WO', 'MO']; }
    else { sexes = Array(4).fill(cat === 'W' ? 'F' : 'M'); loads = Array(4).fill(cat === 'W' ? 'WO' : 'MO'); }
  }
  const catName = cat === 'W' ? 'Women' : cat === 'M' ? 'Men' : 'Mixed';
  const lvName = level === 'elite' ? 'Elite 15' : pro ? 'Pro' : '';
  if (format === 'singles') name = level === 'elite' ? `Elite 15 ${catName}` : `${catName} ${pro ? 'Pro' : 'Open'}`;
  else if (format === 'doubles') name = `${f.name} ${catName}${pro ? ' Pro' : ''}`;
  else name = `Relay ${catName}`;
  return { format, cat, level, sexes, loads: loads.map(k => ({ ...LOADS[k], key: k })), name, team: f.team, pro, elite: level === 'elite' };
}

// Combinaciones que existen en el reglamento 26/27
export function validDivision(format, cat, level) {
  if (format === 'relay') return level === 'open';
  if (format === 'doubles') return !(cat === 'X' && level !== 'open') && level !== 'elite';
  return !(cat === 'X');
}

// ---------- Tiempos de referencia (segundos reales de carrera) ----------
// Élite (B) y promedio (D) de hombres y mujeres (Roxlyfe / HyroxDataLab). run = promedio por km.
export const SPLITS = {
  M: {
    elite: { run: 231, ski: 227, push: 165, pull: 194, bbj: 141, row: 238, farmers: 97, lunges: 183, wb: 265, rox: 174 },
    avg: { run: 318, ski: 257, push: 220, pull: 391, bbj: 315, row: 275, farmers: 152, lunges: 322, wb: 458, rox: 418 },
  },
  F: {
    elite: { run: 258, ski: 252, push: 180, pull: 234, bbj: 191, row: 269, farmers: 117, lunges: 215, wb: 230, rox: 227 },
    avg: { run: 331, ski: 291, push: 228, pull: 396, bbj: 293, row: 312, farmers: 165, lunges: 325, wb: 380, rox: 372 },
  },
};
// Récords (fuentes: Red Bull, Roxlyfe, Hyranking — no hay lista oficial)
// Mejores tiempos de la historia según los resultados oficiales de HYROX (actualizado nov. 2026)
export const RECORDS = {
  'Men Open': ['50:38', 'Alexander Rončević · Colonia, abr. 2024'],
  'Women Open': ['55:38', 'Lauren Weeks · Washington D.C., mar. 2025'],
  'Men Pro': ['51:59', 'Alexander Rončević · Varsovia, abr. 2026'],
  'Women Pro': ['54:25', 'Joanna Wietrzyk · Varsovia, abr. 2026'],
  'Doubles Men': ['47:57', 'Jake Williamson / Fabian Eisenlauer · Berlín, may. 2025'],
  'Doubles Women': ['53:21', 'Meg Martin / Calypso Sheridan · Brisbane, abr. 2026'],
  'Doubles Mixed': ['49:13', 'Cole Learn / Mollie Fkiaras · Melbourne, dic. 2025'],
  'Doubles Men Pro': ['47:40', 'Tim Wenisch / Alexander Rončević · Londres, mar. 2026'],
  'Doubles Women Pro': ['52:11', 'Lauren Weeks / Vivian Tafuto · Varsovia, abr. 2026'],
  'Relay Men': ['45:43', 'Woods / Olsen / Røssland / White · Londres, dic. 2025'],
  'Relay Women': ['51:26', 'Hill / Stockley / Geddes / Falconer · Londres, dic. 2025'],
  'Relay Mixed': ['46:47', 'Ifversen / Bent / Wietrzyk / Botterill · Varsovia, abr. 2026'],
};

// Distribución de tiempos finales del campo (minutos): [mejor, mediana, peor]
export function fieldDistribution(div) {
  const { format, cat, pro, elite } = div;
  if (elite) return cat === 'W' ? [55, 62, 70] : [52, 58, 64];
  if (format === 'singles') {
    if (cat === 'M') return pro ? [55, 74, 100] : [58, 86, 125];
    return pro ? [60, 82, 108] : [62, 96, 135];
  }
  if (format === 'doubles') {
    if (cat === 'M') return pro ? [50, 68, 92] : [50, 79, 112];
    if (cat === 'W') return pro ? [54, 76, 100] : [55, 92, 125];
    return [50, 85, 118];
  }
  return cat === 'M' ? [46, 70, 98] : cat === 'W' ? [52, 80, 108] : [48, 75, 104];
}

// ---------- Fantasma: papá (HYROX Tampa, 24-oct-2026, Men Open, 1:33:20) ----------
// Datos sacados de su video (~/hyrox-papa). Run 5 y 8 no se ven en el video: se estiman.
export const PAPA = {
  name: 'Papá', where: 'Tampa · 24 oct 2026', total: 5600, div: 'Men Open',
  // [run1, ski, run2, push, run3, pull, run4, bbj, run5, row, run6, farmers, run7, lunges, run8, wb]
  seg: [311, 299, 318, 211, 328, 310, 332, 334, 330, 300, 340, 160, 422, 319, 330, 407],
};
PAPA.rox = (PAPA.total - PAPA.seg.reduce((a, b) => a + b, 0)) / 16;

// Nombres de rivales (inventados)
export const NAMES = {
  M: ['Mateo R.', 'Diego S.', 'Lucas M.', 'Andrés P.', 'Tomás V.', 'Sebastián G.', 'Nico F.', 'Javier L.', 'Rafa D.', 'Emilio C.', 'Bruno T.', 'Iván K.', 'Pablo O.', 'Leo B.', 'Hugo A.', 'Marcos E.', 'Daniel W.', 'Felipe N.', 'Óscar J.', 'Gael H.'],
  F: ['Valentina R.', 'Camila S.', 'Sofía M.', 'Lucía P.', 'Isabella V.', 'Martina G.', 'Daniela F.', 'Paula L.', 'Elena D.', 'Carla C.', 'Ana T.', 'Julia K.', 'Renata O.', 'Mía B.', 'Sara A.', 'Inés E.', 'Laura W.', 'Clara N.', 'Noa J.', 'Abril H.'],
};
export const COUNTRIES = ['PAN', 'MEX', 'COL', 'ESP', 'ARG', 'USA', 'GBR', 'GER', 'CHI', 'PER', 'BRA', 'CRC', 'POL', 'AUS', 'NED', 'ITA'];

// Penalizaciones (reglamento)
export const PENALTY = {
  missedLap: 7 * 60,      // circuito de 2 vueltas por km: 7 min por vuelta que falta
  wrongArch: 2 * 60,      // entrar por OUT o salir por IN
  noRep: 15,              // desde la 2.ª falta en estaciones 1–7
  doublesSplit: 60,       // dobles separados (> 10 s)
  bagDrop: 15,            // saco caído (26/27: 15 s cada vez)
  kbBox: 30,              // pesas fuera de la caja / asas mal
};

export const LAPS_PER_KM = 2;

export function fmt(t, dec = false) {
  if (!isFinite(t)) return '--:--';
  t = Math.max(0, t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const d = dec ? '.' + Math.floor((t * 10) % 10) : '';
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0') + d;
}
export function fmtPace(secPerKm) { return fmt(secPerKm) + '/km'; }
