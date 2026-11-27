// crea las tablas de cuentas (una sola vez): node --env-file=.env.local scripts/crear-tablas.mjs
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
await sql`create table if not exists hr_users (
  id serial primary key, usuario text unique not null, pin_hash text not null, data jsonb,
  rev bigint not null default 0, fails int not null default 0, locked_until timestamptz, created_at timestamptz default now(), updated_at timestamptz default now())`;
await sql`alter table hr_users add column if not exists rev bigint not null default 0`;   // bases creadas antes de rev
await sql`alter table hr_users add column if not exists dev text`;
await sql`alter table hr_users add column if not exists dseq bigint not null default 0`;
await sql`create table if not exists hr_sessions (token_hash text primary key, user_id int not null references hr_users(id) on delete cascade, expires_at timestamptz not null)`;
await sql`create index if not exists hr_sessions_user on hr_sessions(user_id)`;
console.log('tablas listas', (await sql`select count(*)::int n from hr_users`)[0]);
