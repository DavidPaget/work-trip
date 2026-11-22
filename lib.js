// Pure helpers, shared by the app and the node tests. No DOM access here.

export const VEHICLE = '1HNK143';

/** Financial year start year for an ISO date. 2025 = FY2025-26 (1 Jul 2025 to 30 Jun 2026). */
export function fyOf(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 7 ? y : y - 1;
}

export function fyLabel(fy) {
  return `FY${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

export function fmtOdo(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Local calendar date as yyyy-mm-dd (never UTC, so a late trip stays on the right day). */
export function localIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses a typed odometer reading. Returns null for anything that is not a plain number. */
export function parseNum(s) {
  const t = String(s ?? '').trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function validateFinish(start, finishStr) {
  const v = parseNum(finishStr);
  if (v === null) return { ok: false, error: 'Enter the finish odometer reading' };
  if (v < start) return { ok: false, error: 'Finish ODO is below the start ODO' };
  return { ok: true, value: v };
}

/** Latest finish ODO: a queued (unsynced) trip beats the server's cached value. */
export function lastFinish(cache, queue) {
  const queued = queue
    .filter((o) => o.action === 'addTrip' && o.payload.trip.odoFinish != null)
    .map((o) => o.payload.trip);
  if (queued.length) return queued[queued.length - 1].odoFinish;
  return cache?.lastFinish ?? null;
}

/** Server FY readings with queued setFy operations applied on top. */
export function mergedFy(cache, queue) {
  const map = new Map((cache?.fy ?? []).map((r) => [r.fy, { ...r }]));
  for (const o of queue) {
    if (o.action !== 'setFy') continue;
    const p = o.payload;
    const r = map.get(p.fy) ?? { fy: p.fy, opening: null, closing: null, note: '' };
    if (p.opening != null) r.opening = p.opening;
    if (p.closing != null) r.closing = p.closing;
    if (p.note) r.note = p.note;
    map.set(p.fy, r);
  }
  return [...map.values()].sort((a, b) => a.fy - b.fy);
}

export function tripFys(cache, queue) {
  const set = new Set(cache?.tripFys ?? []);
  for (const o of queue) if (o.action === 'addTrip') set.add(fyOf(o.payload.trip.date));
  return set;
}

/** Which FY readings to nag about on the home screen. */
export function neededFyReadings(todayIso, fysWithTrips, readings) {
  const cur = fyOf(todayIso);
  const need = [];
  if (!readings.some((r) => r.fy === cur && r.opening != null)) need.push({ fy: cur, kind: 'opening' });
  if (fysWithTrips.has(cur - 1) && !readings.some((r) => r.fy === cur - 1 && r.closing != null)) {
    need.push({ fy: cur - 1, kind: 'closing' });
  }
  return need;
}

/** Note for a reading that was not taken on 1 July (opening) or 30 June (closing). */
export function fyNote(fy, todayIso, next, prev) {
  const notes = [];
  if (next.opening != null && next.opening !== prev?.opening && todayIso !== `${fy}-07-01`) {
    notes.push(`Opening not taken on the day (entered ${todayIso})`);
  }
  if (next.closing != null && next.closing !== prev?.closing && todayIso !== `${fy + 1}-06-30`) {
    notes.push(`Closing not taken on the day (entered ${todayIso})`);
  }
  return notes.join('; ');
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
