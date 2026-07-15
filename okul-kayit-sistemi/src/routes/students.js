const express = require('express');
const { db, audit, today } = require('../db');
const { requirePermission, campusScope, assertCampusAccess } = require('../auth');

const router = express.Router();

const GRADES = ['9', '10', '11', '12'];

/** Yeni öğrenci numarası üretir: <KAMPUS_KODU>-<YIL>-<SIRA> */
function nextStudentNo(campusId) {
  const campus = db.prepare('SELECT code FROM campuses WHERE id = ?').get(campusId);
  const year = new Date().getFullYear();
  const prefix = `${campus.code}-${year}-`;
  const row = db.prepare(
    `SELECT student_no FROM students WHERE student_no LIKE ? ORDER BY LENGTH(student_no) DESC, student_no DESC LIMIT 1`
  ).get(prefix + '%');
  let seq = 1;
  if (row) seq = parseInt(row.student_no.slice(prefix.length), 10) + 1;
  return prefix + String(seq).padStart(5, '0');
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

// ---- Detay ----
router.get('/:id', requirePermission('student.view'), (req, res) => {
  const s = db.prepare(`
    SELECT s.*, c.name AS campus_name, d.name AS department_name FROM students s
    JOIN campuses c ON c.id = s.campus_id
    LEFT JOIN departments d ON d.id = s.department_id
    WHERE s.id = ?`).get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) {
    return res.status(403).json({ error: 'Bu öğrenci başka bir kampüse kayıtlı.' });
  }
  const parents = db.prepare('SELECT * FROM parents WHERE student_id = ? ORDER BY is_primary DESC, id').all(s.id);
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
  res.json({ student: s, parents, enrollments, grades: GRADES });
});

function validateStudentBody(b) {
  if (!b.first_name || !String(b.first_name).trim()) return 'Öğrenci adı zorunludur.';
  if (!b.last_name || !String(b.last_name).trim()) return 'Öğrenci soyadı zorunludur.';
  if (!b.campus_id) return 'Kampüs seçimi zorunludur.';
  if (b.tc_no && !/^\d{11}$/.test(String(b.tc_no).trim())) return 'TC Kimlik No 11 haneli rakam olmalıdır.';
  return null;
}

const STUDENT_FIELDS = ['tc_no', 'first_name', 'last_name', 'birth_date', 'birth_place', 'gender',
  'blood_type', 'nationality', 'grade', 'section', 'previous_school', 'health_notes',
  'address', 'city', 'district', 'status', 'notes'];

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
  const result = db.transaction(() => {
    const studentNo = nextStudentNo(Number(b.campus_id));
    const info = db.prepare(`
      INSERT INTO students (student_no, tc_no, first_name, last_name, birth_date, birth_place, gender,
        blood_type, nationality, campus_id, department_id, grade, section, previous_school, health_notes,
        address, city, district, status, notes, created_by)
      VALUES (@student_no, @tc_no, @first_name, @last_name, @birth_date, @birth_place, @gender,
        @blood_type, @nationality, @campus_id, @department_id, @grade, @section, @previous_school, @health_notes,
        @address, @city, @district, @status, @notes, @created_by)`)
      .run({
        department_id: departmentId,
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
        status: b.status || 'AKTIF',
        notes: b.notes || '',
        created_by: req.user.id,
      });
    const studentId = info.lastInsertRowid;
    for (const p of (Array.isArray(b.parents) ? b.parents : [])) {
      if (!p.full_name || !p.relation) continue;
      db.prepare(`
        INSERT INTO parents (student_id, relation, full_name, tc_no, phone, phone2, email,
          occupation, workplace, education, address, is_primary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(studentId, p.relation, String(p.full_name).trim(), p.tc_no || '', p.phone || '',
          p.phone2 || '', p.email || '', p.occupation || '', p.workplace || '',
          p.education || '', p.address || '', p.is_primary ? 1 : 0);
    }
    return { id: studentId, student_no: studentNo };
  })();
  audit(req.user.id, 'CREATE', 'student', result.id, result.student_no);
  res.json(result);
});

// ---- Güncelle ----
router.put('/:id', requirePermission('student.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) {
    return res.status(403).json({ error: 'Bu öğrenci başka bir kampüse kayıtlı.' });
  }
  const b = req.body || {};
  if (b.tc_no && !/^\d{11}$/.test(String(b.tc_no).trim())) {
    return res.status(400).json({ error: 'TC Kimlik No 11 haneli rakam olmalıdır.' });
  }
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

// ---- Veli ekle/güncelle/sil ----
router.post('/:id/parents', requirePermission('student.edit'), (req, res) => {
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, s.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  const p = req.body || {};
  if (!p.full_name || !p.relation) return res.status(400).json({ error: 'Yakınlık ve ad soyad zorunludur.' });
  const info = db.prepare(`
    INSERT INTO parents (student_id, relation, full_name, tc_no, phone, phone2, email,
      occupation, workplace, education, address, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(s.id, p.relation, String(p.full_name).trim(), p.tc_no || '', p.phone || '', p.phone2 || '',
      p.email || '', p.occupation || '', p.workplace || '', p.education || '', p.address || '',
      p.is_primary ? 1 : 0);
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
  db.prepare(`
    UPDATE parents SET relation = ?, full_name = ?, tc_no = ?, phone = ?, phone2 = ?, email = ?,
      occupation = ?, workplace = ?, education = ?, address = ?, is_primary = ? WHERE id = ?`)
    .run(p.relation || existing.relation, p.full_name || existing.full_name,
      p.tc_no !== undefined ? p.tc_no : existing.tc_no,
      p.phone !== undefined ? p.phone : existing.phone,
      p.phone2 !== undefined ? p.phone2 : existing.phone2,
      p.email !== undefined ? p.email : existing.email,
      p.occupation !== undefined ? p.occupation : existing.occupation,
      p.workplace !== undefined ? p.workplace : existing.workplace,
      p.education !== undefined ? p.education : existing.education,
      p.address !== undefined ? p.address : existing.address,
      p.is_primary !== undefined ? (p.is_primary ? 1 : 0) : existing.is_primary,
      existing.id);
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
