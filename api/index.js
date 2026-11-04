// Сервер приложения «Мои часы» для Vercel: аккаунты, синхронизация, мессенджер, push.
// Данные хранятся в Postgres (Neon), очередь напоминаний в Redis (Upstash).
import { webcrypto } from 'node:crypto';
import pg from 'pg';

const crypto = globalThis.crypto || webcrypto;
const { Pool, types } = pg;
types.setTypeParser(20, v => Number(v)); // bigint -> число

/* ---------- база данных ---------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(name TEXT PRIMARY KEY, salt TEXT, hash TEXT, created BIGINT, fails INTEGER DEFAULT 0, locked_until BIGINT DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, token TEXT UNIQUE, usr TEXT, label TEXT, created BIGINT, last_seen BIGINT);
CREATE TABLE IF NOT EXISTS docs(usr TEXT, k TEXT, rev INTEGER, data TEXT, PRIMARY KEY(usr, k));
CREATE TABLE IF NOT EXISTS msgs(id BIGSERIAL PRIMARY KEY, a TEXT, b TEXT, frm TEXT, data TEXT, ts BIGINT);
CREATE INDEX IF NOT EXISTS msgs_ab ON msgs(a, b, id);
CREATE TABLE IF NOT EXISTS sigs(id BIGSERIAL PRIMARY KEY, to_user TEXT, frm TEXT, data TEXT, ts BIGINT);
CREATE TABLE IF NOT EXISTS subs(endpoint TEXT PRIMARY KEY, usr TEXT, sub TEXT);
`;
let pool, ready;
const db = () => pool || (pool = new Pool({ connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL, max: 3 }));
const ensure = () => ready || (ready = db().query(SCHEMA).catch(e => { ready = null; throw e; }));
const Q = async (sql, p = []) => { await ensure(); return db().query(sql, p); };
const one = async (sql, p) => (await Q(sql, p)).rows[0] || null;
const all = async (sql, p) => (await Q(sql, p)).rows;
const run = async (sql, p) => (await Q(sql, p)).rowCount;

/* ---------- Redis (очередь напоминаний) ---------- */
const RU = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RT = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function redis(...cmd) {
  if (!RU() || !RT()) throw new Error('Redis не подключён');
  const r = await fetch(RU(), { method: 'POST', headers: { Authorization: 'Bearer ' + RT(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmd.map(String)) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

/* ---------- вспомогательное ---------- */
const enc = new TextEncoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const rnd = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
const normName = n => { n = String(n || '').trim().toLowerCase(); return n.length >= 1 && n.length <= 32 ? n : ''; };
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

/* ---------- Web Push (VAPID + шифрование RFC 8291) ---------- */
async function vapid(endpoint) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(process.env.VAPID_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const c = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + c));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${process.env.VAPID_PUBLIC}`;
}
async function encrypt(sub, payload) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const hk = async (ikm, salt, info, bits) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bits));
  const ikm = await hk(secret, auth, cat(enc.encode('WebPush: info\0'), ua, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hk(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hk(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 96);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc.encode(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0, 65]), asPub, ct);
}
async function push(sub, obj) {
  const body = await encrypt(sub, JSON.stringify(obj));
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: await vapid(sub.endpoint) },
    body,
  });
}
async function notify(user, obj) {
  const rows = await all('SELECT endpoint,sub FROM subs WHERE usr=$1', [user]);
  for (const r of rows) {
    try {
      const res = await push(JSON.parse(r.sub), obj);
      if (res.status === 404 || res.status === 410) await run('DELETE FROM subs WHERE endpoint=$1', [r.endpoint]);
    } catch (e) { console.log('notify error', String(e)); }
  }
}

/* ---------- повторяющиеся напоминания ---------- */
function localMin(ms, tz) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  return Number(p.find(x => x.type === 'hour').value) * 60 + Number(p.find(x => x.type === 'minute').value);
}
function nextDay(at, tz, hm) {
  let n = at + 864e5;
  try {
    const [h, m] = String(hm).split(':').map(Number);
    let diff = h * 60 + m - localMin(n, tz);
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    n += diff * 60e3;
  } catch (e) { /* без поправки */ }
  return n;
}
// вызывается раз в минуту внешним планировщиком
async function cron() {
  const now = Date.now();
  const ids = (await redis('ZRANGEBYSCORE', 'rq', '-inf', now, 'LIMIT', 0, 50)) || [];
  let sent = 0;
  for (const id of ids) {
    if (!(await redis('ZREM', 'rq', id))) continue; // забираем себе, чтобы не отправить дважды
    const raw = await redis('HGET', 'rqd', id);
    if (!raw) continue;
    const x = JSON.parse(raw);
    let retry = false, dead = false;
    try {
      const r = await push(x.sub, { title: x.title, body: x.body });
      if (r.ok) sent++;
      else {
        console.log('push failed', r.status, (await r.text()).slice(0, 200));
        if (r.status === 404 || r.status === 410) dead = true;
        else if ((r.status >= 500 || r.status === 429) && now - x.at < 3600e3) retry = true;
      }
    } catch (e) { console.log('push error', String(e)); retry = now - x.at < 3600e3; }
    if (retry) { await redis('ZADD', 'rq', x.at, id); continue; }
    if (x.rep === 'day' && !dead) {
      let n = nextDay(x.at, x.tz, x.hm), g = 0;
      while (n <= now && g++ < 400) n = nextDay(n, x.tz, x.hm);
      if (!x.until || n <= x.until) { x.at = n; await redis('HSET', 'rqd', id, JSON.stringify(x)); await redis('ZADD', 'rq', n, id); continue; }
    }
    await redis('HDEL', 'rqd', id);
  }
  return { ok: true, sent };
}

/* ---------- аккаунты ---------- */
async function pbkdf(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, k, 256));
}
async function newSession(user, label) {
  const token = rnd(32), id = rnd(6), now = Date.now();
  await run('INSERT INTO sessions(id,token,usr,label,created,last_seen) VALUES($1,$2,$3,$4,$5,$6)', [id, token, user, String(label || 'Устройство').slice(0, 60), now, now]);
  return { token, id };
}
async function sess(tok) {
  if (!tok) return null;
  const r = await one('SELECT * FROM sessions WHERE token=$1', [String(tok)]);
  if (r && Date.now() - r.last_seen > 3e5) await run('UPDATE sessions SET last_seen=$1 WHERE token=$2', [Date.now(), r.token]);
  return r;
}
async function account(d, reply) {
  const name = normName(d.name);
  if (d.op === 'reg') {
    if (!name) return reply({ error: 'Введите имя (до 32 символов)' }, 400);
    if (!d.pass) return reply({ error: 'Введите пароль' }, 400);
    const salt = rnd(12), hash = await pbkdf(String(d.pass), salt);
    const n = await run('INSERT INTO users(name,salt,hash,created) VALUES($1,$2,$3,$4) ON CONFLICT (name) DO NOTHING', [name, salt, hash, Date.now()]);
    if (!n) return reply({ error: 'Это имя уже занято' }, 409);
    const s = await newSession(name, d.label);
    return reply({ ok: true, token: s.token, user: name });
  }
  const u = name && await one('SELECT * FROM users WHERE name=$1', [name]);
  if (!u) return reply({ error: 'Неверное имя или пароль' }, 401);
  if (u.locked_until > Date.now()) return reply({ error: 'Слишком много попыток. Подождите несколько минут.' }, 429);
  if (await pbkdf(String(d.pass || ''), u.salt) !== u.hash) {
    const f = (u.fails || 0) + 1;
    await run('UPDATE users SET fails=$1,locked_until=$2 WHERE name=$3', [f >= 10 ? 0 : f, f >= 10 ? Date.now() + 10 * 60e3 : 0, name]);
    return reply({ error: 'Неверное имя или пароль' }, 401);
  }
  await run('UPDATE users SET fails=0,locked_until=0 WHERE name=$1', [name]);
  if (d.remove) await run('DELETE FROM sessions WHERE id=$1 AND usr=$2', [String(d.remove), name]);
  const ss = await all('SELECT id,label,last_seen AS last FROM sessions WHERE usr=$1 ORDER BY last_seen DESC', [name]);
  if (ss.length >= 3) return reply({ error: 'limit', devices: ss }, 409);
  const s = await newSession(name, d.label);
  return reply({ ok: true, token: s.token, user: name });
}

/* ---------- синхронизация данных ---------- */
const DOCS = ['hours', 'crm', 'rem', 'tsk', 'meta'];
async function synced(s, d, reply) {
  const u = s.usr;
  if (d.op === 'logout') {
    await run('DELETE FROM sessions WHERE token=$1', [s.token]);
    if (d.ep) await run('DELETE FROM subs WHERE endpoint=$1 AND usr=$2', [String(d.ep), u]);
    return reply({ ok: true });
  }
  if (d.op === 'devices') {
    const r = await all('SELECT id,label,last_seen AS last FROM sessions WHERE usr=$1 ORDER BY last_seen DESC', [u]);
    return reply({ ok: true, devices: r.map(x => ({ ...x, current: x.id === s.id })) });
  }
  if (d.op === 'revoke') { await run('DELETE FROM sessions WHERE id=$1 AND usr=$2', [String(d.id), u]); return reply({ ok: true }); }
  if (d.op === 'pull') {
    const docs = {};
    for (const x of await all('SELECT k,rev,data FROM docs WHERE usr=$1', [u])) docs[x.k] = { rev: x.rev, data: x.data };
    return reply({ ok: true, docs });
  }
  if (!DOCS.includes(d.k) || typeof d.data !== 'string' || d.data.length > 3000000) return reply({ error: 'bad doc' }, 400);
  const base = Number(d.base) || 0;
  if (base === 0) {
    const n = await run('INSERT INTO docs(usr,k,rev,data) VALUES($1,$2,1,$3) ON CONFLICT DO NOTHING', [u, d.k, d.data]);
    return n ? reply({ ok: true, rev: 1 }) : reply({ error: 'conflict' }, 409);
  }
  const n = await run('UPDATE docs SET rev=rev+1,data=$1 WHERE usr=$2 AND k=$3 AND rev=$4', [d.data, u, d.k, base]);
  return n ? reply({ ok: true, rev: base + 1 }) : reply({ error: 'conflict' }, 409);
}

/* ---------- мессенджер ---------- */
const CHATOPS = ['peer', 'send', 'poll', 'clear', 'sig', 'subscribe', 'ice'];
const userExists = async n => !!(n && await one('SELECT 1 AS x FROM users WHERE name=$1', [n]));
async function chatOps(s, d, reply) {
  const u = s.usr, now = Date.now();
  if (d.op === 'subscribe') {
    if (!d.sub || !d.sub.endpoint || !d.sub.keys) return reply({ error: 'bad sub' }, 400);
    await run('INSERT INTO subs(endpoint,usr,sub) VALUES($1,$2,$3) ON CONFLICT (endpoint) DO UPDATE SET usr=EXCLUDED.usr, sub=EXCLUDED.sub', [String(d.sub.endpoint), u, JSON.stringify(d.sub)]);
    return reply({ ok: true });
  }
  if (d.op === 'ice') return reply({ ok: true, iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] });
  const peer = normName(d.peer || d.to || d.name);
  if (d.op === 'peer') return reply({ ok: !!peer && peer !== u && await userExists(peer), name: peer });
  if (d.op === 'poll') {
    const out = { ok: true };
    if (peer) {
      const [a, b] = pair(u, peer), since = Number(d.since) || 0;
      out.msgs = since
        ? await all('SELECT id,frm,data,ts FROM msgs WHERE a=$1 AND b=$2 AND id>$3 ORDER BY id LIMIT 200', [a, b, since])
        : await all('SELECT * FROM (SELECT id,frm,data,ts FROM msgs WHERE a=$1 AND b=$2 ORDER BY id DESC LIMIT 200) t ORDER BY id', [a, b]);
    }
    out.chats = await all('SELECT a,b,id,frm,ts FROM msgs WHERE id IN (SELECT MAX(id) FROM msgs WHERE a=$1 OR b=$1 GROUP BY a,b) ORDER BY id DESC LIMIT 50', [u]);
    out.sigs = await all('SELECT id,frm,data,ts FROM sigs WHERE to_user=$1 AND ts>$2 ORDER BY id', [u, now - 90000]);
    if (out.sigs.length) await run('DELETE FROM sigs WHERE to_user=$1 AND id<=$2', [u, out.sigs[out.sigs.length - 1].id]);
    if (Math.random() < 0.05) await run('DELETE FROM sigs WHERE ts<$1', [now - 90000]);
    return reply(out);
  }
  if (!peer || peer === u || !(await userExists(peer))) return reply({ error: 'Пользователь не найден' }, 404);
  if (d.op === 'send') {
    if (typeof d.data !== 'string' || !d.data || d.data.length > 8000) return reply({ error: 'bad message' }, 400);
    const [a, b] = pair(u, peer);
    const r = await one('INSERT INTO msgs(a,b,frm,data,ts) VALUES($1,$2,$3,$4,$5) RETURNING id', [a, b, u, d.data, now]);
    await notify(peer, { title: 'Мессенджер', body: 'Новое сообщение от ' + u });
    return reply({ ok: true, id: r.id, ts: now });
  }
  if (d.op === 'clear') {
    const [a, b] = pair(u, peer);
    await run('DELETE FROM msgs WHERE a=$1 AND b=$2', [a, b]);
    return reply({ ok: true });
  }
  if (d.op === 'sig') {
    if (typeof d.data !== 'string' || d.data.length > 20000) return reply({ error: 'bad signal' }, 400);
    await run('INSERT INTO sigs(to_user,frm,data,ts) VALUES($1,$2,$3,$4)', [peer, u, d.data, now]);
    if (d.notify) await notify(peer, { title: 'Мессенджер', body: u + ' хочет отправить файл. Откройте чат.' });
    return reply({ ok: true });
  }
  return reply({ error: 'unknown op' }, 400);
}

/* ---------- напоминания с push (по секретному коду из настройки) ---------- */
async function legacy(d, reply) {
  // Вход по аккаунту (токен сессии) или по секретному коду TOKEN (прежний способ)
  const s = await sess(d.s);
  if (!s && (!process.env.TOKEN || d.t !== process.env.TOKEN)) return reply({ error: d.s ? 'auth' : 'bad token' }, 401);
  const owned = async id => { // чужие напоминания трогать нельзя
    if (!s) return true;
    const raw = await redis('HGET', 'rqd', id);
    const o = raw ? JSON.parse(raw) : null;
    return !o || !o.usr || o.usr === s.usr;
  };
  if (d.op === 'add') {
    if (!(await owned(String(d.id)))) return reply({ error: 'forbidden' }, 403);
    const x = {
      usr: s ? s.usr : '',
      id: String(d.id), sub: d.sub, title: String(d.title || 'Напоминание').slice(0, 100), body: String(d.body || '').slice(0, 300),
      at: Number(d.at), rep: d.rep === 'day' ? 'day' : '', until: Number(d.until) || 0, tz: String(d.tz || 'UTC'), hm: String(d.hm || ''),
    };
    await redis('HSET', 'rqd', x.id, JSON.stringify(x));
    await redis('ZADD', 'rq', x.at, x.id);
    return reply({ ok: true });
  }
  if (d.op === 'del') {
    if (!(await owned(String(d.id)))) return reply({ error: 'forbidden' }, 403);
    await redis('ZREM', 'rq', String(d.id)); await redis('HDEL', 'rqd', String(d.id));
    return reply({ ok: true });
  }
  if (d.op === 'test') {
    const r = await push(d.sub, { title: 'Проверка', body: 'Уведомления работают' });
    return reply({ ok: r.ok, status: r.status, detail: r.ok ? '' : (await r.text()).slice(0, 200) });
  }
  return reply({ error: 'unknown op' }, 400);
}

/* ---------- проверка настроек: открыть /api?check=1 ---------- */
async function health() {
  const t = async f => { try { await f(); return 'ok'; } catch (e) { return 'ошибка: ' + String(e && e.message || e).slice(0, 90); } };
  return {
    ok: true, v: 3,
    postgres: await t(() => one('SELECT 1 AS x')),
    redis: await t(() => redis('PING')),
    vapid: process.env.VAPID_JWK && process.env.VAPID_PUBLIC && process.env.VAPID_SUBJECT ? 'ok' : 'нет переменных VAPID_JWK, VAPID_PUBLIC или VAPID_SUBJECT',
    cron_key: process.env.CRON_KEY ? 'ok' : 'нет переменной CRON_KEY',
  };
}

/* ---------- вход в функцию ---------- */
async function readBody(req) {
  let b = req.body;
  if (b === undefined || b === null) {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  return typeof b === 'string' ? b : JSON.stringify(b);
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const reply = (o, s = 200) => res.status(s).json(o);
  try {
    const qs = req.query || {};
    if (qs.cron !== undefined) { // запуск рассылки: любой планировщик (GET или POST)
      if (!process.env.CRON_KEY || qs.cron !== process.env.CRON_KEY) return reply({ error: 'bad key' }, 401);
      return reply(await cron());
    }
    if (req.method === 'GET') {
      if (qs.check !== undefined) return reply(await health());
      return reply({ ok: true, info: 'moi-chasy server', v: 3 });
    }
    if (req.method !== 'POST') return reply({ error: 'method' }, 405);
    let d;
    try { d = JSON.parse(await readBody(req)); } catch (e) { return reply({ error: 'bad json' }, 400); }
    if (d.op === 'reg' || d.op === 'login') return await account(d, reply);
    if (CHATOPS.includes(d.op) || ['logout', 'devices', 'revoke', 'pull', 'push'].includes(d.op)) {
      const s = await sess(d.s);
      if (!s) return reply({ error: 'auth' }, 401);
      return CHATOPS.includes(d.op) ? await chatOps(s, d, reply) : await synced(s, d, reply);
    }
    return await legacy(d, reply);
  } catch (e) {
    console.log('error', String(e && e.stack || e));
    return reply({ error: 'Ошибка сервера: ' + String(e && e.message || e).slice(0, 120) }, 500);
  }
}
