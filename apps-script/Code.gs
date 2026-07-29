/**
 * ระบบบันทึกของเข้า–ออก ครัวกลางหม่าล่า + แจ้งเตือน LINE + คำนวณของหาย
 * ---------------------------------------------------------------------
 * ทำงานบน Google Apps Script (ผูกกับ Google Sheet)
 *  - เป็นทั้งฐานข้อมูล (Google Sheet) และเว็บแอป (HtmlService)
 *  - แจ้งเตือนผ่าน LINE Official Account (Messaging API)
 *
 * รองรับสินค้า 2 แบบ:
 *  1) ชั่งน้ำหนัก  — เช่น สันคอ 30 กรัม/ถุง  → กรอกเป็นกิโล/กรัม
 *  2) นับชิ้น      — เช่น ปูอัด 2 ชิ้น/ไม้    → กรอกเป็นจำนวนชิ้น
 *
 * ตั้งค่าครั้งแรก: เปิดชีต > เมนู "🌶️ ระบบสต็อก" > "1) ติดตั้งครั้งแรก"
 * แล้วทำตามไฟล์ SETUP.md
 */

/* ===================== ค่าคงที่ ===================== */
var TZ = 'Asia/Bangkok';

var SH = {
  ITEMS:     'รายการสินค้า',
  BRANCHES:  'สาขา',
  TRANSFER:  'บันทึกโอน',
  STOCKIN:   'รับเข้าครัวกลาง',
  SUMMARY:   'สรุป',
  BRANCHSUM: 'สรุปสาขา',
  LINEIDS:   'LINE_IDs'
};

var CENTRAL_NAME = 'ครัวกลาง';

var U_GRAM  = 'กรัม';   // หน่วยวัดแบบชั่ง
var U_PIECE = 'ชิ้น';   // หน่วยวัดแบบนับ

// หัวคอลัมน์ชีต "รายการสินค้า" (ห้ามสลับลำดับ)
var I_COLS = ['สินค้า', 'ปริมาณต่อหน่วย', 'หน่วยวัด', 'หน่วยขาย', 'หมวด', 'หมายเหตุ'];

// หัวคอลัมน์ชีต "รับเข้าครัวกลาง" (ห้ามสลับลำดับ)
var SI_COLS = ['วันที่', 'สินค้า', 'ปริมาณเข้า', 'หน่วยวัด', 'ที่กรอก',
               'ผู้ส่ง/ซัพพลายเออร์', 'ผู้บันทึก', 'หมายเหตุ'];

// หัวคอลัมน์ชีต "บันทึกโอน" (ห้ามสลับลำดับ)
var T_COLS = [
  'รหัส', 'วันที่', 'เวลาบันทึก', 'สินค้า', 'ปริมาณเข้า', 'หน่วยวัด', 'ที่กรอก',
  'จาก', 'ไปสาขา', 'ปริมาณต่อหน่วย', 'หน่วยขาย', 'ควรแพ็ค', 'สถานะ',
  'แพ็คได้', 'ของหาย', 'ของหายคิดเป็น', 'เวลาแพ็ค', 'ผู้แพ็ค', 'ผู้บันทึก', 'หมายเหตุ'
];

var STATUS_WAIT = 'รอแพ็ค';
var STATUS_DONE = 'แพ็คแล้ว';

/**
 * รายการสินค้าตั้งต้น — [ชื่อ, ปริมาณต่อหน่วยขาย, หน่วยวัด, หน่วยขาย, หมวด]
 * แก้ไข/เพิ่ม/ลบ ได้ที่ชีต "รายการสินค้า" โดยตรง (ไม่ต้องแก้โค้ด)
 */
