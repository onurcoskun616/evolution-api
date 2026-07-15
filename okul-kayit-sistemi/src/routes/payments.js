const express = require('express');
const { db, audit, money, today } = require('../db');
const { requirePermission, assertCampusAccess, campusScope } = require('../auth');
const { PAYMENT_METHODS } = require('./enrollments');

const router = express.Router();

const METHOD_LABELS = {
  NAKIT: 'Nakit', KREDI_KARTI: 'Kredi Kartı', KMH: 'KMH',
  SENET: 'Senet', HAVALE_EFT: 'Havale/EFT', CEK: 'Çek', MAIL_ORDER: 'Mail Order',
};

/** Bir taksitin durumunu ödenen tutara göre yeniden hesaplar. */
function refreshInstallmentStatus(installmentId) {
  const inst = db.prepare('SELECT * FROM installments WHERE id = ?').get(installmentId);
  if (!inst || inst.status === 'IPTAL') return;
  const paid = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE installment_id = ? AND cancelled = 0'
  ).get(installmentId).s;
  const status = paid <= 0 ? 'BEKLIYOR' : (money(paid) >= money(inst.amount) ? 'ODENDI' : 'KISMI');
  db.prepare('UPDATE installments SET paid_amount = ?, status = ? WHERE id = ?')
    .run(money(paid), status, installmentId);
}

/** Kayıt tamamen ödendiyse durumunu TAMAMLANDI yapar (veya geri alır). */
function refreshEnrollmentStatus(enrollmentId) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e || e.status === 'IPTAL' || e.status === 'DONDURULDU') return;
  const paid = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE enrollment_id = ? AND cancelled = 0'
  ).get(enrollmentId).s;
  const status = money(paid) >= money(e.net_fee) && e.net_fee > 0 ? 'TAMAMLANDI' : 'AKTIF';
  if (status !== e.status) db.prepare('UPDATE enrollments SET status = ? WHERE id = ?').run(status, enrollmentId);
}

// ---- Tahsilat listesi ----
router.get('/', requirePermission('payment.view'), (req, res) => {
  const q = req.query || {};
  const scope = campusScope(req, q.campus_id);
  const where = ['1=1'];
  const params = {};
  if (scope !== null) { where.push('e.campus_id = @campus'); params.campus = scope; }
  if (q.start_date) { where.push('p.payment_date >= @sd'); params.sd = q.start_date; }
  if (q.end_date) { where.push('p.payment_date <= @ed'); params.ed = q.end_date; }
  if (q.method) { where.push('p.method = @m'); params.m = q.method; }
  if (!q.include_cancelled) where.push('p.cancelled = 0');
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM payments p JOIN enrollments e ON e.id = p.enrollment_id
    WHERE ${where.join(' AND ')}`).get(params).c;
  const sum = db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) AS s FROM payments p JOIN enrollments e ON e.id = p.enrollment_id
    WHERE ${where.join(' AND ')} AND p.cancelled = 0`).get(params).s;
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(q.page_size, 10) || 25));
  params.limit = pageSize; params.offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT p.*, s.student_no, s.first_name || ' ' || s.last_name AS student_name,
      c.name AS campus_name, u.full_name AS received_by_name,
      i.label AS installment_label
    FROM payments p
    JOIN enrollments e ON e.id = p.enrollment_id
    JOIN students s ON s.id = e.student_id
    JOIN campuses c ON c.id = e.campus_id
    LEFT JOIN users u ON u.id = p.received_by
    LEFT JOIN installments i ON i.id = p.installment_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.payment_date DESC, p.id DESC
    LIMIT @limit OFFSET @offset`).all(params);
  res.json({ payments: rows, total, total_amount: money(sum), page, page_size: pageSize, methods: METHOD_LABELS });
});

// ---- Tahsilat kaydet ----
router.post('/', requirePermission('payment.create'), (req, res) => {
  const b = req.body || {};
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(b.enrollment_id);
  if (!e) return res.status(400).json({ error: 'Kayıt bulunamadı.' });
  if (!assertCampusAccess(req, e.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  if (e.status === 'IPTAL') return res.status(400).json({ error: 'İptal edilmiş kayda tahsilat yapılamaz.' });
  const amount = money(b.amount);
  if (amount <= 0) return res.status(400).json({ error: 'Tutar sıfırdan büyük olmalıdır.' });
  if (!PAYMENT_METHODS.includes(b.method)) return res.status(400).json({ error: 'Geçersiz ödeme türü.' });
  const paymentDate = b.payment_date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) return res.status(400).json({ error: 'Geçersiz tarih.' });

  const totalPaid = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE enrollment_id = ? AND cancelled = 0'
  ).get(e.id).s;
  const balance = money(e.net_fee - totalPaid);
  if (amount > balance) {
    return res.status(400).json({ error: `Tutar kalan bakiyeyi aşıyor. Kalan bakiye: ${balance.toFixed(2)} TL` });
  }

  let installmentId = b.installment_id ? Number(b.installment_id) : null;
  if (installmentId) {
    const inst = db.prepare('SELECT * FROM installments WHERE id = ? AND enrollment_id = ?')
      .get(installmentId, e.id);
    if (!inst) return res.status(400).json({ error: 'Taksit bu kayda ait değil.' });
    if (inst.status === 'IPTAL') return res.status(400).json({ error: 'İptal edilmiş taksite ödeme alınamaz.' });
    const instRemaining = money(inst.amount - inst.paid_amount);
    if (amount > instRemaining) {
      return res.status(400).json({ error: `Tutar taksit kalanını aşıyor. Taksit kalanı: ${instRemaining.toFixed(2)} TL` });
    }
  }

  const result = db.transaction(() => {
    // Makbuz no girilmediyse kampüs bazlı seri numara üret: KOD-YIL-000001
    let receiptNo = String(b.receipt_no || '').trim();
    if (!receiptNo) {
      const campus = db.prepare('SELECT code FROM campuses WHERE id = ?').get(e.campus_id);
      const prefix = `${campus.code}-${new Date().getFullYear()}-`;
      const row = db.prepare(`
        SELECT receipt_no FROM payments WHERE receipt_no LIKE ?
        ORDER BY LENGTH(receipt_no) DESC, receipt_no DESC LIMIT 1`).get(prefix + '%');
      let seq = 1;
      if (row) seq = (parseInt(row.receipt_no.slice(prefix.length), 10) || 0) + 1;
      receiptNo = prefix + String(seq).padStart(6, '0');
    }
    const info = db.prepare(`
      INSERT INTO payments (enrollment_id, installment_id, payment_date, amount, method,
        receipt_no, reference, notes, received_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(e.id, installmentId, paymentDate, amount, b.method,
        receiptNo, b.reference || '', b.notes || '', req.user.id);
    if (installmentId) refreshInstallmentStatus(installmentId);
    refreshEnrollmentStatus(e.id);
    return { id: info.lastInsertRowid, receipt_no: receiptNo };
  })();
  audit(req.user.id, 'CREATE', 'payment', result.id, `${amount} TL / ${b.method} / ${result.receipt_no}`);
  res.json(result);
});

