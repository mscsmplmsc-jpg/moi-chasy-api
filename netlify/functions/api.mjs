// Тот же сервер, запущенный на Netlify: переводит запрос Netlify в привычный вид и обратно.
import handler from '../../api/index.js';

export default async (request) => {
  const url = new URL(request.url);
  const req = {
    method: request.method,
    query: Object.fromEntries(url.searchParams),
    body: request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS' ? undefined : await request.text(),
  };
  let status = 200;
  const headers = {};
  let finish;
  const done = new Promise(r => { finish = r; });
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status(s) { status = s; return res; },
    json(o) { headers['Content-Type'] = 'application/json'; finish(new Response(JSON.stringify(o), { status, headers })); },
    end() { finish(new Response(null, { status, headers })); },
  };
  try { await handler(req, res); } catch (e) { console.log('error', e); finish(new Response('error', { status: 500 })); }
  return await done;
};

export const config = { path: ['/api', '/api/'] };
