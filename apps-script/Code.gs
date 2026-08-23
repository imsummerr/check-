/**
 * ระบบสต็อกครัวกลางหม่าล่า — ของเข้าครัวกลาง / ของเข้าร้าน / เช็คสต็อก / ของเสีย
 * ---------------------------------------------------------------------------
 * ทำงานบน Google Apps Script (ผูกกับ Google Sheet)
 *
 * หน่วยนับ 2 ระดับต่อสินค้า:
 *   หน่วยย่อย (ไม้ / กรัม / ชิ้น)  →  หน่วยแพ็ค (แพ็ค / ถุง)
 *   เช่น ไส้กรอกหนังกรอบ 7 ไม้ = 1 แพ็ค → 26 ไม้ = "3 แพ็ค 5 ไม้"
 *   ระบบเก็บยอดจริงเป็น "หน่วยย่อย" เสมอ แล้วแปลงกลับเป็นแพ็คตอนแสดงผล
 *
 * แจ้ง LINE แยกกลุ่ม: กลุ่มครัวกลาง (ของเข้าครัวกลาง) / กลุ่มสาขา (ของเข้าร้าน, หมดอายุ, ของเสีย)
 *
 * ตั้งค่าครั้งแรก: เมนู "🌶️ ระบบสต็อก" > "1) ติดตั้งครั้งแรก" แล้วดู SETUP.md
 */

/* ===================== ค่าคงที่ ===================== */
var TZ = 'Asia/Bangkok';

var SH = {
  ITEMS:     'รายการสินค้า',
  LOCATIONS: 'สถานที่',
  USERS:     'ผู้ใช้งาน',
  STOCKIN:   'ของเข้าครัวกลาง',
  TOSHOP:    'ของเข้าร้าน',
  WASTE:     'ของเสีย',
  COUNT:     'เช็คสต็อก',
  SUMMARY:   'สรุปสต็อก',
  LINEIDS:   'LINE_IDs'
};

// ประเภทสถานที่
var LOC_CENTRAL = 'ครัวกลาง';
var LOC_BRANCH  = 'สาขา';

// บทบาทผู้ใช้
var U_COLS = ['ชื่อผู้ใช้', 'รหัสผ่าน', 'ชื่อ-สกุล', 'บทบาท', 'สาขา', 'เปิดใช้งาน'];
var ROLE_ADMIN   = 'แอดมิน';
var ROLE_CENTRAL = 'ครัวกลาง';
var ROLE_BRANCH  = 'สาขา';
var SESSION_DAYS = 30;

// หัวคอลัมน์ (ห้ามสลับลำดับ)
var I_COLS  = ['สินค้า', 'หน่วยย่อย', 'หน่วยแพ็ค', 'หน่วยย่อยต่อแพ็ค', 'อายุเก็บ(วัน)', 'หมวด', 'หมายเหตุ'];
var L_COLS  = ['สถานที่', 'ประเภท', 'LINE Group ID', 'เปิดใช้งาน'];
var SI_COLS = ['รหัส', 'วันที่', 'สินค้า', 'แพ็ค', 'เศษ', 'รวม(หน่วยย่อย)', 'วันหมดอายุ',
               'ผู้บันทึก', 'หมายเหตุ', 'แจ้งหมดอายุแล้ว'];
var TS_COLS = ['รหัส', 'วันที่', 'สินค้า', 'สาขา', 'แพ็ค', 'เศษ', 'รวม(หน่วยย่อย)', 'วันหมดอายุ',
               'ผู้บันทึก', 'หมายเหตุ', 'แจ้งหมดอายุแล้ว'];
var W_COLS  = ['วันที่', 'สถานที่', 'สินค้า', 'แพ็ค', 'เศษ', 'รวม(หน่วยย่อย)', 'สาเหตุ', 'ผู้บันทึก'];
var C_COLS  = ['วันที่', 'สถานที่', 'สินค้า', 'ยอดระบบ', 'นับได้', 'ส่วนต่าง', 'ปรับสต็อก', 'ผู้นับ', 'หมายเหตุ'];

var UNIT_SUB  = ['ไม้', 'กรัม', 'ชิ้น'];   // หน่วยย่อย
var UNIT_PACK = ['แพ็ค', 'ถุง'];           // หน่วยแพ็ค

/**
 * สินค้าตั้งต้น — [ชื่อ, หน่วยย่อย, หน่วยแพ็ค, หน่วยย่อยต่อแพ็ค, อายุเก็บ(วัน), หมวด]
 * ⚠️ ตัวเลข "หน่วยย่อยต่อแพ็ค" และ "อายุเก็บ" เป็นค่าตั้งต้น — ตรวจและแก้ในชีตให้ตรงกับที่ร้านใช้จริง
 */
