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
    'SELECT fee_item_id, price FROM campus_prices WHERE campus_id = ? AND academic_year_id = ?'
  ).all(campusId, yearId);
  const priceMap = Object.fromEntries(prices.map(p => [p.fee_item_id, p.price]));
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
    fee_items: items.map(i => ({ ...i, price: priceMap[i.id] ?? null })),
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
  for (const p of prices) {
    if (p.price !== null && p.price !== '' && (isNaN(Number(p.price)) || Number(p.price) < 0)) {
      return res.status(400).json({ error: 'Fiyatlar 0 veya daha büyük olmalıdır.' });
    }
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
      INSERT INTO campus_prices (campus_id, academic_year_id, fee_item_id, price)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(campus_id, academic_year_id, fee_item_id) DO UPDATE SET price = excluded.price`);
    const del = db.prepare(
      'DELETE FROM campus_prices WHERE campus_id = ? AND academic_year_id = ? AND fee_item_id = ?');
    for (const p of prices) {
      const itemId = Number(p.fee_item_id);
      if (!itemId) continue;
      if (p.price === null || p.price === '') del.run(campusId, yearId, itemId);
      else up.run(campusId, yearId, itemId, money(p.price));
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

module.exports = router;
module.exports.getParams = getParams;
module.exports.GRADES = GRADES;
module.exports.MAX_CLASS_SIZE = MAX_CLASS_SIZE;
module.exports.SECTION_LETTERS = SECTION_LETTERS;
