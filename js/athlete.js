// Atletas realistas (Microsoft Rocketbox, licencia MIT) con animación procedural:
// cada movimiento es una curva de ángulos por articulación, y la fase la maneja el juego.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';

const D = Math.PI / 180;
const ROOT = new URL('../', import.meta.url).href;
const MODELS = {
  M: { dir: ROOT + 'assets/atletas/Sports_Male_04/', file: 'Sports_Male_04.fbx', p: 'm026', h: 1.80 },
  F: { dir: ROOT + 'assets/atletas/Sports_Female_02/', file: 'Sports_Female_02.fbx', p: 'f013', h: 1.70 },
};
const base = {};           // modelo cargado por sexo
const texCache = {};

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const manager = new THREE.LoadingManager();
manager.setURLModifier(u => /\.fbx$/i.test(u) ? u : BLANK);

function loadTex(url, srgb, aniso) {
  if (texCache[url]) return texCache[url];
  const t = new THREE.TextureLoader().load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso || 4;
  return (texCache[url] = t);
}

// Colores de camiseta: se repinta la zona de la camiseta de la textura original.
const KITS = [
  null,                        // original (azul / blanco)
  [0.86, 0.13, 0.10],          // rojo
  [0.07, 0.07, 0.08],          // negro
  [0.95, 0.42, 0.05],          // naranja
  [0.10, 0.45, 0.22],          // verde
  [0.55, 0.56, 0.58],          // gris
  [0.92, 0.80, 0.10],          // amarillo
  [0.40, 0.12, 0.55],          // morado
  [0.05, 0.30, 0.65],          // azul fuerte
  [0.85, 0.85, 0.86],          // blanco
];
export const KIT_COUNT = KITS.length;

function kitTexture(sex, kit) {
  const m = MODELS[sex];
  const key = sex + '-kit-' + kit;
  if (texCache[key]) return texCache[key];
  const src = m.dir + m.p + '_body_color.jpg';
  if (!KITS[kit]) return loadTex(src, true);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    const g = canvas.getContext('2d'); g.drawImage(img, 0, 0, 1024, 1024);
    const d = g.getImageData(0, 0, 1024, 1024); const a = d.data;
    const [kr, kg, kb] = KITS[kit];
    for (let i = 0; i < a.length; i += 4) {
      const r = a[i] / 255, gg = a[i + 1] / 255, b = a[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
      let w = 0;
      if (sex === 'M') {             // camiseta azul: azul saturado
        if (b > r * 1.25 && b > gg * 1.05 && sat > 0.25) w = Math.min(1, (sat - 0.25) * 4);
      } else {                       // top gris claro: poco saturado y claro (piel es más saturada)
        if (sat < 0.10 && mx > 0.45) w = Math.min(1, (0.10 - sat) * 25) * Math.min(1, (mx - 0.45) * 6);
      }
      if (!w) continue;
      const lum = sex === 'M' ? Math.min(1, b * 1.25) : mx;     // conservar arrugas/sombras
      const k = kit === 9 ? 1 : 1.15;
      a[i] = 255 * (r * (1 - w) + Math.min(1, kr * lum * k) * w);
      a[i + 1] = 255 * (gg * (1 - w) + Math.min(1, kg * lum * k) * w);
      a[i + 2] = 255 * (b * (1 - w) + Math.min(1, kb * lum * k) * w);
    }
    g.putImageData(d, 0, 0); tex.needsUpdate = true;
  };
  img.src = src;
  return (texCache[key] = tex);
}

export function loadAthletes() {
  const L = new FBXLoader(manager);
  return Promise.all(Object.entries(MODELS).map(([sex, m]) => new Promise((res, rej) => {
    L.load(m.dir + m.file, o => {
      for (const c of [...o.children]) if (c.isLight) o.remove(c);
      base[sex] = o; res();
    }, undefined, rej);
  })));
}

