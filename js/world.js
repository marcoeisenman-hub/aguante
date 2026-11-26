// El pabellón: pista de 2 vueltas por km alrededor de las 8 estaciones, Roxzone, público y pantallas.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { initMaterials, MAT, skiErg, rower, sled, kettlebell, sandbag, wallBall, wbTarget, arch } from './equipment.js';
import { STATIONS } from './data.js';

const ROOT = new URL('../', import.meta.url).href;
export const ACCENT = '#ffe500';
export const TRACK = { L: 26, R: 16, W: 5 };          // rectas de 52 m, curvas de radio 16, ancho 5 m
TRACK.P = 4 * TRACK.L + 2 * Math.PI * TRACK.R;        // ≈ 204.5 m por vuelta
export const LANES = 8;
const TL = new THREE.TextureLoader();

function tex(name, srgb, rep = 1) {
  const t = TL.load(ROOT + 'assets/tex/' + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// ---------- Geometría de la pista ----------
// s = 0 en el vértice oeste (x = -L-R, z = 0); se corre hacia +z por la curva oeste, luego la recta sur hacia +x…
export function trackPos(s, lat = 0, out = new THREE.Vector3()) {
  const { L, R, P } = TRACK;
  s = ((s % P) + P) % P;
  const q = Math.PI * R / 2;                  // cuarto de curva
  let x, z, a;
  if (s < q) { a = Math.PI + s / R; x = -L + Math.cos(a) * (R + lat); z = -Math.sin(a) * (R + lat); }
  else if (s < q + 2 * L) { const d = s - q; x = -L + d; z = R + lat; }
  else if (s < 3 * q + 2 * L) { const d = s - q - 2 * L; a = Math.PI / 2 - d / R; x = L + Math.cos(a) * (R + lat); z = Math.sin(a) * (R + lat); }
  else if (s < 3 * q + 4 * L) { const d = s - 3 * q - 2 * L; x = L - d; z = -(R + lat); }
  else { const d = s - 3 * q - 4 * L; a = -Math.PI / 2 - d / R; x = -L + Math.cos(a) * (R + lat); z = Math.sin(a) * (R + lat); }
  return out.set(x, 0, z);
}
export function trackDir(s, out = new THREE.Vector3()) {
  const a = trackPos(s - 0.25), b = trackPos(s + 0.25);
  return out.subVectors(b, a).normalize();
}

// Estaciones: lado norte (z < 0) ski, push, pull, bbj · lado sur (z > 0) row, farmers, lunges, wb
// Cada carril: start (donde empieza el atleta), dir (hacia dónde avanza), len (largo visual)
export const ST = {
  ski: { x0: -35, x1: -25, side: -1, kind: 'machine' },
  push: { x0: -23, x1: -9.5, side: -1, kind: 'lane', len: 12.5 },
  pull: { x0: -7.5, x1: 6, side: -1, kind: 'lane', len: 12.5 },
  bbj: { x0: 9, x1: 31, side: -1, kind: 'lane', len: 20 },
  row: { x0: -35, x1: -25, side: 1, kind: 'machine' },
  farmers: { x0: -22, x1: -1, side: 1, kind: 'lane', len: 20 },
  lunges: { x0: 1.5, x1: 22, side: 1, kind: 'lane', len: 20 },
  wb: { x0: 23.5, x1: 33.5, side: 1, kind: 'machine' },
};
export const ROX = { inX: -39, z: 2.6, finishX: 37.5 };      // arcos IN (z<0) y OUT (z>0) al oeste
export const LAP_MAT_S = 0;
export const IN_S = TRACK.P - 4.5;                             // dónde se entra a la Roxzone (antes del vértice)
export const OUT_S = 4.5;

export function laneOf(id, j) {           // posición y dirección del carril j (0..7)
  const st = ST[id], side = st.side;
  if (id === 'ski') return { pos: new THREE.Vector3(st.x0 + 0.6 + j * 1.25, 0, side * 7.4), face: new THREE.Vector3(0, 0, side) };
  if (id === 'row') return { pos: new THREE.Vector3(st.x0 + 0.6 + j * 1.25, 0, side * 5.6), face: new THREE.Vector3(0, 0, -side) };
  if (id === 'wb') return { pos: new THREE.Vector3(st.x0 + 0.6 + j * 1.25, 0, side * 9.2), face: new THREE.Vector3(0, 0, side) };
  const z = side * (4.3 + j * 1.2);
  const x = st.x0 + (st.x1 - st.x0 - st.len) / 2;
  return { pos: new THREE.Vector3(x, 0, z), dir: new THREE.Vector3(1, 0, 0), len: st.len };
}

export class World {
  constructor(renderer, quality = 2) {
    this.r = renderer; this.q = quality;
    const s = this.scene = new THREE.Scene();
    s.background = new THREE.Color(0x07080a);
    s.fog = new THREE.FogExp2(0x0b0c0f, 0.0085);
    this.t = {
      concrete: tex('smooth_concrete_floor_diffuse.jpg', true, 18), concreteN: tex('smooth_concrete_floor_nor_gl.jpg', false, 18), concreteR: tex('smooth_concrete_floor_rough.jpg', false, 18),
      rubber: tex('rubber_tiles_diffuse.jpg', true, 1), rubberN: tex('rubber_tiles_nor_gl.jpg', false, 1), rubberR: tex('rubber_tiles_rough.jpg', false, 1),
      carpet: tex('dirty_carpet_diffuse.jpg', true, 1), carpetN: tex('dirty_carpet_nor_gl.jpg', false, 1),
      metal: tex('metal_plate_diffuse.jpg', true, 1), metalN: tex('metal_plate_nor_gl.jpg', false, 1),
    };
    initMaterials(this.t);
    this.lights();
    this.floor();
    this.track();
    this.stationsBuild();
    this.roxzone();
    this.hall();
    this.crowd();
    this.screens();
    this.anim = [];
  }
  env() {
    return new Promise(res => {
      new HDRLoader().load(ROOT + 'assets/tex/hangar_interior_1k.hdr', h => {
        h.mapping = THREE.EquirectangularReflectionMapping;
        const pm = new THREE.PMREMGenerator(this.r);
        this.scene.environment = pm.fromEquirectangular(h).texture;
        this.scene.environmentIntensity = 0.32;
        h.dispose(); pm.dispose(); res();
      }, undefined, () => res());
    });
  }
  lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xbfc8d6, 0x1a1712, 0.55));
    const key = this.key = new THREE.DirectionalLight(0xfff4e6, 2.4);
    key.position.set(-8, 30, 10); key.castShadow = true;
    const sc = key.shadow.camera; sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 70;
    key.shadow.mapSize.set(this.q >= 2 ? 2048 : 1024, this.q >= 2 ? 2048 : 1024); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03;
    s.add(key); s.add(key.target);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.5); fill.position.set(20, 18, -25); s.add(fill);
    // focos de color del show sobre la pista
    this.spots = [];
    const cols = [0xffffff, 0xffd7b0, 0xffe36a, 0xffffff];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.SpotLight(cols[i], 60, 60, 0.28, 0.6, 1.4);
      sp.position.set(-30 + i * 20, 15, i % 2 ? 22 : -22); sp.target.position.set(-30 + i * 20, 0, i % 2 ? 16 : -16);
      s.add(sp); s.add(sp.target); this.spots.push(sp);
    }
  }
  floor() {
    const m = new THREE.MeshStandardMaterial({ map: this.t.concrete, normalMap: this.t.concreteN, roughnessMap: this.t.concreteR, color: 0x6c6e72, roughness: 0.9, metalness: 0.0, normalScale: new THREE.Vector2(0.6, 0.6), envMapIntensity: 1.4 });
    const f = new THREE.Mesh(new THREE.PlaneGeometry(130, 90), m);
    f.rotation.x = -Math.PI / 2; f.receiveShadow = true; this.scene.add(f);
    // piso de goma de gimnasio en el área de estaciones
    const rt = this.t.rubber.clone(); rt.repeat.set(36, 14); rt.needsUpdate = true;
    const rn = this.t.rubberN.clone(); rn.repeat.set(36, 14); rn.needsUpdate = true;
    const rr = this.t.rubberR.clone(); rr.repeat.set(36, 14); rr.needsUpdate = true;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(76, 27), new THREE.MeshStandardMaterial({ map: rt, normalMap: rn, roughnessMap: rr, color: 0x3a3b3f, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.position.y = 0.004; g.receiveShadow = true; this.scene.add(g);
  }
  track() {
    const { P, W } = TRACK;
    const N = 520, pos = [], uv = [], idx = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const s = i / N * P;
      trackPos(s, -W / 2, a); trackPos(s, W / 2, b);
      pos.push(a.x, 0.012, a.z, b.x, 0.012, b.z);
      uv.push(0, s / 2.5, 2, s / 2.5);
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // alfombra negra de carrera con líneas: textura de color con la línea del Fast Lane
    const ct = this.t.carpet.clone(); ct.needsUpdate = true;
    const lines = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#fff'; x.fillRect(0, 0, 6, h); x.fillRect(w - 6, 0, 6, h);
      x.fillStyle = '#ffe500'; for (let y = 0; y < h; y += 64) x.fillRect(w * 0.38 - 3, y, 6, 36);   // línea del Fast Lane (40 % interior)
    }, false);
    const m = new THREE.MeshStandardMaterial({ map: ct, normalMap: this.t.carpetN, color: 0x2c2d31, roughness: 0.95, emissiveMap: lines, emissive: 0xffffff, emissiveIntensity: 0.0 });
    m.onBeforeCompile = sh => {           // pintar líneas encima de la alfombra
      sh.uniforms.lineMap = { value: lines };
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec4 ln = texture2D(lineMap, vEmissiveMapUv * vec2(0.5, 1.0) );
        diffuseColor.rgb = mix(diffuseColor.rgb, ln.r > 0.5 && ln.g > 0.5 ? vec3(0.85) : vec3(1.0,0.35,0.12), max(ln.r, 0.0) * 0.92);`)
        .replace('#include <emissivemap_fragment>', '')
        .replace('uniform vec3 emissive;', 'uniform vec3 emissive; uniform sampler2D lineMap;');
    };
    const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; this.scene.add(mesh);
    // vallas acolchadas a los lados con publicidad
    this.boards();
    // alfombra de cronometraje (vuelta) en el vértice oeste
    const mat = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.02, 1.2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, emissive: 0xffe500, emissiveIntensity: 0.15 }));
    const p0 = trackPos(LAP_MAT_S); mat.position.set(p0.x, 0.02, p0.z); mat.rotation.y = 0; this.scene.add(mat);
    this.lapMat = mat;
  }
  boards() {
    const { P, W } = TRACK;
    const adTex = canvasTex(2048, 128, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#121316'); g.addColorStop(1, '#050506'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      const items = [['HYBRID.RACE', '#fff'], ['8 KM · 8 ESTACIONES', ACCENT], ['FITNESS RACING', '#fff'], ['ROXZONE', ACCENT]];
      x.font = '800 78px Barlow, Arial, sans-serif'; x.textBaseline = 'middle';
      let px = 40; for (let k = 0; k < 2; k++) for (const [t, c] of items) { x.fillStyle = c; x.fillText(t, px, h / 2 + 4); px += x.measureText(t).width + 90; }
      x.fillStyle = ACCENT; x.fillRect(0, h - 6, w, 6);
    });
    const m = new THREE.MeshStandardMaterial({ map: adTex, emissiveMap: adTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6 });
    const pad = new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.8 });
    for (const lat of [-W / 2 - 0.15, W / 2 + 0.15]) {
      const N = 260, pos = [], uv = [], idx = [];
      const a = new THREE.Vector3();
      for (let i = 0; i <= N; i++) {
        const s = i / N * P;
        trackPos(s, lat, a);
        pos.push(a.x, 0, a.z, a.x, 0.9, a.z); uv.push(-s / 14, 0, -s / 14, 1);
        if (i < N) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      // dejar abierta la valla interior donde están los arcos de la Roxzone
      const mesh = new THREE.Mesh(g, lat < 0 ? new THREE.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.8, side: THREE.DoubleSide }) : m);
      if (lat > 0) mesh.material.side = THREE.DoubleSide;
      mesh.receiveShadow = true;
      if (lat < 0) { // valla interior baja con hueco en la Roxzone
        const keep = [];
        for (let i = 0; i < N; i++) { const s = i / N * P; const d = Math.min(s, P - s); if (d > 6) keep.push(i); }
        const id2 = []; for (const i of keep) { const k = i * 2; id2.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
        g.setIndex(id2);
        mesh.scale.y = 0.7;
      }
      this.scene.add(mesh);
    }
  }
  stationsBuild() {
    const s = this.scene;
    this.eq = {};
    // césped sintético para trineos
    const turf = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#20261f'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) { const v = 25 + Math.random() * 30; x.fillStyle = `rgb(${v * 0.8},${v},${v * 0.75})`; x.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 2); }
    });
    turf.repeat.set(10, 1);
    const turfM = new THREE.MeshStandardMaterial({ map: turf, roughness: 1, normalMap: this.t.carpetN, normalScale: new THREE.Vector2(1.2, 1.2) });
    const lineM = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, emissive: 0x333333 });
    const accM = new THREE.MeshStandardMaterial({ color: 0xffe500, roughness: 0.5, emissive: 0xffe500, emissiveIntensity: 0.25 });
    const matM = new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 0.85, normalMap: this.t.rubberN });
    for (const id of ['push', 'pull', 'bbj', 'farmers', 'lunges']) {
      const st = ST[id];
      for (let j = 0; j < LANES; j++) {
        const l = laneOf(id, j);
        const isTurf = id === 'push' || id === 'pull';
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(l.len + 2.5, 1.05), isTurf ? turfM : matM);
        pl.rotation.x = -Math.PI / 2; pl.position.set(l.pos.x + l.len / 2, 0.015, l.pos.z); pl.receiveShadow = true; s.add(pl);
        for (const d of [0, l.len]) { const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 1.05), d ? accM : lineM); ln.rotation.x = -Math.PI / 2; ln.position.set(l.pos.x + d, 0.02, l.pos.z); s.add(ln); }
        if (id === 'bbj' || id === 'lunges' || id === 'farmers') for (let d = 5; d < l.len; d += 5) { const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.3), lineM); ln.rotation.x = -Math.PI / 2; ln.position.set(l.pos.x + d, 0.02, l.pos.z - 0.38); s.add(ln); }
      }
    }
    for (const id in ST) { const st = ST[id]; this.sign(id, (st.x0 + st.x1) / 2, st.side * 8.5); }
    // máquinas
    this.eq.ski = []; this.eq.row = []; this.eq.wb = [];
    for (let j = 0; j < LANES; j++) {
      const a = laneOf('ski', j); const m = skiErg(); m.position.set(a.pos.x, 0, a.pos.z + 0.55 * ST.ski.side); m.rotation.y = ST.ski.side < 0 ? 0 : Math.PI; s.add(m); this.eq.ski.push(m);
      const b = laneOf('row', j); const r = rower(); r.position.set(b.pos.x, 0, b.pos.z); r.rotation.y = 0; s.add(r); this.eq.row.push(r);
    }
  }
  // Para cada división se colocan trineos, pesas, sacos y blancos con el peso correcto
  setLoads(loads) {
    const s = this.scene;
    if (this.loadGroup) s.remove(this.loadGroup);
    const G = this.loadGroup = new THREE.Group(); s.add(G);
    this.eq.push = []; this.eq.pull = []; this.eq.kb = []; this.eq.bag = []; this.eq.ball = []; this.eq.wb = [];
    for (let j = 0; j < LANES; j++) {
      const L = loads[j % loads.length];
      const p = laneOf('push', j); const sp = sled(L.push); sp.rotation.y = Math.PI / 2; sp.position.set(p.pos.x + 1.0, 0, p.pos.z); G.add(sp); this.eq.push.push(sp);
      const q = laneOf('pull', j); const sq = sled(L.pull); sq.rotation.y = -Math.PI / 2; sq.position.set(q.pos.x + 0.2, 0, q.pos.z); G.add(sq); this.eq.pull.push(sq);
      const f = laneOf('farmers', j); const k1 = kettlebell(L.farmers), k2 = kettlebell(L.farmers);
      k1.position.set(f.pos.x - 0.5, 0, f.pos.z - 0.25); k2.position.set(f.pos.x - 0.5, 0, f.pos.z + 0.25); G.add(k1, k2); this.eq.kb.push([k1, k2]);
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.8, 0.001, 0.9)), new THREE.LineBasicMaterial({ color: 0xffe500 })); box.position.set(f.pos.x - 0.5, 0.02, f.pos.z); G.add(box);
      const lu = laneOf('lunges', j); const bg = sandbag(L.sandbag); bg.position.set(lu.pos.x - 0.6, 0.12, lu.pos.z); G.add(bg); this.eq.bag.push(bg);
      const w = laneOf('wb', j); const h = L.target || 3.0;
      const tg = wbTarget(h); tg.position.set(w.pos.x, 0, w.pos.z + 0.95 * ST.wb.side); tg.rotation.y = ST.wb.side > 0 ? Math.PI : 0; G.add(tg); this.eq.wb.push(tg);
      const ball = wallBall(L.ball); ball.position.set(w.pos.x + 0.3, ball.userData.r, w.pos.z - 0.2); G.add(ball); this.eq.ball.push(ball);
    }
  }
  sign(id, x, z) {
    const st = STATIONS.find(s => s.id === id); const n = STATIONS.indexOf(st) + 1;
    const t = canvasTex(1024, 256, (c, w, h) => {
      c.fillStyle = '#060607'; c.fillRect(0, 0, w, h);
      c.fillStyle = ACCENT; c.fillRect(0, 0, 170, h);
      c.fillStyle = '#000'; c.font = '800 150px Barlow, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(n, 85, 136);
      c.fillStyle = '#fff'; c.textAlign = 'left'; c.font = '800 96px Barlow, Arial'; c.fillText(st.name.toUpperCase(), 210, 105);
      c.fillStyle = '#9a9ca1'; c.font = '600 56px Barlow, Arial'; c.fillText(st.dist + (st.unit === 'reps' ? ' REPS' : ' M'), 212, 195);
    });
    const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); m.color.setScalar(1.25);
    // cubo colgado con el cartel en las 4 caras
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(4.1, 1.1, 4.1), MAT.black); g.add(back);
    for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), m); const a = i * Math.PI / 2; p.position.set(Math.sin(a) * 2.06, 0, Math.cos(a) * 2.06); p.rotation.y = a; g.add(p); }
    for (const sx of [-1.8, 1.8]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 7, 4), MAT.steel); c.position.set(sx, 4, 0); g.add(c); }
    g.position.set(x, 6.2, z);
    this.scene.add(g);
  }
  roxzone() {
    const s = this.scene;
    // pasillo central (Roxzone) con alfombra
    const ct = this.t.carpet.clone(); ct.repeat.set(30, 2); ct.needsUpdate = true;
    const cor = new THREE.Mesh(new THREE.PlaneGeometry(ROX.finishX - ROX.inX + 2, 4.2), new THREE.MeshStandardMaterial({ map: ct, normalMap: this.t.carpetN, color: 0x3a1a10, roughness: 1 }));
    cor.rotation.x = -Math.PI / 2; cor.position.set((ROX.finishX + ROX.inX) / 2, 0.01, 0); cor.receiveShadow = true; s.add(cor);
    const ain = arch(2.3, 2.6, 'ROXZONE', 'IN'); ain.position.set(ROX.inX - 0.5, 0, -1.25); ain.rotation.y = Math.PI / 2; s.add(ain);
    const aout = arch(2.3, 2.6, 'ROXZONE', 'OUT'); aout.position.set(ROX.inX - 0.5, 0, 1.25); aout.rotation.y = Math.PI / 2; s.add(aout);
    const fin = arch(4.4, 3.2, 'FINISH', ''); fin.position.set(ROX.finishX, 0, 0); fin.rotation.y = Math.PI / 2; s.add(fin);
    const start = arch(5.6, 3.4, 'START', ''); const sp = trackPos(OUT_S + 6); start.position.set(sp.x, 0, sp.z); start.rotation.y = -0.35; s.add(start);
    this.startArch = start;
    // cintas del pasillo (postes y cinta)
    const postM = MAT.black, tapeM = new THREE.MeshStandardMaterial({ color: 0xffe500, roughness: 0.5, emissive: 0xffe500, emissiveIntensity: 0.2 });
    // la cinta tiene huecos donde se entra y se sale de cada estación (no se salta la cinta)
    const gaps = { '-1': [], '1': [] };
    for (const id of Object.keys(ST)) {
      const st = ST[id], g = gaps[st.side];
      if (st.kind === 'machine') { g.push([st.x0 - 0.4, st.x1 + 0.4]); continue; }
      const L = laneOf(id, 0);
      const xs = [L.pos.x - 0.6];
      if (id === 'pull') xs.push(L.pos.x + 13.5);
      if (id === 'lunges') xs.push(L.pos.x + L.len + 0.6);
      for (const x of xs) g.push([x - 1.1, x + 1.1]);
    }
    const geoP = new THREE.CylinderGeometry(0.03, 0.05, 1, 8);
    for (const z of [-2.2, 2.2]) {
      const g = gaps[z < 0 ? '-1' : '1'].sort((a, b) => a[0] - b[0]);
      let x = ROX.inX + 2; const end = ROX.finishX - 2, segs = [];
      for (const [a, b] of g) { if (a > x) segs.push([x, Math.min(a, end)]); x = Math.max(x, b); if (x >= end) break; }
      if (x < end) segs.push([x, end]);
      for (const [a, b] of segs) {
        if (b - a < 0.3) continue;
        const tp = new THREE.Mesh(new THREE.BoxGeometry(b - a, 0.05, 0.01), tapeM); tp.position.set((a + b) / 2, 0.95, z); s.add(tp);
        const n = Math.max(1, Math.round((b - a) / 4));
        for (let i = 0; i <= n; i++) { const p = new THREE.Mesh(geoP, postM); p.position.set(a + (b - a) * i / n, 0.5, z); p.castShadow = true; s.add(p); }
      }
    }
  }
  hall() {
    const s = this.scene;
    // paredes y techo oscuro con trusses y lámparas
    const wallM = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.95 });
    const W = 130, D = 90, H = 18;
    for (const [w, x, z, ry] of [[W, 0, -D / 2, 0], [W, 0, D / 2, Math.PI], [D, -W / 2, 0, Math.PI / 2], [D, W / 2, 0, -Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wallM); m.position.set(x, H / 2, z); m.rotation.y = ry; s.add(m);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; s.add(ceil);
    // trusses del techo + lámparas (instanciadas)
    const tg = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
    const trussMesh = new THREE.InstancedMesh(tg, MAT.alu, 900);
    let n = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const put = (x, y, z, len, axis) => { if (n >= 900) return; q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis); sc.set(1, len, 1); p.set(x, y, z); m4.compose(p, q, sc); trussMesh.setMatrixAt(n++, m4); };
    const X = new THREE.Vector3(1, 0, 0), Zv = new THREE.Vector3(0, 0, 1);
    for (let z = -36; z <= 36; z += 12) for (const dy of [0, 0.6]) for (const dz of [-0.3, 0.3]) put(0, 13.5 + dy, z + dz, 120, X);
    for (let x = -54; x <= 54; x += 18) for (const dy of [0, 0.6]) put(x, 13.5 + dy, 0, 80, Zv);
    trussMesh.count = n; s.add(trussMesh);
    // lámparas colgantes (emisivas) + halo
    const lampG = new THREE.CylinderGeometry(0.45, 0.6, 0.35, 16);
    const lampM = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff1dc, emissiveIntensity: 3.2 });
    const lamps = new THREE.InstancedMesh(lampG, lampM, 80); let k = 0;
    for (let z = -36; z <= 36; z += 12) for (let x = -50; x <= 50; x += 12.5) { m4.makeTranslation(x, 13.2, z); lamps.setMatrixAt(k++, m4); }
    lamps.count = k; s.add(lamps);
    // conos de luz con polvo (aditivos y suaves)
    const coneM = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { c: { value: new THREE.Color(0xffe8cc) }, a: { value: 0.05 } },
      vertexShader: 'varying float vy; varying vec3 vn; varying vec3 vv; void main(){ vy = uv.y; vec4 mv = modelViewMatrix*vec4(position,1.0); vn = normalize(normalMatrix*normal); vv = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 c; uniform float a; varying float vy; varying vec3 vn; varying vec3 vv; void main(){ float f = pow(abs(dot(vn, vv)), 1.6); gl_FragColor = vec4(c, a * f * pow(vy, 1.4)); }',
    });
    for (const sp of this.spots) {
      const h = sp.position.y;
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.3, Math.tan(0.28) * h * 1.25, h, 24, 1, true), coneM);
      cone.position.set(sp.position.x, h / 2, sp.position.z); cone.lookAt(sp.target.position); cone.rotateX(Math.PI / 2);
      const mid = sp.position.clone().add(sp.target.position).multiplyScalar(0.5); cone.position.copy(mid);
      s.add(cone);
    }
    // tribunas
    const standM = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.9 });
    for (const side of [-1, 1]) for (let r = 0; r < 10; r++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(84, 0.55, 1.0), standM);
      st.position.set(0, 0.275 + r * 0.55, side * (21.5 + r * 1.0)); st.receiveShadow = true; s.add(st);
      const fill = new THREE.Mesh(new THREE.BoxGeometry(84, r * 0.55 + 0.01, 1.0), standM); fill.position.set(0, (r * 0.55) / 2, side * (21.5 + r * 1.0)); s.add(fill);
    }
  }
  crowd() {
    // público: figuras simples instanciadas (de lejos y en penumbra se leen como gente)
    const body = new THREE.CapsuleGeometry(0.2, 0.62, 3, 8); body.translate(0, 0.52, 0);
    const head = new THREE.SphereGeometry(0.12, 10, 8); head.translate(0, 1.18, 0);
    const g = mergeGeoms([body, head]);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    const U = { t: { value: 0 } }; this.crowdU = U;
    m.onBeforeCompile = sh => {
      sh.uniforms.ct = U.t;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float ct; attribute float ph;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n float hop = max(0.0, sin(ct*(3.0+ph) + ph*40.0)); transformed.y += hop*hop*0.12*step(0.5, fract(ph*7.0)); transformed.x += sin(ct*1.3+ph*20.0)*0.03;');
    };
    const pts = [];
    for (const side of [-1, 1]) for (let r = 0; r < 10; r++) for (let x = -41; x < 41; x += 0.62) if (Math.random() < 0.82) pts.push([x + (Math.random() - 0.5) * 0.2, 0.55 + r * 0.55, side * (21.5 + r * 1.0)]);
    // de pie detrás de las vallas exteriores en las curvas
    for (let i = 0; i < 380; i++) { const s = Math.random() * TRACK.P; const p = trackPos(s, TRACK.W / 2 + 1.2 + Math.random() * 2.5); if (Math.abs(p.z) < 19) pts.push([p.x, 0, p.z]); }
    const im = new THREE.InstancedMesh(g, m, pts.length);
    const ph = new Float32Array(pts.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const shirt = [0x1b1c20, 0x2a2b30, 0x5a5d63, 0x1a2a44, 0x7a1f12, 0xcfcfcf, 0x203a26, 0x3d2d1f, 0x33363c, 0x101010];
    pts.forEach((p, i) => {
      const s = 0.9 + Math.random() * 0.2;
      m4.makeRotationY(p[2] > 0 ? Math.PI : 0).scale(new THREE.Vector3(s, s, s)).setPosition(p[0], p[1], p[2]);
      im.setMatrixAt(i, m4); col.setHex(shirt[(Math.random() * shirt.length) | 0]).multiplyScalar(0.55 + Math.random() * 0.4); im.setColorAt(i, col); ph[i] = Math.random();
    });
    g.setAttribute('ph', new THREE.InstancedBufferAttribute(ph, 1));
    im.receiveShadow = false; im.castShadow = false;
    this.scene.add(im); this.crowdMesh = im;
  }
  screens() {
    // pantalla gigante colgada (4 caras) con la clasificación en vivo
    const c = this.scrCanvas = document.createElement('canvas'); c.width = 1024; c.height = 576;
    const t = this.scrTex = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(9.4, 5.4, 9.4), MAT.black); g.add(frame);
    for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.06), m); const a = i * Math.PI / 2; p.position.set(Math.sin(a) * 4.71, 0, Math.cos(a) * 4.71); p.rotation.y = a; g.add(p); }
    for (const sx of [-3, 3]) for (const sz of [-3, 3]) { const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4, 4), MAT.steel); cab.position.set(sx, 4.7, sz); g.add(cab); }
    g.position.set(0, 10.8, 0); this.scene.add(g); this.screen = g;
    this.drawScreen([{ name: 'HYBRID.RACE', time: '' }], 'FITNESS RACING');
  }
  drawScreen(rows, title, sub = '') {
    const c = this.scrCanvas, x = c.getContext('2d');
    x.fillStyle = '#050506'; x.fillRect(0, 0, 1024, 576);
    x.fillStyle = ACCENT; x.fillRect(0, 0, 1024, 70);
    x.fillStyle = '#000'; x.font = '800 46px Barlow, Arial'; x.textBaseline = 'middle'; x.fillText(title, 30, 37);
    x.textAlign = 'right'; x.font = '700 36px Barlow, Arial'; x.fillText(sub, 994, 37); x.textAlign = 'left';
    rows.slice(0, 8).forEach((r, i) => {
      const y = 112 + i * 58;
      x.fillStyle = r.me ? 'rgba(255,229,0,0.2)' : (i % 2 ? '#0c0d10' : '#08090b'); x.fillRect(16, y - 27, 992, 54);
      x.fillStyle = r.me ? ACCENT : '#8f9298'; x.font = '800 40px Barlow, Arial'; x.fillText(String(i + 1), 34, y + 2);
      x.fillStyle = '#fff'; x.font = (r.me ? '800 ' : '600 ') + '40px Barlow, Arial'; x.fillText(r.name, 100, y + 2);
      x.fillStyle = '#9a9ca1'; x.font = '600 32px Barlow, Arial'; x.fillText(r.where || '', 560, y + 2);
      x.fillStyle = '#fff'; x.textAlign = 'right'; x.font = '700 40px Barlow, Arial'; x.fillText(r.time || '', 994, y + 2); x.textAlign = 'left';
    });
    this.scrTex.needsUpdate = true;
  }
  update(dt, t, focus) {
    if (this.crowdU) this.crowdU.t.value = t;
    if (focus) {    // la sombra sigue al jugador
      this.key.position.set(focus.x - 8, 30, focus.z + 10); this.key.target.position.copy(focus); this.key.target.updateMatrixWorld();
    }
    for (let i = 0; i < this.spots.length; i++) {
      const sp = this.spots[i]; const k = t * 0.25 + i * 1.7;
      sp.target.position.x = sp.position.x + Math.sin(k) * 9; sp.target.updateMatrixWorld();
    }
  }
}

function mergeGeoms(list) {
  const out = new THREE.BufferGeometry();
  const pos = [], nor = [], idx = []; let off = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    const ix = g.index; for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
    off += p.count;
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(idx);
  return out;
}
