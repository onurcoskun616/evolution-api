const express = require('express');
const ExcelJS = require('exceljs');
const { db, money, today } = require('../db');
const { requirePermission, campusScope } = require('../auth');
const { METHOD_LABELS } = require('./payments');

const router = express.Router();

const STATUS_LABELS = {
  AKTIF: 'Aktif', PASIF: 'Pasif', MEZUN: 'Mezun', KAYIT_SILDI: 'Kayıt Sildi', ADAY: 'Aday',
  IPTAL: 'İptal', DONDURULDU: 'Donduruldu', TAMAMLANDI: 'Tamamlandı',
  BEKLIYOR: 'Bekliyor', KISMI: 'Kısmi Ödendi', ODENDI: 'Ödendi',
};

const REPORT_DEFS = [
  { key: 'ogrenciler', name: 'Öğrenci Listesi', desc: 'Tüm öğrenciler; veli ve iletişim bilgileriyle birlikte.' },
  { key: 'kayitlar', name: 'Kayıt / Sözleşme Listesi', desc: 'Öğretim yılı kayıtları, ücret, indirim, tahsilat ve bakiye.' },
  { key: 'tahsilatlar', name: 'Tahsilat Listesi', desc: 'Tarih aralığına göre alınan tüm ödemeler.' },
  { key: 'geciken-taksitler', name: 'Vadesi Geçen Taksitler', desc: 'Gecikmiş taksitler; veli iletişim bilgileriyle.' },
  { key: 'yaklasan-taksitler', name: 'Yaklaşan Taksitler', desc: 'Önümüzdeki 30 gün içinde vadesi gelecek taksitler.' },
  { key: 'kayit-yenilemeyenler', name: 'Kayıt Yenilemeyenler', desc: 'Geçen öğretim yılında kayıtlı olup seçilen yıla kayıt yaptırmayan öğrenciler.' },
  { key: 'kampus-ozet', name: 'Kampüs Özet Raporu', desc: 'Kampüs bazında öğrenci, ciro, tahsilat ve gecikme özeti.' },
  { key: 'odeme-turu', name: 'Ödeme Türü Dağılımı', desc: 'Ödeme yöntemlerine göre tahsilat dağılımı.' },
];

router.get('/', requirePermission('report.view'), (req, res) => {
  res.json({ reports: REPORT_DEFS });
});

