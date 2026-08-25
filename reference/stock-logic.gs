/**
 * โค้ดอ้างอิง — ส่วนที่ระบบจริง (malanadaengstock) ยังไม่มี
 * ---------------------------------------------------------------------------
 * ⚠️ ไฟล์นี้ "ห้ามเอาไปวางใน Apps Script ของระบบจริง" ตรง ๆ
 *    เก็บไว้เป็นแหล่งอ้างอิงตอนเขียนหน้าลงสต็อกในระบบจริงเท่านั้น
 *    ส่วนที่ซ้ำกับระบบจริง (login, แจ้งวันหมดอายุ, คำนวณของหาย, สร้างชีต)
 *    ลบออกไปแล้ว เพราะระบบจริงมีอยู่แล้วและดีกว่า
 *
 * สิ่งที่เหลือไว้ในไฟล์นี้ 3 กลุ่ม:
 *   1) แปลงหน่วย 2 ระดับ  toBase_ / splitPack_ / fmtPack_
 *      เช่น ไส้กรอกหนังกรอบ 7 ไม้ = 1 แพ็ค → 26 ไม้ = "3 แพ็ค 5 ไม้"
 *      ระบบเก็บยอดจริงเป็น "หน่วยย่อย" เสมอ แล้วแปลงกลับเป็นแพ็คตอนแสดงผล
 *   2) คำนวณยอดคงเหลือจากรายการเคลื่อนไหว  balances_ / balanceOf_
 *   3) เตือนของครัวกลางใกล้หมด  checkLowStock_ / lowStockDaily
 *      จุดสำคัญ: เตือนตอน "ตกลงมาต่ำกว่าจุดเตือน" ครั้งเดียว ไม่ใช่เตือนทุกครั้งที่ส่งของ
 *
 * ตอนยกไปใช้จริงต้องแก้ 2 อย่าง:
 *   - ชื่อชีต/คอลัมน์ ให้ตรงกับชีตจริง (จำนวนของเข้า / เช็คสต็อกรายสัปดาห์ / ของเสีย)
 *   - lineToken_ / linePush_ ใช้ sendLine_ ใน line-expiry-alert.gs แทน จะได้มี token ที่เดียว
 */

var TZ = 'Asia/Bangkok';

// ชื่อชีตของระบบเดิม — ระบบจริงใช้คนละชื่อ ต้องแมปใหม่ตอนยกไปใช้
var SH = {
  ITEMS:     'รายการสินค้า',
  LOCATIONS: 'สถานที่',
  STOCKIN:   'ของเข้าครัวกลาง',
  TOSHOP:    'ของเข้าร้าน',
  WASTE:     'ของเสีย',
  COUNT:     'เช็คสต็อก'
};

var LOC_CENTRAL = 'ครัวกลาง';
var LOC_BRANCH  = 'สาขา';

var I_COLS  = ['สินค้า', 'หน่วยย่อย', 'หน่วยแพ็ค', 'หน่วยย่อยต่อแพ็ค', 'ราคาขาย/หน่วยย่อย',
               'อายุเก็บ(วัน)', 'เตือนเมื่อเหลือ(แพ็ค)', 'หมวด', 'หมายเหตุ'];
var L_COLS  = ['สถานที่', 'ประเภท', 'LINE Group ID', 'เปิดใช้งาน'];

var OUT_WASTE = 'ของเสีย';    // ทิ้ง/เน่า/หมดอายุ
var OUT_FREE  = 'แถมฟรี';     // เช่น น้ำจิ้มที่แถมให้ลูกค้า

var UNIT_SUB  = ['ไม้', 'กรัม', 'ชิ้น'];
var UNIT_PACK = ['แพ็ค', 'ถุง'];

function toBase_(packs, rem, perPack) {
  var p = Math.max(0, Math.floor(Number(packs) || 0));
  var r = Math.max(0, Number(rem) || 0);
  return p * (Number(perPack) || 0) + r;
}
/** หน่วยย่อยรวม → {packs, rem} */