var DEFAULT_ITEMS = [
  // ---- เนื้อสัตว์ (ชั่งกรัม) ----
  ['สันคอ',                30, U_GRAM,  'ถุง', 'เนื้อสัตว์'],
  ['หมูสามชั้น',           30, U_GRAM,  'ถุง', 'เนื้อสัตว์'],
  ['เนื้อแดง',             30, U_GRAM,  'ถุง', 'เนื้อสัตว์'],
  // ---- ทะเล (ชั่งกรัม) ----
  ['หมึก',                 35, U_GRAM,  'ถุง', 'ทะเล'],
  ['ปลาดอลลี่',            35, U_GRAM,  'ถุง', 'ทะเล'],
  ['ปลาหมึกกรอบ',          35, U_GRAM,  'ถุง', 'ทะเล'],
  ['แมงกะพรุน',            35, U_GRAM,  'ถุง', 'ทะเล'],
  // ---- ผัก (ชั่งกรัม) ----
  ['ผักกาดขาว',           100, U_GRAM,  'ถุง', 'ผัก'],
  ['กะหล่ำ',              100, U_GRAM,  'ถุง', 'ผัก'],
  ['ผักบุ้ง',             100, U_GRAM,  'ถุง', 'ผัก'],
  ['กวางตุ้ง',             50, U_GRAM,  'ถุง', 'ผัก'],
  ['เห็ดเข็มทอง',          50, U_GRAM,  'ถุง', 'ผัก'],
  ['เห็ดชิเมจิ',           50, U_GRAM,  'ถุง', 'ผัก'],
  ['รากบัว',               50, U_GRAM,  'ถุง', 'ผัก'],
  ['ข้าวโพด',              25, U_GRAM,  'ถุง', 'ผัก'],
  ['สาหร่าย',               5, U_GRAM,  'ถุง', 'ผัก'],
  ['เห็ดออรินจิ',          50, U_GRAM,  'ถุง', 'ผัก'],   // ← ตรวจสอบค่ากรัม/ถุง
  // ---- เส้น/แป้ง (ชั่งกรัม) ----
  ['เส้นมันเทศ',           55, U_GRAM,  'ถุง', 'เส้น/แป้ง'],
  ['เส้นอุด้ง',            50, U_GRAM,  'ถุง', 'เส้น/แป้ง'],

  // ---- เสียบไม้ (นับชิ้น → ได้เป็น "ไม้") ----
  ['ต็อก',                  5, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ไส้กรอกพันเบคอน',       3, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['เต้าหู้หมู',            3, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ฟองเต้าหู้สามเหลี่ยม',  3, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ปูอัด',                 2, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['เต้าหู้ชีส',            2, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ชีสหลายสี',             2, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['เต้าหู้หลอด',           1, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ปูอัดชีส',              1, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ปูอัดยาว',              1, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['เต้าหู้ปลาแผ่น',        1, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ฟองเต้าหู้',            1, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ไส้กรอกหนังกรอบ',       1, U_PIECE, 'ไม้', 'เสียบไม้'],
  ['ไส้กรอกชมพู',           1, U_PIECE, 'ไม้', 'เสียบไม้'],
  // ---- แปรรูป/อื่น ๆ (นับชิ้น → ได้เป็น "ถุง") ----
  ['ควิซ',                  1, U_PIECE, 'ถุง', 'แปรรูป'],
  ['วุ้นเส้นหม่าล่า',       1, U_PIECE, 'ถุง', 'เส้น/แป้ง'],
  ['มาม่า (ทุกชนิด)',       1, U_PIECE, 'ถุง', 'เส้น/แป้ง']
];

/* ===================== เมนูในชีต ===================== */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🌶️ ระบบสต็อก')
    .addItem('1) ติดตั้งครั้งแรก (สร้างชีต + รายการสินค้า)', 'setup')
    .addItem('อัปเดตหน้า "สรุป"', 'updateSummary')
    .addSeparator()
    .addItem('🧪 ทดสอบส่ง LINE ทุกสาขา', 'testLineAll')
    .addItem('แสดงลิงก์เว็บแอป', 'showWebAppUrl')
    .addToUi();
}

/* ===================== ติดตั้งครั้งแรก ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ---- รายการสินค้า ----
  var items = ensureSheet_(ss, SH.ITEMS, I_COLS);
  if (items.getLastRow() < 2) {
    var rows = DEFAULT_ITEMS.map(function (r) {
      return [r[0], r[1], r[2], r[3], r[4], ''];
    });
    items.getRange(2, 1, rows.length, I_COLS.length).setValues(rows);
    items.setColumnWidth(1, 190);
    // ตัวเลือกหน่วยวัดแบบ dropdown กันพิมพ์ผิด
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList([U_GRAM, U_PIECE], true).setAllowInvalid(false).build();
    items.getRange(2, 3, Math.max(rows.length, 200), 1).setDataValidation(rule);
  }

  // ---- สาขา ----
  var br = ensureSheet_(ss, SH.BRANCHES, ['สาขา', 'LINE Group ID', 'เปิดใช้งาน']);
  if (br.getLastRow() < 2) {
    br.getRange(2, 1, 2, 3).setValues([
      ['สาขา 1', '', true],
      ['สาขา 2', '', true]
    ]);
    br.setColumnWidth(2, 320);
  }

  ensureSheet_(ss, SH.TRANSFER, T_COLS);
  ensureSheet_(ss, SH.STOCKIN, SI_COLS);
  ensureSheet_(ss, SH.LINEIDS, ['เวลา', 'ประเภท', 'sourceId', 'ข้อความ/เหตุการณ์']);

  ensureSheet_(ss, SH.SUMMARY, ['สินค้า', 'หน่วยวัด', 'รับเข้า', 'ส่งออก', 'คงเหลือครัวกลาง',
                                'หน่วยขาย', 'ควรแพ็ครวม', 'แพ็คได้จริง', 'ของหาย', 'ของหาย %', 'จำนวนครั้ง']);
  ensureSheet_(ss, SH.BRANCHSUM, ['สาขา', 'ควรแพ็ค', 'แพ็คได้', 'ของหาย', 'ของหาย %', 'จำนวนครั้ง']);

  updateSummary();

  SpreadsheetApp.getUi().alert(
    'ติดตั้งเรียบร้อย ✅\n\n' +
    'ใส่รายการสินค้าให้แล้ว ' + DEFAULT_ITEMS.length + ' รายการ (แก้ไข/เพิ่ม/ลบได้ที่ชีต "รายการสินค้า")\n\n' +
    'ขั้นต่อไป (ดูละเอียดใน SETUP.md):\n' +
    '1. ใส่ชื่อสาขา + LINE Group ID ที่ชีต "สาขา"\n' +
    '2. ใส่ LINE token ที่ Project Settings > Script Properties (คีย์ LINE_TOKEN)\n' +
    '3. Deploy > New deployment > Web app (Execute as: Me, Access: Anyone)\n' +
    '4. ทดสอบด้วยเมนู "🧪 ทดสอบส่ง LINE ทุกสาขา"'
  );
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var cur = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn() || 1)).getValues()[0];
  if (!cur[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold')
      .setBackground('#c0392b').setFontColor('#ffffff');
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
  } else if (page === 'stockin') {
    tmpl = HtmlService.createTemplateFromFile('StockIn');
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

function getWebAppUrl_() { return ScriptApp.getService().getUrl(); }

function showWebAppUrl() {
  var url = getWebAppUrl_();
  SpreadsheetApp.getUi().alert(
    url ? ('ลิงก์เว็บแอป:\n\n' + url) : 'ยังไม่ได้ Deploy เป็น Web app — ไปที่ Deploy > New deployment ก่อน'
  );
}

/* ===================== API ที่หน้าเว็บเรียก ===================== */

function getEntryData() {
  return {
    items: getItems_(),
    branches: getBranches_(),
    balances: balanceMap_(),
    webAppUrl: getWebAppUrl_()
  };
}

function getStockInData() {
  return { items: getItems_(), balances: balanceMap_(), webAppUrl: getWebAppUrl_() };
}

/** ครัวกลางรับของเข้าจากซัพพลายเออร์ */
function submitStockIn(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var it = mustFindItem_(payload.item);
    var qty = toBase_(payload.qty, payload.inputUnit, it.measureUnit);
    if (!(qty > 0)) throw new Error('กรุณากรอกจำนวนให้ถูกต้อง');

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.STOCKIN);
    var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    sh.appendRow([now, it.name, qty, it.measureUnit, enteredText_(payload.qty, payload.inputUnit),
                  String(payload.supplier || ''), String(payload.staff || ''), String(payload.note || '')]);

    updateSummary();
    var b = centralBalance_()[it.name];
    return { ok: true, qty: qty, balance: b ? b.bal : qty, measureUnit: it.measureUnit };
  } finally { lock.releaseLock(); }
}

