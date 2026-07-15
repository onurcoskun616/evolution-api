/**
 * Parametreler: MEB'e ilan edilen kampüs ücret listeleri ve indirim sınırları.
 * Görüntüleme: tüm oturumlu kullanıcılar (kayıt formunun ihtiyacı).
 * Düzenleme: settings.manage izni (varsayılan: Genel Merkez; kullanıcı bazında verilebilir).
 */
const express = require('express');
const { db, audit, money } = require('../db');
const { requirePermission, assertCampusAccess } = require('../auth');

const router = express.Router();

function getParams(campusId, yearId) {
  const items = db.prepare('SELECT * FROM fee_items ORDER BY sort_order, id').all();
  const prices = db.prepare(
    'SELECT fee_item_id, price FROM campus_prices WHERE campus_id = ? AND academic_year_id = ?'
  ).all(campusId, yearId);
  const priceMap = Object.fromEntries(prices.map(p => [p.fee_item_id, p.price]));
  const limits = db.prepare(
    'SELECT max_discount_rate, max_discount_amount FROM campus_discount_limits WHERE campus_id = ? AND academic_year_id = ?'
  ).get(campusId, yearId) || { max_discount_rate: null, max_discount_amount: null };
  return {
    fee_items: items.map(i => ({ ...i, price: priceMap[i.id] ?? null })),
    limits,
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

module.exports = router;
module.exports.getParams = getParams;