var DEFAULT_ITEMS = [
  // ---- ชั่งกรัม → ถุง ----
  ['สันคอ',                'กรัม', 'ถุง',  30,  3, 'เนื้อสัตว์'],
  ['หมูสามชั้น',           'กรัม', 'ถุง',  30,  3, 'เนื้อสัตว์'],
  ['เนื้อแดง',             'กรัม', 'ถุง',  30,  3, 'เนื้อสัตว์'],
  ['หมึก',                 'กรัม', 'ถุง',  35,  2, 'ทะเล'],
  ['ปลาดอลลี่',            'กรัม', 'ถุง',  35,  2, 'ทะเล'],
  ['ปลาหมึกกรอบ',          'กรัม', 'ถุง',  35,  3, 'ทะเล'],
  ['แมงกะพรุน',            'กรัม', 'ถุง',  35,  3, 'ทะเล'],
  ['ผักกาดขาว',            'กรัม', 'ถุง', 100,  3, 'ผัก'],
  ['กะหล่ำ',               'กรัม', 'ถุง', 100,  3, 'ผัก'],
  ['ผักบุ้ง',              'กรัม', 'ถุง', 100,  2, 'ผัก'],
  ['กวางตุ้ง',             'กรัม', 'ถุง',  50,  2, 'ผัก'],
  ['เห็ดเข็มทอง',          'กรัม', 'ถุง',  50,  5, 'ผัก'],
  ['เห็ดชิเมจิ',           'กรัม', 'ถุง',  50,  5, 'ผัก'],
  ['รากบัว',               'กรัม', 'ถุง',  50,  5, 'ผัก'],
  ['ข้าวโพด',              'กรัม', 'ถุง',  25,  5, 'ผัก'],
  ['สาหร่าย',              'กรัม', 'ถุง',   5,  7, 'ผัก'],
  ['เส้นมันเทศ',           'กรัม', 'ถุง',  55, 14, 'เส้น/แป้ง'],
  ['เส้นอุด้ง',            'กรัม', 'ถุง',  50, 14, 'เส้น/แป้ง'],

  // ---- เสียบไม้ → แพ็ค (7 ไม้/แพ็ค เป็นค่าตั้งต้น ตรวจสอบด้วย) ----
  ['ต็อก',                 'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ไส้กรอกพันเบคอน',      'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['เต้าหู้หมู',           'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ฟองเต้าหู้สามเหลี่ยม', 'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ปูอัด',                'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['เต้าหู้ชีส',           'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ชีสหลายสี',            'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['เต้าหู้หลอด',          'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ปูอัดชีส',             'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ปูอัดยาว',             'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['เต้าหู้ปลาแผ่น',       'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ฟองเต้าหู้',           'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ไส้กรอกหนังกรอบ',      'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['ไส้กรอกชมพู',          'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],
  ['เห็ดออรินจิ',          'ไม้',  'แพ็ค',  7,  5, 'เสียบไม้'],

  // ---- นับชิ้น → ถุง ----
  ['ควิซ',                 'ชิ้น', 'ถุง',   1,  7, 'แปรรูป'],
  ['วุ้นเส้นหม่าล่า',      'ชิ้น', 'ถุง',   1, 30, 'เส้น/แป้ง'],
  ['มาม่า (ทุกชนิด)',      'ชิ้น', 'ถุง',   1, 90, 'เส้น/แป้ง']
];

/* ===================== เมนู ===================== */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🌶️ ระบบสต็อก')
    .addItem('1) ติดตั้งครั้งแรก', 'setup')
    .addItem('2) เปิดแจ้งเตือนวันหมดอายุอัตโนมัติ', 'installTriggers')
    .addSeparator()
    .addItem('🔄 รีเซ็ตรายการสินค้า', 'resetItems')
    .addItem('อัปเดตหน้า "สรุปสต็อก"', 'updateSummary')
    .addSeparator()
    .addItem('🧪 ทดสอบส่ง LINE ทุกกลุ่ม', 'testLineAll')
    .addItem('⏰ ทดสอบแจ้งวันหมดอายุเดี๋ยวนี้', 'checkExpiryDaily')
    .addItem('🔒 บังคับล็อกอินใหม่ทุกคน', 'logoutEveryone')
    .addItem('แสดงลิงก์เว็บแอป', 'showWebAppUrl')
    .addToUi();
}

/* ===================== ติดตั้ง ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // รายการสินค้า
  var items = ss.getSheetByName(SH.ITEMS);
  var seeded = false;
  if (!items || items.getLastRow() < 2 || !headerHas_(items, 'หน่วยย่อยต่อแพ็ค')) {
    writeItemsSheet_(); seeded = true;
  }

  // สถานที่
  var loc = ensureSheet_(ss, SH.LOCATIONS, L_COLS);
  var firstLoc = false;
  if (loc.getLastRow() < 2) {
    loc.getRange(2, 1, 3, L_COLS.length).setValues([
      ['ครัวกลาง', LOC_CENTRAL, '', true],
      ['สาขา 1',   LOC_BRANCH,  '', true],
      ['สาขา 2',   LOC_BRANCH,  '', true]
    ]);
    loc.setColumnWidth(3, 320);
    loc.getRange(2, 2, 200, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList([LOC_CENTRAL, LOC_BRANCH], true).setAllowInvalid(false).build());
    firstLoc = true;
  }

  // ผู้ใช้งาน
  var us = ensureSheet_(ss, SH.USERS, U_COLS);
  var firstUser = false;
  if (us.getLastRow() < 2) {
    us.getRange(2, 1, 3, U_COLS.length).setValues([
      ['admin',   '1234', 'ผู้ดูแลระบบ',   ROLE_ADMIN,   '',       true],
      ['kitchen', '1234', 'ครัวกลาง',      ROLE_CENTRAL, '',       true],
      ['branch1', '1234', 'พนักงานสาขา 1', ROLE_BRANCH,  'สาขา 1', true]
    ]);
    us.setColumnWidth(2, 260);
    us.getRange(2, 4, 200, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList([ROLE_ADMIN, ROLE_CENTRAL, ROLE_BRANCH], true)
        .setAllowInvalid(false).build());
    firstUser = true;
  }

  ensureSheet_(ss, SH.STOCKIN, SI_COLS);
  ensureSheet_(ss, SH.TOSHOP,  TS_COLS);
  ensureSheet_(ss, SH.WASTE,   W_COLS);
  ensureSheet_(ss, SH.COUNT,   C_COLS);
  ensureSheet_(ss, SH.LINEIDS, ['เวลา', 'ประเภท', 'sourceId', 'ข้อความ/เหตุการณ์']);
  ensureSheet_(ss, SH.SUMMARY, ['สถานที่', 'สินค้า', 'คงเหลือ', 'หน่วยแพ็ค', 'เศษ', 'หน่วยย่อย', 'รวม(หน่วยย่อย)']);

  updateSummary();

  SpreadsheetApp.getUi().alert(
    'ติดตั้งเรียบร้อย ✅\n\n' +
    (seeded ? ('ใส่รายการสินค้าให้แล้ว ' + DEFAULT_ITEMS.length + ' รายการ\n')
            : 'ชีต "รายการสินค้า" มีข้อมูลเดิมอยู่ (กด 🔄 รีเซ็ตรายการสินค้า ถ้าต้องการใส่ใหม่)\n') +
    (firstUser ? '⚠️ ผู้ใช้ตัวอย่างรหัสผ่าน 1234 — เปลี่ยนก่อนใช้จริง\n' : '') +
    (firstLoc  ? '⚠️ ใส่ LINE Group ID ที่ชีต "สถานที่" ให้ครบ\n' : '') +
    '\nสิ่งที่ต้องตรวจในชีต "รายการสินค้า":\n' +
    '• หน่วยย่อยต่อแพ็ค (เช่น ไส้กรอกหนังกรอบ 7 ไม้/แพ็ค)\n' +
    '• อายุเก็บ (วัน) — ใช้คำนวณวันหมดอายุอัตโนมัติ\n\n' +
    'อย่าลืมกดเมนู "2) เปิดแจ้งเตือนวันหมดอายุอัตโนมัติ"'
  );
}

function headerHas_(sh, name) {
  var w = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, w).getValues()[0]
    .map(function (c) { return String(c).trim(); }).indexOf(name) >= 0;
}

function writeItemsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SH.ITEMS) || ss.insertSheet(SH.ITEMS);
  sh.clear();
  sh.getRange(1, 1, 1, I_COLS.length).setValues([I_COLS])
    .setFontWeight('bold').setBackground('#c0392b').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  var rows = DEFAULT_ITEMS.map(function (r) {
    return [r[0], r[1], r[2], r[3], r[4], r[5], 'ตรวจสอบตัวเลข'];
  });
  sh.getRange(2, 1, rows.length, I_COLS.length).setValues(rows);
  sh.setColumnWidth(1, 190);
  sh.getRange(2, 2, 300, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(UNIT_SUB, true).setAllowInvalid(false).build());
  sh.getRange(2, 3, 300, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(UNIT_PACK, true).setAllowInvalid(false).build());
  return rows.length;
}

function resetItems() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('รีเซ็ตรายการสินค้า',
      'ลบข้อมูลในชีต "รายการสินค้า" ทั้งหมด แล้วใส่ ' + DEFAULT_ITEMS.length + ' รายการใหม่?\n' +
      'สินค้าที่แก้ไว้เองจะหาย', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  ui.alert('เรียบร้อย ✅ ใส่ ' + writeItemsSheet_() + ' รายการแล้ว\n\n' +
           'อย่าลืมตรวจ "หน่วยย่อยต่อแพ็ค" และ "อายุเก็บ(วัน)"');
}

function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var width = Math.max(headers.length, sh.getLastColumn() || 1);
  var cur = sh.getRange(1, 1, 1, width).getValues()[0].map(function (c) { return String(c).trim(); });
  var mismatch = headers.some(function (h, i) { return cur[i] !== h; });
  if (!cur[0] || (mismatch && sh.getLastRow() < 2)) {
    if (mismatch && cur[0]) sh.getRange(1, 1, 1, width).clearContent();
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#c0392b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ===================== ทริกเกอร์แจ้งวันหมดอายุ ===================== */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'checkExpiryDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkExpiryDaily').timeBased().atHour(8).everyDays(1).create();
  SpreadsheetApp.getUi().alert('เปิดแจ้งเตือนวันหมดอายุแล้ว ✅\n\nระบบจะเช็คทุกวันช่วง 8:00–9:00 น.\n' +
    'แจ้งเฉพาะของที่หมดอายุ "วันนี้" และแจ้งครั้งเดียวไม่ซ้ำ');
}