function splitPack_(base, perPack) {
  base = Number(base) || 0; perPack = Number(perPack) || 0;
  if (perPack <= 0) return { packs: 0, rem: base };
  var neg = base < 0, a = Math.abs(base);
  var p = Math.floor(a / perPack), r = a - p * perPack;
  return { packs: neg ? -p : p, rem: neg ? -r : r };
}
/** ข้อความอ่านง่าย เช่น "3 แพ็ค 5 ไม้" */

function fmtPack_(base, it) {
  var s = splitPack_(base, it.perPack);
  if (it.perPack <= 0) return (Number(base) || 0) + ' ' + it.subUnit;
  if (s.packs && s.rem) return s.packs + ' ' + it.packUnit + ' ' + s.rem + ' ' + it.subUnit;
  if (s.packs) return s.packs + ' ' + it.packUnit;
  return s.rem + ' ' + it.subUnit;
}

function round_(n, d) { var f = Math.pow(10, d || 0); return Math.round((Number(n) || 0) * f) / f; }

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

function thaiDate_(iso) {
  if (!iso) return '-';
  var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return String(iso);
  var m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return d.getDate() + ' ' + m[d.getMonth()] + ' ' + ((d.getFullYear() + 543) % 100);
}

function idx_(cols) { var o = {}; cols.forEach(function (c, i) { o[c] = i; }); return o; }

function rowsOf_(name, cols) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
}

/* ===================== ยอดคงเหลือ ===================== */
/** คืน { สถานที่: { สินค้า: ยอดหน่วยย่อย } } */

function getItems_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.ITEMS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, I_COLS.length).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return {
        name: String(r[0]).trim(),
        subUnit: String(r[1] || 'ชิ้น').trim(),
        packUnit: String(r[2] || 'แพ็ค').trim(),
        perPack: Number(r[3]) || 0,
        price: Number(r[4]) || 0,
        shelfDays: Number(r[5]) || 0,
        lowPacks: Number(r[6]) || 0,
        category: String(r[7] || '')
      };
    });
}

function getLocations_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.LOCATIONS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, L_COLS.length).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return {
        name: String(r[0]).trim(),
        type: String(r[1] || LOC_BRANCH).trim(),
        groupId: String(r[2] || '').trim(),
        active: r[3] !== false
      };
    });
}

function centralName_() {
  var l = getLocations_().filter(function (x) { return x.type === LOC_CENTRAL; });
  return l.length ? l[0].name : 'ครัวกลาง';
}

function groupIdOf_(locName) {
  var l = getLocations_();
  for (var i = 0; i < l.length; i++) if (l[i].name === locName) return l[i].groupId;
  return '';
}

/* ===================== แปลงหน่วย ===================== */
/** แพ็ค + เศษ → หน่วยย่อยรวม */

function balances_() {
  var b = {};
  function add(loc, item, qty) {
    if (!loc || !item) return;
    if (!b[loc]) b[loc] = {};
    b[loc][item] = (b[loc][item] || 0) + (Number(qty) || 0);
  }
  var central = centralName_();

  var si = idx_(SI_COLS);
  rowsOf_(SH.STOCKIN, SI_COLS).forEach(function (r) {
    add(central, r[si['สินค้า']], r[si['รวม(หน่วยย่อย)']]);
  });

  var ts = idx_(TS_COLS);
  rowsOf_(SH.TOSHOP, TS_COLS).forEach(function (r) {
    var q = Number(r[ts['รวม(หน่วยย่อย)']]) || 0;
    add(central, r[ts['สินค้า']], -q);
    add(r[ts['สาขา']], r[ts['สินค้า']], q);
  });

  var w = idx_(W_COLS);
  rowsOf_(SH.WASTE, W_COLS).forEach(function (r) {
    add(r[w['สถานที่']], r[w['สินค้า']], -(Number(r[w['รวม(หน่วยย่อย)']]) || 0));
  });

  // ส่วนต่างจากการนับสต็อก (เฉพาะรายการที่เลือก "ปรับสต็อก")
  var c = idx_(C_COLS);
  rowsOf_(SH.COUNT, C_COLS).forEach(function (r) {
    if (r[c['ปรับสต็อก']] === true || String(r[c['ปรับสต็อก']]) === 'ปรับ') {
      add(r[c['สถานที่']], r[c['สินค้า']], Number(r[c['ส่วนต่าง']]) || 0);
    }
  });

  return b;
}

