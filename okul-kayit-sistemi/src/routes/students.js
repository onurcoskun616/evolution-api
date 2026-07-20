const express = require('express');
const { db, audit, today, getSetting, setSetting } = require('../db');
const { requirePermission, campusScope, assertCampusAccess } = require('../auth');
const { tcError, phoneField } = require('../validate');

const router = express.Router();

const GRADES = ['9', '10', '11', '12'];

/**
 * Okul numarası atama önceliği (kampüs bazında):
 *  1) e-Okul boş numara havuzunda kullanılmamış numara varsa (giriş sırasına göre) onu verir.
 *  2) Havuz bitmişse "son okul no" sayacından (okul_no_seq_<campusId>) sıralı devam eder.
 *  3) Sayaç da tanımlı değilse geriye dönük uyumlu <KAMPUS_KODU>-<YIL>-<SIRA> üretir.
 * Not: Bu fonksiyon bir transaction içinde çağrılmalıdır (havuzu rezerve eder).
 * Dönüş: { no, poolId } — poolId varsa öğrenci eklendikten sonra used_by set edilmelidir.
 */
function assignStudentNo(campusId) {
  const exists = db.prepare('SELECT 1 FROM students WHERE student_no = ?');
  // 1) Havuz
  const poolRow = db.prepare(
    `SELECT id, number FROM school_number_pool WHERE campus_id = ? AND used = 0 ORDER BY id LIMIT 1`
  ).get(campusId);
  if (poolRow && !exists.get(poolRow.number)) {
    db.prepare('UPDATE school_number_pool SET used = 1 WHERE id = ?').run(poolRow.id);
    return { no: poolRow.number, poolId: poolRow.id };
  }
  // 2) Sıralı sayaç
  const seqKey = `okul_no_seq_${campusId}`;
  const last = parseInt(getSetting(seqKey, ''), 10);
  if (!isNaN(last)) {
    let n = last + 1;
    while (exists.get(String(n))) n++;
    setSetting(seqKey, String(n));
    return { no: String(n), poolId: null };
  }
  // 3) Geriye dönük uyumlu biçim
  const campus = db.prepare('SELECT code FROM campuses WHERE id = ?').get(campusId);
  const year = new Date().getFullYear();
  const prefix = `${campus.code}-${year}-`;
  const row = db.prepare(
    `SELECT student_no FROM students WHERE student_no LIKE ? ORDER BY LENGTH(student_no) DESC, student_no DESC LIMIT 1`
  ).get(prefix + '%');
  let seq = 1;
  if (row) seq = parseInt(row.student_no.slice(prefix.length), 10) + 1;
  return { no: prefix + String(seq).padStart(5, '0'), poolId: null };
}

// ---- Liste (arama, filtre, sayfalama) ----
router.get('/', requirePermission('student.view'), (req, res) => {
  const q = req.query || {};
  const scope = campusScope(req, q.campus_id);
  const where = [];
  const params = {};
  if (scope !== null) { where.push('s.campus_id = @campus'); params.campus = scope; }
  if (q.status) { where.push('s.status = @status'); params.status = q.status; }
  if (q.grade) { where.push('s.grade = @grade'); params.grade = q.grade; }
  if (q.department_id) { where.push('s.department_id = @dept'); params.dept = Number(q.department_id); }
  if (q.search) {
    where.push(`(s.first_name || ' ' || s.last_name LIKE @search
      OR s.student_no LIKE @search OR s.tc_no LIKE @search
      OR EXISTS (SELECT 1 FROM parents p WHERE p.student_id = s.id
                 AND (p.full_name LIKE @search OR p.phone LIKE @search)))`);
    params.search = `%${String(q.search).trim()}%`;
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM students s ${whereSql}`).get(params).c;
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(q.page_size, 10) || 25));
  params.limit = pageSize;
  params.offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT s.id, s.student_no, s.tc_no, s.first_name, s.last_name, s.gender, s.grade, s.section,
           s.status, s.campus_id, s.department_id, c.name AS campus_name, d.name AS department_name,
           (SELECT p.full_name FROM parents p WHERE p.student_id = s.id ORDER BY p.is_primary DESC, p.id LIMIT 1) AS parent_name,
           (SELECT p.phone FROM parents p WHERE p.student_id = s.id ORDER BY p.is_primary DESC, p.id LIMIT 1) AS parent_phone
    FROM students s JOIN campuses c ON c.id = s.campus_id
    LEFT JOIN departments d ON d.id = s.department_id
    ${whereSql}
    ORDER BY s.last_name, s.first_name
    LIMIT @limit OFFSET @offset`).all(params);
  res.json({ students: rows, total, page, page_size: pageSize, grades: GRADES });
});

