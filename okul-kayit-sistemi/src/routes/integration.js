/**
 * CRM Entegrasyon API'si (sunucudan sunucuya, X-API-Key ile korunur).
 *
 * Akış:
 *  - CRM, ön kayıt/aday öğrencileri buraya gönderir (POST /candidates).
 *  - Okul kayıt ekranında "CRM'den Getir" ile aday seçilir, form dolar.
 *  - Kesin kayıt tamamlanınca okul no + sınıf/bölüm/şube + 6 haneli sözleşme no
 *    + kayıt tarihi CRM'e webhook ile iletilir; CRM ayrıca buradan sorgulayabilir.
 */
const express = require('express');
const { db, audit, money } = require('../db');
const { tcError, phoneField } = require('../validate');

const router = express.Router();

// ---- API anahtarı doğrulama ----
function authenticateApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key || '';
  if (!key) return res.status(401).json({ error: 'X-Api-Key başlığı zorunludur.' });
  const row = db.prepare('SELECT * FROM integration_keys WHERE key = ? AND active = 1').get(String(key));
  if (!row) return res.status(403).json({ error: 'Geçersiz veya pasif API anahtarı.' });
  req.apiKey = row; // row.campus_id: anahtarın bağlı olduğu kampüs (null = genel)
  if (row.campus_id) {
    const c = db.prepare('SELECT code FROM campuses WHERE id = ?').get(row.campus_id);
    req.apiKeyCampusCode = c ? c.code : null;
  }
  next();
}
router.use(authenticateApiKey);

// ---- Öğrencinin CRM'e dönecek tam görüntüsü ----
function studentSnapshot(student) {
  const parents = db.prepare(
    'SELECT relation, full_name, tc_no, phone, email, occupation, is_guardian, is_payer FROM parents WHERE student_id = ? ORDER BY is_guardian DESC, id'
  ).all(student.id);
  const enrollments = db.prepare(`
    SELECT e.id, e.contract_no, e.enrollment_date, e.enrollment_type, e.grade, e.section,
      e.list_fee, e.discount_amount, e.net_fee, e.installment_count, e.default_payment_method, e.status,
      ay.name AS academic_year, dn.name AS department, c.name AS campus, c.code AS campus_code,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.enrollment_id = e.id AND p.cancelled = 0) AS total_paid
    FROM enrollments e
    JOIN academic_years ay ON ay.id = e.academic_year_id
    JOIN campuses c ON c.id = e.campus_id
    LEFT JOIN departments dn ON dn.id = e.department_id
    WHERE e.student_id = ? ORDER BY ay.start_date DESC`).all(student.id);
  const campus = db.prepare('SELECT name, code FROM campuses WHERE id = ?').get(student.campus_id);
  const dept = student.department_id
    ? db.prepare('SELECT name FROM departments WHERE id = ?').get(student.department_id) : null;
  return {
    crm_form_id: student.crm_form_id || null,
    okul_no: student.student_no,
    ad: student.first_name,
    soyad: student.last_name,
    tc_no: student.tc_no,
    dogum_tarihi: student.birth_date,
    cinsiyet: student.gender,
    durum: student.status,
    kampus: campus?.name || '',
    kampus_kodu: campus?.code || '',
    bolum: dept?.name || '',
    sinif: student.grade,
    sube: student.section,
    adres: { il: student.city, ilce: student.district, mahalle: student.neighborhood, adres: student.address },
    veliler: parents.map(p => ({
      yakinlik: p.relation, ad_soyad: p.full_name, tc_no: p.tc_no, telefon: p.phone,
      eposta: p.email, meslek: p.occupation, veli_mi: !!p.is_guardian, odeme_sorumlusu_mu: !!p.is_payer,
    })),
    kayitlar: enrollments.map(e => ({
      sozlesme_no: e.contract_no,
      ogretim_yili: e.academic_year,
      kayit_tarihi: e.enrollment_date,
      kayit_turu: e.enrollment_type,
      kampus: e.campus, kampus_kodu: e.campus_code,
      bolum: e.department, sinif: e.grade, sube: e.section,
      liste_ucreti: e.list_fee, indirim: e.discount_amount, net_ucret: e.net_fee,
      tahsil_edilen: money(e.total_paid), bakiye: money(e.net_fee - e.total_paid),
      taksit_sayisi: e.installment_count, odeme_turu: e.default_payment_method,
      durum: e.status,
    })),
  };
}

