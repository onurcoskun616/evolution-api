/**
 * Topkapı CRM'e giden bildirimler (API Entegrasyon Dokümantasyonu v1.0).
 *
 * Ayarlar (Parametreler > CRM Entegrasyonu):
 *   crm_base_url : CRM taban adresi (örn. https://crm.topkapi.k12.tr) — boşsa bildirim yapılmaz
 *   crm_api_key  : CRM API Anahtarı (okul → CRM erişiminde X-Api-Key başlığında gider)
 *
 * Kesin kayıt  -> POST {base}/api/okul/kayit-sonucu/
 * Kayıt iptali -> POST {base}/api/okul/kayit-iptal/
 */
const { db, getSetting } = require('./db');

function crmConfig() {
  const base = getSetting('crm_base_url', '').trim().replace(/\/+$/, '');
  const key = getSetting('crm_api_key', '').trim();
  return { base, key };
}

async function crmPost(pathname, body) {
  const { base, key } = crmConfig();
  if (!base || !key) return { skipped: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000); // doküman: 10 sn timeout
  try {
    const res = await fetch(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

/** Kesin kayıt sonucunu CRM'e bildirir (POST /api/okul/kayit-sonucu/). */
async function notifyCrmEnrollment(enrollmentId) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e) return { skipped: true };
  const s = db.prepare('SELECT * FROM students WHERE id = ?').get(e.student_id);
  if (!s || !s.crm_form_id) return { skipped: true }; // CRM'den gelmemiş öğrenci
  const dept = e.department_id ? db.prepare('SELECT name FROM departments WHERE id = ?').get(e.department_id) : null;
  const parents = db.prepare(
    'SELECT relation, full_name, phone, is_guardian FROM parents WHERE student_id = ? ORDER BY is_guardian DESC, id'
  ).all(s.id);
  const v1 = parents[0] || {}; const v2 = parents[1] || {};
  const payload = {
    crm_id: Number(s.crm_form_id),
    sozlesme_no: e.contract_no,
    okul_no: s.student_no,
    kayit_tarihi: (e.enrollment_date || '').slice(0, 10) + 'T00:00:00',
    sinif: e.grade,
    bolum: dept ? dept.name : '',
    sube: e.section,
    veli_adi: v1.full_name || '', veli_telefon: v1.phone || '',
    veli2_adi: v2.full_name || '', veli2_telefon: v2.phone || '',
    il: s.city, ilce: s.district, mahalle: s.neighborhood,
  };
  return crmPost('/api/okul/kayit-sonucu/', payload);
}

/** Kayıt iptalini CRM'e bildirir (POST /api/okul/kayit-iptal/). */
async function notifyCrmCancel(enrollmentId, reason) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e) return { skipped: true };
  const s = db.prepare('SELECT crm_form_id FROM students WHERE id = ?').get(e.student_id);
  if (!s || !s.crm_form_id) return { skipped: true };
  return crmPost('/api/okul/kayit-iptal/', {
    crm_id: Number(s.crm_form_id),
    iptal_nedeni: reason || '',
  });
}

/** CRM'den aday listesini çeker (GET /api/okul/adaylar/). Dönen adayları crm_candidates'e yazar. */
async function pullCandidatesFromCrm() {
  const { base, key } = crmConfig();
  if (!base || !key) throw new Error('CRM taban adresi ve API anahtarı Parametreler sayfasından tanımlanmalı.');
  let sayfa = 1, imported = 0, updated = 0, pages = 0;
  const upsert = db.prepare(`
    INSERT INTO crm_candidates (crm_form_id, first_name, last_name, tc_no, grade, parents_json, raw_json, status)
    VALUES (@fid, @ad, @soyad, @tc, @sinif, @parents, @raw, 'BEKLIYOR')
    ON CONFLICT(crm_form_id) DO UPDATE SET
      first_name = excluded.first_name, last_name = excluded.last_name, tc_no = excluded.tc_no,
      grade = excluded.grade, parents_json = excluded.parents_json, raw_json = excluded.raw_json,
      updated_at = datetime('now')
    WHERE crm_candidates.status != 'AKTARILDI'`);
  while (sayfa <= 100) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let data;
    try {
      const res = await fetch(`${base}/api/okul/adaylar/?sayfa=${sayfa}`, {
        headers: { 'X-Api-Key': key }, signal: controller.signal,
      });
      if (!res.ok) throw new Error(`CRM ${res.status} döndürdü.`);
      data = await res.json();
    } finally { clearTimeout(timer); }
    const list = Array.isArray(data.adaylar) ? data.adaylar : [];
    for (const a of list) {
      const parents = [];
      if (a.veli_adi) parents.push({ full_name: a.veli_adi, phone: String(a.veli_telefon || '') });
      if (a.veli2_adi) parents.push({ full_name: a.veli2_adi, phone: String(a.veli2_telefon || '') });
      const info = upsert.run({
        fid: String(a.id), ad: a.ad || '', soyad: a.soyad || '', tc: String(a.tc_kimlik || ''),
        sinif: String(a.sinif || ''), parents: JSON.stringify(parents), raw: JSON.stringify(a).slice(0, 20000),
      });
      if (info.changes) (info.lastInsertRowid ? imported++ : updated++);
    }
    pages++;
    const totalPages = Number(data.sayfa_sayisi) || 1;
    if (sayfa >= totalPages || !list.length) break;
    sayfa++;
  }
  return { pages, imported, updated };
}

module.exports = { notifyCrmEnrollment, notifyCrmCancel, pullCandidatesFromCrm };
