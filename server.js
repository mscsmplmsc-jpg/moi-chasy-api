// Запуск того же сервера на обычном хостинге с Node.js (не на Vercel): node server.js
// Нужны те же переменные окружения, что и на Vercel (база Postgres, Redis, VAPID_*, CRON_KEY).
import http from 'node:http';
import handler from './api/index.js';

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (!['/', '/api', '/api/'].includes(u.pathname)) { res.statusCode = 404; res.end('not found'); return; }
  req.query = Object.fromEntries(u.searchParams);
  res.status = s => { res.statusCode = s; return res; };
  res.json = o => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  try { await handler(req, res); } catch (e) { console.log('error', e); res.statusCode = 500; res.end('error'); }
}).listen(process.env.PORT || 3000, () => console.log('server on', process.env.PORT || 3000));