function balanceOf_(loc, item) {
  var b = balances_();
  return (b[loc] && b[loc][item]) || 0;
}

/* ===================== API: ข้อมูลตั้งต้นของหน้า ===================== */

function lineToken_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') || '';
}

function linePush_(to, text) {
  var token = lineToken_();
  if (!token) return { sent: false, msg: 'ยังไม่ได้ตั้งค่า LINE_TOKEN' };
  if (!to) return { sent: false, msg: 'สถานที่นี้ยังไม่ได้ใส่ LINE Group ID' };
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true,
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] })
    });
    var c = res.getResponseCode();
    return { sent: c === 200, msg: c === 200 ? 'ส่งแล้ว' : ('LINE error ' + c + ': ' + res.getContentText()) };
  } catch (err) { return { sent: false, msg: String(err) }; }
}

function checkLowStock_(itemNames) {
  var central = centralName_();
  var map = {};
  getItems_().forEach(function (i) { map[i.name] = i; });
  var bal = balances_()[central] || {};
  var props = PropertiesService.getScriptProperties();
  var hits = [];

  (itemNames || []).forEach(function (n) {
    var it = map[n];
    if (!it || !(it.lowPacks > 0)) return;
    var limit = it.lowPacks * (it.perPack > 0 ? it.perPack : 1);
    var have = Number(bal[n]) || 0;
    var key = 'LOW_' + n;
    var wasLow = props.getProperty(key) === '1';
    var isLow = have <= limit;
    if (isLow && !wasLow) { hits.push({ it: it, have: have, limit: limit }); props.setProperty(key, '1'); }
    else if (!isLow && wasLow) { props.deleteProperty(key); }
  });

  if (!hits.length) return { sent: false };
  var text = '⚠️ ของครัวกลางใกล้หมด\n' +
    hits.map(function (h) {
      return '• ' + h.it.name + '  เหลือ ' + fmtPack_(h.have, h.it) +
             '  (จุดเตือน ' + h.it.lowPacks + ' ' + h.it.packUnit + ')';
    }).join('\n') +
    '\n\nเตรียมเสียบเพิ่มหรือสั่งของได้แล้ว';
  return linePush_(groupIdOf_(central), text);
}

/** สรุปของใกล้หมดทั้งหมด (รันเองจากเมนู หรือตั้งเป็นทริกเกอร์รายวัน) */

function lowStockDaily() {
  var central = centralName_();
  var items = getItems_();
  var bal = balances_()[central] || {};
  var low = items.filter(function (it) {
    if (!(it.lowPacks > 0)) return false;
    var limit = it.lowPacks * (it.perPack > 0 ? it.perPack : 1);
    return (Number(bal[it.name]) || 0) <= limit;
  });
  if (!low.length) {
    return linePush_(groupIdOf_(central), '✅ สรุปสต็อกครัวกลาง (' + thaiDate_(today_()) + ')\nไม่มีของต่ำกว่าจุดเตือน');
  }
  low.sort(function (a, b) {
    return (Number(bal[a.name]) || 0) / (a.perPack || 1) - (Number(bal[b.name]) || 0) / (b.perPack || 1);
  });
  var text = '⚠️ สรุปของครัวกลางใกล้หมด (' + thaiDate_(today_()) + ')\n' +
    low.slice(0, 25).map(function (it) {
      return '• ' + it.name + '  เหลือ ' + fmtPack_(Number(bal[it.name]) || 0, it) +
             '  (จุดเตือน ' + it.lowPacks + ' ' + it.packUnit + ')';
    }).join('\n') +
    (low.length > 25 ? ('\n… และอีก ' + (low.length - 25) + ' รายการ') : '');
  return linePush_(groupIdOf_(central), text);
}

/** เมนู: ทดสอบสรุปของใกล้หมดเดี๋ยวนี้ */
