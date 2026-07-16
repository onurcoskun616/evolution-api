/**
 * Parametreler: MEB'e ilan edilen kampüs ücret listeleri ve indirim sınırları.
 * Görüntüleme: tüm oturumlu kullanıcılar (kayıt formunun ihtiyacı).
 * Düzenleme: settings.manage izni (varsayılan: Genel Merkez; kullanıcı bazında verilebilir).
 */
const express = require('express');
const { db, audit, money } = require('../db');
const { requirePermission, assertCampusAccess } = require('../auth');

const router = express.Router();

const GRADES = ['9', '10', '11', '12'];
const MAX_CLASS_SIZE = 30;
const SECTION_LETTERS = 'ABCDEFGHIJ';

function getParams(campusId, yearId) {
  const items = db.prepare('SELECT * FROM fee_items ORDER BY sort_order, id').all();
  const prices = db.prepare(
    'SELECT fee_item_id, price, max_discount_rate, max_discount_amount FROM campus_prices WHERE campus_id = ? AND academic_year_id = ?'
  ).all(campusId, yearId);
  const priceMap = Object.fromEntries(prices.map(p => [p.fee_item_id, p]));
  const limits = db.prepare(
    'SELECT max_discount_rate, max_discount_amount FROM campus_discount_limits WHERE campus_id = ? AND academic_year_id = ?'
  ).get(campusId, yearId) || { max_discount_rate: null, max_discount_amount: null };
  const departments = db.prepare(
    'SELECT * FROM departments WHERE campus_id = ? ORDER BY name').all(campusId);
  const planRows = db.prepare(
    'SELECT department_id, grade, section_count FROM section_plans WHERE campus_id = ? AND academic_year_id = ?'
  ).all(campusId, yearId);
  const section_plans = {};
  for (const p of planRows) section_plans[`${p.department_id}|${p.grade}`] = p.section_count;
  return {
    fee_items: items.map(i => ({
      ...i,
      price: priceMap[i.id]?.price ?? null,
      max_discount_rate: priceMap[i.id]?.max_discount_rate ?? null,
      max_discount_amount: priceMap[i.id]?.max_discount_amount ?? null,
    })),
    limits,
    departments,
    section_plans,
    grades: GRADES,
    max_class_size: MAX_CLASS_SIZE,
  };
}

// ---- Görüntüle ----
router.get('/', (req, res) => {
  const yearId = Number(req.query.academic_year_id);
  if (!yearId) return res.status(400).json({ error: 'Öğretim yılı seçimi zorunludur.' });
  let campusId = Number(req.query.campus_id);
  if (req.user.role !== 'GENEL_MERKEZ') campusId = req.user.campus_id;
  if (!campusId) return res.status(400).json({ error: 'Kampüs seçimi zorunludur.' });
  res.json({ campus_id: campusId, academic_year_id: yearId, ...getParams(campusId, yearId) });
});