// ---------- Curvas ----------
// Curva periódica Catmull-Rom: keys = [[fase, valor], ...] con fase en [0,1)
function curve(keys) {
  const n = keys.length;
  return p => {
    p = ((p % 1) + 1) % 1;
    let i = n - 1;
    for (let k = 0; k < n; k++) if (keys[k][0] > p) { i = k - 1; break; }
    if (i < 0) i = n - 1;
    const k0 = keys[(i - 1 + n) % n], k1 = keys[i], k2 = keys[(i + 1) % n], k3 = keys[(i + 2) % n];
    let t0 = k1[0], t1 = k2[0]; if (t1 <= t0) t1 += 1;
    let pp = p; if (pp < t0) pp += 1;
    const t = (pp - t0) / (t1 - t0);
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * k1[1]) + (-k0[1] + k2[1]) * t + (2 * k0[1] - 5 * k1[1] + 4 * k2[1] - k3[1]) * t2 + (-k0[1] + 3 * k1[1] - 3 * k2[1] + k3[1]) * t3);
  };
}
// Curva no periódica con suavizado (para movimientos de ida y vuelta)
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

// ---------- Poses ----------
// Una pose es un objeto de ángulos en grados (campos que faltan = 0).
// root: y (cm, altura extra), z (cm adelante), pitch (inclinar todo el cuerpo adelante), roll, yaw
// trunk: pitch (adelante), yaw, roll · neck, head: pitch
// hipL/hipR: flex (muslo adelante), abd (afuera), rot · knee: flex · ankle: flex (punta arriba)
// shL/shR: flex (brazo adelante/arriba), abd (0 = colgando, 90 = en cruz) · el: flex · grip 0-1
export function blendPose(a, b, t) {
  const o = {};
  for (const k in a) o[k] = lerp(a[k], b[k] ?? 0, t);
  for (const k in b) if (!(k in a)) o[k] = lerp(0, b[k], t);
  return o;
}
function seqPose(keys, p) {           // keys: [[fase, pose], ...] periódico
  const n = keys.length; p = ((p % 1) + 1) % 1;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] > p) { i = k - 1; break; }
  if (i < 0) i = n - 1;
  const a = keys[i], b = keys[(i + 1) % n];
  let t0 = a[0], t1 = b[0]; if (t1 <= t0) t1 += 1;
  let pp = p; if (pp < t0) pp += 1;
  return blendPose(a[1], b[1], smooth((pp - t0) / (t1 - t0)));
}

const STAND = { shLabd: 8, shRabd: 8, elL: 12, elR: 12, kneeL: 3, kneeR: 3, hipL: 2, hipR: 2 };

