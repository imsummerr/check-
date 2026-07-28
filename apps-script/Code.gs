/**
 * ระบบบันทึกของเข้า–ออก ครัวกลางหม่าล่า + แจ้งเตือน LINE + คำนวณของหาย
 * ---------------------------------------------------------------------
 * ทำงานบน Google Apps Script (ผูกกับ Google Sheet)
 *  - เป็นทั้งฐานข้อมูล (Google Sheet) และเว็บแอป (HtmlService)
 *  - แจ้งเตือนผ่าน LINE Official Account (Messaging API)
 *
 * ตั้งค่าครั้งแรก: เปิดชีต > เมนู "🌶️ ระบบสต็อก" > "1) ติดตั้งครั้งแรก"
 * แล้วทำตามไฟล์ SETUP.md
 */

/* ===================== ค่าคงที่ ===================== */
var TZ = 'Asia/Bangkok';

var SH = {
  ITEMS:    'รายการสินค้า',
  BRANCHES: 'สาขา',
  TRANSFER: 'บันทึกโอน',
  STOCKIN:  'รับเข้าครัวกลาง',
  SUMMARY:  'สรุป',
  LINEIDS:  'LINE_IDs'
};

var CENTRAL_NAME = 'ครัวกลาง';

// ลำดับหัวคอลัมน์ของชีต "บันทึกโอน" (ห้ามสลับลำดับ)
var T_COLS = [
  'รหัส', 'วันที่', 'เวลาบันทึก', 'สินค้า', 'น้ำหนักเข้า(กรัม)', 'ที่กรอก',
  'จาก', 'ไปสาขา', 'กรัมต่อถุง', 'ควรแพ็ค(ถุง)', 'สถานะ',
  'แพ็คได้(ถุง)', 'น้ำหนักที่แพ็ค(กรัม)', 'ของหาย(ถุง)', 'ของหาย(กรัม)',
  'เวลาแพ็ค', 'ผู้แพ็ค', 'ผู้บันทึก', 'หมายเหตุ'
];

var STATUS_WAIT = 'รอแพ็ค';
var STATUS_DONE = 'แพ็คแล้ว';

/* ===================== เมนูในชีต ===================== */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🌶️ ระบบสต็อก')
    .addItem('1) ติดตั้งครั้งแรก (สร้างชีต + ตัวอย่าง)', 'setup')
    .addItem('อัปเดตหน้า "สรุป"', 'updateSummary')
    .addSeparator()
    .addItem('แสดงลิงก์เว็บแอป', 'showWebAppUrl')
    .addToUi();
}

/* ===================== ติดตั้งครั้งแรก ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ---- รายการสินค้า ----
  var items = ensureSheet_(ss, SH.ITEMS, ['สินค้า', 'กรัมต่อถุง', 'หมวด', 'หมายเหตุ']);
  if (items.getLastRow() < 2) {
    items.getRange(2, 1, 3, 4).setValues([
      ['สันคอ',        30, 'เนื้อสัตว์', 'ตัวอย่าง — แก้ได้'],
      ['หมูสามชั้น',   30, 'เนื้อสัตว์', ''],
      ['ผักกาดขาว',    50, 'ผัก',        '']
    ]);
  }

  // ---- สาขา ----
  var br = ensureSheet_(ss, SH.BRANCHES, ['สาขา', 'LINE Group ID', 'เปิดใช้งาน']);
  if (br.getLastRow() < 2) {
    br.getRange(2, 1, 2, 3).setValues([
      ['สาขา 1', '', true],
      ['สาขา 2', '', true]
    ]);
  }

  // ---- บันทึกโอน ----
  ensureSheet_(ss, SH.TRANSFER, T_COLS);

  // ---- รับเข้าครัวกลาง (ไว้ทำ FIFO ต้นทาง) ----
  ensureSheet_(ss, SH.STOCKIN, ['วันที่', 'สินค้า', 'น้ำหนัก(กรัม)', 'ที่กรอก', 'ผู้ส่ง/ซัพพลายเออร์', 'ผู้บันทึก', 'หมายเหตุ']);

  // ---- LINE IDs (ใช้เก็บ Group ID ที่จับได้จาก webhook) ----
  ensureSheet_(ss, SH.LINEIDS, ['เวลา', 'ประเภท', 'sourceId', 'ข้อความ/เหตุการณ์']);

  // ---- สรุป ----
  ensureSheet_(ss, SH.SUMMARY, ['สินค้า', 'ส่งออก (กรัม)', 'ส่งออก (กก.)', 'ควรแพ็ครวม (ถุง)', 'แพ็คได้จริง (ถุง)', 'ของหาย (ถุง)', 'ของหาย (กรัม)', 'ของหาย %', 'จำนวนครั้ง']);

  updateSummary();

  SpreadsheetApp.getUi().alert(
    'ติดตั้งเรียบร้อย ✅\n\n' +
    'ขั้นต่อไป (ดูละเอียดในไฟล์ SETUP.md):\n' +
    '1. Deploy > New deployment > Web app (Execute as: me, Access: Anyone)\n' +
    '2. เอา URL ที่ได้ ไปตั้งเป็น Webhook ของ LINE Messaging API\n' +
    '3. ใส่ Channel access token ที่เมนู Project Settings > Script Properties (คีย์ LINE_TOKEN)\n' +
    '4. ดึงบอทเข้ากลุ่มไลน์สาขา แล้วพิมพ์ "id" ในกลุ่ม เพื่อรับ Group ID มาใส่ชีต "สาขา"'
  );
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var cur = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn() || 1)).getValues()[0];
  var needHeader = !cur[0];
  if (needHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#c0392b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ===================== เว็บ (doGet) ===================== */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
  var tmpl;
  if (page === 'pack') {
    tmpl = HtmlService.createTemplateFromFile('Pack');
    tmpl.transferId = (e.parameter.id || '');
  } else if (page === 'entry') {
    tmpl = HtmlService.createTemplateFromFile('Entry');
  } else {
    tmpl = HtmlService.createTemplateFromFile('Index');
  }
  return tmpl.evaluate()
    .setTitle('ระบบสต็อกครัวกลางหม่าล่า')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getWebAppUrl_() {
  return ScriptApp.getService().getUrl();
}