// ---- Kaydet (fiyatlar + indirim sınırları) ----
router.put('/', requirePermission('settings.manage'), (req, res) => {
  const b = req.body || {};
  const campusId = Number(b.campus_id);
  const yearId = Number(b.academic_year_id);
  if (!campusId || !yearId) return res.status(400).json({ error: 'Kampüs ve öğretim yılı zorunludur.' });
  if (!assertCampusAccess(req, campusId)) {
    return res.status(403).json({ error: 'Bu kampüsün parametrelerini düzenleme yetkiniz yok.' });
  }
  if (!db.prepare('SELECT id FROM campuses WHERE id = ?').get(campusId)) {
    return res.status(404).json({ error: 'Kampüs bulunamadı.' });
  }
  if (!db.prepare('SELECT id FROM academic_years WHERE id = ?').get(yearId)) {
    return res.status(404).json({ error: 'Öğretim yılı bulunamadı.' });
  }
  const prices = Array.isArray(b.prices) ? b.prices : [];
  const normLimit = (v, max) => {
    if (v === null || v === '' || v === undefined) return null;
    const n = Number(v);
    if (isNaN(n) || n < 0 || (max !== undefined && n > max)) return NaN;
    return n;
  };
  for (const p of prices) {
    if (p.price !== null && p.price !== '' && (isNaN(Number(p.price)) || Number(p.price) < 0)) {
      return res.status(400).json({ error: 'Fiyatlar 0 veya daha büyük olmalıdır.' });
    }
    p._maxRate = normLimit(p.max_discount_rate, 100);
    p._maxAmount = normLimit(p.max_discount_amount);
    if (Number.isNaN(p._maxRate)) return res.status(400).json({ error: 'Kalem azami indirim oranı 0-100 arasında olmalıdır.' });
    if (Number.isNaN(p._maxAmount)) return res.status(400).json({ error: 'Kalem azami indirim tutarı geçersiz.' });
  }
  const maxRate = b.max_discount_rate === null || b.max_discount_rate === '' || b.max_discount_rate === undefined
    ? null : Number(b.max_discount_rate);
  const maxAmount = b.max_discount_amount === null || b.max_discount_amount === '' || b.max_discount_amount === undefined
    ? null : money(b.max_discount_amount);
  if (maxRate !== null && (isNaN(maxRate) || maxRate < 0 || maxRate > 100)) {
    return res.status(400).json({ error: 'Azami indirim oranı 0-100 arasında olmalıdır.' });
  }
  if (maxAmount !== null && (isNaN(maxAmount) || maxAmount < 0)) {
    return res.status(400).json({ error: 'Azami indirim tutarı geçersiz.' });
  }

  // Şube planı doğrulama
  const plans = Array.isArray(b.section_plans) ? b.section_plans : [];
  for (const p of plans) {
    if (!GRADES.includes(String(p.grade))) {
      return res.status(400).json({ error: 'Şube planında sınıf kademesi 9-12 arasında olmalıdır.' });
    }
    const cnt = Number(p.section_count);
    if (p.section_count !== null && p.section_count !== '' && (isNaN(cnt) || cnt < 0 || cnt > 10)) {
      return res.status(400).json({ error: 'Şube sayısı 0-10 arasında olmalıdır.' });
    }
  }

  db.transaction(() => {
    const up = db.prepare(`
      INSERT INTO campus_prices (campus_id, academic_year_id, fee_item_id, price, max_discount_rate, max_discount_amount)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(campus_id, academic_year_id, fee_item_id) DO UPDATE
        SET price = excluded.price,
            max_discount_rate = excluded.max_discount_rate,
            max_discount_amount = excluded.max_discount_amount`);
    const del = db.prepare(
      'DELETE FROM campus_prices WHERE campus_id = ? AND academic_year_id = ? AND fee_item_id = ?');
    for (const p of prices) {
      const itemId = Number(p.fee_item_id);
      if (!itemId) continue;
      if (p.price === null || p.price === '') del.run(campusId, yearId, itemId);
      else up.run(campusId, yearId, itemId, money(p.price),
        p._maxRate !== undefined ? p._maxRate : null,
        p._maxAmount !== undefined ? (p._maxAmount === null ? null : money(p._maxAmount)) : null);
    }
    db.prepare(`
      INSERT INTO campus_discount_limits (campus_id, academic_year_id, max_discount_rate, max_discount_amount)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(campus_id, academic_year_id) DO UPDATE
        SET max_discount_rate = excluded.max_discount_rate,
            max_discount_amount = excluded.max_discount_amount`)
      .run(campusId, yearId, maxRate, maxAmount);
    const upPlan = db.prepare(`
      INSERT INTO section_plans (campus_id, academic_year_id, department_id, grade, section_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(campus_id, academic_year_id, department_id, grade) DO UPDATE
        SET section_count = excluded.section_count`);
    const delPlan = db.prepare(
      'DELETE FROM section_plans WHERE campus_id = ? AND academic_year_id = ? AND department_id = ? AND grade = ?');
    for (const p of plans) {
      const deptId = Number(p.department_id);
      if (!deptId) continue;
      const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND campus_id = ?').get(deptId, campusId);
      if (!dept) continue;
      const cnt = Number(p.section_count);
      if (!cnt) delPlan.run(campusId, yearId, deptId, String(p.grade));
      else upPlan.run(campusId, yearId, deptId, String(p.grade), cnt);
    }
  })();
  audit(req.user.id, 'UPDATE', 'parameters', campusId, `yıl=${yearId}`);
  res.json({ ok: true, ...getParams(campusId, yearId) });
});