/* ===================== เว็บ ===================== */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
  var allow = { index: 'Index', stockin: 'StockIn', toshop: 'ToShop', count: 'Count', waste: 'Waste' };
  var file = allow[page] || 'Index';
  return HtmlService.createTemplateFromFile(file).evaluate()
    .setTitle('ระบบสต็อกครัวกลางหม่าล่า')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico');
}

function include(f) { return HtmlService.createHtmlOutputFromFile(f).getContent(); }
function getWebAppUrl_() { return ScriptApp.getService().getUrl(); }

function showWebAppUrl() {
  var u = getWebAppUrl_();
  SpreadsheetApp.getUi().alert(u ? ('ลิงก์เว็บแอป:\n\n' + u)
    : 'ยังไม่ได้ Deploy — ไปที่ Deploy > New deployment');
}

/* ===================== ล็อกอิน / สิทธิ์ ===================== */
function salt_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('PW_SALT');
  if (!s) { s = Utilities.getUuid(); p.setProperty('PW_SALT', s); }
  return s;
}
function hashPw_(pw) {
  return 'sha256:' + Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt_() + String(pw), Utilities.Charset.UTF_8));
}
function isHash_(v) { return String(v).indexOf('sha256:') === 0; }

function login(username, password) {
  var u = String(username || '').trim().toLowerCase(), pw = String(password || '');
  if (!u || !pw) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.USERS);
  if (!sh || sh.getLastRow() < 2) throw new Error('ยังไม่มีผู้ใช้ในระบบ');
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, U_COLS.length).getValues();
  for (var i = 0; i < v.length; i++) {
    if (String(v[i][0]).trim().toLowerCase() !== u) continue;
    if (v[i][5] === false) throw new Error('บัญชีนี้ถูกปิดใช้งาน');
    var stored = String(v[i][1] || '');
    if (!stored) throw new Error('บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน');
    if (!isHash_(stored)) { stored = hashPw_(stored); sh.getRange(i + 2, 2).setValue(stored); }
    if (stored !== hashPw_(pw)) throw new Error('รหัสผ่านไม่ถูกต้อง');
    var sess = {
      u: String(v[i][0]).trim(), name: String(v[i][2] || v[i][0]).trim(),
      role: String(v[i][3] || ROLE_BRANCH).trim(), branch: String(v[i][4] || '').trim(),
      exp: Date.now() + SESSION_DAYS * 86400000
    };
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    PropertiesService.getScriptProperties().setProperty('SESS_' + token, JSON.stringify(sess));
    return { token: token, name: sess.name, role: sess.role, branch: sess.branch };
  }
  throw new Error('ไม่พบชื่อผู้ใช้นี้');
}

