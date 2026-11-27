// Cuenta (usuario + PIN): tu atleta, tu personaje, tus tiempos y la carrera a medias se guardan en la nube.
// Todo sigue funcionando sin cuenta (se guarda solo en este compu).
const KEYS = ['hrAtleta', 'aguanteSetup', 'aguanteRecords', 'hrResume'];
const LS = window.localStorage;
const origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
const meta = { get: k => origGetItem(k), set: (k, v) => origSet.call(LS, k, v), del: k => origRemove.call(LS, k) };
function origGetItem(k) { try { return LS.getItem(k); } catch { return null; } }

let user = null, timer = null;
const listeners = new Set();
export const cuenta = { get user() { return user; }, onChange(f) { listeners.add(f); } };
const notify = () => listeners.forEach(f => { try { f(user); } catch { } });

function snapshot() {
  const d = {};
  for (const k of KEYS) { const v = origGetItem(k); if (v != null) { try { d[k] = JSON.parse(v); } catch { } } }
  return d;
}
function apply(data) {
  for (const k of KEYS) { if (data && data[k] != null) meta.set(k, JSON.stringify(data[k])); else meta.del(k); }
}
async function api(body, timeout = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch('/api/cuenta', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { cache: 'no-store', signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo conectar');
    return j;
  } finally { clearTimeout(t); }
}

// cada vez que el juego guarda algo de tu progreso, se sube a tu cuenta (1,5 s después, juntando cambios)
Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === LS && KEYS.includes(k)) changed(); };
Storage.prototype.removeItem = function (k) { origRemove.call(this, k); if (this === LS && KEYS.includes(k)) changed(); };
function changed() { if (!user) return; meta.set('hrDirty', '1'); clearTimeout(timer); timer = setTimeout(push, 1500); }
async function push() {
  if (!user) return;
  try { const j = await api({ accion: 'guardar', data: snapshot() }); meta.set('hrSyncAt', String(j.updated)); meta.set('hrDirty', '0'); }
  catch { clearTimeout(timer); timer = setTimeout(push, 15000); }        // sin internet: lo intenta de nuevo
}
addEventListener('pagehide', () => {
  if (!user || meta.get('hrDirty') !== '1') return;
  navigator.sendBeacon?.('/api/cuenta', new Blob([JSON.stringify({ accion: 'guardar', data: snapshot() })], { type: 'application/json' }));
});

// al abrir el juego: si tienes sesión, trae tu progreso (si en este compu no hay cambios sin subir)
export async function cuentaInit() {
  try {
    const j = await api(null, 3500); user = j.user;
    if (!user) return;
    const sameUser = meta.get('hrSyncUser') === user.usuario, dirty = meta.get('hrDirty') === '1';
    if (sameUser && dirty) push();                                       // cambios de este compu que no alcanzaron a subir
    else if (!sameUser || user.updated > Number(meta.get('hrSyncAt') || 0)) { if (user.data) apply(user.data); meta.set('hrSyncUser', user.usuario); meta.set('hrSyncAt', String(user.updated)); meta.set('hrDirty', '0'); }
  } catch { /* sin internet: juega con lo de este compu */ }
  notify();
}
// crear cuenta: se lleva el progreso que tienes ahora en este compu
export async function registro(usuario, pin) {
  const j = await api({ accion: 'registro', usuario, pin, data: snapshot() });
  user = j.user; meta.set('hrSyncUser', user.usuario); meta.set('hrSyncAt', String(user.updated)); meta.set('hrDirty', '0');
  notify(); return user;
}
// entrar: trae el progreso de la cuenta (si la cuenta está vacía, sube lo de este compu)
export async function entrar(usuario, pin) {
  const j = await api({ accion: 'entrar', usuario, pin });
  user = j.user;
  if (user.data && Object.keys(user.data).length) apply(user.data); else { meta.set('hrDirty', '1'); await push(); }
  meta.set('hrSyncUser', user.usuario); meta.set('hrSyncAt', String(user.updated)); meta.set('hrDirty', '0');
  return user;
}
// salir: sube lo último y deja este compu en blanco (tu progreso queda en tu cuenta)
export async function salir() {
  if (meta.get('hrDirty') === '1') await push();
  await api({ accion: 'salir' }).catch(() => { });
  user = null; clearTimeout(timer);
  for (const k of [...KEYS, 'hrSyncUser', 'hrSyncAt', 'hrDirty']) meta.del(k);
}
