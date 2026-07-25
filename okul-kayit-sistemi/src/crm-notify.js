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
const { db, getSetting, setSetting } = require('./db');

/** Kampüs bazlı CRM yapılandırması: taban URL ortak, API anahtarı ve aktiflik kampüse özel. */
function crmConfig(campusId) {
  const base = getSetting('crm_base_url', '').trim().replace(/\/+$/, '');
  const key = getSetting(`crm_api_key_${campusId}`, '').trim();
  const active = getSetting(`crm_active_${campusId}`, '') === '1';
  return { base, key, active };
}

async function crmPost(campusId, pathname, body) {
  const { base, key, active } = crmConfig(campusId);
  if (!base || !key || !active) return { skipped: true };
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
  // Öğrencinin gerçekte kayıt olduğu kampüs (CRM'deki aday kampüsünden farklı olabilir).
  const campus = db.prepare('SELECT code, name FROM campuses WHERE id = ?').get(e.campus_id) || {};
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
    kampus: campus.name || '',       // gerçekte kayıt olunan kampüs adı
    kampus_kodu: campus.code || '',  // gerçekte kayıt olunan kampüs kodu
    veli_adi: v1.full_name || '', veli_telefon: v1.phone || '',
    veli2_adi: v2.full_name || '', veli2_telefon: v2.phone || '',
    il: s.city, ilce: s.district, mahalle: s.neighborhood,
  };
  return crmPost(e.campus_id, '/api/okul/kayit-sonucu/', payload);
}

/** Kayıt iptalini CRM'e bildirir (POST /api/okul/kayit-iptal/). */
async function notifyCrmCancel(enrollmentId, reason) {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!e) return { skipped: true };
  const s = db.prepare('SELECT crm_form_id FROM students WHERE id = ?').get(e.student_id);
  if (!s || !s.crm_form_id) return { skipped: true };
  return crmPost(e.campus_id, '/api/okul/kayit-iptal/', {
    crm_id: Number(s.crm_form_id),
    iptal_nedeni: reason || '',
  });
}

const upsertCandidate = () => db.prepare(`
  INSERT INTO crm_candidates (crm_form_id, campus_code, first_name, last_name, tc_no, birth_date, gender,
    grade, city, district, neighborhood, address, parents_json, notes, raw_json, status)
  VALUES (@fid, @cc, @ad, @soyad, @tc, @birth, @gender, @sinif, @il, @ilce, @mahalle, @adres,
    @parents, @notes, @raw, 'BEKLIYOR')
  ON CONFLICT(crm_form_id) DO UPDATE SET
    campus_code = excluded.campus_code, first_name = excluded.first_name, last_name = excluded.last_name,
    tc_no = excluded.tc_no, birth_date = excluded.birth_date, gender = excluded.gender, grade = excluded.grade,
    city = excluded.city, district = excluded.district, neighborhood = excluded.neighborhood, address = excluded.address,
    parents_json = excluded.parents_json, notes = excluded.notes, raw_json = excluded.raw_json,
    updated_at = datetime('now')
  WHERE crm_candidates.status != 'AKTARILDI'`);

// CRM'de iptal edilmiş adayı okul tarafında da IPTAL işaretler (kayda dönmemişse)
const cancelCandidate = () => db.prepare(`
  UPDATE crm_candidates SET status = 'IPTAL', updated_at = datetime('now')
  WHERE crm_form_id = ? AND status = 'BEKLIYOR'`);

const val = (obj, ...keys) => { for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]; return ''; };

/** CRM yanıtından aday dizisini çıkarır (farklı sarmalayıcı adlarına toleranslı). */
function extractCandidateList(data) {
  if (Array.isArray(data)) return { list: data, key: '(kök dizi)' };
  if (!data || typeof data !== 'object') return { list: [], key: null };
  for (const k of ['adaylar', 'results', 'data', 'items', 'candidates', 'sonuclar', 'kayitlar']) {
    if (Array.isArray(data[k])) return { list: data[k], key: k };
  }
  return { list: [], key: null };
}

/** CRM yanıtından toplam sayfa sayısını çıkarır (farklı alan adlarına toleranslı). */
function totalPagesOf(data) {
  if (!data || typeof data !== 'object') return 1;
  return Number(val(data, 'sayfa_sayisi', 'toplam_sayfa', 'total_pages', 'totalPages', 'pages')) || 1;
}