function logout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('SESS_' + token);
  return { ok: true };
}

function getSession_(token) {
  if (!token) throw new Error('NOAUTH');
  var props = PropertiesService.getScriptProperties(), raw = props.getProperty('SESS_' + token);
  if (!raw) throw new Error('NOAUTH');
  var s; try { s = JSON.parse(raw); } catch (e) { throw new Error('NOAUTH'); }
  if (!s || Date.now() > Number(s.exp || 0)) { props.deleteProperty('SESS_' + token); throw new Error('NOAUTH'); }
  return s;
}

function requireRole_(token, roles) {
  var s = getSession_(token);
  if (roles && roles.length && roles.indexOf(s.role) < 0) {
    throw new Error('บัญชี "' + s.name + '" (' + s.role + ') ไม่มีสิทธิ์ทำรายการนี้');
  }
  return s;
}

function me(token) {
  try { var s = getSession_(token); return { name: s.name, role: s.role, branch: s.branch }; }
  catch (e) { return null; }
}

function logoutEveryone() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('บังคับล็อกอินใหม่ทุกคน', 'ทุกคนต้องล็อกอินใหม่ ทำต่อ?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var props = PropertiesService.getScriptProperties(), all = props.getProperties(), n = 0;
  Object.keys(all).forEach(function (k) { if (k.indexOf('SESS_') === 0) { props.deleteProperty(k); n++; } });
  ui.alert('ล้างแล้ว ' + n + ' เซสชัน');
}