// ---- TC ile öğrenci sorgulama (mükerrer kayıt uyarısı) ----
router.get('/lookup/tc/:tc', requirePermission('student.view'), (req, res) => {
  const tc = String(req.params.tc || '').trim();
  if (!/^\d{11}$/.test(tc)) return res.json({ found: false });
  const s = db.prepare(`
    SELECT s.id, s.student_no, s.first_name, s.last_name, s.status, s.campus_id, c.name AS campus_name
    FROM students s JOIN campuses c ON c.id = s.campus_id WHERE s.tc_no = ?`).get(tc);
  if (!s) return res.json({ found: false });
  res.json({ found: true, accessible: assertCampusAccess(req, s.campus_id), student: s });
});

// ---- TC ile veli sorgulama (mevcut veliyi getir, öğrencilerini listele) ----
router.get('/parents/lookup/tc/:tc', requirePermission('student.create'), (req, res) => {
  const tc = String(req.params.tc || '').trim();
  if (!/^\d{11}$/.test(tc)) return res.json({ found: false });
  const p = db.prepare(`
    SELECT relation, full_name, tc_no, phone, phone2, email, occupation, workplace, education, address
    FROM parents WHERE tc_no = ? ORDER BY id DESC LIMIT 1`).get(tc);
  if (!p) return res.json({ found: false });
  const students = db.prepare(`
    SELECT DISTINCT s.id, s.student_no, s.first_name || ' ' || s.last_name AS name, s.campus_id, c.name AS campus_name
    FROM parents pr JOIN students s ON s.id = pr.student_id JOIN campuses c ON c.id = s.campus_id
    WHERE pr.tc_no = ? ORDER BY s.first_name`).all(tc)
    .map(x => ({ ...x, accessible: assertCampusAccess(req, x.campus_id) }));
  res.json({ found: true, parent: p, students });
});