// ---- Aday gönder / güncelle (CRM -> Okul Kayıt) ----
// Topkapı CRM sözleşmesi: { crm_id, ad, soyad, tc_kimlik, veli_adi, veli_telefon,
//   veli2_adi, veli2_telefon, sinif, bolum, sube, mahalle, il, ilce }
// (Geriye dönük olarak eski alan adları da kabul edilir.)
router.post('/candidates', (req, res) => {
  const b = req.body || {};
  // Alan eşleme: CRM adları öncelikli, yoksa eski adlar
  const crmId = b.crm_id !== undefined ? String(b.crm_id).trim() : String(b.crm_form_id || '').trim();
  if (!crmId) return res.status(400).json({ hata: 'crm_id zorunludur.', error: 'crm_id zorunludur.' });
  const first = String(b.ad ?? b.first_name ?? '').trim();
  const last = String(b.soyad ?? b.last_name ?? '').trim();
  if (!first || !last) return res.status(400).json({ hata: 'ad ve soyad zorunludur.', error: 'ad ve soyad zorunludur.' });
  const tc = String(b.tc_kimlik ?? b.tc_no ?? '').trim();
  const tErr = tcError(tc, 'Öğrenci');
  if (tErr) return res.status(400).json({ hata: tErr, error: tErr });

  // Veli bilgileri: CRM veli_adi/veli2_adi veya eski parents[] dizisi
  let parents = [];
  if (Array.isArray(b.parents) && b.parents.length) {
    parents = b.parents.map(p => ({ full_name: p.full_name, phone: p.phone, relation: p.relation, tc_no: p.tc_no }));
  } else {
    if (b.veli_adi) parents.push({ full_name: String(b.veli_adi).trim(), phone: String(b.veli_telefon || ''), tc_no: String(b.veli_tc ?? b.veli_tc_kimlik ?? '').trim() });
    if (b.veli2_adi) parents.push({ full_name: String(b.veli2_adi).trim(), phone: String(b.veli2_telefon || ''), tc_no: String(b.veli2_tc ?? b.veli2_tc_kimlik ?? '').trim() });
  }
  for (const p of parents) {
    const label = `Veli (${p.full_name || '?'})`;
    if (p.tc_no) { const pt = tcError(p.tc_no, label); if (pt) return res.status(400).json({ hata: pt, error: pt }); }
    if (p.phone) { const r = phoneField(p.phone, label); if (r.error) return res.status(400).json({ hata: r.error, error: r.error }); p.phone = r.value; }
  }
  // Kampüs: anahtar kampüse bağlıysa onu kullan (CRM'in kampüs bazlı anahtarı belirleyicidir),
  // değilse gövdedeki campus_code.
  const campusCode = req.apiKeyCampusCode || String(b.campus_code || '').trim().toUpperCase();
  if (campusCode && !db.prepare('SELECT id FROM campuses WHERE code = ?').get(campusCode)) {
    return res.status(400).json({ hata: `Bilinmeyen kampüs kodu: ${campusCode}`, error: `Bilinmeyen kampüs kodu: ${campusCode}` });
  }
  const existing = db.prepare('SELECT * FROM crm_candidates WHERE crm_form_id = ?').get(crmId);
  // Aktarılmış (kesin kayda dönmüş) aday: CRM yeniden gönderse de sessizce kabul (200), üzerine yazma
  if (existing && existing.status === 'AKTARILDI') {
    return res.json({ status: 'received', note: 'already_enrolled' });
  }
  const fields = {
    campus_code: campusCode,
    first_name: first, last_name: last, tc_no: tc,
    birth_date: b.birth_date || '',
    gender: ['ERKEK', 'KIZ'].includes(b.gender) ? b.gender : '',
    grade: String(b.sinif ?? b.grade ?? ''),
    city: b.il ?? b.city ?? '', district: b.ilce ?? b.district ?? '', neighborhood: b.mahalle ?? b.neighborhood ?? '',
    address: b.adres ?? b.address ?? '',
    parents_json: JSON.stringify(parents),
    notes: [b.bolum ? 'Bölüm: ' + b.bolum : '', b.sube ? 'Şube: ' + b.sube : '', b.notes || ''].filter(Boolean).join(' · '),
    raw_json: JSON.stringify(b).slice(0, 20000),
  };
  if (existing) {
    db.prepare(`
      UPDATE crm_candidates SET campus_code = @campus_code, first_name = @first_name, last_name = @last_name,
        tc_no = @tc_no, birth_date = @birth_date, gender = @gender, grade = @grade,
        city = @city, district = @district, neighborhood = @neighborhood, address = @address,
        parents_json = @parents_json, notes = @notes, raw_json = @raw_json,
        status = 'BEKLIYOR', updated_at = datetime('now')
      WHERE crm_form_id = @crm_form_id`).run({ ...fields, crm_form_id: crmId });
    audit(null, 'CRM_UPDATE', 'crm_candidate', existing.id, crmId);
    return res.json({ status: 'received', id: existing.id });
  }
  const info = db.prepare(`
    INSERT INTO crm_candidates (crm_form_id, campus_code, first_name, last_name, tc_no, birth_date,
      gender, grade, city, district, neighborhood, address, parents_json, notes, raw_json)
    VALUES (@crm_form_id, @campus_code, @first_name, @last_name, @tc_no, @birth_date,
      @gender, @grade, @city, @district, @neighborhood, @address, @parents_json, @notes, @raw_json)`)
    .run({ ...fields, crm_form_id: crmId });
  audit(null, 'CRM_CREATE', 'crm_candidate', info.lastInsertRowid, crmId);
  res.status(201).json({ status: 'received', id: info.lastInsertRowid });
});

