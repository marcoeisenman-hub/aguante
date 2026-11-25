// Equipo de competencia modelado con geometría (medidas reales aproximadas, en metros).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MAT = {};
export function initMaterials(tex) {
  MAT.black = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55, metalness: 0.2 });
  MAT.matte = new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.85, metalness: 0.05 });
  MAT.alu = new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.32, metalness: 0.9 });
  MAT.steel = new THREE.MeshStandardMaterial({ color: 0x5c6066, roughness: 0.38, metalness: 0.85, map: tex.metal, normalMap: tex.metalN, normalScale: new THREE.Vector2(0.4, 0.4) });
  MAT.chrome = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, roughness: 0.12, metalness: 1 });
  MAT.rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9, metalness: 0 });
  MAT.plate = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.62, metalness: 0.1 });
  MAT.grip = new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.95 });
  MAT.screen = new THREE.MeshStandardMaterial({ color: 0x9aa39a, roughness: 0.3, emissive: 0x1b2a1b, emissiveIntensity: 0.6 });
  MAT.accent = new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.45, metalness: 0.1 });
  MAT.kb = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.45, metalness: 0.55 });
  MAT.bag = new THREE.MeshStandardMaterial({ color: 0x222325, roughness: 0.92, normalMap: tex.carpetN, normalScale: new THREE.Vector2(0.6, 0.6) });
  MAT.ball = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.75, normalMap: tex.carpetN, normalScale: new THREE.Vector2(0.3, 0.3) });
  MAT.rope = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.9 });
  MAT.wood = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.7 });
  MAT.white = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.6 });
}

const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };
const cyl = (r, h, m, seg = 20) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.castShadow = true; o.receiveShadow = true; return o; };
function rbox(w, h, d, r, m) {   // caja con bordes redondeados (extrusión)
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - r * 2, bevelEnabled: true, bevelSize: r * 0.6, bevelThickness: r, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -(d - r * 2) / 2);
  const o = new THREE.Mesh(g, m); o.castShadow = true; o.receiveShadow = true; return o;
}

// Cuerda/cable entre dos puntos (se actualiza)
export class Cable {
  constructor(r = 0.006, m = MAT.black, seg = 12, sag = 0) {
    this.seg = seg; this.sag = sag;
    this.pts = Array.from({ length: seg + 1 }, () => new THREE.Vector3());
    this.curve = new THREE.CatmullRomCurve3(this.pts);
    this.r = r;
    this.mesh = new THREE.Mesh(new THREE.TubeGeometry(this.curve, seg, r, 5), m);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
  }
  set(a, b, sag = this.sag) {
    for (let i = 0; i <= this.seg; i++) {
      const t = i / this.seg;
      this.pts[i].lerpVectors(a, b, t);
      this.pts[i].y -= Math.sin(t * Math.PI) * sag;
    }
    const g = new THREE.TubeGeometry(this.curve, this.seg, this.r, 5);
    this.mesh.geometry.dispose(); this.mesh.geometry = g;
  }
}

// Monitor tipo PM5 con pantalla dibujable
function monitor() {
  const g = new THREE.Group();
  const shell = rbox(0.24, 0.2, 0.06, 0.012, MAT.black); g.add(shell);
  const c = document.createElement('canvas'); c.width = 128; c.height = 96;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.13), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  scr.position.z = 0.031; g.add(scr);
  g.userData.draw = (lines) => {
    const x = c.getContext('2d');
    x.fillStyle = '#a9b4a3'; x.fillRect(0, 0, 128, 96);
    x.fillStyle = '#1d211b'; x.font = 'bold 22px monospace'; x.textAlign = 'center';
    x.fillText(lines[0] || '', 64, 30); x.font = 'bold 16px monospace';
    x.fillText(lines[1] || '', 64, 56); x.fillText(lines[2] || '', 64, 80);
    t.needsUpdate = true;
  };
  g.userData.draw(['0:00', '0 m', '']);
  return g;
}