function showWebAppUrl() {
  var url = getWebAppUrl_();
  SpreadsheetApp.getUi().alert(
    url ? ('ลิงก์เว็บแอป:\n\n' + url + '\n\n(เปิดลิงก์นี้เพื่อกรอกของออกจากครัวกลาง)')
        : 'ยังไม่ได้ Deploy เป็น Web app — ไปที่ Deploy > New deployment ก่อน'
  );
}

/* ===================== API ที่หน้าเว็บเรียก ===================== */

/** ข้อมูลตั้งต้นสำหรับหน้ากรอกของออก */
function getEntryData() {
  return {
    items: getItems_(),        // [{name, gramsPerBag, category}]
    branches: getBranches_(),  // [{name, groupId, active}]
    webAppUrl: getWebAppUrl_()
  };
}

/** ครัวกลางกรอกของออกไปสาขา */
function submitTransfer(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SH.TRANSFER);

    var item = String(payload.item || '').trim();
    var branch = String(payload.branch || '').trim();
    if (!item) throw new Error('กรุณาเลือกสินค้า');
    if (!branch) throw new Error('กรุณาเลือกสาขา');

    var grams = toGrams_(payload.weight, payload.unit);
    if (!(grams > 0)) throw new Error('กรุณากรอกน้ำหนักให้ถูกต้อง');

    var gpb = gramsPerBag_(item);            // กรัมต่อถุงจากชีต "รายการสินค้า"
    var expectedBags = gpb > 0 ? Math.floor(grams / gpb) : '';

    var now = new Date();
    var id = 'TF' + Utilities.formatDate(now, TZ, 'yyMMddHHmmss') +
             '-' + Math.floor(Math.random() * 900 + 100);
    var dateStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    var timeStr = Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm');
    var entered = String(payload.weight) + ' ' + (payload.unit || '');

    var row = objToTransferRow_({
      'รหัส': id, 'วันที่': dateStr, 'เวลาบันทึก': timeStr, 'สินค้า': item,
      'น้ำหนักเข้า(กรัม)': grams, 'ที่กรอก': entered, 'จาก': CENTRAL_NAME,
      'ไปสาขา': branch, 'กรัมต่อถุง': gpb || '', 'ควรแพ็ค(ถุง)': expectedBags,
      'สถานะ': STATUS_WAIT, 'ผู้บันทึก': String(payload.staff || '')
    });
    sh.appendRow(row);

    // ---- แจ้งเตือน LINE เข้ากลุ่มสาขา ----
    var lineResult = notifyBranchNewTransfer_(branch, {
      id: id, item: item, entered: entered, grams: grams,
      gpb: gpb, expectedBags: expectedBags
    });

    updateSummary();
    return {
      ok: true, id: id, expectedBags: expectedBags, gpb: gpb, grams: grams,
      lineSent: lineResult.sent, lineMsg: lineResult.msg
    };
  } finally {
    lock.releaseLock();
  }
}