// ---- Yeni ücret kalemi ----
router.post('/items', requirePermission('settings.manage'), (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'Kalem adı zorunludur.' });
  if (db.prepare('SELECT id FROM fee_items WHERE name = ?').get(name)) {
    return res.status(400).json({ error: 'Bu isimde bir kalem zaten var.' });
  }
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM fee_items').get().m;
  const info = db.prepare('INSERT INTO fee_items (name, sort_order) VALUES (?, ?)').run(name, max + 1);
  audit(req.user.id, 'CREATE', 'fee_item', info.lastInsertRowid, name);
  res.json({ id: info.lastInsertRowid });
});

// ---- Kalem güncelle (ad / aktiflik) ----
router.put('/items/:id', requirePermission('settings.manage'), (req, res) => {
  const item = db.prepare('SELECT * FROM fee_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Kalem bulunamadı.' });
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : item.name;
  if (!name) return res.status(400).json({ error: 'Kalem adı boş olamaz.' });
  const dup = db.prepare('SELECT id FROM fee_items WHERE name = ? AND id != ?').get(name, item.id);
  if (dup) return res.status(400).json({ error: 'Bu isimde başka bir kalem var.' });
  db.prepare('UPDATE fee_items SET name = ?, active = ? WHERE id = ?')
    .run(name, b.active !== undefined ? (b.active ? 1 : 0) : item.active, item.id);
  audit(req.user.id, 'UPDATE', 'fee_item', item.id, name);
  res.json({ ok: true });
});

// ---- Bölümler ----
router.get('/departments', (req, res) => {
  let campusId = Number(req.query.campus_id);
  if (req.user.role !== 'GENEL_MERKEZ') campusId = req.user.campus_id;
  if (!campusId) return res.status(400).json({ error: 'Kampüs seçimi zorunludur.' });
  const rows = db.prepare('SELECT * FROM departments WHERE campus_id = ? ORDER BY name').all(campusId);
  res.json({ departments: rows });
});