/** สาขาแตะได้เฉพาะสาขาตัวเอง */
function assertLocAllowed_(sess, loc) {
  if (sess.role === ROLE_BRANCH && String(sess.branch) !== String(loc)) {
    throw new Error('บัญชีของคุณสังกัด "' + (sess.branch || '-') + '" จึงทำรายการของ "' + loc + '" ไม่ได้');
  }
}

/* ===================== อ่านข้อมูลตั้งค่า ===================== */
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
        shelfDays: Number(r[4]) || 0,
        category: String(r[5] || '')
      };
    });
}

function findItem_(name) {
  var it = getItems_(), n = String(name || '').trim();
  for (var i = 0; i < it.length; i++) if (it[i].name === n) return it[i];
  return null;
}
function mustFindItem_(name) {
  var it = findItem_(name);
  if (!it) throw new Error('ไม่พบสินค้า "' + name + '" ในชีต "รายการสินค้า"');
  return it;
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

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function addDays_(dateStr, days) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + (Number(days) || 0));
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}
function thaiDate_(iso) {
  if (!iso) return '-';
  var d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return String(iso);
  var m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return d.getDate() + ' ' + m[d.getMonth()] + ' ' + ((d.getFullYear() + 543) % 100);
}
function newId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') +
         '-' + Math.floor(Math.random() * 900 + 100);
}
function idx_(cols) { var o = {}; cols.forEach(function (c, i) { o[c] = i; }); return o; }
function rowsOf_(name, cols) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
}

/* ===================== ยอดคงเหลือ ===================== */
/** คืน { สถานที่: { สินค้า: ยอดหน่วยย่อย } } */
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
function getBootstrap(token, page) {
  var sess = getSession_(token);
  var items = getItems_(), locs = getLocations_().filter(function (l) { return l.active; });
  var b = balances_();
  var central = centralName_();
  // สาขาที่ผู้ใช้คนนี้เลือกได้
  var pick = locs.filter(function (l) {
    if (sess.role === ROLE_BRANCH) return l.name === sess.branch;
    return true;
  });
  return {
    me: { name: sess.name, role: sess.role, branch: sess.branch },
    items: items, locations: pick, central: central,
    branches: locs.filter(function (l) { return l.type === LOC_BRANCH; })
                  .filter(function (l) { return sess.role !== ROLE_BRANCH || l.name === sess.branch; }),
    balances: b
  };
}

/* ===================== API: ของเข้าครัวกลาง ===================== */
function submitStockIn(p) {
  var sess = requireRole_(p && p.token, [ROLE_CENTRAL, ROLE_ADMIN]);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var it = mustFindItem_(p.item);
    var total = toBase_(p.packs, p.rem, it.perPack);
    if (!(total > 0)) throw new Error('กรุณากรอกจำนวนอย่างน้อย 1 ' + it.packUnit + ' หรือ 1 ' + it.subUnit);

    var date = String(p.date || today_()).slice(0, 10);
    var exp = p.expiry ? String(p.expiry).slice(0, 10)
                       : (it.shelfDays > 0 ? addDays_(date, it.shelfDays) : '');
    var id = newId_('IN');
    var central = centralName_();

    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.STOCKIN).appendRow([
      id, date, it.name, Math.floor(Number(p.packs) || 0), Number(p.rem) || 0, total,
      exp, sess.name, String(p.note || ''), ''
    ]);

    var line = linePush_(groupIdOf_(central),
      '📥 ของเข้าครัวกลาง\n' +
      '• ' + it.name + '  ' + fmtPack_(total, it) + '\n' +
      '• วันที่เข้า ' + thaiDate_(date) +
      (exp ? ('\n• หมดอายุ ' + thaiDate_(exp)) : '') +
      '\n• คงเหลือครัวกลาง ' + fmtPack_(balanceOf_(central, it.name), it));

    updateSummary();
    return { ok: true, text: fmtPack_(total, it), expiry: exp,
             balance: fmtPack_(balanceOf_(central, it.name), it),
             lineSent: line.sent, lineMsg: line.msg };
  } finally { lock.releaseLock(); }
}