function buildWorkbookRows(type, req) {
  const q = req.query || {};
  const scope = campusScope(req, q.campus_id);
  const t = today();
  const params = { campus: scope, today: t };
  const campusWhereS = scope !== null ? 'AND s.campus_id = @campus' : '';
  const campusWhereE = scope !== null ? 'AND e.campus_id = @campus' : '';
  const yearWhere = q.academic_year_id ? 'AND e.academic_year_id = @year' : '';
  if (q.academic_year_id) params.year = Number(q.academic_year_id);

  switch (type) {
    case 'ogrenciler': {
      const rows = db.prepare(`
        SELECT s.student_no, s.tc_no, s.first_name, s.last_name, s.gender, s.birth_date,
          s.grade, s.section, s.status, c.name AS campus, dp.name AS department, s.city, s.district, s.address,
          (SELECT p.full_name FROM parents p WHERE p.student_id = s.id ORDER BY p.is_primary DESC, p.id LIMIT 1) AS parent_name,
          (SELECT p.phone FROM parents p WHERE p.student_id = s.id ORDER BY p.is_primary DESC, p.id LIMIT 1) AS parent_phone,
          (SELECT p.email FROM parents p WHERE p.student_id = s.id ORDER BY p.is_primary DESC, p.id LIMIT 1) AS parent_email
        FROM students s JOIN campuses c ON c.id = s.campus_id
        LEFT JOIN departments dp ON dp.id = s.department_id
        WHERE 1=1 ${campusWhereS} ${q.status ? 'AND s.status = @status' : ''}
        ORDER BY c.name, s.last_name, s.first_name`)
        .all(q.status ? { ...params, status: q.status } : params);
      return {
        title: 'Öğrenci Listesi',
        columns: [
          { header: 'Öğrenci No', key: 'student_no', width: 16 },
          { header: 'TC Kimlik No', key: 'tc_no', width: 14 },
          { header: 'Adı', key: 'first_name', width: 16 },
          { header: 'Soyadı', key: 'last_name', width: 16 },
          { header: 'Cinsiyet', key: 'gender', width: 10 },
          { header: 'Doğum Tarihi', key: 'birth_date', width: 13 },
          { header: 'Bölüm', key: 'department', width: 26 },
          { header: 'Sınıf', key: 'grade', width: 9 },
          { header: 'Şube', key: 'section', width: 7 },
          { header: 'Durum', key: 'status', width: 12 },
          { header: 'Kampüs', key: 'campus', width: 22 },
          { header: 'Veli', key: 'parent_name', width: 22 },
          { header: 'Veli Telefon', key: 'parent_phone', width: 15 },
          { header: 'Veli E-posta', key: 'parent_email', width: 24 },
          { header: 'İl', key: 'city', width: 12 },
          { header: 'İlçe', key: 'district', width: 14 },
          { header: 'Adres', key: 'address', width: 40 },
        ],
        rows: rows.map(r => ({ ...r, status: STATUS_LABELS[r.status] || r.status })),
      };
    }
    case 'kayitlar': {
      const rows = db.prepare(`
        SELECT s.student_no, s.first_name || ' ' || s.last_name AS student, c.name AS campus,
          ay.name AS year, dp.name AS department, e.grade, e.section, e.enrollment_date, e.enrollment_type,
          e.list_fee, e.discount_rate, e.discount_amount, e.net_fee,
          (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.enrollment_id = e.id AND p.cancelled = 0) AS paid,
          e.installment_count, e.default_payment_method, e.status, e.payer_name, e.payer_phone
        FROM enrollments e
        JOIN students s ON s.id = e.student_id
        JOIN campuses c ON c.id = e.campus_id
        JOIN academic_years ay ON ay.id = e.academic_year_id
        LEFT JOIN departments dp ON dp.id = e.department_id
        WHERE 1=1 ${campusWhereE} ${yearWhere}
        ORDER BY c.name, s.last_name`).all(params);
      return {
        title: 'Kayıt Listesi',
        columns: [
          { header: 'Öğrenci No', key: 'student_no', width: 16 },
          { header: 'Öğrenci', key: 'student', width: 24 },
          { header: 'Kampüs', key: 'campus', width: 22 },
          { header: 'Öğretim Yılı', key: 'year', width: 12 },
          { header: 'Bölüm', key: 'department', width: 26 },
          { header: 'Sınıf', key: 'grade', width: 9 },
          { header: 'Şube', key: 'section', width: 7 },
          { header: 'Kayıt Tarihi', key: 'enrollment_date', width: 13 },
          { header: 'Kayıt Türü', key: 'enrollment_type', width: 14 },
          { header: 'Liste Ücreti', key: 'list_fee', width: 14, money: true },
          { header: 'İndirim %', key: 'discount_rate', width: 10 },
          { header: 'İndirim Tutarı', key: 'discount_amount', width: 14, money: true },
          { header: 'Net Ücret', key: 'net_fee', width: 14, money: true },
          { header: 'Tahsil Edilen', key: 'paid', width: 14, money: true },
          { header: 'Bakiye', key: 'balance', width: 14, money: true },
          { header: 'Taksit', key: 'installment_count', width: 8 },
          { header: 'Ödeme Türü', key: 'default_payment_method', width: 13 },
          { header: 'Durum', key: 'status', width: 12 },
          { header: 'Ödeme Sorumlusu', key: 'payer_name', width: 22 },
          { header: 'Telefon', key: 'payer_phone', width: 15 },
        ],
        rows: rows.map(r => ({
          ...r,
          balance: money(r.net_fee - r.paid),
          enrollment_type: r.enrollment_type === 'DIS_KAYIT' ? 'Dış Kayıt' : r.enrollment_type === 'IC_KAYIT' ? 'İç Kayıt' : 'Nakil',
          default_payment_method: METHOD_LABELS[r.default_payment_method] || r.default_payment_method,
          status: STATUS_LABELS[r.status] || r.status,
        })),
      };
    }
    case 'tahsilatlar': {
      if (q.start_date) params.sd = q.start_date;
      if (q.end_date) params.ed = q.end_date;
      const rows = db.prepare(`
        SELECT p.payment_date, p.receipt_no, s.student_no, s.first_name || ' ' || s.last_name AS student,
          c.name AS campus, ay.name AS year, i.label AS installment, p.amount, p.method,
          u.full_name AS received_by, p.notes
        FROM payments p
        JOIN enrollments e ON e.id = p.enrollment_id
        JOIN students s ON s.id = e.student_id
        JOIN campuses c ON c.id = e.campus_id
        JOIN academic_years ay ON ay.id = e.academic_year_id
        LEFT JOIN installments i ON i.id = p.installment_id
        LEFT JOIN users u ON u.id = p.received_by
        WHERE p.cancelled = 0 ${campusWhereE} ${yearWhere}
          ${q.start_date ? 'AND p.payment_date >= @sd' : ''} ${q.end_date ? 'AND p.payment_date <= @ed' : ''}
        ORDER BY p.payment_date DESC, p.id DESC`).all(params);
      return {
        title: 'Tahsilat Listesi',
        columns: [
          { header: 'Tarih', key: 'payment_date', width: 13 },
          { header: 'Makbuz No', key: 'receipt_no', width: 14 },
          { header: 'Öğrenci No', key: 'student_no', width: 16 },
          { header: 'Öğrenci', key: 'student', width: 24 },
          { header: 'Kampüs', key: 'campus', width: 22 },
          { header: 'Öğretim Yılı', key: 'year', width: 12 },
          { header: 'Taksit', key: 'installment', width: 12 },
          { header: 'Tutar', key: 'amount', width: 14, money: true },
          { header: 'Ödeme Türü', key: 'method', width: 13 },
          { header: 'Tahsil Eden', key: 'received_by', width: 20 },
          { header: 'Açıklama', key: 'notes', width: 30 },
        ],
        rows: rows.map(r => ({ ...r, method: METHOD_LABELS[r.method] || r.method })),
        sumColumn: 'amount',
      };
    }
    case 'geciken-taksitler':
    case 'yaklasan-taksitler': {
      const isOverdue = type === 'geciken-taksitler';
      let dateCond;
      if (isOverdue) {
        dateCond = 'i.due_date < @today';
      } else {
        params.end = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
        dateCond = 'i.due_date >= @today AND i.due_date <= @end';
      }
      const rows = db.prepare(`
        SELECT i.due_date, i.label, i.amount, i.paid_amount,
          s.student_no, s.first_name || ' ' || s.last_name AS student, c.name AS campus,
          ay.name AS year,
          (SELECT p.full_name FROM parents p WHERE p.student_id = s.id ORDER BY p.is_primary DESC, p.id LIMIT 1) AS parent_name,
          (SELECT p.phone FROM parents p WHERE p.student_id = s.id ORDER BY p.is_primary DESC, p.id LIMIT 1) AS parent_phone,
          CAST(julianday(@today) - julianday(i.due_date) AS INTEGER) AS days_overdue
        FROM installments i
        JOIN enrollments e ON e.id = i.enrollment_id
        JOIN students s ON s.id = e.student_id
        JOIN campuses c ON c.id = e.campus_id
        JOIN academic_years ay ON ay.id = e.academic_year_id
        WHERE i.status IN ('BEKLIYOR','KISMI') AND e.status = 'AKTIF' AND ${dateCond}
          ${campusWhereE} ${yearWhere}
        ORDER BY i.due_date`).all(params);
      const cols = [
        { header: 'Vade Tarihi', key: 'due_date', width: 13 },
        { header: 'Taksit', key: 'label', width: 12 },
        { header: 'Öğrenci No', key: 'student_no', width: 16 },
        { header: 'Öğrenci', key: 'student', width: 24 },
        { header: 'Kampüs', key: 'campus', width: 22 },
        { header: 'Öğretim Yılı', key: 'year', width: 12 },
        { header: 'Taksit Tutarı', key: 'amount', width: 14, money: true },
        { header: 'Ödenen', key: 'paid_amount', width: 13, money: true },
        { header: 'Kalan', key: 'remaining', width: 14, money: true },
        { header: 'Veli', key: 'parent_name', width: 22 },
        { header: 'Veli Telefon', key: 'parent_phone', width: 15 },
      ];
      if (isOverdue) cols.splice(2, 0, { header: 'Gecikme (gün)', key: 'days_overdue', width: 13 });
      return {
        title: isOverdue ? 'Vadesi Geçen Taksitler' : 'Yaklaşan Taksitler (30 gün)',
        columns: cols,
        rows: rows.map(r => ({ ...r, remaining: money(r.amount - r.paid_amount) })),
        sumColumn: 'remaining',
      };
    }
    case 'kayit-yenilemeyenler': {
      // Hedef yıl: seçilen ya da aktif yıl; önceki yıl: başlangıcı ondan önceki en yakın yıl
      const targetYear = q.academic_year_id
        ? db.prepare('SELECT * FROM academic_years WHERE id = ?').get(Number(q.academic_year_id))
        : db.prepare('SELECT * FROM academic_years WHERE active = 1').get();
      if (!targetYear) return { title: 'Kayıt Yenilemeyenler', columns: [{ header: 'Bilgi', key: 'x', width: 40 }], rows: [] };
      const prevYear = db.prepare(
        'SELECT * FROM academic_years WHERE start_date < ? ORDER BY start_date DESC LIMIT 1'
      ).get(targetYear.start_date);
      if (!prevYear) return { title: 'Kayıt Yenilemeyenler', columns: [{ header: 'Bilgi', key: 'x', width: 40 }], rows: [] };
      params.targetYear = targetYear.id;
      params.prevYear = prevYear.id;
      const rows = db.prepare(`
        SELECT s.student_no, s.first_name || ' ' || s.last_name AS student, c.name AS campus,
          dp.name AS department, pe.grade AS prev_grade, pe.section AS prev_section,
          pe.net_fee AS prev_net,
          (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.enrollment_id = pe.id AND p.cancelled = 0) AS prev_paid,
          (SELECT pr.full_name FROM parents pr WHERE pr.student_id = s.id ORDER BY pr.is_primary DESC, pr.id LIMIT 1) AS parent_name,
          (SELECT pr.phone FROM parents pr WHERE pr.student_id = s.id ORDER BY pr.is_primary DESC, pr.id LIMIT 1) AS parent_phone
        FROM students s
        JOIN campuses c ON c.id = s.campus_id
        JOIN enrollments pe ON pe.student_id = s.id AND pe.academic_year_id = @prevYear AND pe.status != 'IPTAL'
        LEFT JOIN departments dp ON dp.id = pe.department_id
        WHERE s.status = 'AKTIF'
          AND NOT EXISTS (
            SELECT 1 FROM enrollments ne
            WHERE ne.student_id = s.id AND ne.academic_year_id = @targetYear AND ne.status != 'IPTAL')
          AND pe.grade != '12'
          ${campusWhereS}
        ORDER BY c.name, s.last_name`).all(params);
      return {
        title: `Kayıt Yenilemeyenler (${prevYear.name} → ${targetYear.name})`,
        columns: [
          { header: 'Öğrenci No', key: 'student_no', width: 16 },
          { header: 'Öğrenci', key: 'student', width: 24 },
          { header: 'Kampüs', key: 'campus', width: 22 },
          { header: 'Bölüm', key: 'department', width: 26 },
          { header: 'Geçen Yıl Sınıfı', key: 'prev_grade', width: 14 },
          { header: 'Şube', key: 'prev_section', width: 7 },
          { header: 'Geçen Yıl Ücreti', key: 'prev_net', width: 15, money: true },
          { header: 'Geçen Yıl Ödenen', key: 'prev_paid', width: 15, money: true },
          { header: 'Geçen Yıl Bakiye', key: 'prev_balance', width: 15, money: true },
          { header: 'Veli', key: 'parent_name', width: 22 },
          { header: 'Veli Telefon', key: 'parent_phone', width: 15 },
        ],
        rows: rows.map(r => ({ ...r, prev_balance: money(r.prev_net - r.prev_paid) })),
        sumColumn: 'prev_balance',
      };
    }
    case 'kampus-ozet': {
      const rows = db.prepare(`
        SELECT c.name AS campus,
          (SELECT COUNT(*) FROM students s WHERE s.campus_id = c.id AND s.status = 'AKTIF') AS active_students,
          (SELECT COUNT(*) FROM enrollments e WHERE e.campus_id = c.id AND e.status != 'IPTAL' ${yearWhere}) AS enrollments,
          (SELECT COALESCE(SUM(e.net_fee),0) FROM enrollments e WHERE e.campus_id = c.id AND e.status != 'IPTAL' ${yearWhere}) AS total_fee,
          (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN enrollments e ON e.id = p.enrollment_id
            WHERE e.campus_id = c.id AND p.cancelled = 0 AND e.status != 'IPTAL' ${yearWhere}) AS collected,
          (SELECT COALESCE(SUM(i.amount - i.paid_amount),0) FROM installments i JOIN enrollments e ON e.id = i.enrollment_id
            WHERE e.campus_id = c.id AND i.status IN ('BEKLIYOR','KISMI') AND i.due_date < @today AND e.status = 'AKTIF' ${yearWhere}) AS overdue
        FROM campuses c WHERE c.active = 1 ${scope !== null ? 'AND c.id = @campus' : ''}
        ORDER BY c.name`).all(params);
      return {
        title: 'Kampüs Özet Raporu',
        columns: [
          { header: 'Kampüs', key: 'campus', width: 26 },
          { header: 'Aktif Öğrenci', key: 'active_students', width: 14 },
          { header: 'Kayıt Sayısı', key: 'enrollments', width: 13 },
          { header: 'Toplam Ciro', key: 'total_fee', width: 16, money: true },
          { header: 'Tahsil Edilen', key: 'collected', width: 16, money: true },
          { header: 'Bakiye', key: 'balance', width: 16, money: true },
          { header: 'Tahsilat Oranı %', key: 'rate', width: 15 },
          { header: 'Geciken Tutar', key: 'overdue', width: 16, money: true },
        ],
        rows: rows.map(r => ({
          ...r,
          total_fee: money(r.total_fee), collected: money(r.collected),
          balance: money(r.total_fee - r.collected), overdue: money(r.overdue),
          rate: r.total_fee > 0 ? Math.round((r.collected / r.total_fee) * 1000) / 10 : 0,
        })),
      };
    }
    case 'odeme-turu': {
      const rows = db.prepare(`
        SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount),0) AS total
        FROM payments p JOIN enrollments e ON e.id = p.enrollment_id
        WHERE p.cancelled = 0 ${campusWhereE} ${yearWhere}
        GROUP BY p.method ORDER BY total DESC`).all(params);
      return {
        title: 'Ödeme Türü Dağılımı',
        columns: [
          { header: 'Ödeme Türü', key: 'method', width: 18 },
          { header: 'İşlem Sayısı', key: 'count', width: 14 },
          { header: 'Toplam Tutar', key: 'total', width: 18, money: true },
        ],
        rows: rows.map(r => ({ ...r, method: METHOD_LABELS[r.method] || r.method, total: money(r.total) })),
        sumColumn: 'total',
      };
    }
    default:
      return null;
  }
}