/** Tek CRM aday kaydını okul alanlarına eşler (alan adı toleransıyla). */
function mapCandidate(a, campusCode) {
  const parents = [];
  const v1 = val(a, 'veli_adi', 'veli1_adi', 'veli_ad_soyad');
  if (v1) parents.push({ full_name: v1, phone: String(val(a, 'veli_telefon', 'veli1_telefon', 'veli_tel') || ''), tc_no: String(val(a, 'veli_tc', 'veli1_tc', 'veli_tc_kimlik') || '') });
  const v2 = val(a, 'veli2_adi', 'veli_2_adi');
  if (v2) parents.push({ full_name: v2, phone: String(val(a, 'veli2_telefon', 'veli_2_telefon') || ''), tc_no: String(val(a, 'veli2_tc', 'veli_2_tc') || '') });
  const bolum = val(a, 'bolum', 'bölüm'); const sube = val(a, 'sube', 'şube');
  const cins = val(a, 'cinsiyet', 'gender');
  return {
    fid: String(val(a, 'id', 'crm_id', 'form_id', 'crm_form_id')),
    cc: campusCode,
    ad: val(a, 'ad', 'first_name', 'isim') || '',
    soyad: val(a, 'soyad', 'last_name') || '',
    tc: String(val(a, 'tc_kimlik', 'tc_no', 'tc', 'tckn') || ''),
    birth: val(a, 'dogum_tarihi', 'birth_date', 'dogumTarihi') || '',
    gender: ['ERKEK', 'KIZ'].includes(cins) ? cins : '',
    sinif: String(val(a, 'sinif', 'sınıf', 'grade') || ''),
    il: val(a, 'il', 'city') || '', ilce: val(a, 'ilce', 'ilçe', 'district') || '',
    mahalle: val(a, 'mahalle', 'neighborhood') || '', adres: val(a, 'adres', 'address') || '',
    parents: JSON.stringify(parents),
    notes: [bolum ? 'Bölüm: ' + bolum : '', sube ? 'Şube: ' + sube : ''].filter(Boolean).join(' · '),
    raw: JSON.stringify(a).slice(0, 20000),
  };
}

async function crmGet(base, key, sayfa, since) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const params = new URLSearchParams({ sayfa: String(sayfa) });
    if (since) params.set('guncelleme_sonrasi', since);
    const url = `${base}/api/okul/adaylar/?${params.toString()}`;
    const res = await fetch(url, { headers: { 'X-Api-Key': key } , signal: controller.signal });
    const text = await res.text();
    return { url, status: res.status, ok: res.ok, text };
  } finally { clearTimeout(timer); }
}

/**
 * Tek kampüsün CRM anahtarıyla aday listesini çeker (GET /api/okul/adaylar/).
 * since verilirse artımlı sync: yalnız o tarihten sonra güncellenen adaylar (guncelleme_sonrasi).
 * Dönüş: { imported, updated, cancelled, watermark } — watermark = görülen en yeni guncelleme_tarihi.
 */
async function pullCampusCandidates(campus, base, key, upsert, cancel, since) {
  let sayfa = 1, imported = 0, updated = 0, cancelled = 0, watermark = since || '';
  while (sayfa <= 200) {
    const r = await crmGet(base, key, sayfa, since);
    if (!r.ok) {
      const snippet = (r.text || '').replace(/\s+/g, ' ').slice(0, 200);
      throw new Error(`${campus.name}: CRM ${r.status} döndürdü (${r.url})${snippet ? ' — ' + snippet : ''}`);
    }
    let data;
    try { data = JSON.parse(r.text || 'null'); }
    catch { throw new Error(`${campus.name}: CRM yanıtı JSON değil (${r.url}) — ${(r.text || '').slice(0, 150)}`); }
    const { list, key: listKey } = extractCandidateList(data);
    if (sayfa === 1 && !listKey && data && typeof data === 'object') {
      throw new Error(`${campus.name}: Yanıtta aday dizisi bulunamadı. Gelen alanlar: [${Object.keys(data).join(', ')}]. Beklenen: "adaylar".`);
    }
    for (const a of list) {
      const gt = val(a, 'guncelleme_tarihi', 'updated_at', 'guncellemeTarihi');
      if (gt && String(gt) > watermark) watermark = String(gt);
      const durum = val(a, 'kayit_durumu', 'durum', 'status');
      if (durum === 'kayit_iptal') {
        if (cancel.run(String(val(a, 'id', 'crm_id', 'form_id'))).changes) cancelled++;
        continue;
      }
      const info = upsert.run(mapCandidate(a, campus.code));
      if (info.changes) (info.lastInsertRowid ? imported++ : updated++);
    }
    if (sayfa >= totalPagesOf(data) || !list.length) break;
    sayfa++;
  }
  return { imported, updated, cancelled, watermark };
}