// ---- Detay ----
router.get('/:id', requirePermission('student.view'), (req, res) => {
  const s = db.prepare(`
    SELECT s.*, c.name AS campus_name, d.name AS department_name,
      sch.name AS previous_school_name, sch.city AS previous_school_city, sch.district AS previous_school_district
    FROM students s
    JOIN campuses c ON c.id = s.campus_id
    LEFT JOIN departments d ON d.id = s.department_id
    LEFT JOIN schools sch ON sch.id = s.previous_school_id
    WHERE s.id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) {
    return res.status(403).json({ error: 'Bu öğrenci başka bir kampüse kayıtlı.' });
  }
  const parents = db.prepare('SELECT * FROM parents WHERE student_id = ? ORDER BY is_primary DESC, id').all(s.id);
  const documents = db.prepare(`
    SELECT dt.id, dt.name, dt.active,
      CASE WHEN sd.id IS NULL THEN 0 ELSE 1 END AS received,
      sd.received_at, u.full_name AS received_by_name
    FROM document_types dt
    LEFT JOIN student_documents sd ON sd.document_type_id = dt.id AND sd.student_id = ?
    LEFT JOIN users u ON u.id = sd.received_by
    WHERE dt.active = 1 ORDER BY dt.sort_order, dt.id`).all(s.id);
  const enrollments = db.prepare(`
    SELECT e.*, ay.name AS academic_year_name, dn.name AS department_name,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.enrollment_id = e.id AND p.cancelled = 0) AS total_paid
    FROM enrollments e JOIN academic_years ay ON ay.id = e.academic_year_id
    LEFT JOIN departments dn ON dn.id = e.department_id
    WHERE e.student_id = ? ORDER BY ay.start_date DESC`).all(s.id);
  const t = today();
  for (const e of enrollments) {
    e.items = db.prepare(
      'SELECT * FROM enrollment_items WHERE enrollment_id = ? ORDER BY id').all(e.id);
    e.installments = db.prepare(
      'SELECT * FROM installments WHERE enrollment_id = ? ORDER BY seq_no').all(e.id)
      .map(i => ({ ...i, overdue: i.status !== 'ODENDI' && i.status !== 'IPTAL' && i.due_date < t }));
    e.payments = db.prepare(`
      SELECT p.*, u.full_name AS received_by_name, i.seq_no AS installment_seq, i.label AS installment_label
      FROM payments p
      LEFT JOIN users u ON u.id = p.received_by
      LEFT JOIN installments i ON i.id = p.installment_id
      WHERE p.enrollment_id = ? ORDER BY p.payment_date DESC, p.id DESC`).all(e.id);
    e.balance = Math.round((e.net_fee - e.total_paid) * 100) / 100;
  }
  res.json({ student: s, parents, enrollments, documents, grades: GRADES });
});

function validateStudentBody(b) {
  if (!b.first_name || !String(b.first_name).trim()) return 'Öğrenci adı zorunludur.';
  if (!b.last_name || !String(b.last_name).trim()) return 'Öğrenci soyadı zorunludur.';
  if (!b.campus_id) return 'Kampüs seçimi zorunludur.';
  const tcErr = tcError(b.tc_no, 'Öğrenci');
  if (tcErr) return tcErr;
  return null;
}

const RELATIONS = ['ANNE', 'BABA', 'VASI', 'ABI', 'ABLA', 'DEDE', 'NINE', 'AMCA', 'HALA', 'DAYI', 'TEYZE', 'KUZEN', 'DIGER'];

/** Veli kayıtlarını doğrular ve telefonları normalize eder; hata mesajı ya da null döner. */
function validateParents(parents) {
  for (const p of parents) {
    if (!p.full_name || !p.relation) continue;
    if (!RELATIONS.includes(p.relation)) return 'Geçersiz yakınlık türü.';
    const label = `Veli (${String(p.full_name).trim()})`;
    const tErr = tcError(p.tc_no, label);
    if (tErr) return tErr;
    for (const key of ['phone', 'phone2']) {
      if (p[key] === undefined) continue;
      const r = phoneField(p[key], label);
      if (r.error) return r.error;
      p[key] = r.value;
    }
  }
  return null;
}

/**
 * Aile yapısı kuralı (veli listesi verildiyse):
 *  - Anne VE Baba kayıtları zorunludur
 *  - Tam olarak bir kişi VELİ, tam olarak bir kişi ÖDEME SORUMLUSU olmalıdır
 *    (işaretlenmemişse birincil/ilk kişi otomatik atanır)
 *  - Veli ve ödeme sorumlusunun telefonu zorunludur
 */
function applyFamilyRules(parents) {
  const named = parents.filter(p => p.full_name && p.relation);
  if (!named.length) return null;
  if (!named.some(p => p.relation === 'ANNE')) return 'Anne bilgileri zorunludur.';
  if (!named.some(p => p.relation === 'BABA')) return 'Baba bilgileri zorunludur.';
  const guardians = named.filter(p => p.is_guardian);
  const payers = named.filter(p => p.is_payer);
  if (guardians.length > 1) return 'Yalnızca bir kişi veli olarak işaretlenebilir.';
  if (payers.length > 1) return 'Yalnızca bir kişi ödeme sorumlusu olarak işaretlenebilir.';
  const fallback = named.find(p => p.is_primary) || named[0];
  const guardian = guardians[0] || fallback;
  const payer = payers[0] || guardian;
  for (const p of named) {
    p.is_guardian = p === guardian ? 1 : 0;
    p.is_payer = p === payer ? 1 : 0;
    p.is_primary = p === guardian ? 1 : 0; // veli = birincil iletişim
  }
  if (!String(guardian.phone || '').trim()) return `Veli olarak işaretlenen kişinin (${guardian.full_name}) telefonu zorunludur.`;
  if (!String(payer.phone || '').trim()) return `Ödeme sorumlusunun (${payer.full_name}) telefonu zorunludur.`;
  return null;
}

const STUDENT_FIELDS = ['tc_no', 'first_name', 'last_name', 'birth_date', 'birth_place', 'gender',
  'blood_type', 'nationality', 'grade', 'section', 'previous_school', 'health_notes',
  'address', 'city', 'district', 'neighborhood', 'status', 'notes'];

// ---- Yeni öğrenci ----
router.post('/', requirePermission('student.create'), (req, res) => {
  const b = req.body || {};
  const err = validateStudentBody(b);
  if (err) return res.status(400).json({ error: err });
  if (!assertCampusAccess(req, b.campus_id)) {
    return res.status(403).json({ error: 'Başka kampüse öğrenci kaydedemezsiniz.' });
  }
  const tc = String(b.tc_no || '').trim();
  if (tc) {
    const dup = db.prepare('SELECT id, student_no FROM students WHERE tc_no = ?').get(tc);
    if (dup) return res.status(400).json({ error: `Bu TC Kimlik No ${dup.student_no} numaralı öğrenciye kayıtlı.` });
  }
  let departmentId = null;
  if (b.department_id) {
    const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND campus_id = ?')
      .get(Number(b.department_id), Number(b.campus_id));
    if (!dept) return res.status(400).json({ error: 'Seçilen bölüm bu kampüse ait değil.' });
    departmentId = dept.id;
  }
  const parentList = Array.isArray(b.parents) ? b.parents : [];
  const parentErr = validateParents(parentList);
  if (parentErr) return res.status(400).json({ error: parentErr });
  const familyErr = applyFamilyRules(parentList);
  if (familyErr) return res.status(400).json({ error: familyErr });
  let previousSchoolId = null;
  if (b.previous_school_id) {
    const sch = db.prepare('SELECT * FROM schools WHERE id = ?').get(Number(b.previous_school_id));
    if (!sch) return res.status(400).json({ error: 'Seçilen önceki okul bulunamadı.' });
    previousSchoolId = sch.id;
    if (!b.previous_school) b.previous_school = `${sch.name} (${sch.district}/${sch.city})`;
  }
  const result = db.transaction(() => {
    const assigned = assignStudentNo(Number(b.campus_id));
    const studentNo = assigned.no;
    const info = db.prepare(`
      INSERT INTO students (student_no, tc_no, first_name, last_name, birth_date, birth_place, gender,
        blood_type, nationality, campus_id, department_id, grade, section, previous_school, previous_school_id,
        health_notes, address, city, district, neighborhood, status, notes, crm_form_id, created_by)
      VALUES (@student_no, @tc_no, @first_name, @last_name, @birth_date, @birth_place, @gender,
        @blood_type, @nationality, @campus_id, @department_id, @grade, @section, @previous_school, @previous_school_id,
        @health_notes, @address, @city, @district, @neighborhood, @status, @notes, @crm_form_id, @created_by)`)
      .run({
        department_id: departmentId,
        previous_school_id: previousSchoolId,
        crm_form_id: String(b.crm_form_id || '').trim(),
        student_no: studentNo,
        tc_no: tc,
        first_name: String(b.first_name).trim(),
        last_name: String(b.last_name).trim(),
        birth_date: b.birth_date || '',
        birth_place: b.birth_place || '',
        gender: b.gender || '',
        blood_type: b.blood_type || '',
        nationality: b.nationality || 'T.C.',
        campus_id: Number(b.campus_id),
        grade: b.grade || '',
        section: b.section || '',
        previous_school: b.previous_school || '',
        health_notes: b.health_notes || '',
        address: b.address || '',
        city: b.city || '',
        district: b.district || '',
        neighborhood: b.neighborhood || '',
        status: b.status || 'AKTIF',
        notes: b.notes || '',
        created_by: req.user.id,
      });
    const studentId = info.lastInsertRowid;
    if (assigned.poolId) {
      db.prepare('UPDATE school_number_pool SET used_by = ? WHERE id = ?').run(studentId, assigned.poolId);
    }
    const insDoc = db.prepare(`
      INSERT OR IGNORE INTO student_documents (student_id, document_type_id, received_by) VALUES (?, ?, ?)`);
    for (const docId of (Array.isArray(b.documents) ? b.documents : [])) {
      if (Number(docId)) insDoc.run(studentId, Number(docId), req.user.id);
    }
    for (const p of parentList) {
      if (!p.full_name || !p.relation) continue;
      db.prepare(`
        INSERT INTO parents (student_id, relation, full_name, tc_no, phone, phone2, email,
          occupation, workplace, education, address, is_primary, is_guardian, is_payer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(studentId, p.relation, String(p.full_name).trim(), p.tc_no || '', p.phone || '',
          p.phone2 || '', p.email || '', p.occupation || '', p.workplace || '',
          p.education || '', p.address || '', p.is_primary ? 1 : 0,
          p.is_guardian ? 1 : 0, p.is_payer ? 1 : 0);
    }
    return { id: studentId, student_no: studentNo };
  })();
  audit(req.user.id, 'CREATE', 'student', result.id, result.student_no);
  res.json(result);
});

