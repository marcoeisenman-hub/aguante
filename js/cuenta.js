// Cuenta (usuario + PIN): tu atleta, tu personaje, tus tiempos y la carrera a medias se guardan en la nube.
// Todo sigue funcionando sin cuenta (se guarda solo en este compu).
//
// Cómo se sincroniza (simple a propósito):
//  - hrSeq sube con cada cambio en este compu; hrSent = el último hrSeq que la nube confirmó. Si hrSeq > hrSent hay cambios sin subir.
//  - El servidor numera cada guardado (rev 1, 2, 3…), no depende del reloj de ningún compu.
//  - Los guardados de este compu van de a uno (nunca dos a la vez), así no se desordenan.
//  - Al abrir el juego: si este compu tiene cambios sin subir, se suben (gana este compu); si no, se baja lo de la nube.
const KEYS = ['hrAtleta', 'aguanteSetup', 'aguanteRecords', 'hrResume'];
const LS = window.localStorage;
const origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
const get = k => { try { return LS.getItem(k); } catch { return null; } };
const put = (k, v) => { try { origSet.call(LS, k, v); } catch { } };
const del = k => { try { origRemove.call(LS, k); } catch { } };
const num = k => Number(get(k) || 0);
const META = ['hrSyncUser', 'hrSeq', 'hrSent', 'hrBase'];

let user = null, timer = null, busy = null, lastError = '';
export const cuenta = { get user() { return user; }, get error() { return lastError; } };

function snapshot() {
  const d = {};
  for (const k of KEYS) { const v = get(k); if (v != null) { try { d[k] = JSON.parse(v); } catch { } } }
  return d;
}
function apply(data, rev) {          // lo de la nube pasa a este compu (y queda como "sin cambios")
  for (const k of KEYS) { if (data && data[k] != null) put(k, JSON.stringify(data[k])); else del(k); }
  put('hrBase', String(rev || 0)); put('hrSent', get('hrSeq') || '0');
}
const dirty = () => num('hrSeq') > num('hrSent');
async function api(body, timeout = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch('/api/cuenta', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { cache: 'no-store', signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'No se pudo conectar'); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(t); }
}

// cada vez que el juego guarda algo de tu progreso, se marca y se sube (1,5 s después, juntando cambios)
Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === LS && KEYS.includes(k)) changed(); };
Storage.prototype.removeItem = function (k) { origRemove.call(this, k); if (this === LS && KEYS.includes(k)) changed(); };
function changed() {
  if (!user) return;
  put('hrSeq', String(num('hrSeq') + 1));
  clearTimeout(timer); timer = setTimeout(push, 1500);
}
function retry() { clearTimeout(timer); timer = setTimeout(push, 15000); }

// sube lo de este compu (de a un guardado). true = la nube tiene todo lo de aquí
function push() {
  if (busy) return busy.then(() => push());
  busy = (async () => {
    if (user?.offline && !(await reconnect())) { retry(); return false; }
    if (!user) return false;
    if (!dirty()) return true;
    const seq = num('hrSeq');
    try {
      const j = await api({ accion: 'guardar', data: snapshot() });
      lastError = ''; put('hrBase', String(j.rev));
      if (num('hrSent') < seq) put('hrSent', String(seq));       // lo que cambió mientras subía queda pendiente
      if (dirty()) { clearTimeout(timer); timer = setTimeout(push, 1500); }
      return !dirty();
    } catch (e) {
      if (e.status === 401) { user = null; return false; }        // la sesión venció
      if (e.status === 400) { lastError = e.message; return false; }   // el servidor no lo acepta (p. ej. muy grande): no insistir
      retry(); return false;                                       // sin internet: lo intenta de nuevo
    }
  })().finally(() => { busy = null; });
  return busy;
}
// abriste sin internet: cuando vuelva, revisa la sesión (y luego sube lo de aquí: gana este compu)
async function reconnect() {
  try {
    const j = await api(null, 3500);
    if (!j.user || j.user.usuario !== user.usuario) { user = null; return false; }
    user = j.user; return true;
  } catch { return false; }
}
addEventListener('online', () => { if (user) push(); });
addEventListener('pagehide', () => {
  if (!user || user.offline || !dirty() || busy) return;
  navigator.sendBeacon?.('/api/cuenta', new Blob([JSON.stringify({ accion: 'guardar', data: snapshot() })], { type: 'application/json' }));
});

// al abrir el juego
export async function cuentaInit() {
  const mine = get('hrSyncUser');
  try {
    const j = await api(null, 3500); user = j.user;
    if (!user) { if (mine) for (const k of META) del(k); return; }             // la sesión venció: sigue como invitado con lo de aquí
    if (mine !== user.usuario) { apply(user.data, user.rev); put('hrSyncUser', user.usuario); }   // otro usuario o compu nuevo
    else if (dirty()) push();                                                   // cambios de aquí sin subir: ganan
    else if (user.rev !== num('hrBase')) apply(user.data, user.rev);            // la nube cambió (otro compu)
  } catch {
    if (mine) { user = { usuario: mine, offline: true }; retry(); }             // sin internet: guarda tus cambios y los sube cuando vuelva
  }
}
// crear cuenta: se lleva el progreso que tienes ahora en este compu
export async function registro(usuario, pin) {
  const j = await api({ accion: 'registro', usuario, pin, data: snapshot() });
  user = j.user; put('hrSyncUser', user.usuario); put('hrBase', String(user.rev)); put('hrSent', get('hrSeq') || '0');
  return user;
}
// entrar: trae el progreso de la cuenta (si la cuenta está vacía, sube lo de este compu)
export async function entrar(usuario, pin) {
  const j = await api({ accion: 'entrar', usuario, pin });
  user = j.user; put('hrSyncUser', user.usuario);
  if (user.data && Object.keys(user.data).length) apply(user.data, user.rev);
  else { put('hrSeq', String(num('hrSeq') + 1)); await push(); }
  return user;
}
// salir: primero sube lo último. Si no se puede (sin internet), NO borra nada y avisa.
export async function salir() {
  if (user?.offline && !(await reconnect())) throw new Error('Sin internet: conéctate para salir sin perder tu progreso');
  if (!(await push())) throw new Error(lastError || 'No se pudo guardar tu progreso. Revisa el internet y prueba otra vez.');
  await api({ accion: 'salir' });
  user = null; clearTimeout(timer);
  for (const k of [...KEYS, ...META]) del(k);
}