// ---- Tahsilat iptal ----
router.post('/:id/cancel', requirePermission('payment.cancel'), (req, res) => {
  const p = db.prepare(`
    SELECT p.*, e.campus_id FROM payments p
    JOIN enrollments e ON e.id = p.enrollment_id WHERE p.id = ?`).get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Tahsilat bulunamadı.' });
  if (!assertCampusAccess(req, p.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  if (p.cancelled) return res.status(400).json({ error: 'Tahsilat zaten iptal edilmiş.' });
  db.transaction(() => {
    db.prepare(`
      UPDATE payments SET cancelled = 1, cancel_reason = ?, cancelled_by = ?, cancelled_at = datetime('now')
      WHERE id = ?`).run((req.body && req.body.reason) || '', req.user.id, p.id);
    if (p.installment_id) refreshInstallmentStatus(p.installment_id);
    refreshEnrollmentStatus(p.enrollment_id);
  })();
  audit(req.user.id, 'CANCEL', 'payment', p.id, (req.body && req.body.reason) || '');
  res.json({ ok: true });
});

// ---- Taksit takibi: vadesi geçen / yaklaşan / tümü ----
router.get('/installments', requirePermission('payment.view'), (req, res) => {
  const q = req.query || {};
  const scope = campusScope(req, q.campus_id);
  const t = today();
  const where = [`i.status IN ('BEKLIYOR','KISMI')`, `e.status IN ('AKTIF')`];
  const params = { today: t };
  if (scope !== null) { where.push('e.campus_id = @campus'); params.campus = scope; }
  if (q.filter === 'overdue') {
    where.push('i.due_date < @today');
  } else if (q.filter === 'upcoming') {
    const days = Math.min(120, Math.max(1, parseInt(q.days, 10) || 30));
    const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    where.push('i.due_date >= @today AND i.due_date <= @end');
    params.end = end;
  } else if (q.filter === 'future') {
    where.push('i.due_date >= @today');
  }
  if (q.search) {
    where.push(`(s.first_name || ' ' || s.last_name LIKE @search OR s.student_no LIKE @search)`);
    params.search = `%${String(q.search).trim()}%`;
  }
  const whereSql = where.join(' AND ');
  const totals = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(i.amount - i.paid_amount),0) AS remaining
    FROM installments i
    JOIN enrollments e ON e.id = i.enrollment_id
    JOIN students s ON s.id = e.student_id
    WHERE ${whereSql}`).get(params);
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(q.page_size, 10) || 25));
  params.limit = pageSize; params.offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT i.*, e.id AS enrollment_id, s.id AS student_id, s.student_no,
      s.first_name || ' ' || s.last_name AS student_name, c.name AS campus_name,
      ay.name AS academic_year_name,
      (SELECT pr.full_name FROM parents pr WHERE pr.student_id = s.id ORDER BY pr.is_primary DESC, pr.id LIMIT 1) AS parent_name,
      (SELECT pr.phone FROM parents pr WHERE pr.student_id = s.id ORDER BY pr.is_primary DESC, pr.id LIMIT 1) AS parent_phone,
      CAST(julianday(@today) - julianday(i.due_date) AS INTEGER) AS days_overdue
    FROM installments i
    JOIN enrollments e ON e.id = i.enrollment_id
    JOIN students s ON s.id = e.student_id
    JOIN campuses c ON c.id = e.campus_id
    JOIN academic_years ay ON ay.id = e.academic_year_id
    WHERE ${whereSql}
    ORDER BY i.due_date ASC
    LIMIT @limit OFFSET @offset`).all(params);
  for (const r of rows) r.remaining = money(r.amount - r.paid_amount);
  res.json({
    installments: rows, total: totals.c, total_remaining: money(totals.remaining),
    page, page_size: pageSize,
  });
});

module.exports = router;
module.exports.METHOD_LABELS = METHOD_LABELS;
