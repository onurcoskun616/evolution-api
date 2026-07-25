const express = require('express');
const { db, money, today } = require('../db');
const { requirePermission, campusScope } = require('../auth');

const router = express.Router();

router.get('/', requirePermission('dashboard.view'), (req, res) => {
  const q = req.query || {};
  const scope = campusScope(req, q.campus_id);
  const t = today();
  const yearFilter = q.academic_year_id ? Number(q.academic_year_id) : null;

  const campusWhere = scope !== null ? 'AND e.campus_id = @campus' : '';
  const yearWhere = yearFilter ? 'AND e.academic_year_id = @year' : '';
  const params = { campus: scope, year: yearFilter, today: t };

  const studentCampusWhere = scope !== null ? 'AND s.campus_id = @campus' : '';
  const students = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN s.status = 'AKTIF' THEN 1 ELSE 0 END) AS active
    FROM students s WHERE 1=1 ${studentCampusWhere}`).get(params);

  const enroll = db.prepare(`
    SELECT COUNT(*) AS total_enrollments,
      COALESCE(SUM(e.net_fee), 0) AS total_fee
    FROM enrollments e WHERE e.status != 'IPTAL' ${campusWhere} ${yearWhere}`).get(params);

  const collected = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS s FROM payments p
    JOIN enrollments e ON e.id = p.enrollment_id
    WHERE p.cancelled = 0 AND e.status != 'IPTAL' ${campusWhere} ${yearWhere}`).get(params).s;

  const overdue = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(i.amount - i.paid_amount), 0) AS s
    FROM installments i JOIN enrollments e ON e.id = i.enrollment_id
    WHERE i.status IN ('BEKLIYOR','KISMI') AND i.due_date < @today AND e.status = 'AKTIF'
      ${campusWhere} ${yearWhere}`).get(params);

  const next30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const upcoming = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(i.amount - i.paid_amount), 0) AS s
    FROM installments i JOIN enrollments e ON e.id = i.enrollment_id
    WHERE i.status IN ('BEKLIYOR','KISMI') AND i.due_date >= @today AND i.due_date <= @next30
      AND e.status = 'AKTIF' ${campusWhere} ${yearWhere}`)
    .get({ ...params, next30 });

  const todayPayments = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(p.amount), 0) AS s FROM payments p
    JOIN enrollments e ON e.id = p.enrollment_id
    WHERE p.cancelled = 0 AND p.payment_date = @today ${campusWhere} ${yearWhere}`).get(params);

  // Kampüs bazlı özet (genel merkez için karşılaştırma tablosu)
  const perCampus = db.prepare(`
    SELECT c.id, c.name,
      (SELECT COUNT(*) FROM students s WHERE s.campus_id = c.id AND s.status = 'AKTIF') AS active_students,
      (SELECT COUNT(*) FROM enrollments e WHERE e.campus_id = c.id AND e.status != 'IPTAL' ${yearWhere}) AS enrollments,
      (SELECT COALESCE(SUM(e.net_fee),0) FROM enrollments e WHERE e.campus_id = c.id AND e.status != 'IPTAL' ${yearWhere}) AS total_fee,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN enrollments e ON e.id = p.enrollment_id
        WHERE e.campus_id = c.id AND p.cancelled = 0 AND e.status != 'IPTAL' ${yearWhere}) AS collected,
      (SELECT COALESCE(SUM(i.amount - i.paid_amount),0) FROM installments i JOIN enrollments e ON e.id = i.enrollment_id
        WHERE e.campus_id = c.id AND i.status IN ('BEKLIYOR','KISMI') AND i.due_date < @today AND e.status = 'AKTIF' ${yearWhere}) AS overdue
    FROM campuses c WHERE c.active = 1 ${scope !== null ? 'AND c.id = @campus' : ''}
    ORDER BY c.name`).all(params);

  // Son 12 ayın tahsilat grafiği
  const monthly = db.prepare(`
    SELECT substr(p.payment_date, 1, 7) AS month, COALESCE(SUM(p.amount),0) AS total
    FROM payments p JOIN enrollments e ON e.id = p.enrollment_id
    WHERE p.cancelled = 0 AND p.payment_date >= date(@today, '-12 months') ${campusWhere} ${yearWhere}
    GROUP BY month ORDER BY month`).all(params);

  // Ödeme türü dağılımı
  const byMethod = db.prepare(`
    SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount),0) AS total
    FROM payments p JOIN enrollments e ON e.id = p.enrollment_id
    WHERE p.cancelled = 0 AND e.status != 'IPTAL' ${campusWhere} ${yearWhere}
    GROUP BY p.method ORDER BY total DESC`).all(params);

  res.json({
    students: { total: students.total || 0, active: students.active || 0 },
    enrollments: enroll.total_enrollments || 0,
    total_fee: money(enroll.total_fee),
    collected: money(collected),
    balance: money(enroll.total_fee - collected),
    collection_rate: enroll.total_fee > 0 ? Math.round((collected / enroll.total_fee) * 1000) / 10 : 0,
    overdue: { count: overdue.c, amount: money(overdue.s) },
    upcoming30: { count: upcoming.c, amount: money(upcoming.s) },
    today_payments: { count: todayPayments.c, amount: money(todayPayments.s) },
    per_campus: perCampus.map(c => ({
      ...c, total_fee: money(c.total_fee), collected: money(c.collected), overdue: money(c.overdue),
      collection_rate: c.total_fee > 0 ? Math.round((c.collected / c.total_fee) * 1000) / 10 : 0,
    })),
    monthly_collections: monthly.map(m => ({ ...m, total: money(m.total) })),
    by_method: byMethod.map(m => ({ ...m, total: money(m.total) })),
  });
});

module.exports = router;