/**
 * Tanı: tek kampüs için CRM'e tek bir GET atar ve ham yanıtı özetler.
 * Bağlantı/anahtar/yanıt-biçimi sorunlarını görmek için kullanılır (veri yazmaz).
 */
async function testCrmConnection(campusId) {
  const base = getSetting('crm_base_url', '').trim().replace(/\/+$/, '');
  if (!base) return { ok: false, error: 'CRM taban adresi tanımlı değil.' };
  const c = db.prepare('SELECT id, code, name FROM campuses WHERE id = ?').get(campusId);
  if (!c) return { ok: false, error: 'Kampüs bulunamadı.' };
  const cfg = crmConfig(c.id);
  if (!cfg.key) return { ok: false, error: `${c.name}: CRM API Anahtarı girilmemiş.` };
  if (!cfg.active) return { ok: false, error: `${c.name}: CRM entegrasyonu pasif (Aktif kutusu işaretli değil).` };
  try {
    const r = await crmGet(base, cfg.key, 1, '');
    let parsed = null, listInfo = { list: [], key: null }, topKeys = [];
    try { parsed = JSON.parse(r.text || 'null'); listInfo = extractCandidateList(parsed); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) topKeys = Object.keys(parsed); } catch {}
    return {
      ok: r.ok && !!listInfo.key,
      url: r.url, http_status: r.status,
      yanit_json_mi: parsed !== null,
      aday_dizisi_alani: listInfo.key,
      aday_sayisi: listInfo.list.length,
      yanit_alanlari: topKeys,
      ornek_yanit: (r.text || '').slice(0, 600),
    };
  } catch (e) {
    return { ok: false, url: `${base}/api/okul/adaylar/`, error: 'Bağlantı hatası: ' + e.message };
  }
}

/**
 * CRM'den aday çeker. campusId verilirse yalnız o kampüs; verilmezse CRM'i aktif
 * tüm kampüsler için sırayla çeker. Her kampüs kendi CRM anahtarını kullanır.
 * full=true değilse artımlı sync yapar (kampüs bazlı son çekim tarihinden sonrası).
 */
async function pullCandidatesFromCrm(campusId, opts = {}) {
  const base = getSetting('crm_base_url', '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('CRM taban adresi Parametreler sayfasından tanımlanmalı.');
  const campuses = campusId
    ? db.prepare('SELECT id, code, name FROM campuses WHERE id = ?').all(campusId)
    : db.prepare('SELECT id, code, name FROM campuses WHERE active = 1').all();
  const upsert = upsertCandidate();
  const cancel = cancelCandidate();
  let imported = 0, updated = 0, cancelled = 0, pulled = 0;
  const errors = [];
  for (const c of campuses) {
    const cfg = crmConfig(c.id);
    if (!cfg.key || !cfg.active) continue;
    const sinceKey = `crm_pull_since_${c.id}`;
    const since = opts.full ? '' : getSetting(sinceKey, '');
    try {
      const r = await pullCampusCandidates(c, base, cfg.key, upsert, cancel, since);
      imported += r.imported; updated += r.updated; cancelled += r.cancelled; pulled++;
      if (r.watermark) setSetting(sinceKey, r.watermark); // sonraki çekim için imleç
    } catch (e) { errors.push(e.message); }
  }
  if (!pulled && !errors.length) throw new Error('Aktif ve anahtarı tanımlı CRM kampüsü yok.');
  return { campuses: pulled, imported, updated, cancelled, errors };
}

module.exports = { notifyCrmEnrollment, notifyCrmCancel, pullCandidatesFromCrm, testCrmConnection };
