import assert from 'node:assert/strict';
import * as L from '../lib.js';

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log('ok -', name);
};

t('fyOf splits at 1 July', () => {
  assert.equal(L.fyOf('2026-06-30'), 2025);
  assert.equal(L.fyOf('2026-07-01'), 2026);
  assert.equal(L.fyOf('2026-12-31'), 2026);
  assert.equal(L.fyOf('2027-01-01'), 2026);
});

t('fyLabel', () => {
  assert.equal(L.fyLabel(2025), 'FY2025-26');
  assert.equal(L.fyLabel(2026), 'FY2026-27');
  assert.equal(L.fyLabel(2099), 'FY2099-00');
});

t('parseNum accepts plain numbers only', () => {
  assert.equal(L.parseNum('90827'), 90827);
  assert.equal(L.parseNum(' 90,827.5 '), 90827.5);
  assert.equal(L.parseNum(''), null);
  assert.equal(L.parseNum('abc'), null);
  assert.equal(L.parseNum('-5'), null);
  assert.equal(L.parseNum('12 km'), null);
});

t('validateFinish', () => {
  assert.deepEqual(L.validateFinish(100, '150'), { ok: true, value: 150 });
  assert.deepEqual(L.validateFinish(100, '100'), { ok: true, value: 100 });
  assert.equal(L.validateFinish(100, '99').ok, false);
  assert.equal(L.validateFinish(100, '').ok, false);
});

t('localIso uses the local calendar day', () => {
  assert.equal(L.localIso(new Date(2026, 10, 22, 23, 59)), '2026-11-22');
  assert.equal(L.localIso(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});

t('lastFinish prefers a queued trip over the cache', () => {
  const cache = { lastFinish: 90827 };
  assert.equal(L.lastFinish(cache, []), 90827);
  const q = [{ action: 'addTrip', payload: { trip: { odoFinish: 90900 } } }];
  assert.equal(L.lastFinish(cache, q), 90900);
  assert.equal(L.lastFinish(null, []), null);
});

t('mergedFy applies queued setFy over server rows without erasing values', () => {
  const cache = { fy: [{ fy: 2025, opening: 79000, closing: null, note: '' }] };
  const q = [{ action: 'setFy', payload: { fy: 2025, opening: null, closing: 83900, note: 'late' } }];
  assert.deepEqual(L.mergedFy(cache, q), [{ fy: 2025, opening: 79000, closing: 83900, note: 'late' }]);
});

t('neededFyReadings asks for current opening and previous closing', () => {
  const trips = new Set([2025, 2026]);
  assert.deepEqual(L.neededFyReadings('2026-11-22', trips, []), [
    { fy: 2026, kind: 'opening' },
    { fy: 2025, kind: 'closing' },
  ]);
  const done = [{ fy: 2026, opening: 83900, closing: null }, { fy: 2025, opening: null, closing: 83900 }];
  assert.deepEqual(L.neededFyReadings('2026-11-22', trips, done), []);
  assert.deepEqual(L.neededFyReadings('2026-11-22', new Set([2026]), [{ fy: 2026, opening: 1 }]), []);
});

t('fyNote flags readings not taken on the day', () => {
  assert.equal(L.fyNote(2026, '2026-07-01', { opening: 5 }, null), '');
  assert.equal(L.fyNote(2026, '2026-07-03', { opening: 5 }, null), 'Opening not taken on the day (entered 2026-07-03)');
  assert.equal(L.fyNote(2025, '2026-06-30', { closing: 9 }, null), '');
  assert.equal(L.fyNote(2025, '2026-11-22', { closing: 9 }, { closing: 9 }), '');
  assert.equal(L.fyNote(2025, '2026-11-22', { closing: 9 }, { closing: 8 }), 'Closing not taken on the day (entered 2026-11-22)');
});

t('esc escapes HTML', () => {
  assert.equal(L.esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

console.log(`\n${n} tests passed`);