// ---------- SkiErg ----------
export function skiErg() {
  const g = new THREE.Group();
  g.add(box(0.62, 0.05, 0.95, MAT.matte, 0, 0.025, 0.22));                 // plataforma
  g.add(box(0.58, 0.012, 0.7, MAT.rubber, 0, 0.056, 0.3));
  const col = rbox(0.24, 2.0, 0.14, 0.03, MAT.black); col.position.set(0, 1.03, -0.12); g.add(col);
  const fw = cyl(0.24, 0.22, MAT.black, 28); fw.rotation.z = Math.PI / 2; fw.position.set(0, 1.92, -0.1); g.add(fw);
  const grill = cyl(0.2, 0.225, MAT.steel, 28); grill.rotation.z = Math.PI / 2; grill.position.copy(fw.position); g.add(grill);
  const arm = box(0.5, 0.05, 0.05, MAT.black, 0, 2.04, -0.02); g.add(arm);
  for (const s of [-1, 1]) { const p = cyl(0.03, 0.06, MAT.alu, 12); p.rotation.z = Math.PI / 2; p.position.set(s * 0.24, 2.04, 0.02); g.add(p); }
  const mon = monitor(); mon.position.set(0, 1.45, -0.03); mon.rotation.x = -0.25; g.add(mon);
  g.userData.monitor = mon;
  // manijas
  g.userData.handles = [];
  g.userData.cables = [];
  for (const s of [-1, 1]) {
    const h = new THREE.Group();
    const grip = cyl(0.018, 0.14, MAT.grip, 10); h.add(grip);
    const cap = cyl(0.025, 0.02, MAT.black, 10); cap.position.y = 0.075; h.add(cap);
    h.position.set(s * 0.24, 1.85, 0.05); g.add(h);
    const cb = new Cable(0.004, MAT.black, 2); g.add(cb.mesh);
    g.userData.handles.push(h); g.userData.cables.push(cb);
  }
  g.userData.top = [new THREE.Vector3(-0.24, 2.04, 0.04), new THREE.Vector3(0.24, 2.04, 0.04)];
  return g;
}

// ---------- Remo ----------
export function rower() {
  const g = new THREE.Group();          // largo en +z (asiento hacia +z, volante en -z)
  const rail = box(0.09, 0.05, 1.9, MAT.alu, 0, 0.4, 0.45); g.add(rail);
  g.add(box(0.5, 0.05, 0.06, MAT.black, 0, 0.03, 1.4));                    // pata trasera
  const leg = box(0.06, 0.38, 0.06, MAT.black, 0, 0.2, 1.38); g.add(leg);
  // cuerpo delantero
  const front = rbox(0.18, 0.5, 0.5, 0.04, MAT.black); front.position.set(0, 0.42, -0.6); front.rotation.x = 0.35; g.add(front);
  const cage = cyl(0.3, 0.2, MAT.black, 30); cage.rotation.z = Math.PI / 2; cage.position.set(0, 0.42, -0.85); g.add(cage);
  const fan = cyl(0.27, 0.205, MAT.steel, 30); fan.rotation.z = Math.PI / 2; fan.position.copy(cage.position); g.add(fan);
  g.add(box(0.6, 0.05, 0.08, MAT.black, 0, 0.03, -0.9));
  // reposapiés
  for (const s of [-1, 1]) { const fp = box(0.13, 0.28, 0.03, MAT.matte, s * 0.1, 0.4, -0.28); fp.rotation.x = -0.75; g.add(fp); const st = box(0.14, 0.02, 0.06, MAT.accent, s * 0.1, 0.32, -0.25); st.rotation.x = -0.75; g.add(st); }
  // brazo del monitor
  const ma = box(0.03, 0.55, 0.03, MAT.black, 0, 0.75, -0.5); ma.rotation.x = 0.4; g.add(ma);
  const mon = monitor(); mon.position.set(0, 1.0, -0.38); mon.rotation.x = -0.3; mon.scale.setScalar(0.9); g.add(mon);
  g.userData.monitor = mon;
  // asiento (se mueve)
  const seat = rbox(0.3, 0.05, 0.28, 0.02, MAT.matte); seat.position.set(0, 0.45, 0.6); g.add(seat);
  g.userData.seat = seat;
  // manija + cadena
  const handle = new THREE.Group();
  const bar = cyl(0.016, 0.42, MAT.grip, 10); bar.rotation.z = Math.PI / 2; handle.add(bar);
  handle.position.set(0, 0.55, -0.3); g.add(handle); g.userData.handle = handle;
  const chain = new Cable(0.005, MAT.steel, 2); g.add(chain.mesh); g.userData.chain = chain;
  g.userData.chainStart = new THREE.Vector3(0, 0.52, -0.55);
  return g;
}