// --- Correr ---
const RUN = {
  hip: curve([[0, 28], [0.14, 10], [0.36, -18], [0.55, 6], [0.82, 42], [0.94, 33]]),
  knee: curve([[0, 16], [0.14, 38], [0.36, 18], [0.58, 105], [0.8, 60], [0.95, 14]]),
  ank: curve([[0, 4], [0.15, 18], [0.36, -28], [0.55, -5], [0.85, 8]]),
  bob: curve([[0, -1], [0.15, -3], [0.33, 2.5], [0.5, -1], [0.65, -3], [0.83, 2.5]]),
};
function runPose(p, speed = 1, fatigue = 0) {      // speed 0.6–1.4
  const a = 0.75 + 0.25 * speed, pr = p + 0.5;
  const sw = Math.sin(p * Math.PI * 2);
  return {
    rooty: RUN.bob(p) * (0.8 + 0.6 * speed), rootyaw: sw * 4,
    trunkpitch: 7 + 4 * speed + fatigue * 8, trunkyaw: -sw * 7, trunkroll: Math.sin(p * Math.PI * 4) * 1.5,
    headpitch: -6 - fatigue * 5,
    hipL: RUN.hip(p) * a, hipR: RUN.hip(pr) * a,
    kneeL: RUN.knee(p) * (0.7 + 0.3 * speed), kneeR: RUN.knee(pr) * (0.7 + 0.3 * speed),
    ankleL: RUN.ank(p), ankleR: RUN.ank(pr),
    hipLabd: 3, hipRabd: 3,
    shLflex: -sw * 38 * a, shRflex: sw * 38 * a, shLabd: 14, shRabd: 14,
    elL: 88 - sw * 18, elR: 88 + sw * 18, grip: 0.5,
  };
}
// --- Caminar ---
const WALK = {
  hip: curve([[0, 22], [0.25, 5], [0.5, -14], [0.65, -6], [0.85, 22]]),
  knee: curve([[0, 4], [0.12, 14], [0.4, 5], [0.62, 40], [0.75, 58], [0.92, 6]]),
  ank: curve([[0, 2], [0.2, 8], [0.55, -15], [0.7, 0], [0.9, 4]]),
};
function walkPose(p, load = 0) {   // load: 0 nada, 1 farmers carry
  const pr = p + 0.5, sw = Math.sin(p * Math.PI * 2);
  return {
    rooty: Math.cos(p * Math.PI * 4) * 1.2, rootyaw: sw * 3,
    trunkpitch: 3 - load * 2, trunkyaw: -sw * 4 * (1 - load * 0.8),
    hipL: WALK.hip(p), hipR: WALK.hip(pr), kneeL: WALK.knee(p), kneeR: WALK.knee(pr),
    ankleL: WALK.ank(p), ankleR: WALK.ank(pr),
    shLflex: load ? -2 : -sw * 18, shRflex: load ? -2 : sw * 18,
    shLabd: load ? 12 : 8, shRabd: load ? 12 : 8, elL: load ? 4 : 14, elR: load ? 4 : 14,
    grip: load ? 1 : 0.3, clav: load ? -6 : 0,
  };
}
// --- SkiErg: 0 = arriba, 0.45 = abajo ---
const SKI = [
  [0, { trunkpitch: -4, hipL: 0, hipR: 0, kneeL: 6, kneeR: 6, shLflex: 165, shRflex: 165, shLabd: 22, shRabd: 22, elL: 25, elR: 25, ankleL: -6, ankleR: -6, grip: 1, headpitch: -10 }],
  [0.2, { trunkpitch: 22, hipL: 22, hipR: 22, kneeL: 22, kneeR: 22, shLflex: 95, shRflex: 95, shLabd: 18, shRabd: 18, elL: 18, elR: 18, grip: 1 }],
  [0.42, { trunkpitch: 45, hipL: 62, hipR: 62, kneeL: 42, kneeR: 42, ankleL: 14, ankleR: 14, shLflex: -18, shRflex: -18, shLabd: 12, shRabd: 12, elL: 10, elR: 10, grip: 1, headpitch: 12 }],
  [0.7, { trunkpitch: 25, hipL: 30, hipR: 30, kneeL: 18, kneeR: 18, shLflex: 70, shRflex: 70, shLabd: 18, shRabd: 18, elL: 60, elR: 60, grip: 1 }],
];
// --- Remo: 0 = catch (adelante), 0.35 = final del jalón ---
const ROW = [
  [0, { rootpitch: 28, hipL: 120, hipR: 120, kneeL: 128, kneeR: 128, ankleL: 22, ankleR: 22, shLflex: 82, shRflex: 82, shLabd: 10, shRabd: 10, elL: 4, elR: 4, grip: 1, headpitch: -25 }],
  [0.13, { rootpitch: 18, hipL: 100, hipR: 100, kneeL: 70, kneeR: 70, ankleL: 0, ankleR: 0, shLflex: 72, shRflex: 72, shLabd: 10, shRabd: 10, elL: 6, elR: 6, grip: 1, headpitch: -16 }],
  [0.35, { rootpitch: -20, hipL: 98, hipR: 98, kneeL: 4, kneeR: 4, ankleL: -20, ankleR: -20, shLflex: -38, shRflex: -38, shLabd: 22, shRabd: 22, elL: 118, elR: 118, grip: 1, headpitch: 12 }],
  [0.55, { rootpitch: -14, hipL: 96, hipR: 96, kneeL: 4, kneeR: 4, ankleL: -20, ankleR: -20, shLflex: 55, shRflex: 55, shLabd: 10, shRabd: 10, elL: 6, elR: 6, grip: 1, headpitch: 6 }],
  [0.75, { rootpitch: 22, hipL: 108, hipR: 108, kneeL: 40, kneeR: 40, ankleL: -6, ankleR: -6, shLflex: 75, shRflex: 75, shLabd: 10, shRabd: 10, elL: 4, elR: 4, grip: 1, headpitch: -18 }],
];
// --- Sled push: cuerpo inclinado, brazos estirados al trineo ---
function pushPose(p, effort = 1) {
  const pr = p + 0.5, sw = Math.sin(p * Math.PI * 2);
  const hip = curve([[0, 72], [0.4, 18], [0.6, 30], [0.85, 85]]);
  const knee = curve([[0, 62], [0.35, 32], [0.5, 22], [0.7, 85], [0.9, 80]]);
  const ank = curve([[0, 22], [0.4, -18], [0.6, 0], [0.85, 15]]);
  return {
    rootpitch: 48 + effort * 6, rooty: -18 - effort * 4 + Math.cos(p * Math.PI * 4) * 1.5, rootyaw: sw * 2,
    trunkpitch: 8, headpitch: -38,
    hipL: hip(p), hipR: hip(pr), kneeL: knee(p), kneeR: knee(pr), ankleL: ank(p), ankleR: ank(pr),
    shLflex: 72, shRflex: 72, shLabd: 18, shRabd: 18, elL: 35 + sw * 6, elR: 35 - sw * 6, grip: 1,
  };
}
// --- Sled pull: mano sobre mano, de pie y echado atrás ---
function pullPose(p) {      // p: 0..1 un ciclo de dos manos
  const s = Math.sin(p * Math.PI * 2);
  return {
    rootpitch: -12, rooty: -10, trunkpitch: 4, headpitch: 6,
    hipL: 38, hipR: 14, kneeL: 38, kneeR: 12, ankleL: 16, ankleR: -2, hipLabd: 8, hipRabd: 10,
    shLflex: 60 + s * 35, shRflex: 60 - s * 35, shLabd: 14, shRabd: 14,
    elL: 40 - s * 35, elR: 40 + s * 35, trunkyaw: s * 8, grip: 1,
  };
}
// --- Burpee broad jump: 0 de pie → 0.25 manos al piso → 0.4 pecho al piso → 0.6 arriba → 0.8 salto → 1 aterriza ---
const BURPEE = [
  [0, { ...STAND }],
  [0.14, { rootpitch: 10, rooty: -45, trunkpitch: 55, hipL: 120, hipR: 120, kneeL: 125, kneeR: 125, ankleL: 30, ankleR: 30, shLflex: 70, shRflex: 70, shLabd: 18, shRabd: 18, elL: 10, elR: 10, headpitch: -20 }],
  [0.28, { rootpitch: 82, rooty: -88, trunkpitch: 4, hipL: 4, hipR: 4, kneeL: 2, kneeR: 2, ankleL: -40, ankleR: -40, shLflex: 72, shRflex: 72, shLabd: 42, shRabd: 42, elL: 70, elR: 70, headpitch: -50 }],
  [0.4, { rootpitch: 90, rooty: -96, trunkpitch: 0, hipL: 0, hipR: 0, kneeL: 0, kneeR: 0, ankleL: -45, ankleR: -45, shLflex: 60, shRflex: 60, shLabd: 55, shRabd: 55, elL: 100, elR: 100, headpitch: -55 }],
  [0.55, { rootpitch: 14, rooty: -50, trunkpitch: 50, hipL: 118, hipR: 118, kneeL: 120, kneeR: 120, ankleL: 30, ankleR: 30, shLflex: 50, shRflex: 50, shLabd: 18, shRabd: 18, elL: 20, elR: 20, headpitch: -15 }],
  [0.66, { rootpitch: 10, rooty: -34, trunkpitch: 40, hipL: 95, hipR: 95, kneeL: 95, kneeR: 95, ankleL: 25, ankleR: 25, shLflex: -45, shRflex: -45, shLabd: 12, shRabd: 12, elL: 10, elR: 10 }],
  [0.78, { rootpitch: -2, rooty: 12, trunkpitch: 6, hipL: -4, hipR: -4, kneeL: 4, kneeR: 4, ankleL: -40, ankleR: -40, shLflex: 150, shRflex: 150, shLabd: 18, shRabd: 18, elL: 8, elR: 8 }],
  [0.9, { rootpitch: 6, rooty: 8, trunkpitch: 18, hipL: 70, hipR: 70, kneeL: 60, kneeR: 60, ankleL: 10, ankleR: 10, shLflex: 60, shRflex: 60, shLabd: 18, shRabd: 18, elL: 20, elR: 20 }],
];
// --- Zancada con saco: p 0..1 = una zancada por pierna (dos en el ciclo) ---
function lungePose(p) {
  const half = p < 0.5, t = (p % 0.5) / 0.5;                 // t: 0 de pie, 0.5 rodilla al piso, 1 de pie
  const d = Math.sin(t * Math.PI);                            // profundidad 0..1
  const front = half ? 'L' : 'R', back = half ? 'R' : 'L';
  const o = {
    rooty: -d * 46, trunkpitch: 4 + d * 4, headpitch: -4,
    shLflex: 40, shRflex: 40, shLabd: 62, shRabd: 62, elL: 135, elR: 135, grip: 1,   // manos en el saco
  };
  o['hip' + front] = 8 + d * 82; o['knee' + front] = 6 + d * 86; o['ankle' + front] = d * 18;
  o['hip' + back] = -6 - d * 14; o['knee' + back] = 8 + d * 84; o['ankle' + back] = -d * 38;
  return o;
}
// --- Wall ball: 0 de pie con balón al pecho → 0.35 sentadilla → 0.6 lanzar (brazos arriba) → 1 recibir ---
const WALLBALL = [
  [0, { trunkpitch: 2, hipL: 4, hipR: 4, kneeL: 6, kneeR: 6, shLflex: 38, shRflex: 38, shLabd: 26, shRabd: 26, elL: 128, elR: 128, headpitch: -12, grip: 0.6 }],
  [0.33, { rooty: -50, trunkpitch: 28, hipL: 108, hipR: 108, kneeL: 118, kneeR: 118, ankleL: 30, ankleR: 30, hipLabd: 14, hipRabd: 14, shLflex: 48, shRflex: 48, shLabd: 28, shRabd: 28, elL: 130, elR: 130, headpitch: -20, grip: 0.6 }],
  [0.5, { rooty: -6, trunkpitch: 2, hipL: 10, hipR: 10, kneeL: 10, kneeR: 10, ankleL: -10, ankleR: -10, shLflex: 110, shRflex: 110, shLabd: 26, shRabd: 26, elL: 80, elR: 80, headpitch: -28, grip: 0.6 }],
  [0.62, { rooty: 2, trunkpitch: -2, hipL: 0, hipR: 0, kneeL: 2, kneeR: 2, ankleL: -24, ankleR: -24, shLflex: 165, shRflex: 165, shLabd: 22, shRabd: 22, elL: 10, elR: 10, headpitch: -32, grip: 0.2 }],
  [0.85, { trunkpitch: 2, hipL: 4, hipR: 4, kneeL: 8, kneeR: 8, shLflex: 120, shRflex: 120, shLabd: 24, shRabd: 24, elL: 45, elR: 45, headpitch: -30, grip: 0.5 }],
];
// --- Descanso: manos en las rodillas ---
const REST = { trunkpitch: 45, hipL: 45, hipR: 45, kneeL: 25, kneeR: 25, ankleL: 10, ankleR: 10, hipLabd: 8, hipRabd: 8, shLflex: 38, shRflex: 38, shLabd: 18, shRabd: 18, elL: 15, elR: 15, headpitch: -15, grip: 0.2 };
const CHEER = { trunkpitch: -6, shLflex: 165, shRflex: 165, shLabd: 30, shRabd: 30, elL: 15, elR: 15, headpitch: -15, grip: 0.9 };
const CROUCH = { rooty: -42, trunkpitch: 28, hipL: 100, hipR: 100, kneeL: 110, kneeR: 110, ankleL: 25, ankleR: 25, shLflex: 30, shRflex: 30, shLabd: 12, shRabd: 12, elL: 8, elR: 8, grip: 1 };