/** ครัวกลางกรอกของออกไปสาขา */
function submitTransfer(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var branch = String(payload.branch || '').trim();
    if (!branch) throw new Error('กรุณาเลือกสาขา');
    var it = mustFindItem_(payload.item);

    var qty = toBase_(payload.qty, payload.inputUnit, it.measureUnit);
    if (!(qty > 0)) throw new Error('กรุณากรอกจำนวนให้ถูกต้อง');

    var expected = it.perUnit > 0 ? Math.floor(qty / it.perUnit) : '';

    var now = new Date();
    var id = 'TF' + Utilities.formatDate(now, TZ, 'yyMMddHHmmss') +
             '-' + Math.floor(Math.random() * 900 + 100);
    var entered = enteredText_(payload.qty, payload.inputUnit);

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
    sh.appendRow(objToRow_(T_COLS, {
      'รหัส': id,
      'วันที่': Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
      'เวลาบันทึก': Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm'),
      'สินค้า': it.name, 'ปริมาณเข้า': qty, 'หน่วยวัด': it.measureUnit, 'ที่กรอก': entered,
      'จาก': CENTRAL_NAME, 'ไปสาขา': branch,
      'ปริมาณต่อหน่วย': it.perUnit || '', 'หน่วยขาย': it.sellUnit,
      'ควรแพ็ค': expected, 'สถานะ': STATUS_WAIT,
      'ผู้บันทึก': String(payload.staff || '')
    }));

    var line = notifyBranchNewTransfer_(branch, {
      id: id, item: it, entered: entered, qty: qty, expected: expected
    });

    updateSummary();
    return {
      ok: true, id: id, expected: expected, sellUnit: it.sellUnit,
      lineSent: line.sent, lineMsg: line.msg
    };
  } finally { lock.releaseLock(); }
}

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
    var found = findTransfer_(String(payload.id || '').trim());
    if (!found) throw new Error('ไม่พบรายการนี้');
    var o = found.obj;

    var packed = Number(payload.packed);
    if (!(packed >= 0)) throw new Error('กรุณากรอกจำนวนที่แพ็คได้');

    var perUnit = Number(o['ปริมาณต่อหน่วย']) || 0;
    var expected = Number(o['ควรแพ็ค']) || 0;
    var loss = o['ควรแพ็ค'] === '' ? '' : (expected - packed);
    var lossAmt = (loss !== '' && perUnit) ? loss * perUnit : '';

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
    var now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');
    setCell_(sh, T_COLS, found.rowIndex, 'สถานะ', STATUS_DONE);
    setCell_(sh, T_COLS, found.rowIndex, 'แพ็คได้', packed);
    setCell_(sh, T_COLS, found.rowIndex, 'ของหาย', loss);
    setCell_(sh, T_COLS, found.rowIndex, 'ของหายคิดเป็น',
             lossAmt === '' ? '' : (lossAmt + ' ' + o['หน่วยวัด']));
    setCell_(sh, T_COLS, found.rowIndex, 'เวลาแพ็ค', now);
    setCell_(sh, T_COLS, found.rowIndex, 'ผู้แพ็ค', String(payload.packer || ''));
    if (payload.note) setCell_(sh, T_COLS, found.rowIndex, 'หมายเหตุ', String(payload.note));

    notifyBranchPacked_(o['ไปสาขา'], {
      item: o['สินค้า'], entered: o['ที่กรอก'], sellUnit: o['หน่วยขาย'],
      measureUnit: o['หน่วยวัด'], expected: expected, packed: packed,
      loss: loss, lossAmt: lossAmt, packer: String(payload.packer || '')
    });

    updateSummary();
    return { ok: true, expected: expected, packed: packed, loss: loss, lossAmt: lossAmt };
  } finally { lock.releaseLock(); }
}