/* ===================== API: ของเข้าร้าน ===================== */
function submitToShop(p) {
  var sess = requireRole_(p && p.token, [ROLE_CENTRAL, ROLE_ADMIN]);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var it = mustFindItem_(p.item);
    var branch = String(p.branch || '').trim();
    if (!branch) throw new Error('กรุณาเลือกสาขา');
    var total = toBase_(p.packs, p.rem, it.perPack);
    if (!(total > 0)) throw new Error('กรุณากรอกจำนวน');

    var date = String(p.date || today_()).slice(0, 10);
    var exp = p.expiry ? String(p.expiry).slice(0, 10)
                       : (it.shelfDays > 0 ? addDays_(date, it.shelfDays) : '');
    var id = newId_('TS');

    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.TOSHOP).appendRow([
      id, date, it.name, branch, Math.floor(Number(p.packs) || 0), Number(p.rem) || 0, total,
      exp, sess.name, String(p.note || ''), ''
    ]);

    var line = linePush_(groupIdOf_(branch),
      '🏪 สินค้าเข้าร้าน — ' + branch + '\n' +
      '• ' + it.name + '  ' + fmtPack_(total, it) +
      (it.perPack > 0 ? ('  (1 ' + it.packUnit + ' = ' + it.perPack + ' ' + it.subUnit + ')') : '') + '\n' +
      '• วันที่เข้า ' + thaiDate_(date) +
      (exp ? ('\n• หมดอายุ ' + thaiDate_(exp)) : ''));

    updateSummary();
    var central = centralName_();
    return { ok: true, text: fmtPack_(total, it), expiry: exp,
             centralLeft: fmtPack_(balanceOf_(central, it.name), it),
             lineSent: line.sent, lineMsg: line.msg };
  } finally { lock.releaseLock(); }
}

/* ===================== API: ของเสีย ===================== */
function submitWaste(p) {
  var sess = requireRole_(p && p.token, null);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var it = mustFindItem_(p.item);
    var loc = String(p.location || '').trim();
    if (!loc) throw new Error('กรุณาเลือกสถานที่');
    assertLocAllowed_(sess, loc);
    var total = toBase_(p.packs, p.rem, it.perPack);
    if (!(total > 0)) throw new Error('กรุณากรอกจำนวนของเสีย');

    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.WASTE).appendRow([
      today_(), loc, it.name, Math.floor(Number(p.packs) || 0), Number(p.rem) || 0, total,
      String(p.reason || ''), sess.name
    ]);

    var line = linePush_(groupIdOf_(loc),
      '🗑️ บันทึกของเสีย — ' + loc + '\n' +
      '• ' + it.name + '  ' + fmtPack_(total, it) + '\n' +
      (p.reason ? ('• สาเหตุ ' + p.reason + '\n') : '') +
      '• คงเหลือ ' + fmtPack_(balanceOf_(loc, it.name), it) + '\n' +
      '• โดย ' + sess.name);

    updateSummary();
    return { ok: true, text: fmtPack_(total, it),
             balance: fmtPack_(balanceOf_(loc, it.name), it),
             lineSent: line.sent, lineMsg: line.msg };
  } finally { lock.releaseLock(); }
}

/* ===================== API: เช็คสต็อกรายสัปดาห์ ===================== */
/** รายการสินค้าพร้อมยอดระบบของสถานที่นั้น (ไว้ให้กรอกยอดนับ) */
function getCountSheet(token, loc) {
  var sess = getSession_(token);
  assertLocAllowed_(sess, loc);
  var b = balances_()[loc] || {};
  return getItems_().map(function (it) {
    var sys = Number(b[it.name]) || 0;
    var s = splitPack_(sys, it.perPack);
    return {
      name: it.name, category: it.category, subUnit: it.subUnit, packUnit: it.packUnit,
      perPack: it.perPack, sysBase: sys, sysPacks: s.packs, sysRem: s.rem,
      sysText: fmtPack_(sys, it)
    };
  });
}