export const ACTIONS = {
  stand: () => STAND,
  rest: () => REST,
  cheer: () => CHEER,
  crouch: () => CROUCH,
  run: (p, o) => runPose(p, o.speed ?? 1, o.fatigue ?? 0),
  walk: (p, o) => walkPose(p, o.load ?? 0),
  ski: p => seqPose(SKI, p),
  row: p => seqPose(ROW, p),
  push: (p, o) => pushPose(p, o.effort ?? 1),
  pull: p => pullPose(p),
  burpee: p => seqPose(BURPEE, p),
  lunge: p => lungePose(p),
  wallball: p => seqPose(WALLBALL, p),
};

// ---------- Rig ----------
const BN = {
  root: 'Bip01', pelvis: 'Bip01_Pelvis', sp1: 'Bip01_Spine1', sp2: 'Bip01_Spine2', neck: 'Bip01_Neck', head: 'Bip01_Head',
  thL: 'Bip01_L_Thigh', thR: 'Bip01_R_Thigh', caL: 'Bip01_L_Calf', caR: 'Bip01_R_Calf', ftL: 'Bip01_L_Foot', ftR: 'Bip01_R_Foot',
  toL: 'Bip01_L_Toe0', toR: 'Bip01_R_Toe0',
  clL: 'Bip01_L_Clavicle', clR: 'Bip01_R_Clavicle', uaL: 'Bip01_L_UpperArm', uaR: 'Bip01_R_UpperArm',
  faL: 'Bip01_L_Forearm', faR: 'Bip01_R_Forearm', hdL: 'Bip01_L_Hand', hdR: 'Bip01_R_Hand',
};
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Athlete {
  constructor(sex = 'M', kit = 0) {
    this.sex = sex;
    const src = base[sex];
    this.model = skClone(src);
    const m = MODELS[sex];
    this.model.scale.setScalar(0.01);
    this.group = new THREE.Group();
    this.group.add(this.model);
    const body = kitTexture(sex, kit);
    const bn = loadTex(m.dir + m.p + '_body_normal.jpg', false);
    const hc = loadTex(m.dir + m.p + '_head_color.jpg', true), hn = loadTex(m.dir + m.p + '_head_normal.jpg', false);
    this.model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      const mats = [].concat(o.material).map(x => {
        if (/opacity/.test(x.name)) return new THREE.MeshStandardMaterial({ map: loadTex(m.dir + m.p + '_opacity_color.png', true), alphaTest: 0.45, transparent: false, roughness: 0.7, side: THREE.DoubleSide });
        if (/head/.test(x.name)) return new THREE.MeshStandardMaterial({ map: hc, normalMap: hn, roughness: 0.52, metalness: 0 });
        return new THREE.MeshStandardMaterial({ map: body, normalMap: bn, roughness: 0.72, metalness: 0 });
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
      this.mats = (this.mats || []).concat(mats);
    });
    // huesos
    this.b = {};
    this.model.traverse(o => { if (o.isBone) for (const k in BN) if (o.name === BN[k]) this.b[k] = o; });
    this.fingers = { L: [], R: [] };
    this.model.traverse(o => { if (o.isBone && /Finger/.test(o.name)) this.fingers[/_L_/.test(o.name) ? 'L' : 'R'].push(o); });
    // pose de reposo: local + mundo (en espacio del personaje)
    this.model.updateMatrixWorld(true);
    const inv = new THREE.Quaternion().copy(this.model.getWorldQuaternion(new THREE.Quaternion())).invert();
    this.bind = new Map();
    this.model.traverse(o => {
      if (!o.isBone) return;
      const w = o.getWorldQuaternion(new THREE.Quaternion()).premultiply(inv);
      this.bind.set(o, { L: o.quaternion.clone(), W: w, Wi: w.clone().invert(), P: o.position.clone() });
    });
    // eje de bisagra del codo (perpendicular al brazo y hacia adelante)
    const dir = (a, b) => b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize();
    this.elAxL = new THREE.Vector3().crossVectors(dir(this.b.faL, this.b.hdL), Z).normalize();
    this.elAxR = new THREE.Vector3().crossVectors(dir(this.b.faR, this.b.hdR), Z).normalize();
    this.armBindL = Math.acos(-dir(this.b.uaL, this.b.faL).y) / D;   // ~44°
    this.armBindR = Math.acos(-dir(this.b.uaR, this.b.faR).y) / D;
    this.rootY0 = this.bind.get(this.b.root).P.y;
    this.phase = 0; this.action = 'stand'; this.opts = {};
    this.pose = { ...STAND };
    this.blend = null;
    this.ground = true;
    this.apply(this.pose);
  }
  // rotación R (espacio del personaje) aplicada a un hueso en su marco de reposo
  rot(bone, R) {
    const k = this.bind.get(bone);
    _q.copy(k.Wi).multiply(R).multiply(k.W);
    bone.quaternion.copy(k.L).multiply(_q);
  }
  apply(P) {
    const g = k => (P[k] || 0) * D;
    const b = this.b;
    // tronco (Spine1 y Spine2; el Spine de Biped también mueve las piernas, no se toca)
    const tr = (f) => new THREE.Quaternion().setFromEuler(new THREE.Euler(g('trunkpitch') * f, g('trunkyaw') * f, -g('trunkroll') * f, 'YXZ'));
    this.rot(b.sp1, tr(0.5)); this.rot(b.sp2, tr(0.5));
    this.rot(b.neck, _q2.setFromAxisAngle(X, g('neckpitch')));
    this.rot(b.head, new THREE.Quaternion().setFromEuler(new THREE.Euler(g('headpitch'), g('headyaw'), 0, 'YXZ')));
    // piernas
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? 1 : -1;
      const hip = new THREE.Quaternion().setFromAxisAngle(X, -g('hip' + s))
        .multiply(_q2.setFromAxisAngle(Z, sg * g('hip' + s + 'abd')))
        .multiply(new THREE.Quaternion().setFromAxisAngle(Y, sg * g('hip' + s + 'rot')));
      this.rot(b['th' + s], hip);
      this.rot(b['ca' + s], _q2.setFromAxisAngle(X, g('knee' + s)));
      this.rot(b['ft' + s], _q2.setFromAxisAngle(X, -g('ankle' + s)));
      // brazos
      const abd = (P['sh' + s + 'abd'] ?? 8) - (s === 'L' ? this.armBindL : this.armBindR);
      const sh = new THREE.Quaternion().setFromAxisAngle(X, -g('sh' + s + 'flex'))
        .multiply(_q2.setFromAxisAngle(Z, sg * abd * D));
      this.rot(b['ua' + s], sh);
      this.rot(b['cl' + s], _q2.setFromAxisAngle(Z, -sg * g('clav')));
      const ax = s === 'L' ? this.elAxL : this.elAxR;
      this.rot(b['fa' + s], _q2.setFromAxisAngle(ax, (P['el' + s] || 0) * D));
    }
    // dedos
    const grip = P.grip ?? 0.3;
    for (const s of ['L', 'R']) for (const f of this.fingers[s]) {
      const k = this.bind.get(f);
      const thumb = /Finger0/.test(f.name);
      f.quaternion.copy(k.L).multiply(_q2.setFromAxisAngle(Z, (s === 'L' ? -1 : -1) * grip * (thumb ? 0.35 : 1.15)));
    }
    // raíz
    const r = b.root, k = this.bind.get(r);
    r.position.copy(k.P);
    r.position.y += (P.rooty || 0); r.position.z += (P.rootz || 0);
    const rr = new THREE.Quaternion().setFromEuler(new THREE.Euler(g('rootpitch'), g('rootyaw'), -g('rootroll'), 'YXZ'));
    r.quaternion.copy(rr).multiply(k.L);
  }
  set(action, phase = 0, opts = {}) {
    if (action !== this.action) {
      this.blend = { from: { ...this.pose }, t: 0, dur: opts.blend ?? 0.25 };
      this.action = action;
    }
    this.phase = phase; this.opts = opts;
  }
  update(dt) {
    let P = ACTIONS[this.action](this.phase, this.opts);
    if (this.blend) {
      this.blend.t += dt / this.blend.dur;
      if (this.blend.t >= 1) this.blend = null;
      else P = blendPose(this.blend.from, P, smooth(this.blend.t));
    }
    this.pose = P;
    this.apply(P);
    if (this.opts.ground !== false && this.ground) this.plant();
  }
  // apoyar en el piso: el punto más bajo (pies, manos o pecho) toca y = 0
  plant() {
    this.model.position.y = 0;
    this.group.updateMatrixWorld(true);
    const gy = this.group.getWorldPosition(_v2).y;
    let min = Infinity;
    for (const k of ['toL', 'toR', 'ftL', 'ftR', 'hdL', 'hdR', 'sp2', 'head', 'caL', 'caR']) {
      this.b[k].getWorldPosition(_v);
      let y = _v.y - gy;
      if (k === 'ftL' || k === 'ftR') y -= 0.075;           // tobillo → suela
      else if (k === 'toL' || k === 'toR') y -= 0.015;
      else if (k === 'sp2') y -= 0.13;                      // pecho
      else if (k === 'head') y -= 0.1;
      else if (k === 'caL' || k === 'caR') y -= 0.06;       // rodilla
      else y -= 0.03;
      if (y < min) min = y;
    }
    this.model.position.y = -min;
  }
  handPos(s, out = new THREE.Vector3()) { return this.b['hd' + s].localToWorld(out.set(9, -1.5, 0)); }
  bonePos(k, out = new THREE.Vector3()) { return this.b[k].getWorldPosition(out); }
}
