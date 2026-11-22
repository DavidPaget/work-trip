import * as L from './lib.js';

const KEY = { cfg: 'wt.cfg', active: 'wt.active', queue: 'wt.queue', cache: 'wt.cache' };

const load = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch { /* storage unavailable: the app still works for this session */ }
};
const drop = (k) => {
  try {
    localStorage.removeItem(k);
  } catch { /* ignore */ }
};

const ui = {
  screen: 'home',
  startOdo: '',
  finishOdo: '',
  error: '',
  logged: '',
  status: '',
  draft: {},
  cfg: load(KEY.cfg, { url: '', key: '' }),
};

// ---- Setup link: #u=<endpoint url>&k=<key> stores the config, then clears the hash. ----
(function readSetupHash() {
  if (!location.hash.includes('u=')) return;
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('u') && p.get('k')) {
    ui.cfg = { url: p.get('u'), key: p.get('k') };
    save(KEY.cfg, ui.cfg);
  }
  history.replaceState(null, '', location.pathname + location.search);
})();

// ---- Server API (Apps Script web app). POST text/plain avoids a CORS preflight. ----
class NetError extends Error {}
class ServerError extends Error {}

async function api(body) {
  if (!ui.cfg.url || !ui.cfg.key) throw new ServerError('not configured');
  let res;
  try {
    res = await fetch(ui.cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: ui.cfg.key }),
    });
  } catch (e) {
    throw new NetError(String(e));
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new NetError('Unreadable response from the endpoint');
  }
  if (!json.ok) throw new ServerError(json.error || 'server error');
  return json;
}

// ---- Offline queue. The server de-duplicates trips by id, so a retry never double-logs. ----
const queue = () => load(KEY.queue, []);

function enqueue(action, payload) {
  const q = queue();
  q.push({ id: crypto.randomUUID(), action, payload });
  save(KEY.queue, q);
}

let flushing = false;
async function flush() {
  if (flushing || !ui.cfg.url) return;
  flushing = true;
  try {
    while (queue().length) {
      const op = queue()[0];
      try {
        await api({ action: op.action, ...op.payload });
      } catch (e) {
        if (e instanceof ServerError && e.message !== 'unauthorised') {
          // A request the server will never accept must not block everything behind it.
          const dead = load('wt.dead', []);
          dead.push({ op, error: e.message });
          save('wt.dead', dead);
        } else {
          throw e;
        }
      }
      const q = queue();
      q.shift();
      save(KEY.queue, q);
    }
    await refresh();
    ui.status = 'All trips synced';
  } catch (e) {
    ui.status = e instanceof ServerError
      ? (e.message === 'unauthorised' ? 'Key rejected. Check Settings.' : `Server error: ${e.message}`)
      : 'Not synced yet. Will retry when online.';
  } finally {
    flushing = false;
    render();
  }
}

async function refresh() {
  const s = await api({ action: 'state' });
  save(KEY.cache, { ...s, at: Date.now() });
  if (!ui.startOdo && !load(KEY.active, null)) {
    const lf = L.lastFinish(s, queue());
    if (lf != null) ui.startOdo = L.fmtOdo(lf);
  }
}

// ---- Actions ----
function startTrip() {
  const odo = L.parseNum(ui.startOdo);
  if (odo === null) {
    ui.error = 'Enter the start odometer reading';
    return render();
  }
  save(KEY.active, { startedAt: new Date().toISOString(), date: L.localIso(), odoStart: odo });
  ui.error = '';
  ui.logged = '';
  ui.finishOdo = '';
  render();
}

function endTrip() {
  const a = load(KEY.active, null);
  if (!a) return;
  const v = L.validateFinish(a.odoStart, ui.finishOdo);
  if (!v.ok) {
    ui.error = v.error;
    return render();
  }
  const trip = {
    id: crypto.randomUUID(),
    date: a.date,
    odoStart: a.odoStart,
    odoFinish: v.value,
    distance: L.round1(v.value - a.odoStart),
    source: 'ODO',
    purpose: '',
    check: '',
    vehicle: L.VEHICLE,
  };
  enqueue('addTrip', { trip });
  drop(KEY.active);
  ui.logged = `Logged ${L.fmtOdo(trip.distance)} km`;
  ui.startOdo = L.fmtOdo(v.value);
  ui.finishOdo = '';
  ui.error = '';
  render();
  flush();
}