// Arama anında CRM'den taze aday çeker (en fazla 60 sn'de bir; hata olursa sessizce yerel havuzu kullanır).
// Böylece kayıt personeli ayrı bir düğmeye basmadan güncel adayları görür.
let lastCandidatePull = 0;
async function refreshCandidatesIfStale() {
  if (process.env.NODE_ENV === 'test') return;
  const now = Date.now();
  if (now - lastCandidatePull < 60000) return;
  lastCandidatePull = now;
  try {
    if (!getSetting('crm_base_url', '').trim()) return;
    const { pullCandidatesFromCrm } = require('../crm-notify');
    await pullCandidatesFromCrm(null); // artımlı, tüm aktif kampüsler
  } catch { /* sessiz: arama yerel havuzdan sürer */ }
}

// ---- CRM aday havuzu (kayıt ekranı için, oturum korumalı) ----
router.get('/crm/candidates', requirePermission('enrollment.create'), async (req, res) => {
  await refreshCandidatesIfStale();
  const q = req.query || {};
  const where = [`status = 'BEKLIYOR'`];
  const params = {};
  if (q.search) {
    const raw = String(q.search).trim();
    const conds = [`first_name || ' ' || last_name LIKE @s`, `tc_no LIKE @s`, `crm_form_id LIKE @s`];
    params.s = `%${raw}%`;
    // Telefonla arama: parents_json içindeki veli telefonlarını biçimden bağımsız (boşluk/tire/parantez
    // temizlenmiş) eşle. En az 4 rakam girilirse çalışır (son haneyle de aranabilir).
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) {
      conds.push(`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(parents_json,' ',''),'-',''),'(',''),')',''),'+','') LIKE @ph`);
      params.ph = `%${digits}%`;
    }
    where.push('(' + conds.join(' OR ') + ')');
  }
  // Kampüsler arası kayıt: CRM'de bir kampüse ait aday başka kampüse kayıt olabilir.
  // Bu nedenle tüm kullanıcılar tüm adayları görebilir; campus_code yalnız bilgi amaçlıdır
  // (adayın CRM'de hangi kampüste açıldığını gösterir, kaydı kısıtlamaz).
  const rows = db.prepare(`
    SELECT id, crm_form_id, campus_code, first_name, last_name, tc_no, birth_date, gender,
      grade, city, district, neighborhood, address, parents_json, notes, created_at
    FROM crm_candidates WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 100`).all(params);
  res.json({
    candidates: rows.map(r => ({ ...r, parents: JSON.parse(r.parents_json || '[]') })),
  });
});