function getDashboard() {
  var agg = aggregate_();
  var bal = centralBalance_();
  var central = Object.keys(bal).map(function (k) {
    return { item: k, unit: bal[k].unit, inQty: bal[k].inQty, outQty: bal[k].outQty, bal: bal[k].bal };
  });
  central.sort(function (a, b) { return b.bal - a.bal; });
  return {
    perItem: agg.perItem, perBranch: agg.perBranch, perDay: agg.perDay.slice(0, 14),
    central: central, totals: agg.totals,
    recent: getRecentTransfers_(15), webAppUrl: getWebAppUrl_()
  };
}

/* ===================== ตัวช่วย ===================== */
function getItems_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.ITEMS);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, I_COLS.length).getValues();
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    var mu = String(r[2] || '').trim() === U_PIECE ? U_PIECE : U_GRAM;
    return {
      name: String(r[0]).trim(),
      perUnit: Number(r[1]) || 0,
      measureUnit: mu,
      sellUnit: String(r[3] || '').trim() || 'ถุง',
      category: String(r[4] || '')
    };
  });
}

function findItem_(name) {
  var items = getItems_();
  for (var i = 0; i < items.length; i++) if (items[i].name === name) return items[i];
  return null;
}

function mustFindItem_(name) {
  var it = findItem_(String(name || '').trim());
  if (!it) throw new Error('ไม่พบสินค้านี้ในชีต "รายการสินค้า"');
  return it;
}