// ---- Aday listesi ----
router.get('/candidates', (req, res) => {
  const q = req.query || {};
  const where = ['1=1'];
  const params = {};
  if (q.status) { where.push('status = @status'); params.status = q.status; }
  if (q.crm_form_id) { where.push('crm_form_id = @fid'); params.fid = q.crm_form_id; }
  const rows = db.prepare(`
    SELECT id, crm_form_id, campus_code, first_name, last_name, tc_no, grade, status,
      student_id, created_at, updated_at
    FROM crm_candidates WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 500`).all(params);
  res.json({ candidates: rows });
});

// ---- Aday iptal ----
router.delete('/candidates/:formId', (req, res) => {
  const c = db.prepare('SELECT * FROM crm_candidates WHERE crm_form_id = ?').get(req.params.formId);
  if (!c) return res.status(404).json({ error: 'Aday bulunamadı.' });
  if (c.status === 'AKTARILDI') return res.status(409).json({ error: 'Aktarılmış aday iptal edilemez.' });
  db.prepare(`UPDATE crm_candidates SET status = 'IPTAL', updated_at = datetime('now') WHERE id = ?`).run(c.id);
  audit(null, 'CRM_CANCEL', 'crm_candidate', c.id, c.crm_form_id);
  res.json({ ok: true });
});

// ---- Öğrenci sorgu: CRM form ID ile tam görüntü ----
router.get('/students/:formId', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE crm_form_id = ?').get(req.params.formId);
  if (!student) return res.status(404).json({ error: 'Bu CRM form ID ile eşleşmiş öğrenci yok.' });
  res.json({ student: studentSnapshot(student) });
});

// ---- Kayıt akışı: CRM'in çekebileceği sözleşme beslemesi ----
router.get('/enrollments', (req, res) => {
  const q = req.query || {};
  const where = ["e.contract_no != ''"];
  const params = {};
  if (q.since) { where.push('e.created_at >= @since'); params.since = String(q.since); }
  if (q.after_id) { where.push('e.id > @after'); params.after = Number(q.after_id); }
  if (q.campus_code) {
    where.push('c.code = @cc');
    params.cc = String(q.campus_code).trim().toUpperCase();
  }
  const rows = db.prepare(`
    SELECT e.id, e.contract_no AS sozlesme_no, e.enrollment_date AS kayit_tarihi,
      e.enrollment_type AS kayit_turu, e.grade AS sinif, e.section AS sube, e.status AS durum,
      e.net_fee AS net_ucret, e.installment_count AS taksit_sayisi, e.created_at,
      s.student_no AS okul_no, s.first_name AS ad, s.last_name AS soyad, s.crm_form_id,
      ay.name AS ogretim_yili, c.code AS kampus_kodu, c.name AS kampus, dn.name AS bolum
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN academic_years ay ON ay.id = e.academic_year_id
    JOIN campuses c ON c.id = e.campus_id
    LEFT JOIN departments dn ON dn.id = e.department_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.id LIMIT 500`).all(params);
  res.json({ enrollments: rows, next_after_id: rows.length ? rows[rows.length - 1].id : null });
});

module.exports = router;
module.exports.studentSnapshot = studentSnapshot;
