// Local stand-in for the Apps Script endpoint, plus a static server for the app.
// It follows the same contract as apps-script/Code.gs, with generic sample data (no client names).
//   node test/mock-server.js   ->   http://localhost:8080   (endpoint: http://localhost:8080/api, key: testkey)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'testkey';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const trips = [
  { id: 's1', date: '2026-11-10', odoStart: 90700, odoFinish: 90740, distance: 40, source: 'ODO', purpose: 'Sample', check: '' },
  { id: 's2', date: '2026-11-17', odoStart: 90786, odoFinish: 90827, distance: 41, source: 'ODO', purpose: 'Sample', check: '' },
];
const fy = [];
let offline = false;

const fyOf = (iso) => (Number(iso.slice(5, 7)) >= 7 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1);

function state() {
  const best = [...trips].filter((t) => t.odoFinish != null).sort((a, b) => (a.date < b.date ? -1 : 1)).at(-1);
  return {
    ok: true,
    lastFinish: best?.odoFinish ?? null,
    lastDate: best?.date ?? null,
    tripFys: [...new Set(trips.map((t) => fyOf(t.date)))],
    fy,
    recent: [...trips].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5),
  };
}

function handle(body) {
  if (body.key !== KEY) return { ok: false, error: 'unauthorised' };
  if (body.action === 'state') return state();
  if (body.action === 'addTrip') {
    const t = body.trip;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t?.date ?? '')) return { ok: false, error: 'bad date' };
    if (trips.some((x) => x.id === t.id)) return { ok: true, dup: true };
    trips.push(t);
    return { ok: true };
  }
  if (body.action === 'setFy') {
    let r = fy.find((x) => x.fy === body.fy);
    if (!r) fy.push((r = { fy: body.fy, opening: null, closing: null, note: '' }));
    if (body.opening != null) r.opening = body.opening;
    if (body.closing != null) r.closing = body.closing;
    if (body.note) r.note = body.note;
    return { ok: true };
  }
  return { ok: false, error: 'unknown action' };
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api' && req.method === 'POST') {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (offline) return res.destroy(); // simulates a dropped connection
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(handle(JSON.parse(data))));
    });
    return;
  }
  // Test controls and inspection.
  if (url.pathname === '/__offline') { offline = url.searchParams.get('on') === '1'; return res.end(`offline=${offline}`); }
  if (url.pathname === '/__dump') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ trips, fy })); }

  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
}).listen(8080, () => console.log('http://localhost:8080  (endpoint /api, key testkey)'));
