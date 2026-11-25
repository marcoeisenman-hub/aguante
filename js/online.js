// Salas online: dos brokers MQTT públicos a la vez (si uno falla sigue el otro), mensajes cifrados con el código.
const URLS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const ALF = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TE = new TextEncoder(), TD = new TextDecoder();
const uid = () => Math.random().toString(36).slice(2, 10);

function loadMqtt() {
  if (window.mqtt) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = new URL('../vendor/mqtt/mqtt.min.js', import.meta.url).href;
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar la conexión')); document.head.append(s);
  });
}
async function keyFor(code) {
  const h = await crypto.subtle.digest('SHA-256', TE.encode('aguante-sala:' + code));
  const key = await crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const t = new Uint8Array(await crypto.subtle.digest('SHA-256', TE.encode('aguante-tema:' + code)));
  return { key, topic: 'aguante-v1/' + Array.from(t.slice(0, 10), x => x.toString(16).padStart(2, '0')).join('') };
}
const b64 = u => btoa(String.fromCharCode(...u));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function newCode() { return Array.from(crypto.getRandomValues(new Uint8Array(5)), x => ALF[x % ALF.length]).join(''); }

export class Room {
  constructor(code, me) {
    this.code = code.toUpperCase(); this.me = { id: uid(), joined: Date.now(), ...me };
    this.peers = new Map();      // id → {id, name, kit, joined, seen, ...}
    this.h = {}; this.clis = []; this.ok = false; this.seen = new Set(); this.seenL = [];
    this.n = 0;
  }
  on(t, f) { (this.h[t] = this.h[t] || []).push(f); return this; }
  emit(t, ...a) { for (const f of this.h[t] || []) try { f(...a); } catch (e) { console.error(e); } }
  async connect() {
    await loadMqtt();
    this.k = await keyFor(this.code);
    for (const url of URLS) {
      const x = { ok: false };
      const cli = x.cli = window.mqtt.connect(url, { clientId: 'ag_' + this.me.id + '_' + uid().slice(0, 4), clean: true, keepalive: 15, reconnectPeriod: 1500, connectTimeout: 8000 });
      this.clis.push(x);
      cli.on('connect', () => { cli.subscribe(this.k.topic, { qos: 0 }, err => { if (err) return; const first = !this.ok; x.ok = true; this.ok = true; if (first) this.emit('status', 'ok'); this.hello(); }); });
      cli.on('message', (t, b) => { if (t === this.k.topic) this.rx(b.toString()); });
      cli.on('offline', () => { x.ok = false; this.recalc(); });
      cli.on('close', () => { x.ok = false; this.recalc(); });
      cli.on('error', () => { });
    }
    setTimeout(() => { if (!this.ok) this.emit('status', 'fail'); }, 12000);
    this.beat = setInterval(() => {
      if (!this.ok) return;
      this.send({ t: 'hi', p: this.pub() });
      const now = Date.now();
      for (const [id, p] of this.peers) if (now - p.seen > 10000) { this.peers.delete(id); this.emit('peers'); }
    }, 2500);
  }
  recalc() { const was = this.ok; this.ok = this.clis.some(x => x.ok); if (was && !this.ok) this.emit('status', 'lost'); }
  pub() { const { id, name, kit, joined, country } = this.me; return { id, name, kit, joined, country }; }
  hello() { this.send({ t: 'hi', p: this.pub(), ask: true }); }
  async send(m) {
    if (!this.k) return;
    m.from = this.me.id; m.n = this.me.id + ':' + (++this.n);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.k.key, TE.encode(JSON.stringify(m))));
    const txt = b64(iv) + '.' + b64(ct);
    for (const x of this.clis) if (x.ok) try { x.cli.publish(this.k.topic, txt, { qos: 0 }); } catch { }
  }
  async rx(txt) {
    try {
      const [a, b] = txt.split('.');
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(a) }, this.k.key, unb64(b));
      const m = JSON.parse(TD.decode(pt));
      if (!m || m.from === this.me.id || typeof m.n !== 'string') return;
      if (this.seen.has(m.n)) return; this.seen.add(m.n); this.seenL.push(m.n); if (this.seenL.length > 1000) this.seen.delete(this.seenL.shift());
      if (m.t === 'hi' && m.p) {
        const old = this.peers.get(m.p.id);
        this.peers.set(m.p.id, { ...m.p, seen: Date.now() });
        if (!old || old.name !== m.p.name || old.kit !== m.p.kit) this.emit('peers');
        if (m.ask) this.send({ t: 'hi', p: this.pub() });
        return;
      }
      if (m.t === 'bye') { this.peers.delete(m.from); this.emit('peers'); return; }
      const p = this.peers.get(m.from); if (p) p.seen = Date.now();
      this.emit(m.t, m, p);
    } catch { }
  }
  // todos (yo incluido), en orden de llegada a la sala
  list() { return [this.me, ...this.peers.values()].sort((a, b) => a.joined - b.joined || (a.id < b.id ? -1 : 1)); }
  get isHost() { const h = this.list().find(p => p.host); return h ? h.id === this.me.id : this.list()[0].id === this.me.id; }
  leave() {
    this.send({ t: 'bye' });
    clearInterval(this.beat);
    const cs = this.clis; this.clis = []; this.ok = false;
    setTimeout(() => { for (const x of cs) try { x.cli.end(true); } catch { } }, 250);
  }
}

// Semilla para que todos generen los mismos rivales
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