// ---- Güncelle ----
router.put('/:id', requirePermission('student.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) {
    return res.status(403).json({ error: 'Bu öğrenci başka bir kampüse kayıtlı.' });
  }
  const b = req.body || {};
  const tcErrPut = tcError(b.tc_no, 'Öğrenci');
  if (tcErrPut) return res.status(400).json({ error: tcErrPut });
  if (b.tc_no) {
    const dup = db.prepare('SELECT id FROM students WHERE tc_no = ? AND id != ?').get(String(b.tc_no).trim(), s.id);
    if (dup) return res.status(400).json({ error: 'Bu TC Kimlik No başka bir öğrenciye kayıtlı.' });
  }
  // Kampüs değişikliği (nakil) sadece genel merkez tarafından yapılabilir
  let campusId = s.campus_id;
  if (b.campus_id && Number(b.campus_id) !== s.campus_id) {
    if (req.user.role !== 'GENEL_MERKEZ') {
      return res.status(403).json({ error: 'Kampüsler arası nakil yalnızca genel merkez tarafından yapılabilir.' });
    }
    campusId = Number(b.campus_id);
  }
  const sets = ['campus_id = @campus_id', "updated_at = datetime('now')"];
  const params = { id: s.id, campus_id: campusId };
  for (const f of STUDENT_FIELDS) {
    if (b[f] !== undefined) { sets.push(`${f} = @${f}`); params[f] = b[f] === null ? '' : String(b[f]).trim(); }
  }
  if (b.previous_school_id !== undefined) {
    let schId = null;
    if (b.previous_school_id) {
      const sch = db.prepare('SELECT * FROM schools WHERE id = ?').get(Number(b.previous_school_id));
      if (!sch) return res.status(400).json({ error: 'Seçilen önceki okul bulunamadı.' });
      schId = sch.id;
      if (b.previous_school === undefined) {
        sets.push('previous_school = @previous_school');
        params.previous_school = `${sch.name} (${sch.district}/${sch.city})`;
      }
    }
    sets.push('previous_school_id = @previous_school_id');
    params.previous_school_id = schId;
  }
  if (b.department_id !== undefined) {
    let deptId = null;
    if (b.department_id) {
      const dept = db.prepare('SELECT id FROM departments WHERE id = ? AND campus_id = ?')
        .get(Number(b.department_id), campusId);
      if (!dept) return res.status(400).json({ error: 'Seçilen bölüm bu kampüse ait değil.' });
      deptId = dept.id;
    }
    sets.push('department_id = @department_id');
    params.department_id = deptId;
  }
  db.prepare(`UPDATE students SET ${sets.join(', ')} WHERE id = @id`).run(params);
  audit(req.user.id, 'UPDATE', 'student', s.id, s.student_no);
  res.json({ ok: true });
});