/** บันทึกผลนับ — lines: [{item, packs, rem}] (เฉพาะที่กรอก) */
function submitCount(p) {
  var sess = requireRole_(p && p.token, null);
  var loc = String(p.location || '').trim();
  if (!loc) throw new Error('กรุณาเลือกสถานที่');
  assertLocAllowed_(sess, loc);
  var lines = (p.lines || []).filter(function (l) { return l && l.item; });
  if (!lines.length) throw new Error('ยังไม่ได้กรอกยอดนับสักรายการ');

  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var b = balances_()[loc] || {};
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH.COUNT);
    var adjust = p.adjust !== false;
    var date = today_(), out = [], rows = [];

    lines.forEach(function (l) {
      var it = findItem_(l.item); if (!it) return;
      var counted = toBase_(l.packs, l.rem, it.perPack);
      var sys = Number(b[it.name]) || 0;
      var diff = counted - sys;
      rows.push([date, loc, it.name, sys, counted, diff, adjust, sess.name, String(l.note || '')]);
      if (diff !== 0) {
        out.push({ item: it.name, sysText: fmtPack_(sys, it), countText: fmtPack_(counted, it),
                   diff: diff, diffText: fmtPack_(Math.abs(diff), it), short: diff < 0 });
      }
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, C_COLS.length).setValues(rows);

    var msg = '📋 เช็คสต็อกรายสัปดาห์ — ' + loc + '\n' +
      '• วันที่ ' + thaiDate_(date) + '  โดย ' + sess.name + '\n' +
      '• นับ ' + rows.length + ' รายการ\n';
    if (!out.length) {
      msg += '✅ ตรงกับระบบทั้งหมด';
    } else {
      msg += '⚠️ ไม่ตรง ' + out.length + ' รายการ\n' +
        out.slice(0, 12).map(function (o) {
          return (o.short ? '  ▼ ขาด ' : '  ▲ เกิน ') + o.diffText + ' — ' + o.item +
                 ' (ระบบ ' + o.sysText + ' / นับได้ ' + o.countText + ')';
        }).join('\n');
      if (out.length > 12) msg += '\n  … และอีก ' + (out.length - 12) + ' รายการ';
    }
    var line = linePush_(groupIdOf_(loc), msg);

    updateSummary();
    return { ok: true, counted: rows.length, diffs: out, adjusted: adjust,
             lineSent: line.sent, lineMsg: line.msg };
  } finally { lock.releaseLock(); }
}

/* ===================== API: หน้าแรก ===================== */
function getDashboard(token) {
  var sess = getSession_(token);
  var items = getItems_(), map = {};
  items.forEach(function (i) { map[i.name] = i; });
  var b = balances_();
  var locs = getLocations_().filter(function (l) { return l.active; });
  if (sess.role === ROLE_BRANCH) locs = locs.filter(function (l) { return l.name === sess.branch; });

  var stock = locs.map(function (l) {
    var m = b[l.name] || {};
    var rows = Object.keys(m).filter(function (k) { return Math.abs(m[k]) > 0.0001; })
      .map(function (k) {
        var it = map[k] || { subUnit: '', packUnit: '', perPack: 0 };
        return { item: k, base: m[k], text: fmtPack_(m[k], it), low: m[k] <= 0 };
      });
    rows.sort(function (x, y) { return x.item.localeCompare(y.item, 'th'); });
    return { name: l.name, type: l.type, rows: rows };
  });

  // ของใกล้หมดอายุ (วันนี้ + 3 วันข้างหน้า) จากล็อตที่ยังไม่เลยวัน
  var soon = [], t = today_();
  function scanExp(sheetRows, cols, locKey) {
    var ix = idx_(cols);
    sheetRows.forEach(function (r) {
      var e = r[ix['วันหมดอายุ']]; if (!e) return;
      e = (e instanceof Date) ? Utilities.formatDate(e, TZ, 'yyyy-MM-dd') : String(e).slice(0, 10);
      var days = Math.round((new Date(e + 'T00:00:00') - new Date(t + 'T00:00:00')) / 86400000);
      if (days < 0 || days > 3) return;
      var it = map[r[ix['สินค้า']]] || { subUnit: '', packUnit: '', perPack: 0 };
      soon.push({ item: r[ix['สินค้า']], loc: locKey ? r[ix[locKey]] : centralName_(),
                  qty: fmtPack_(r[ix['รวม(หน่วยย่อย)']], it), expiry: e, days: days });
    });
  }
  scanExp(rowsOf_(SH.STOCKIN, SI_COLS), SI_COLS, null);
  scanExp(rowsOf_(SH.TOSHOP, TS_COLS), TS_COLS, 'สาขา');
  soon.sort(function (a, b2) { return a.days - b2.days; });

  return { me: { name: sess.name, role: sess.role, branch: sess.branch },
           stock: stock, expiring: soon.slice(0, 20), today: thaiDate_(t) };
}

