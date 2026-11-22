/**
 * Work Trip endpoint. Runs as the deploying user and writes to a "Work Trips" spreadsheet it creates.
 *
 * One-time setup (see README): run setup(), then seed() if you have SeedData.gs, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * Every request must carry the API key that setup() generates.
 */

var TZ = 'Australia/Perth';
var VEHICLE = '1HNK143';
var TRIPS = 'Trips';
var FYTAB = 'FY Odometer';
var TRIPS_HEADER = ['Date', 'Vehicle', 'ODO start', 'ODO finish', 'Distance (km)', 'Source', 'Purpose', 'Check', 'Trip ID'];
var FY_HEADER = ['FY', 'Opening ODO', 'Closing ODO', 'Total km', 'Business km', 'Private km', 'Note'];

function props_() {
  return PropertiesService.getScriptProperties();
}

/** Creates the spreadsheet and the API key. Safe to run again: it never replaces either. */
function setup() {
  var p = props_();
  var ss;
  if (p.getProperty('SHEET_ID')) {
    ss = SpreadsheetApp.openById(p.getProperty('SHEET_ID'));
  } else {
    ss = SpreadsheetApp.create('Work Trips');
    ss.setSpreadsheetTimeZone(TZ);
    var first = ss.getSheets()[0];
    first.setName(TRIPS);
    ss.insertSheet(FYTAB);
    p.setProperty('SHEET_ID', ss.getId());

    var t = ss.getSheetByName(TRIPS);
    t.getRange(1, 1, 1, TRIPS_HEADER.length).setValues([TRIPS_HEADER]).setFontWeight('bold');
    t.setFrozenRows(1);
    t.getRange('A2:A').setNumberFormat('dd/mm/yyyy');

    var f = ss.getSheetByName(FYTAB);
    f.getRange(1, 1, 1, FY_HEADER.length).setValues([FY_HEADER]).setFontWeight('bold');
    f.setFrozenRows(1);
  }
  if (!p.getProperty('API_KEY')) {
    p.setProperty('API_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
  }
  Logger.log('Sheet: ' + ss.getUrl());
  Logger.log('API key (paste into the app): ' + p.getProperty('API_KEY'));
}

/** One-time history import from SeedData.gs. Idempotent: rows are keyed by Trip ID. */
function seed() {
  if (typeof SEED === 'undefined') {
    Logger.log('No SeedData.gs found - nothing to import.');
    return;
  }
  var added = 0;
  for (var i = 0; i < SEED.length; i++) {
    var r = SEED[i];
    var res = addTrip_({
      id: 'seed-' + (i + 1),
      date: r[0],
      odoStart: r[1],
      odoFinish: r[2],
      distance: r[3],
      source: r[4],
      purpose: r[5],
      check: r[6]
    });
    if (!res.dup) added++;
  }
  Logger.log('Seed rows added: ' + added + ' of ' + SEED.length);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!body.key || body.key !== props_().getProperty('API_KEY')) return json_({ ok: false, error: 'unauthorised' });
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (body.action === 'state') return json_(state_());
      if (body.action === 'addTrip') return json_(addTrip_(body.trip));
      if (body.action === 'setFy') return json_(setFy_(body));
      return json_({ ok: false, error: 'unknown action' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: false, error: 'POST only' });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  return SpreadsheetApp.openById(props_().getProperty('SHEET_ID'));
}

function fyOf_(iso) {
  var y = parseInt(iso.substr(0, 4), 10);
  var m = parseInt(iso.substr(5, 2), 10);
  return m >= 7 ? y : y - 1;
}

function num_(v) {
  return v === '' || v === null || v === undefined ? '' : Number(v);
}