function cancelTrip() {
  if (confirm('Discard the trip in progress? Nothing will be logged.')) {
    drop(KEY.active);
    ui.error = '';
    render();
  }
}

function saveFy(fy) {
  const cache = load(KEY.cache, null);
  const prev = L.mergedFy(cache, queue()).find((r) => r.fy === fy);
  const o = L.parseNum(ui.draft[`${fy}.opening`] ?? (prev?.opening != null ? String(prev.opening) : ''));
  const c = L.parseNum(ui.draft[`${fy}.closing`] ?? (prev?.closing != null ? String(prev.closing) : ''));
  if (o === null && c === null) {
    ui.error = 'Enter an opening or closing reading';
    return render();
  }
  const note = L.fyNote(fy, L.localIso(), { opening: o, closing: c }, prev);
  enqueue('setFy', { fy, opening: o, closing: c, note });
  ui.error = '';
  ui.status = 'Saving…';
  render();
  flush();
}

// ---- Rendering ----
const app = document.getElementById('app');

function render() {
  app.innerHTML = ui.screen === 'settings' ? settingsView() : ui.screen === 'fy' ? fyView() : homeView();
}

function homeView() {
  const active = load(KEY.active, null);
  const cache = load(KEY.cache, null);
  const q = queue();
  const last = L.lastFinish(cache, q);
  const readings = L.mergedFy(cache, q);
  const need = L.neededFyReadings(L.localIso(), L.tripFys(cache, q), readings);

  const pending = q.filter((o) => o.action === 'addTrip').map((o) => ({ ...o.payload.trip, pending: true })).reverse();
  const recent = [...pending, ...(cache?.recent ?? [])].slice(0, 5);

  return `
    <h1>Work trip</h1>
    <div class="sub"><span>Vehicle ${L.VEHICLE}</span><button class="link" data-a="settings">Settings</button></div>
    ${ui.cfg.url ? '' : '<div class="card warn"><strong>Not connected.</strong> Open Settings and enter your endpoint URL and key.</div>'}
    ${need.map((n) => `<div class="card warn"><span>${L.fyLabel(n.fy)} ${n.kind} ODO not entered</span><button class="secondary" data-a="fy">Enter reading</button></div>`).join('')}
    ${active ? activeView(active) : startView()}
    ${ui.error ? `<p class="error">${L.esc(ui.error)}</p>` : ''}
    ${ui.logged ? `<p>${L.esc(ui.logged)}</p>` : ''}
    <h2>Recent trips</h2>
    <ul>${recent.map((t) => `<li><span>${L.esc(t.date)} · ${L.fmtOdo(t.distance)} km${t.purpose ? ' · ' + L.esc(t.purpose) : ''}</span>${t.pending ? '<span class="pending">not yet synced</span>' : ''}</li>`).join('') || '<li class="hint">No trips yet</li>'}</ul>
    <p class="hint">${L.esc(ui.status || (q.length ? 'Not yet synced' : ''))}${q.length ? ` (${q.length} waiting)` : ''}</p>
    <button class="secondary" data-a="sync">Sync now</button>
    <button class="secondary" data-a="fy">Financial year readings</button>`;
}

/** Warns when the typed start differs from the last logged finish (private use or a missed trip). */
function gapHtml() {
  const last = L.lastFinish(load(KEY.cache, null), queue());
  const typed = L.parseNum(ui.startOdo);
  if (typed === null || last == null || Math.abs(typed - last) <= 0.5) return '';
  const d = L.fmtOdo(Math.round(Math.abs(typed - last) * 10) / 10);
  return `<p class="hint">Differs from last finish (${L.fmtOdo(last)}) by ${d} km. Private use or a missed trip?</p>`;
}

function startView() {
  return `
    <div class="card">
      <label>Start odometer (km)
        <input type="text" inputmode="decimal" data-bind="startOdo" value="${L.esc(ui.startOdo)}" autocomplete="off">
      </label>
      <div id="gap">${gapHtml()}</div>
      <button data-a="start">Start work trip</button>
    </div>`;
}