function getBranches_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.BRANCHES);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
  return v.filter(function (r) { return r[0]; }).map(function (r) {
    return { name: String(r[0]).trim(), groupId: String(r[1] || '').trim(), active: r[2] !== false };
  });
}

function branchGroupId_(name) {
  var b = getBranches_();
  for (var i = 0; i < b.length; i++) if (b[i].name === name) return b[i].groupId;
  return '';
}

/** แปลงค่าที่กรอก → หน่วยฐานของสินค้า (กรัม หรือ ชิ้น) */
function toBase_(qty, inputUnit, measureUnit) {
  var n = Number(qty);
  if (!(n > 0)) return 0;
  if (measureUnit === U_PIECE) return Math.round(n);          // นับชิ้น
  return String(inputUnit) === U_GRAM ? n : Math.round(n * 1000); // ค่าเริ่มต้น = กิโล
}

function enteredText_(qty, inputUnit) {
  return String(qty) + ' ' + String(inputUnit || '');
}

/** แสดงปริมาณให้อ่านง่าย: กรัม→กก. เมื่อ >=1000, ชิ้น→ชิ้น */
function fmtQty_(qty, measureUnit) {
  qty = Number(qty) || 0;
  if (measureUnit === U_PIECE) return qty + ' ' + U_PIECE;
  return qty >= 1000 ? (round_(qty / 1000, 2) + ' กก.') : (qty + ' ก.');
}

function objToRow_(cols, obj) {
  return cols.map(function (c) { return obj.hasOwnProperty(c) ? obj[c] : ''; });
}

function setCell_(sh, cols, rowIndex, colName, value) {
  var col = cols.indexOf(colName) + 1;
  if (col > 0) sh.getRange(rowIndex, col).setValue(value);
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

function getRecentTransfers_(n) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
  if (!sh || sh.getLastRow() < 2) return [];
  var last = sh.getLastRow();
  var count = Math.min(n, last - 1);
  var vals = sh.getRange(last - count + 1, 1, count, T_COLS.length).getValues();
  return vals.map(function (r) {
    var o = {}; T_COLS.forEach(function (c, j) { o[c] = r[j]; }); return o;
  }).reverse();
}