// ---- Sil ----
router.delete('/:id', requirePermission('student.delete'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) {
    return res.status(403).json({ error: 'Bu öğrenci başka bir kampüse kayıtlı.' });
  }
  const hasEnrollment = db.prepare('SELECT id FROM enrollments WHERE student_id = ?').get(s.id);
  if (hasEnrollment) {
    return res.status(400).json({
      error: 'Kayıt/ödeme geçmişi olan öğrenci silinemez. Durumunu "Kayıt Sildi" olarak güncelleyebilirsiniz.',
    });
  }
  db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
  audit(req.user.id, 'DELETE', 'student', s.id, s.student_no);
  res.json({ ok: true });
});

// ---- Evrak teslim işaretleme ----
router.put('/:id/documents/:docId', requirePermission('student.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  const doc = db.prepare('SELECT * FROM document_types WHERE id = ?').get(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Evrak türü bulunamadı.' });
  const received = !!(req.body || {}).received;
  if (received) {
    db.prepare(`
      INSERT OR IGNORE INTO student_documents (student_id, document_type_id, received_by)
      VALUES (?, ?, ?)`).run(s.id, doc.id, req.user.id);
  } else {
    db.prepare('DELETE FROM student_documents WHERE student_id = ? AND document_type_id = ?')
      .run(s.id, doc.id);
  }
  audit(req.user.id, received ? 'DOC_RECEIVED' : 'DOC_REMOVED', 'student_document', s.id, doc.name);
  res.json({ ok: true });
});