/** ดึงรายละเอียดรายการโอน (ใช้ในหน้าแพ็ค) */
function getTransfer(id) {
  var found = findTransfer_(id);
  if (!found) throw new Error('ไม่พบรายการนี้ (id: ' + id + ')');
  return found.obj;
}

/** พนักงานสาขากรอกจำนวนที่แพ็คได้ */
function submitPack(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var id = String(payload.id || '').trim();
    var found = findTransfer_(id);
    if (!found) throw new Error('ไม่พบรายการนี้');

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
    var o = found.obj;

    var packedBags = Number(payload.packedBags);
    if (!(packedBags >= 0)) throw new Error('กรุณากรอกจำนวนถุงที่แพ็คได้');

    var gpb = Number(o['กรัมต่อถุง']) || 0;
    var expectedBags = Number(o['ควรแพ็ค(ถุง)']) || 0;
    var packedWeight = payload.packedWeight !== '' && payload.packedWeight != null
      ? Number(payload.packedWeight) : (gpb ? packedBags * gpb : '');

    var lossBags = expectedBags ? (expectedBags - packedBags) : '';
    var lossGrams = (lossBags !== '' && gpb) ? lossBags * gpb : '';

    var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');

    setTransferCell_(sh, found.rowIndex, 'สถานะ', STATUS_DONE);
    setTransferCell_(sh, found.rowIndex, 'แพ็คได้(ถุง)', packedBags);
    setTransferCell_(sh, found.rowIndex, 'น้ำหนักที่แพ็ค(กรัม)', packedWeight);
    setTransferCell_(sh, found.rowIndex, 'ของหาย(ถุง)', lossBags);
    setTransferCell_(sh, found.rowIndex, 'ของหาย(กรัม)', lossGrams);
    setTransferCell_(sh, found.rowIndex, 'เวลาแพ็ค', now);
    setTransferCell_(sh, found.rowIndex, 'ผู้แพ็ค', String(payload.packer || ''));
    if (payload.note) setTransferCell_(sh, found.rowIndex, 'หมายเหตุ', String(payload.note));

    // ยืนยันกลับเข้ากลุ่มสาขา
    notifyBranchPacked_(o['ไปสาขา'], {
      item: o['สินค้า'], entered: o['ที่กรอก'], expectedBags: expectedBags,
      packedBags: packedBags, lossBags: lossBags, lossGrams: lossGrams,
      packer: String(payload.packer || '')
    });

    updateSummary();
    return {
      ok: true, item: o['สินค้า'], expectedBags: expectedBags,
      packedBags: packedBags, lossBags: lossBags, lossGrams: lossGrams
    };
  } finally {
    lock.releaseLock();
  }
}

/** ข้อมูลสรุปสำหรับหน้า Index */
function getDashboard() {
  var agg = aggregate_();
  return {
    perItem: agg.perItem,
    totals: agg.totals,
    recent: getRecentTransfers_(15),
    webAppUrl: getWebAppUrl_()
  };
}

/* ===================== ตัวช่วยอ่านชีต ===================== */
function getItems_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.ITEMS);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    return { name: String(r[0]).trim(), gramsPerBag: Number(r[1]) || 0, category: String(r[2] || '') };
  });
}

function getBranches_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.BRANCHES);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    return { name: String(r[0]).trim(), groupId: String(r[1] || '').trim(), active: r[2] !== false };
  });
}

function gramsPerBag_(itemName) {
  var items = getItems_();
  for (var i = 0; i < items.length; i++) {
    if (items[i].name === itemName) return items[i].gramsPerBag;
  }
  return 0;
}

function branchGroupId_(branchName) {
  var brs = getBranches_();
  for (var i = 0; i < brs.length; i++) {
    if (brs[i].name === branchName) return brs[i].groupId;
  }
  return '';
}

function toGrams_(weight, unit) {
  var w = Number(weight);
  if (!(w > 0)) return 0;
  unit = String(unit || '').trim();
  if (unit === 'กรัม' || unit === 'g' || unit === 'กก.รวมเศษ') return w;
  // ค่าเริ่มต้นถือเป็นกิโล
  return Math.round(w * 1000);
}