// ---------- Trineo ----------
export function sled(kg) {
  const g = new THREE.Group();
  // patines
  for (const s of [-1, 1]) {
    const sk = box(0.08, 0.05, 1.05, MAT.steel, s * 0.32, 0.03, 0); g.add(sk);
    const tip = box(0.08, 0.05, 0.18, MAT.steel, s * 0.32, 0.07, 0.56); tip.rotation.x = -0.6; g.add(tip);
  }
  g.add(box(0.72, 0.04, 0.9, MAT.steel, 0, 0.08, 0));
  // poste central para discos
  const peg = cyl(0.03, 0.42, MAT.chrome, 14); peg.position.set(0, 0.3, 0.05); g.add(peg);
  // discos según el peso (sin contar el trineo ~ 52 kg)
  const plates = Math.max(1, Math.round((kg - 52) / 25));
  for (let i = 0; i < plates; i++) {
    const p = cyl(0.225, 0.045, MAT.plate, 36); p.position.set(0, 0.125 + i * 0.048, 0.05); g.add(p);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.012, 6, 36), MAT.rubber); rim.rotation.x = Math.PI / 2; rim.position.copy(p.position); g.add(rim);
  }
  // postes de empuje con manijas (lado -z)
  for (const s of [-1, 1]) {
    const post = cyl(0.025, 1.05, MAT.steel, 12); post.position.set(s * 0.25, 0.6, -0.42); post.rotation.x = 0.12; g.add(post);
    const hand = cyl(0.022, 0.26, MAT.grip, 10); hand.rotation.z = Math.PI / 2; hand.position.set(s * 0.25, 0.95, -0.47); g.add(hand);
    const low = cyl(0.02, 0.22, MAT.grip, 10); low.rotation.z = Math.PI / 2; low.position.set(s * 0.25, 0.5, -0.42); g.add(low);
  }
  // argolla para la cuerda (lado +z)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.01, 6, 14), MAT.chrome); ring.position.set(0, 0.12, 0.5); g.add(ring);
  g.userData.ring = new THREE.Vector3(0, 0.12, 0.5);
  g.userData.plates = plates;
  return g;
}

// ---------- Kettlebell ----------
let KB_G;
export function kettlebell(kg) {
  if (!KB_G) {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + i / 16 * Math.PI * 0.86; pts.push(new THREE.Vector2(Math.max(0.001, Math.cos(a) * 0.11), 0.11 + Math.sin(a) * 0.11)); }
    const body = new THREE.LatheGeometry(pts, 24);
    const handle = new THREE.TorusGeometry(0.07, 0.014, 8, 20, Math.PI);
    handle.translate(0, 0.21, 0);
    const legs = [new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8), new THREE.CylinderGeometry(0.014, 0.014, 0.05, 8)];
    legs[0].translate(-0.07, 0.205, 0); legs[1].translate(0.07, 0.205, 0);
    KB_G = mergeGeometries([body.toNonIndexed(), handle.toNonIndexed(), legs[0].toNonIndexed(), legs[1].toNonIndexed()]);
    KB_G.computeVertexNormals();
  }
  const o = new THREE.Mesh(KB_G, MAT.kb); o.castShadow = true;
  const s = 0.75 + (kg / 32) * 0.35; o.scale.setScalar(s);
  o.userData.handleY = 0.235 * s;
  return o;
}