/* ===================== สรุปลงชีต ===================== */
function updateSummary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var items = getItems_(), map = {};
  items.forEach(function (i) { map[i.name] = i; });
  var b = balances_(), rows = [];
  Object.keys(b).forEach(function (loc) {
    Object.keys(b[loc]).forEach(function (item) {
      var v = b[loc][item];
      if (Math.abs(v) < 0.0001) return;
      var it = map[item] || { subUnit: '', packUnit: '', perPack: 0 };
      var s = splitPack_(v, it.perPack);
      rows.push([loc, item, s.packs, it.packUnit, s.rem, it.subUnit, v]);
    });
  });
  rows.sort(function (x, y) { return x[0].localeCompare(y[0], 'th') || x[1].localeCompare(y[1], 'th'); });

  var sh = ss.getSheetByName(SH.SUMMARY) || ss.insertSheet(SH.SUMMARY);
  var head = ['สถานที่', 'สินค้า', 'คงเหลือ', 'หน่วยแพ็ค', 'เศษ', 'หน่วยย่อย', 'รวม(หน่วยย่อย)'];
  sh.clear();
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#c0392b').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (rows.length) sh.getRange(2, 1, rows.length, head.length).setValues(rows);
}

/* ===================== LINE ===================== */
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

function testLineAll() {
  var ui = SpreadsheetApp.getUi();
  if (!lineToken_()) { ui.alert('ยังไม่ได้ตั้งค่า LINE_TOKEN\n\nProject Settings > Script Properties'); return; }
  var locs = getLocations_().filter(function (l) { return l.active; });
  if (!locs.length) { ui.alert('ยังไม่มีสถานที่ในชีต "สถานที่"'); return; }
  var out = locs.map(function (l) {
    if (!l.groupId) return '⚠️ ' + l.name + ' — ยังไม่ได้ใส่ Group ID';
    var r = linePush_(l.groupId, '🧪 ทดสอบระบบสต็อก\nกลุ่มนี้คือ: ' + l.name + ' (' + l.type + ')\nเชื่อมต่อสำเร็จ ✅');
    return (r.sent ? '✅ ' : '❌ ') + l.name + (r.sent ? '' : ' — ' + r.msg);
  });
  ui.alert('ผลทดสอบส่ง LINE\n\n' + out.join('\n'));
}

/* ===================== แจ้งวันหมดอายุ (รันอัตโนมัติทุกวัน) ===================== */
/**
 * แจ้งเฉพาะล็อตที่หมดอายุ "วันนี้" และแจ้งครั้งเดียว
 * ล็อตที่เลยวันไปแล้วโดยยังไม่เคยแจ้ง จะปิดสถานะเงียบ ๆ ไม่แจ้งย้อนหลัง
 */
function checkExpiryDaily() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var t = today_();
  var items = getItems_(), map = {};
  items.forEach(function (i) { map[i.name] = i; });
  var byGroup = {};   // locName -> [ข้อความย่อย]
  var central = centralName_();

  function scan(sheetName, cols, locKey) {
    var sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastRow() < 2) return;
    var ix = idx_(cols);
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getValues();
    var flagCol = ix['แจ้งหมดอายุแล้ว'] + 1;
    vals.forEach(function (r, i) {
      if (String(r[ix['แจ้งหมดอายุแล้ว']] || '')) return;      // แจ้ง/ปิดไปแล้ว
      var e = r[ix['วันหมดอายุ']]; if (!e) return;
      e = (e instanceof Date) ? Utilities.formatDate(e, TZ, 'yyyy-MM-dd') : String(e).slice(0, 10);
      if (e > t) return;                                        // ยังไม่ถึงวัน
      var loc = locKey ? String(r[ix[locKey]]) : central;
      if (e === t) {                                            // หมดอายุวันนี้ → แจ้ง
        var it = map[r[ix['สินค้า']]] || { subUnit: '', packUnit: '', perPack: 0 };
        (byGroup[loc] = byGroup[loc] || []).push(
          '• ' + r[ix['สินค้า']] + '  ' + fmtPack_(r[ix['รวม(หน่วยย่อย)']], it) +
          '  (เข้า ' + thaiDate_(r[ix['วันที่']]) + ')');
        sh.getRange(i + 2, flagCol).setValue('แจ้งแล้ว ' + t);
      } else {                                                  // เลยวันแล้ว → ปิดเงียบ
        sh.getRange(i + 2, flagCol).setValue('เลยวัน (ไม่แจ้ง)');
      }
    });
  }

  scan(SH.STOCKIN, SI_COLS, null);
  scan(SH.TOSHOP,  TS_COLS, 'สาขา');

  var sent = 0;
  Object.keys(byGroup).forEach(function (loc) {
    var r = linePush_(groupIdOf_(loc),
      '⏰ ของหมดอายุวันนี้ (' + thaiDate_(t) + ') — ' + loc + '\n' +
      byGroup[loc].join('\n') + '\n\nกรุณาตรวจและบันทึกของเสียถ้าใช้ไม่ได้');
    if (r.sent) sent++;
  });
  return { groups: Object.keys(byGroup).length, sent: sent };
}