function activeView(a) {
  const when = new Date(a.startedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  return `
    <div class="card">
      <strong>Trip in progress</strong>
      <span>Start ODO ${L.fmtOdo(a.odoStart)} · started ${when} on ${L.esc(a.date)}</span>
      <label>Finish odometer (km)
        <input type="text" inputmode="decimal" data-bind="finishOdo" value="${L.esc(ui.finishOdo)}" autocomplete="off">
      </label>
      <button data-a="end">End trip</button>
      <button class="secondary" data-a="cancel">Discard trip</button>
    </div>`;
}

function fyView() {
  const cache = load(KEY.cache, null);
  const q = queue();
  const readings = L.mergedFy(cache, q);
  const cur = L.fyOf(L.localIso());
  const fys = [...new Set([...L.tripFys(cache, q), ...readings.map((r) => r.fy), cur])].sort((a, b) => b - a);
  return `
    <button class="secondary" data-a="home">Back</button>
    <h1>Financial year readings</h1>
    <p class="hint">Opening is your odometer on 1 July, closing on 30 June. A reading entered on another day is saved with a note.</p>
    ${ui.error ? `<p class="error">${L.esc(ui.error)}</p>` : ''}
    ${fys.map((fy) => {
      const r = readings.find((x) => x.fy === fy);
      const o = ui.draft[`${fy}.opening`] ?? (r?.opening != null ? String(r.opening) : '');
      const c = ui.draft[`${fy}.closing`] ?? (r?.closing != null ? String(r.closing) : '');
      return `<div class="card">
        <strong>${L.fyLabel(fy)}</strong>
        <label>Opening ODO (1 Jul ${fy})<input type="text" inputmode="decimal" data-bind="draft:${fy}.opening" value="${L.esc(o)}"></label>
        <label>Closing ODO (30 Jun ${fy + 1})<input type="text" inputmode="decimal" data-bind="draft:${fy}.closing" value="${L.esc(c)}"></label>
        ${r?.note ? `<span class="hint">${L.esc(r.note)}</span>` : ''}
        <button data-a="saveFy" data-fy="${fy}">Save</button>
      </div>`;
    }).join('')}`;
}

function settingsView() {
  return `
    <button class="secondary" data-a="home">Back</button>
    <h1>Settings</h1>
    <div class="card">
      <label>Endpoint URL<input type="url" data-bind="cfg.url" value="${L.esc(ui.cfg.url)}" autocomplete="off"></label>
      <label>API key<input type="password" data-bind="cfg.key" value="${L.esc(ui.cfg.key)}" autocomplete="off"></label>
      <button data-a="saveCfg">Save and test</button>
      ${ui.error ? `<p class="error">${L.esc(ui.error)}</p>` : ''}
      <p class="hint">${L.esc(ui.status)}</p>
    </div>`;
}

// ---- Events ----
document.addEventListener('input', (e) => {
  const b = e.target?.dataset?.bind;
  if (!b) return;
  if (b === 'startOdo') ui.startOdo = e.target.value;
  else if (b === 'finishOdo') ui.finishOdo = e.target.value;
  else if (b.startsWith('draft:')) ui.draft[b.slice(6)] = e.target.value;
  else if (b === 'cfg.url') ui.cfg.url = e.target.value.trim();
  else if (b === 'cfg.key') ui.cfg.key = e.target.value.trim();
  if (b === 'startOdo') {
    // Update only the gap hint, so typing never loses focus.
    const gap = document.getElementById('gap');
    if (gap) gap.innerHTML = gapHtml();
  }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a;
  if (a === 'start') startTrip();
  else if (a === 'end') endTrip();
  else if (a === 'cancel') cancelTrip();
  else if (a === 'sync') { ui.status = 'Syncing…'; render(); flush(); }
  else if (a === 'fy') { ui.screen = 'fy'; ui.error = ''; render(); }
  else if (a === 'settings') { ui.screen = 'settings'; ui.error = ''; ui.status = ''; render(); }
  else if (a === 'home') { ui.screen = 'home'; ui.error = ''; render(); }
  else if (a === 'saveFy') saveFy(Number(el.dataset.fy));
  else if (a === 'saveCfg') {
    save(KEY.cfg, ui.cfg);
    ui.error = '';
    ui.status = 'Testing…';
    render();
    try {
      await api({ action: 'state' });
      ui.status = 'Connected';
      await flush();
    } catch (err) {
      ui.status = '';
      ui.error = err instanceof ServerError
        ? (err.message === 'unauthorised' ? 'The endpoint rejected the key' : `Server error: ${err.message}`)
        : 'Could not reach the endpoint';
    }
    render();
  }
});

window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app works without offline caching */ });
}

// Prefill the start reading from the cache straight away, before the network answers.
{
  const lf = L.lastFinish(load(KEY.cache, null), queue());
  if (lf != null) ui.startOdo = L.fmtOdo(lf);
}
render();
flush();