// ---------- Saco ----------
export function sandbag(kg) {
  const g = new THREE.Group();
  const len = 0.55 + kg / 30 * 0.1;
  const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.13 + kg / 30 * 0.03, len - 0.25, 6, 14), MAT.bag);
  b.rotation.z = Math.PI / 2; b.scale.set(1, 1, 0.8); b.castShadow = true; g.add(b);
  for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 10, Math.PI), MAT.rope); h.position.set(s * 0.12, 0.13, 0); g.add(h); }
  return g;
}

// ---------- Balón medicinal ----------
export function wallBall(kg) {
  const r = 0.17 + kg / 9 * 0.015;
  const o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), MAT.ball); o.castShadow = true;
  const seam = new THREE.Mesh(new THREE.TorusGeometry(r * 1.001, 0.004, 4, 32), MAT.accent); o.add(seam);
  const seam2 = seam.clone(); seam2.rotation.y = Math.PI / 2; o.add(seam2);
  o.userData.r = r;
  return o;
}

// ---------- Blanco de wall balls (estructura con dos alturas) ----------
export function wbTarget(h) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) { const p = box(0.08, 3.6, 0.08, MAT.black, s * 0.55, 1.8, 0); g.add(p); }
  g.add(box(1.2, 0.08, 0.08, MAT.black, 0, 3.6, 0));
  g.add(box(1.25, 0.04, 0.5, MAT.black, 0, 0.02, 0.2));
  const tgt = new THREE.Group();
  const disc = cyl(0.3, 0.03, MAT.white, 32); disc.rotation.x = Math.PI / 2; tgt.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.02, 6, 32), MAT.accent); ring.position.z = 0.016; tgt.add(ring);
  const bull = cyl(0.08, 0.035, MAT.accent, 20); bull.rotation.x = Math.PI / 2; tgt.add(bull);
  tgt.position.set(0, h, 0.06); g.add(tgt);
  // marcas 2,70 / 3,00
  for (const y of [2.7, 3.0]) { const m = box(1.1, 0.015, 0.02, y === h ? MAT.accent : MAT.white, 0, y, 0.05); g.add(m); }
  g.userData.target = new THREE.Vector3(0, h, 0.1);
  g.userData.disc = tgt;
  return g;
}

// ---------- Arcos de truss con letrero LED ----------
export function arch(w, h, text, sub = '', color = '#ff5a1f') {
  const g = new THREE.Group();
  const trussM = MAT.alu;
  const post = (x) => {
    const p = new THREE.Group();
    for (const [dx, dz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) { const t = cyl(0.025, h, trussM, 8); t.position.set(dx, h / 2, dz); p.add(t); }
    for (let y = 0.3; y < h; y += 0.45) for (const r of [0, Math.PI / 2]) { const c = cyl(0.01, 0.4, trussM, 5); c.rotation.z = Math.PI / 4; c.rotation.y = r; c.position.y = y; p.add(c); }
    p.position.x = x; return p;
  };
  g.add(post(-w / 2), post(w / 2));
  const beam = box(w + 0.4, 0.9, 0.45, MAT.black, 0, h + 0.2, 0); g.add(beam);
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const x = c.getContext('2d');
  x.fillStyle = '#050505'; x.fillRect(0, 0, 1024, 160);
  x.fillStyle = color; x.fillRect(0, 0, 1024, 8); x.fillRect(0, 152, 1024, 8);
  x.fillStyle = '#fff'; x.font = '800 92px Barlow, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, sub ? 420 : 512, 84);
  if (sub) { x.fillStyle = color; x.font = '800 92px Barlow, Arial, sans-serif'; x.fillText(sub, 830, 84); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  m.color.setScalar(1.6);
  for (const s of [1, -1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, (w + 0.3) * 160 / 1024), m); p.position.set(0, h + 0.2, s * 0.23); if (s < 0) p.rotation.y = Math.PI; g.add(p); }
  return g;
}