function state_() {
  var ss = ss_();
  var sh = ss.getSheetByName(TRIPS);
  var n = sh.getLastRow() - 1;
  var rows = n > 0 ? sh.getRange(2, 1, n, 9).getValues() : [];
  var best = null;
  var fys = {};
  var all = [];
  rows.forEach(function (r, i) {
    if (!(r[0] instanceof Date)) return;
    var iso = Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd');
    fys[fyOf_(iso)] = true;
    var fin = r[3] === '' ? null : Number(r[3]);
    if (fin !== null && (best === null || iso >= best.date)) best = { date: iso, finish: fin };
    all.push({
      row: i,
      date: iso,
      odoStart: r[2] === '' ? null : Number(r[2]),
      odoFinish: fin,
      distance: Number(r[4]),
      source: r[5],
      purpose: r[6],
      check: r[7]
    });
  });
  all.sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : b.row - a.row;
  });

  var fsh = ss.getSheetByName(FYTAB);
  var fn = fsh.getLastRow() - 1;
  var fyRows = fn > 0 ? fsh.getRange(2, 1, fn, 7).getValues() : [];
  var fy = fyRows.map(function (r) {
    return {
      fy: parseInt(String(r[0]).substr(2, 4), 10),
      opening: r[1] === '' ? null : Number(r[1]),
      closing: r[2] === '' ? null : Number(r[2]),
      note: r[6] || ''
    };
  });

  return {
    ok: true,
    lastFinish: best ? best.finish : null,
    lastDate: best ? best.date : null,
    tripFys: Object.keys(fys).map(Number),
    fy: fy,
    recent: all.slice(0, 5)
  };
}

function addTrip_(t) {
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) return { ok: false, error: 'bad date' };
  if (isNaN(Number(t.distance))) return { ok: false, error: 'bad distance' };
  if (!t.id) return { ok: false, error: 'missing id' };

  var sh = ss_().getSheetByName(TRIPS);
  if (sh.getLastRow() > 1 && sh.getRange(2, 9, sh.getLastRow() - 1, 1).createTextFinder(String(t.id)).matchEntireCell(true).findNext()) {
    return { ok: true, dup: true };
  }
  var row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 9).setValues([[
    Utilities.parseDate(t.date, TZ, 'yyyy-MM-dd'),
    t.vehicle || VEHICLE,
    num_(t.odoStart),
    num_(t.odoFinish),
    Number(t.distance),
    t.source || 'ODO',
    t.purpose || '',
    t.check || '',
    String(t.id)
  ]]);
  sh.getRange(row, 1).setNumberFormat('dd/mm/yyyy');
  return { ok: true };
}

/** Upserts one financial year. A null opening/closing keeps what is already there. */
function setFy_(f) {
  var fy = parseInt(f.fy, 10);
  if (isNaN(fy)) return { ok: false, error: 'bad fy' };
  var label = 'FY' + fy + '-' + ('0' + ((fy + 1) % 100)).slice(-2);
  var sh = ss_().getSheetByName(FYTAB);
  var last = sh.getLastRow();
  var row = 0;
  var cur = ['', '', '', '', '', '', ''];
  if (last > 1) {
    var labels = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < labels.length; i++) {
      if (labels[i][0] === label) {
        row = i + 2;
        cur = sh.getRange(row, 1, 1, 7).getValues()[0];
        break;
      }
    }
  }
  if (!row) row = last + 1;

  var opening = f.opening !== null && f.opening !== undefined ? Number(f.opening) : cur[1];
  var closing = f.closing !== null && f.closing !== undefined ? Number(f.closing) : cur[2];
  var note = f.note ? String(f.note) : cur[6];
  var from = 'DATE(' + fy + ',7,1)';
  var to = 'DATE(' + (fy + 1) + ',6,30)';

  sh.getRange(row, 1, 1, 7).setValues([[label, opening, closing, '', '', '', note]]);
  sh.getRange(row, 4).setFormula('=IF(AND(B' + row + '<>"",C' + row + '<>""),C' + row + '-B' + row + ',"")');
  sh.getRange(row, 5).setFormula('=SUMIFS(' + TRIPS + '!E:E,' + TRIPS + '!A:A,">="&' + from + ',' + TRIPS + '!A:A,"<="&' + to + ')');
  sh.getRange(row, 6).setFormula('=IF(D' + row + '="","",D' + row + '-E' + row + ')');
  return { ok: true };
}
