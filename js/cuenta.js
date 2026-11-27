// Cuenta (usuario + PIN): tu atleta, tu personaje, tus tiempos y la carrera a medias se guardan en la nube.
// Todo sigue funcionando sin cuenta (se guarda solo en este compu).
// rev = cuándo cambiaste algo por última vez (ms). El servidor solo acepta un guardado más nuevo que el que tiene,
// así un guardado viejo que llega tarde (o de otro compu) no pisa uno nuevo.
const KEYS = ['hrAtleta', 'aguanteSetup', 'aguanteRecords', 'hrResume'];
const LS = window.localStorage;
const origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
const get = k => { try { return LS.getItem(k); } catch { return null; } };
const put = (k, v) => { try { origSet.call(LS, k, v); } catch { } };
const del = k => { try { origRemove.call(LS, k); } catch { } };
const num = k => Number(get(k) || 0);

let user = null, timer = null, busy = null;
export const cuenta = { get user() { return user; } };

function snapshot() {
  const d = {};
  for (const k of KEYS) { const v = get(k); if (v != null) { try { d[k] = JSON.parse(v); } catch { } } }
  return d;
}
function apply(data, rev) {
  for (const k of KEYS) { if (data && data[k] != null) put(k, JSON.stringify(data[k])); else del(k); }
  put('hrRev', String(rev || 0)); put('hrSynced', String(rev || 0));
}
const dirty = () => num('hrRev') > num('hrSynced');
async function api(body, timeout = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch('/api/cuenta', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { cache: 'no-store', signal: ctl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'No se pudo conectar'); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(t); }
}

// cada vez que el juego guarda algo de tu progreso, se marca con la hora y se sube (1,5 s después, juntando cambios)
Storage.prototype.setItem = function (k, v) { origSet.call(this, k, v); if (this === LS && KEYS.includes(k)) changed(); };
Storage.prototype.removeItem = function (k) { origRemove.call(this, k); if (this === LS && KEYS.includes(k)) changed(); };
function changed() {
  if (!user) return;
  put('hrRev', String(Math.max(Date.now(), num('hrRev') + 1)));
  clearTimeout(timer); timer = setTimeout(push, 1500);
}
// sube lo de este compu. true = quedó guardado (o ya estaba)
function push() {
  if (busy) return busy.then(() => dirty() ? push() : true);
  busy = (async () => {
    if (!user || user.offline) return false;
    if (!dirty()) return true;
    const rev = num('hrRev');
    try {
      const j = await api({ accion: 'guardar', rev, data: snapshot() });
      if (j.ok) { if (num('hrSynced') < rev) put('hrSynced', String(rev)); }
      else if (j.stale && j.rev > rev) apply(j.data, j.rev);      // la nube tiene algo más nuevo (otro compu): manda la nube
      return !dirty();
    } catch (e) {
      if (e.status === 401) { user = null; return false; }       // la sesión venció
      clearTimeout(timer); timer = setTimeout(push, 15000);        // sin internet: lo intenta de nuevo
      return false;
    }
  })().finally(() => { busy = null; });
  return busy;
}
addEventListener('pagehide', () => {
  if (!user || user.offline || !dirty()) return;
  navigator.sendBeacon?.('/api/cuenta', new Blob([JSON.stringify({ accion: 'guardar', rev: num('hrRev'), data: snapshot() })], { type: 'application/json' }));
});

// al abrir el juego: si tienes sesión, trae tu progreso (o sube lo de este compu si es más nuevo)
export async function cuentaInit() {
  const mine = get('hrSyncUser');
  try {
    const j = await api(null, 3500); user = j.user;
    if (!user) { if (mine) { for (const k of ['hrSyncUser', 'hrRev', 'hrSynced']) del(k); } return; }
    if (mine !== user.usuario) apply(user.data, user.rev);                     // otro usuario o compu nuevo: lo de la cuenta
    else if (user.rev > num('hrRev')) apply(user.data, user.rev);             // la nube es más nueva
    else if (dirty()) push();                                                  // este compu tiene cambios sin subir
    put('hrSyncUser', user.usuario);
  } catch {
    if (mine) user = { usuario: mine, offline: true };      // sin internet: sigue marcando tus cambios para subirlos después
  }
}
// crear cuenta: se lleva el progreso que tienes ahora en este compu
export async function registro(usuario, pin) {
  const rev = Math.max(Date.now(), num('hrRev'));
  const j = await api({ accion: 'registro', usuario, pin, rev, data: snapshot() });
  user = j.user; put('hrSyncUser', user.usuario); put('hrRev', String(rev)); put('hrSynced', String(rev));
  return user;
}
// entrar: trae el progreso de la cuenta (si la cuenta está vacía, sube lo de este compu)
export async function entrar(usuario, pin) {
  const j = await api({ accion: 'entrar', usuario, pin });
  user = j.user; put('hrSyncUser', user.usuario);
  if (user.data && Object.keys(user.data).length) apply(user.data, user.rev);
  else { put('hrSynced', '0'); put('hrRev', String(Math.max(Date.now(), user.rev + 1))); await push(); }
  return user;
}
// salir: primero sube lo último. Si no se puede (sin internet), NO borra nada y avisa.
export async function salir() {
  if (user?.offline) throw new Error('Sin internet: conéctate para salir sin perder tu progreso');
  if (!(await push())) throw new Error('No se pudo guardar tu progreso. Revisa el internet y prueba otra vez.');
  await api({ accion: 'salir' });
  user = null; clearTimeout(timer);
  for (const k of [...KEYS, 'hrSyncUser', 'hrRev', 'hrSynced']) del(k);
}