/* ===================== คงเหลือ / สรุป ===================== */
/** คงเหลือที่ครัวกลาง = รับเข้า − ส่งออก (แยกตามสินค้า, หน่วยฐานของสินค้านั้น) */
function centralBalance_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var res = {};
  function slot(item, unit) {
    if (!res[item]) res[item] = { inQty: 0, outQty: 0, bal: 0, unit: unit || U_GRAM };
    if (unit) res[item].unit = unit;
    return res[item];
  }

  var si = ss.getSheetByName(SH.STOCKIN);
  if (si && si.getLastRow() >= 2) {
    var v = si.getRange(2, 1, si.getLastRow() - 1, SI_COLS.length).getValues();
    v.forEach(function (r) {
      if (!r[1]) return;
      slot(r[1], r[3]).inQty += Number(r[2]) || 0;
    });
  }

  var tr = ss.getSheetByName(SH.TRANSFER);
  if (tr && tr.getLastRow() >= 2) {
    var idx = {}; T_COLS.forEach(function (c, j) { idx[c] = j; });
    var t = tr.getRange(2, 1, tr.getLastRow() - 1, T_COLS.length).getValues();
    t.forEach(function (r) {
      var it = r[idx['สินค้า']]; if (!it) return;
      slot(it, r[idx['หน่วยวัด']]).outQty += Number(r[idx['ปริมาณเข้า']]) || 0;
    });
  }

  Object.keys(res).forEach(function (k) { res[k].bal = res[k].inQty - res[k].outQty; });
  return res;
}

function balanceMap_() {
  var b = centralBalance_(), out = {};
  Object.keys(b).forEach(function (k) { out[k] = b[k].bal; });
  return out;
}

function aggregate_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TRANSFER);
  var perItem = {}, perBranch = {}, perDay = {};
  // หมายเหตุ: ปริมาณเข้าคนละหน่วย (กรัม/ชิ้น) จึงรวมข้ามสินค้าไม่ได้
  // ยอดรวมจึงนับเฉพาะ ควรแพ็ค/แพ็คได้/ของหาย ซึ่งเป็นจำนวนหน่วยขาย (ถุง/ไม้)
  var totals = { expected: 0, packed: 0, loss: 0, n: 0, outG: 0 };

  function bucket(map, key, extra) {
    if (!map[key]) {
      map[key] = { expected: 0, packed: 0, loss: 0, n: 0, outQty: 0 };
      Object.keys(extra || {}).forEach(function (k) { map[key][k] = extra[k]; });
    }
    return map[key];
  }

  if (sh && sh.getLastRow() >= 2) {
    var idx = {}; T_COLS.forEach(function (c, j) { idx[c] = j; });
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, T_COLS.length).getValues();
    v.forEach(function (r) {
      var item = r[idx['สินค้า']]; if (!item) return;
      var branch = r[idx['ไปสาขา']] || '(ไม่ระบุ)';
      var day = r[idx['วันที่']] || '';
      var mu = r[idx['หน่วยวัด']] || U_GRAM;
      var q = Number(r[idx['ปริมาณเข้า']]) || 0;
      var exp = Number(r[idx['ควรแพ็ค']]) || 0;
      var done = r[idx['สถานะ']] === STATUS_DONE;
      var pk = done ? (Number(r[idx['แพ็คได้']]) || 0) : 0;
      var ls = done ? (Number(r[idx['ของหาย']]) || 0) : 0;

      var bi = bucket(perItem, item, { item: item, unit: mu, sellUnit: r[idx['หน่วยขาย']] || 'ถุง' });
      var bb = bucket(perBranch, branch, { branch: branch });
      var bd = bucket(perDay, day, { day: day });
      [bi, bb, bd].forEach(function (o) {
        o.outQty += q; o.expected += exp; o.packed += pk; o.loss += ls; o.n++;
      });
      totals.expected += exp; totals.packed += pk; totals.loss += ls; totals.n++;
      if (mu === U_GRAM) totals.outG += q;
    });
  }

  function toArr(map, sortKey) {
    var a = Object.keys(map).map(function (k) { return map[k]; });
    a.sort(function (x, y) { return (y[sortKey] || 0) - (x[sortKey] || 0); });
    return a;
  }
  var dayArr = Object.keys(perDay).map(function (k) { return perDay[k]; });
  dayArr.sort(function (a, b) { return String(b.day).localeCompare(String(a.day)); });

  return {
    perItem: toArr(perItem, 'expected'), perItemMap: perItem,
    perBranch: toArr(perBranch, 'expected'), perDay: dayArr, totals: totals
  };
}

function updateSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var agg = aggregate_();
  var bal = centralBalance_();
  var items = getItems_();
  var meta = {};
  items.forEach(function (i) { meta[i.name] = i; });

  var names = {};
  agg.perItem.forEach(function (o) { names[o.item] = true; });
  Object.keys(bal).forEach(function (k) { names[k] = true; });

  var rows = Object.keys(names).map(function (it) {
    var o = agg.perItemMap[it] || { expected: 0, packed: 0, loss: 0, n: 0 };
    var b = bal[it] || { inQty: 0, outQty: 0, bal: 0, unit: U_GRAM };
    var m = meta[it] || {};
    var pct = o.expected ? (o.loss / o.expected * 100) : 0;
    return [it, b.unit, b.inQty, b.outQty, b.bal, m.sellUnit || 'ถุง',
            o.expected, o.packed, o.loss, round_(pct, 1), o.n];
  });
  rows.sort(function (a, b) { return b[4] - a[4]; });
  writeSheet_(ss, SH.SUMMARY,
    ['สินค้า', 'หน่วยวัด', 'รับเข้า', 'ส่งออก', 'คงเหลือครัวกลาง', 'หน่วยขาย',
     'ควรแพ็ครวม', 'แพ็คได้จริง', 'ของหาย', 'ของหาย %', 'จำนวนครั้ง'], rows);

  var brRows = agg.perBranch.map(function (o) {
    var pct = o.expected ? (o.loss / o.expected * 100) : 0;
    return [o.branch, o.expected, o.packed, o.loss, round_(pct, 1), o.n];
  });
  writeSheet_(ss, SH.BRANCHSUM,
    ['สาขา', 'ควรแพ็ค', 'แพ็คได้', 'ของหาย', 'ของหาย %', 'จำนวนครั้ง'], brRows);
}

function writeSheet_(ss, name, header, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#c0392b').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);
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
      method: 'post', contentType: 'application/json',
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
    method: 'post', contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + token },
    muteHttpExceptions: true,
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] })
  });
}

/** ทดสอบส่งเข้ากลุ่มไลน์ทุกสาขา (push อย่างเดียว ไม่ยุ่งกับ webhook เดิม) */
function testLineAll() {
  var ui = SpreadsheetApp.getUi();
  if (!lineToken_()) {
    ui.alert('ยังไม่ได้ตั้งค่า LINE_TOKEN\n\nไปที่ Project Settings > Script Properties แล้วเพิ่มคีย์ LINE_TOKEN');
    return;
  }
  var brs = getBranches_().filter(function (b) { return b.active; });
  if (!brs.length) { ui.alert('ยังไม่มีสาขาในชีต "สาขา"'); return; }
  var lines = [];
  brs.forEach(function (b) {
    if (!b.groupId) { lines.push('⚠️ ' + b.name + ' — ยังไม่ได้ใส่ Group ID'); return; }
    var r = linePush_(b.groupId, '🧪 ทดสอบระบบสต็อกครัวกลาง\nสาขา: ' + b.name + '\nถ้าเห็นข้อความนี้ = เชื่อมต่อสำเร็จ ✅');
    lines.push((r.sent ? '✅ ' : '❌ ') + b.name + (r.sent ? '' : ' — ' + r.msg));
  });
  ui.alert('ผลทดสอบส่ง LINE\n\n' + lines.join('\n'));
}