// ---- Veli ekle/güncelle/sil ----
router.post('/:id/parents', requirePermission('student.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  const p = req.body || {};
  if (!p.full_name || !p.relation) return res.status(400).json({ error: 'Yakınlık ve ad soyad zorunludur.' });
  const vErr = validateParents([p]);
  if (vErr) return res.status(400).json({ error: vErr });
  const info = db.transaction(() => {
    if (p.is_guardian) db.prepare('UPDATE parents SET is_guardian = 0, is_primary = 0 WHERE student_id = ?').run(s.id);
    if (p.is_payer) db.prepare('UPDATE parents SET is_payer = 0 WHERE student_id = ?').run(s.id);
    return db.prepare(`
      INSERT INTO parents (student_id, relation, full_name, tc_no, phone, phone2, email,
        occupation, workplace, education, address, is_primary, is_guardian, is_payer)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(s.id, p.relation, String(p.full_name).trim(), p.tc_no || '', p.phone || '', p.phone2 || '',
        p.email || '', p.occupation || '', p.workplace || '', p.education || '', p.address || '',
        p.is_guardian ? 1 : (p.is_primary ? 1 : 0), p.is_guardian ? 1 : 0, p.is_payer ? 1 : 0);
  })();
  audit(req.user.id, 'CREATE', 'parent', info.lastInsertRowid, `${s.student_no} / ${p.full_name}`);
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id/parents/:parentId', requirePermission('student.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  const existing = db.prepare('SELECT * FROM parents WHERE id = ? AND student_id = ?').get(req.params.parentId, s.id);
  if (!existing) return res.status(404).json({ error: 'Veli kaydı bulunamadı.' });
  const p = req.body || {};
  const check = { ...p, full_name: p.full_name || existing.full_name, relation: p.relation || existing.relation };
  const vErr = validateParents([check]);
  if (vErr) return res.status(400).json({ error: vErr });
  if (p.phone !== undefined) p.phone = check.phone;   // normalize edilmiş halini kullan
  if (p.phone2 !== undefined) p.phone2 = check.phone2;
  db.transaction(() => {
    if (p.is_guardian) db.prepare('UPDATE parents SET is_guardian = 0, is_primary = 0 WHERE student_id = ? AND id != ?').run(s.id, existing.id);
    if (p.is_payer) db.prepare('UPDATE parents SET is_payer = 0 WHERE student_id = ? AND id != ?').run(s.id, existing.id);
    db.prepare(`
      UPDATE parents SET relation = ?, full_name = ?, tc_no = ?, phone = ?, phone2 = ?, email = ?,
        occupation = ?, workplace = ?, education = ?, address = ?, is_primary = ?, is_guardian = ?, is_payer = ? WHERE id = ?`)
      .run(p.relation || existing.relation, p.full_name || existing.full_name,
        p.tc_no !== undefined ? p.tc_no : existing.tc_no,
        p.phone !== undefined ? p.phone : existing.phone,
        p.phone2 !== undefined ? p.phone2 : existing.phone2,
        p.email !== undefined ? p.email : existing.email,
        p.occupation !== undefined ? p.occupation : existing.occupation,
        p.workplace !== undefined ? p.workplace : existing.workplace,
        p.education !== undefined ? p.education : existing.education,
        p.address !== undefined ? p.address : existing.address,
        p.is_guardian !== undefined ? (p.is_guardian ? 1 : 0) : (p.is_primary !== undefined ? (p.is_primary ? 1 : 0) : existing.is_primary),
        p.is_guardian !== undefined ? (p.is_guardian ? 1 : 0) : existing.is_guardian,
        p.is_payer !== undefined ? (p.is_payer ? 1 : 0) : existing.is_payer,
        existing.id);
  })();
  audit(req.user.id, 'UPDATE', 'parent', existing.id, s.student_no);
  res.json({ ok: true });
});

router.delete('/:id/parents/:parentId', requirePermission('student.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  db.prepare('DELETE FROM parents WHERE id = ? AND student_id = ?').run(req.params.parentId, s.id);
  audit(req.user.id, 'DELETE', 'parent', Number(req.params.parentId), s.student_no);
  res.json({ ok: true });
});

module.exports = router;