// ---- Excel indirme ----
router.get('/:type/excel', requirePermission('report.export'), async (req, res) => {
  const data = buildWorkbookRows(req.params.type, req);
  if (!data) return res.status(404).json({ error: 'Rapor bulunamadı.' });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Okul Kayıt Sistemi';
  const ws = wb.addWorksheet(data.title.slice(0, 31));
  ws.columns = data.columns.map(c => ({ header: c.header, key: c.key, width: c.width }));

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 22;

  for (const row of data.rows) ws.addRow(row);

  for (const col of data.columns) {
    if (col.money) ws.getColumn(col.key).numFmt = '#,##0.00 "₺"';
  }

  if (data.sumColumn && data.rows.length) {
    const sum = data.rows.reduce((a, r) => a + (Number(r[data.sumColumn]) || 0), 0);
    const totalRow = ws.addRow({ [data.columns[0].key]: 'TOPLAM', [data.sumColumn]: money(sum) });
    totalRow.font = { bold: true };
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: data.columns.length } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const filename = `${req.params.type}-${today()}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ---- JSON önizleme (rapor ekranında tablo göstermek için) ----
router.get('/:type/preview', requirePermission('report.view'), (req, res) => {
  const data = buildWorkbookRows(req.params.type, req);
  if (!data) return res.status(404).json({ error: 'Rapor bulunamadı.' });
  res.json({
    title: data.title,
    columns: data.columns.map(c => ({ header: c.header, key: c.key, money: !!c.money })),
    rows: data.rows.slice(0, 200),
    total_rows: data.rows.length,
  });
});

module.exports = router;