function notifyBranchNewTransfer_(branch, d) {
  var link = getWebAppUrl_() + '?page=pack&id=' + encodeURIComponent(d.id);
  var it = d.item;
  // แสดงปริมาณที่แปลงแล้วเฉพาะตอนที่ต่างจากที่กรอก (เช่น กรอก 1500 กรัม → 1.5 กก.)
  var pretty = fmtQty_(d.qty, it.measureUnit);
  var qtyLine = d.entered + (pretty !== d.entered ? ('  (' + pretty + ')') : '');
  var expLine = (d.expected !== '' && d.expected != null)
    ? ('📦 ควรแพ็คได้ ~' + d.expected + ' ' + it.sellUnit +
       ' (' + it.perUnit + ' ' + it.measureUnit + '/' + it.sellUnit + ')')
    : '📦 (ยังไม่ได้ตั้งค่าปริมาณต่อหน่วยของสินค้านี้)';
  var text =
    '🔔 มีของเข้า → ' + branch + '\n' +
    '• ' + it.name + '  ' + qtyLine + '\n' +
    expLine + '\n\n' +
    '👉 แพ็คเสร็จแล้วกดกรอกที่นี่:\n' + link;
  return linePush_(branchGroupId_(branch), text);
}

function notifyBranchPacked_(branch, d) {
  var u = d.sellUnit || 'ถุง';
  var lossTxt;
  if (d.loss === '' || d.loss == null) {
    lossTxt = '📊 บันทึกแล้ว';
  } else if (d.loss > 0) {
    lossTxt = '⚠️ ของหาย/ขาด ' + d.loss + ' ' + u +
              (d.lossAmt ? (' (~' + d.lossAmt + ' ' + d.measureUnit + ')') : '');
  } else if (d.loss < 0) {
    lossTxt = '✅ แพ็คได้เกินคาด ' + Math.abs(d.loss) + ' ' + u;
  } else {
    lossTxt = '✅ ครบพอดี ไม่มีของหาย';
  }
  var text =
    '✅ แพ็คเสร็จ: ' + d.item + ' (' + d.entered + ')\n' +
    '• ควรได้ ' + d.expected + ' ' + u + ' / แพ็คจริง ' + d.packed + ' ' + u + '\n' +
    lossTxt + (d.packer ? ('\n• โดย ' + d.packer) : '');
  return linePush_(branchGroupId_(branch), text);
}

/* ===================== LINE webhook (doPost) ===================== */
/**
 * ไม่จำเป็นต้องตั้งค่า — ถ้าไม่ตั้ง Webhook URL ฟังก์ชันนี้จะไม่ถูกเรียกเลย
 * (ใช้เฉพาะกรณีอยากให้ระบบจับ Group ID ให้อัตโนมัติ: พิมพ์ "id" ในกลุ่ม)
 */
function doPost(e) {
  try {
    var events = (JSON.parse(e.postData.contents).events) || [];
    events.forEach(function (ev) {
      var src = ev.source || {};
      var sid = src.groupId || src.roomId || src.userId || '';
      if (ev.type === 'join') {
        logLineId_(src.type, sid, 'บอทเข้ากลุ่ม');
        lineReply_(ev.replyToken, '👋 พร้อมใช้งาน!\nGroup ID นี้คือ:\n' + sid + '\n\nนำไปวางในชีต "สาขา"');
      } else if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
        var txt = String(ev.message.text || '').trim().toLowerCase();
        if (txt === 'id' || txt === 'groupid' || txt === 'ไอดี') {
          logLineId_(src.type, sid, 'ขอ id');
          lineReply_(ev.replyToken, 'Group ID:\n' + sid + '\n\nนำไปวางในชีต "สาขา"');
        }
      }
    });
  } catch (err) { /* ตอบ 200 เสมอ ไม่ให้ LINE retry รัว */ }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function logLineId_(type, sid, note) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SH.LINEIDS) ||
             ensureSheet_(ss, SH.LINEIDS, ['เวลา', 'ประเภท', 'sourceId', 'ข้อความ/เหตุการณ์']);
    sh.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), type, sid, note]);
  } catch (err) {}
}
