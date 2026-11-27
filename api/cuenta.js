// Cuentas de HYBRID.RACE: usuario + PIN (sin correo ni datos personales).
// GET: quién soy y mi progreso · POST {accion: "registro"|"entrar"|"salir"|"guardar", usuario, pin, data}
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'hr_s', DAYS = 365, MAX_DATA = 300_000, MAX_FAILS = 6, LOCK_MIN = 15;
let _sql = null;
const db = () => (_sql ??= neon(process.env.DATABASE_URL));
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

async function hashPin(pin) { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(pin, salt, 64)).toString('hex')}`; }
async function checkPin(pin, stored) { const [salt, hash] = String(stored).split(':'); const t = await scrypt(pin, salt, 64); const h = Buffer.from(hash, 'hex'); return h.length === t.length && crypto.timingSafeEqual(t, h); }

function readCookie(req) { const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`)); return m ? m[1] : null; }
function setCookie(res, token, age) { res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}`); }
async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db()`insert into hr_sessions (token_hash, user_id, expires_at) values (${sha256(token)}, ${userId}, now() + make_interval(days => ${DAYS}))`;
  setCookie(res, token, DAYS * 86400);
}
async function current(req) {
  const t = readCookie(req); if (!t) return null;
  const r = await db()`select u.id, u.usuario, u.data, u.updated_at, u.rev from hr_sessions s join hr_users u on u.id = s.user_id
                       where s.token_hash = ${sha256(t)} and s.expires_at > now()`;
  return r[0] || null;
}
function body(req) { if (req.body && typeof req.body === 'object') return req.body; try { return JSON.parse(req.body || '{}'); } catch { return {}; } }
const pub = u => ({ usuario: u.usuario, data: u.data || null, rev: Number(u.rev || 0) });

// el progreso: un objeto con las partes guardadas del juego (atleta, personaje, tiempos…), con tamaño máximo
function cleanData(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const s = JSON.stringify(d); if (s.length > MAX_DATA) return null;
  return s;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') { const u = await current(req); return res.json({ user: u ? pub(u) : null }); }
    if (req.method !== 'POST') return res.status(405).end();
    const b = body(req), accion = b.accion;

    if (accion === 'salir') {
      const t = readCookie(req); if (t) await db()`delete from hr_sessions where token_hash = ${sha256(t)}`;
      setCookie(res, '', 0); return res.json({ ok: true });
    }
    if (accion === 'guardar') {
      const u = await current(req); if (!u) return res.status(401).json({ error: 'Entra a tu cuenta' });
      const d = cleanData(b.data); if (!d) return res.status(400).json({ error: 'Progreso inválido o muy grande' });
      // el servidor numera cada guardado (no depende del reloj del compu)
      const r = await db()`update hr_users set data = ${d}::jsonb, rev = rev + 1, updated_at = now() where id = ${u.id} returning rev`;
      return res.json({ ok: true, rev: Number(r[0].rev) });
    }

    const usuario = String(b.usuario || '').trim().toLowerCase(), pin = String(b.pin || '');
    if (!/^[a-z0-9_.]{3,16}$/.test(usuario)) return res.status(400).json({ error: 'El usuario: 3 a 16 letras, números, _ o .' });
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'El PIN: 4 a 6 números' });

    if (accion === 'registro') {
      const d = b.data == null ? null : cleanData(b.data);
      if (b.data != null && !d) return res.status(400).json({ error: 'Tu progreso es muy grande para guardarlo' });
      const r = await db()`insert into hr_users (usuario, pin_hash, data, rev) values (${usuario}, ${await hashPin(pin)}, ${d}::jsonb, 1)
                           on conflict (usuario) do nothing returning id, usuario, data, rev`;
      if (!r.length) return res.status(409).json({ error: 'Ese usuario ya existe' });
      await startSession(res, r[0].id);
      return res.json({ user: pub(r[0]) });
    }
    if (accion === 'entrar') {
      // se "gasta" el intento ANTES de revisar el PIN (en una sola operación): así varios intentos a la vez no se saltan el límite
      const r = await db()`update hr_users set
          fails = case when locked_until is not null and locked_until <= now() then 1 else fails + 1 end,
          locked_until = case when (case when locked_until is not null and locked_until <= now() then 1 else fails + 1 end) >= ${MAX_FAILS}
                              then now() + make_interval(mins => ${LOCK_MIN}) else null end
        where usuario = ${usuario} and (locked_until is null or locked_until <= now())
        returning id, usuario, pin_hash, data, rev`;
      const u = r[0];
      if (!u) {
        const ex = await db()`select 1 from hr_users where usuario = ${usuario}`;
        return ex.length ? res.status(429).json({ error: `Muchos intentos. Prueba en ${LOCK_MIN} minutos.` }) : res.status(401).json({ error: 'Usuario o PIN incorrectos' });
      }
      if (!(await checkPin(pin, u.pin_hash))) return res.status(401).json({ error: 'Usuario o PIN incorrectos' });
      await db()`update hr_users set fails = 0, locked_until = null where id = ${u.id}`;
      await startSession(res, u.id);
      return res.json({ user: pub(u) });
    }
    return res.status(400).json({ error: 'Acción desconocida' });
  } catch (e) {
    console.error('cuenta', e?.message);
    return res.status(500).json({ error: 'Error del servidor, prueba otra vez' });
  }
}