/* ---- แปลง object <-> แถวของชีต "บันทึกโอน" ---- */
function objToTransferRow_(obj) {
  return T_COLS.map(function (c) { return obj.hasOwnProperty(c) ? obj[c] : ''; });
}

function findTransfer_(id) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
  if (!sh || sh.getLastRow() < 2) return null;
  var idCol = T_COLS.indexOf('รหัส') + 1;
  var ids = sh.getRange(2, idCol, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var rowIndex = i + 2;
      var vals = sh.getRange(rowIndex, 1, 1, T_COLS.length).getValues()[0];
      var obj = {};
      T_COLS.forEach(function (c, j) { obj[c] = vals[j]; });
      return { rowIndex: rowIndex, obj: obj };
    }
  }
  return null;
}

function setTransferCell_(sh, rowIndex, colName, value) {
  var col = T_COLS.indexOf(colName) + 1;
  if (col > 0) sh.getRange(rowIndex, col).setValue(value);
}

function getRecentTransfers_(n) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
  if (!sh || sh.getLastRow() < 2) return [];
  var last = sh.getLastRow();
  var count = Math.min(n, last - 1);
  var vals = sh.getRange(last - count + 1, 1, count, T_COLS.length).getValues();
  var out = vals.map(function (r) {
    var o = {}; T_COLS.forEach(function (c, j) { o[c] = r[j]; }); return o;
  });
  return out.reverse();
}

/* ===================== สรุป / FIFO ===================== */
function aggregate_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
  var perItem = {};
  var totals = { outG: 0, expBags: 0, packedBags: 0, lossBags: 0, lossG: 0, n: 0 };
  if (sh && sh.getLastRow() >= 2) {
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, T_COLS.length).getValues();
    var idx = {};
    T_COLS.forEach(function (c, j) { idx[c] = j; });
    v.forEach(function (r) {
      var item = r[idx['สินค้า']];
      if (!item) return;
      var o = perItem[item] || (perItem[item] = { item: item, outG: 0, expBags: 0, packedBags: 0, lossBags: 0, lossG: 0, n: 0 });
      var g = Number(r[idx['น้ำหนักเข้า(กรัม)']]) || 0;
      o.outG += g; totals.outG += g;
      o.expBags += Number(r[idx['ควรแพ็ค(ถุง)']]) || 0;
      totals.expBags += Number(r[idx['ควรแพ็ค(ถุง)']]) || 0;
      o.n++; totals.n++;
      if (r[idx['สถานะ']] === STATUS_DONE) {
        o.packedBags += Number(r[idx['แพ็คได้(ถุง)']]) || 0;
        o.lossBags += Number(r[idx['ของหาย(ถุง)']]) || 0;
        o.lossG += Number(r[idx['ของหาย(กรัม)']]) || 0;
        totals.packedBags += Number(r[idx['แพ็คได้(ถุง)']]) || 0;
        totals.lossBags += Number(r[idx['ของหาย(ถุง)']]) || 0;
        totals.lossG += Number(r[idx['ของหาย(กรัม)']]) || 0;
      }
    });
  }
  var arr = Object.keys(perItem).map(function (k) { return perItem[k]; });
  arr.sort(function (a, b) { return b.outG - a.outG; });
  return { perItem: arr, totals: totals };
}

function updateSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH.SUMMARY) ||
    ensureSheet_(ss, SH.SUMMARY, ['สินค้า', 'ส่งออก (กรัม)', 'ส่งออก (กก.)', 'ควรแพ็ครวม (ถุง)', 'แพ็คได้จริง (ถุง)', 'ของหาย (ถุง)', 'ของหาย (กรัม)', 'ของหาย %', 'จำนวนครั้ง']);
  var agg = aggregate_();
  // เคลียร์ข้อมูลเก่า (คงหัวตาราง)
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 9).clearContent();
  var rows = agg.perItem.map(function (o) {
    var pct = o.expBags ? (o.lossBags / o.expBags * 100) : 0;
    return [o.item, o.outG, round_(o.outG / 1000, 2), o.expBags, o.packedBags,
            o.lossBags, o.lossG, round_(pct, 1), o.n];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, 9).setValues(rows);
}

function round_(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }

/* ===================== LINE (Messaging API) ===================== */
function lineToken_() {
  return PropertiesService.getScriptProperties().getProperty('LINE_TOKEN') || '';
}