router.post('/departments', requirePermission('settings.manage'), (req, res) => {
  const b = req.body || {};
  const campusId = Number(b.campus_id);
  const name = String(b.name || '').trim();
  if (!campusId || !name) return res.status(400).json({ error: 'Kampüs ve bölüm adı zorunludur.' });
  if (!assertCampusAccess(req, campusId)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  if (!db.prepare('SELECT id FROM campuses WHERE id = ?').get(campusId)) {
    return res.status(404).json({ error: 'Kampüs bulunamadı.' });
  }
  if (db.prepare('SELECT id FROM departments WHERE campus_id = ? AND name = ?').get(campusId, name)) {
    return res.status(400).json({ error: 'Bu kampüste aynı isimde bölüm zaten var.' });
  }
  const info = db.prepare('INSERT INTO departments (campus_id, name) VALUES (?, ?)').run(campusId, name);
  audit(req.user.id, 'CREATE', 'department', info.lastInsertRowid, name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/departments/:id', requirePermission('settings.manage'), (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(req.params.id);
  if (!dept) return res.status(404).json({ error: 'Bölüm bulunamadı.' });
  if (!assertCampusAccess(req, dept.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : dept.name;
  if (!name) return res.status(400).json({ error: 'Bölüm adı boş olamaz.' });
  const dup = db.prepare('SELECT id FROM departments WHERE campus_id = ? AND name = ? AND id != ?')
    .get(dept.campus_id, name, dept.id);
  if (dup) return res.status(400).json({ error: 'Bu isimde başka bir bölüm var.' });
  db.prepare('UPDATE departments SET name = ?, active = ? WHERE id = ?')
    .run(name, b.active !== undefined ? (b.active ? 1 : 0) : dept.active, dept.id);
  audit(req.user.id, 'UPDATE', 'department', dept.id, name);
  res.json({ ok: true });
});

// ---- Şube doluluk durumu (kayıt formu için) ----
router.get('/sections', (req, res) => {
  const yearId = Number(req.query.academic_year_id);
  const deptId = Number(req.query.department_id);
  const grade = String(req.query.grade || '');
  let campusId = Number(req.query.campus_id);
  if (req.user.role !== 'GENEL_MERKEZ') campusId = req.user.campus_id;
  if (!campusId || !yearId || !deptId || !GRADES.includes(grade)) {
    return res.status(400).json({ error: 'Kampüs, yıl, bölüm ve sınıf (9-12) zorunludur.' });
  }
  const plan = db.prepare(`
    SELECT section_count FROM section_plans
    WHERE campus_id = ? AND academic_year_id = ? AND department_id = ? AND grade = ?`)
    .get(campusId, yearId, deptId, grade);
  if (!plan) {
    return res.json({ sections: [], plan_missing: true, max_class_size: MAX_CLASS_SIZE });
  }
  const counts = db.prepare(`
    SELECT section, COUNT(*) AS c FROM enrollments
    WHERE campus_id = ? AND academic_year_id = ? AND department_id = ? AND grade = ? AND status != 'IPTAL'
    GROUP BY section`).all(campusId, yearId, deptId, grade);
  const countMap = Object.fromEntries(counts.map(r => [r.section, r.c]));
  const sections = [];
  for (let i = 0; i < Math.min(plan.section_count, SECTION_LETTERS.length); i++) {
    const letter = SECTION_LETTERS[i];
    const current = countMap[letter] || 0;
    sections.push({ section: letter, current, capacity: MAX_CLASS_SIZE, full: current >= MAX_CLASS_SIZE });
  }
  res.json({ sections, plan_missing: false, max_class_size: MAX_CLASS_SIZE });
});

// ---- Evrak türleri ----
router.get('/documents', (req, res) => {
  res.json({ document_types: db.prepare('SELECT * FROM document_types ORDER BY sort_order, id').all() });
});

router.post('/documents', requirePermission('settings.manage'), (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name) return res.status(400).json({ error: 'Evrak adı zorunludur.' });
  if (db.prepare('SELECT id FROM document_types WHERE name = ?').get(name)) {
    return res.status(400).json({ error: 'Bu isimde bir evrak türü zaten var.' });
  }
  const max = db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM document_types').get().m;
  const info = db.prepare('INSERT INTO document_types (name, sort_order) VALUES (?, ?)').run(name, max + 1);
  audit(req.user.id, 'CREATE', 'document_type', info.lastInsertRowid, name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/documents/:id', requirePermission('settings.manage'), (req, res) => {
  const doc = db.prepare('SELECT * FROM document_types WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Evrak türü bulunamadı.' });
  const b = req.body || {};
  const name = b.name !== undefined ? String(b.name).trim() : doc.name;
  if (!name) return res.status(400).json({ error: 'Evrak adı boş olamaz.' });
  db.prepare('UPDATE document_types SET name = ?, active = ? WHERE id = ?')
    .run(name, b.active !== undefined ? (b.active ? 1 : 0) : doc.active, doc.id);
  audit(req.user.id, 'UPDATE', 'document_type', doc.id, name);
  res.json({ ok: true });
});

// ---- Önceki okul kataloğu ----
router.get('/schools', (req, res) => {
  const q = req.query || {};
  const where = ['1=1'];
  const params = {};
  if (q.city) { where.push('city = @city'); params.city = String(q.city).trim(); }
  if (q.district) { where.push('district = @district'); params.district = String(q.district).trim(); }
  if (q.type) { where.push('type = @type'); params.type = q.type; }
  if (q.search) { where.push('name LIKE @search'); params.search = `%${String(q.search).trim()}%`; }
  if (!q.include_passive) where.push('active = 1');
  const rows = db.prepare(`
    SELECT * FROM schools WHERE ${where.join(' AND ')} ORDER BY city, district, name LIMIT 500`).all(params);
  const cities = db.prepare('SELECT DISTINCT city FROM schools WHERE active = 1 ORDER BY city').all().map(r => r.city);
  const districts = q.city
    ? db.prepare('SELECT DISTINCT district FROM schools WHERE city = ? AND active = 1 ORDER BY district')
        .all(String(q.city).trim()).map(r => r.district)
    : [];
  res.json({ schools: rows, cities, districts });
});

router.post('/schools', requirePermission('settings.manage'), (req, res) => {
  const b = req.body || {};
  const city = String(b.city || '').trim();
  const district = String(b.district || '').trim();
  const name = String(b.name || '').trim();
  const type = b.type === 'LISE' ? 'LISE' : 'ORTAOKUL';
  if (!city || !district || !name) {
    return res.status(400).json({ error: 'İl, ilçe ve okul adı zorunludur.' });
  }
  if (db.prepare('SELECT id FROM schools WHERE city = ? AND district = ? AND name = ?').get(city, district, name)) {
    return res.status(400).json({ error: 'Bu okul zaten kayıtlı.' });
  }
  const info = db.prepare('INSERT INTO schools (city, district, name, type) VALUES (?, ?, ?, ?)')
    .run(city, district, name, type);
  audit(req.user.id, 'CREATE', 'school', info.lastInsertRowid, `${city}/${district}/${name}`);
  res.json({ id: info.lastInsertRowid });
});

router.put('/schools/:id', requirePermission('settings.manage'), (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(req.params.id);
  if (!school) return res.status(404).json({ error: 'Okul bulunamadı.' });
  const b = req.body || {};
  const city = b.city !== undefined ? String(b.city).trim() : school.city;
  const district = b.district !== undefined ? String(b.district).trim() : school.district;
  const name = b.name !== undefined ? String(b.name).trim() : school.name;
  if (!city || !district || !name) return res.status(400).json({ error: 'İl, ilçe ve okul adı boş olamaz.' });
  const dup = db.prepare('SELECT id FROM schools WHERE city = ? AND district = ? AND name = ? AND id != ?')
    .get(city, district, name, school.id);
  if (dup) return res.status(400).json({ error: 'Bu okul zaten kayıtlı.' });
  db.prepare('UPDATE schools SET city = ?, district = ?, name = ?, type = ?, active = ? WHERE id = ?')
    .run(city, district, name,
      b.type === 'LISE' ? 'LISE' : b.type === 'ORTAOKUL' ? 'ORTAOKUL' : school.type,
      b.active !== undefined ? (b.active ? 1 : 0) : school.active, school.id);
  audit(req.user.id, 'UPDATE', 'school', school.id, name);
  res.json({ ok: true });
});

/**
 * Excel ile okul yükleme. Beklenen sütunlar (1. satır başlık olabilir):
 * A: İl, B: İlçe, C: Okul Adı, D: Tür (Ortaokul/Lise, boşsa Ortaokul)
 * Mevcut okullar (il+ilçe+ad) atlanır.
 */
router.post('/schools/import',
  express.raw({ type: () => true, limit: '15mb' }),
  requirePermission('settings.manage'),
  async (req, res) => {
    try {
      if (!req.body || !req.body.length) return res.status(400).json({ error: 'Dosya alınamadı.' });
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(req.body);
      const ws = wb.worksheets[0];
      if (!ws) return res.status(400).json({ error: 'Excel dosyasında sayfa bulunamadı.' });
      let added = 0, skipped = 0, invalid = 0;
      const exists = db.prepare('SELECT id FROM schools WHERE city = ? AND district = ? AND name = ?');
      const ins = db.prepare('INSERT INTO schools (city, district, name, type) VALUES (?, ?, ?, ?)');
      const cellText = c => String(c?.value?.result ?? c?.value ?? '').trim();
      db.transaction(() => {
        ws.eachRow(row => {
          const city = cellText(row.getCell(1));
          const district = cellText(row.getCell(2));
          const name = cellText(row.getCell(3));
          const typeRaw = cellText(row.getCell(4)).toLocaleUpperCase('tr-TR');
          if (!city || !district || !name) { invalid++; return; }
          if (/^(İL|IL)$/i.test(city)) return; // başlık satırı
          const type = typeRaw.startsWith('L') ? 'LISE' : 'ORTAOKUL';
          if (exists.get(city, district, name)) { skipped++; return; }
          ins.run(city, district, name, type);
          added++;
        });
      })();
      audit(req.user.id, 'IMPORT', 'school', null, `eklendi=${added} atlandı=${skipped}`);
      res.json({ added, skipped, invalid });
    } catch (e) {
      res.status(400).json({ error: 'Excel dosyası okunamadı: ' + e.message });
    }
  });

module.exports = router;
module.exports.getParams = getParams;
module.exports.GRADES = GRADES;
module.exports.MAX_CLASS_SIZE = MAX_CLASS_SIZE;
module.exports.SECTION_LETTERS = SECTION_LETTERS;