function linePush_(to, text) {
  var token = lineToken_();
  if (!token) return { sent: false, msg: 'ยังไม่ได้ตั้งค่า LINE_TOKEN' };
  if (!to) return { sent: false, msg: 'สาขานี้ยังไม่ได้ใส่ LINE Group ID' };
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      muteHttpExceptions: true,
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] })
    });
    var code = res.getResponseCode();
    return { sent: code === 200, msg: code === 200 ? 'ส่งแล้ว' : ('LINE error ' + code + ': ' + res.getContentText()) };
  } catch (err) {
    return { sent: false, msg: String(err) };
  }
}

function lineReply_(replyToken, text) {
  var token = lineToken_();
  if (!token || !replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true,
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] })
  });
}

function notifyBranchNewTransfer_(branch, d) {
  var url = getWebAppUrl_();
  var link = url + '?page=pack&id=' + encodeURIComponent(d.id);
  var kg = round_(d.grams / 1000, 2);
  var expLine = d.expectedBags !== '' && d.expectedBags != null
    ? ('📦 ควรแพ็คได้ ~' + d.expectedBags + ' ถุง (' + d.gpb + ' ก./ถุง)')
    : '📦 (ยังไม่ได้ตั้งค่ากรัม/ถุงของสินค้านี้)';
  var text =
    '🔔 มีของเข้า → ' + branch + '\n' +
    '• ' + d.item + '  ' + d.entered + '  (' + kg + ' กก.)\n' +
    expLine + '\n\n' +
    '👉 แพ็คเสร็จแล้วกดกรอกที่นี่:\n' + link;
  return linePush_(branchGroupId_(branch), text);
}

function notifyBranchPacked_(branch, d) {
  var lossTxt;
  if (d.lossBags === '' || d.lossBags == null) {
    lossTxt = '📊 บันทึกแล้ว';
  } else if (d.lossBags > 0) {
    lossTxt = '⚠️ ของหาย/ขาด ' + d.lossBags + ' ถุง' + (d.lossGrams ? (' (~' + d.lossGrams + ' ก.)') : '');
  } else if (d.lossBags < 0) {
    lossTxt = '✅ แพ็คได้เกินคาด ' + Math.abs(d.lossBags) + ' ถุง';
  } else {
    lossTxt = '✅ ครบพอดี ไม่มีของหาย';
  }
  var text =
    '✅ แพ็คเสร็จ: ' + d.item + ' (' + d.entered + ')\n' +
    '• ควรได้ ' + d.expectedBags + ' ถุง / แพ็คจริง ' + d.packedBags + ' ถุง\n' +
    lossTxt + (d.packer ? ('\n• โดย ' + d.packer) : '');
  return linePush_(branchGroupId_(branch), text);
}

/* ===================== LINE webhook (doPost) ===================== */
/**
 * ตั้ง URL /exec เป็น Webhook ของ LINE Messaging API
 * - จับ Group ID ให้อัตโนมัติ: พิมพ์ "id" ในกลุ่ม บอทจะตอบ Group ID กลับมา
 * - ตอนดึงบอทเข้ากลุ่ม (join) ก็จะตอบ Group ID เช่นกัน
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var events = body.events || [];
    events.forEach(function (ev) {
      var src = ev.source || {};
      var sid = src.groupId || src.roomId || src.userId || '';
      var type = src.type || '';
      var replyToken = ev.replyToken;

      if (ev.type === 'join') {
        logLineId_(type, sid, 'บอทเข้ากลุ่ม');
        lineReply_(replyToken, '👋 พร้อมใช้งาน!\nGroup ID นี้คือ:\n' + sid + '\n\nนำไปวางในชีต "สาขา" คอลัมน์ LINE Group ID');
      } else if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        var txt = String(ev.message.text || '').trim().toLowerCase();
        if (txt === 'id' || txt === 'groupid' || txt === 'ไอดี') {
          logLineId_(type, sid, 'ขอ id');
          lineReply_(replyToken, 'Group ID:\n' + sid + '\n\nนำไปวางในชีต "สาขา" คอลัมน์ LINE Group ID');
        }
      }
    });
  } catch (err) {
    // ไม่ต้องทำอะไร — ต้องตอบ 200 เสมอเพื่อไม่ให้ LINE retry รัว
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function logLineId_(type, sid, note) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SH.LINEIDS) || ensureSheet_(ss, SH.LINEIDS, ['เวลา', 'ประเภท', 'sourceId', 'ข้อความ/เหตุการณ์']);
    sh.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), type, sid, note]);
  } catch (err) {}
}
