/**
 * Okul Kayıt ve Tahsilat Takip Sistemi
 * Çok kampüslü okul yönetimi: öğrenci kayıt, taksit/tahsilat takibi, raporlama.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const { db, audit, today } = require('./src/db');
const { authenticate, requirePermission, ROLE_LABELS } = require('./src/auth');
const { METHOD_LABELS } = require('./src/routes/payments');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- API ----
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', authenticate, require('./src/routes/users'));
app.use('/api/campuses', authenticate, require('./src/routes/campuses'));
app.use('/api/students', authenticate, require('./src/routes/students'));
app.use('/api/enrollments', authenticate, require('./src/routes/enrollments'));
app.use('/api/payments', authenticate, require('./src/routes/payments'));
app.use('/api/dashboard', authenticate, require('./src/routes/dashboard'));
app.use('/api/reports', authenticate, require('./src/routes/reports'));
app.use('/api/parameters', authenticate, require('./src/routes/parameters'));
// CRM entegrasyonu (kendi X-API-Key doğrulaması var, oturum gerektirmez)
app.use('/api/integration', require('./src/routes/integration'));

// Form ve filtreler için sabitler
app.get('/api/meta', authenticate, (req, res) => {
  res.json({
    academic_years: db.prepare('SELECT * FROM academic_years ORDER BY start_date DESC').all(),
    payment_methods: Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label })),
    roles: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
    grades: ['9', '10', '11', '12'],
    enrollment_types: [
      { value: 'DIS_KAYIT', label: 'Dış Kayıt (Yeni Öğrenci)' },
      { value: 'IC_KAYIT', label: 'İç Kayıt (Kayıt Yenileme)' },
    ],
    student_statuses: [
      { value: 'AKTIF', label: 'Kayıtlı' },
      { value: 'MEZUN', label: 'Mezun' },
      { value: 'KAYIT_SILDI', label: 'Kayıt Sildi' },
    ],
  });
});

// Denetim kaydı (genel merkez + kampüs müdürü)
app.get('/api/audit', authenticate, requirePermission('audit.view'), (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS user_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 500`).all();
  res.json({ audit: rows });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Tam veritabanı yedeği (tutarlı anlık görüntü) — genel merkez indirir, güvenli yerde saklar.
// Geri yükleme: sunucu kapalıyken indirilen dosya data/okul.db olarak kopyalanır.
app.get('/api/backup', authenticate, requirePermission('settings.manage'), async (req, res, next) => {
  try {
    const tmpFile = path.join(os.tmpdir(), `okul-yedek-${process.pid}-${Date.now()}.db`);
    await db.backup(tmpFile); // WAL dahil tutarlı kopya
    audit(req.user.id, 'BACKUP', 'database', null, '');
    res.download(tmpFile, `okul-yedek-${today()}.db`, () => fs.unlink(tmpFile, () => {}));
  } catch (err) { next(err); }
});

// SPA fallback
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hata yakalayıcı
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
});

/**
 * Otomatik aday senkronizasyonu: CRM'den adayları periyodik olarak (varsayılan 5 dk)
 * artımlı çeker; böylece "Okul Kayıt Sistemine Gönder" butonuna basılmasını beklemeden
 * tüm adaylar okul tarafında hazır olur. Ayarlar (Parametreler > CRM):
 *   crm_auto_pull       : '0' ise kapalı (varsayılan açık; taban URL tanımlıysa çalışır)
 *   crm_auto_pull_min   : dakika cinsinden aralık (varsayılan 5, en az 1)
 * Not: Render ücretsiz planında sunucu uykudayken tetiklenmez; uyanınca devam eder.
 */
function startAutoPull() {
  const { getSetting } = require('./src/db');
  const { pullCandidatesFromCrm } = require('./src/crm-notify');
  let running = false;
  const tick = async () => {
    if (running) return;
    if (getSetting('crm_auto_pull', '1') === '0') return;
    if (!getSetting('crm_base_url', '').trim()) return;
    running = true;
    try {
      const r = await pullCandidatesFromCrm(null, { full: true }); // tam çekim: yeni adaylar kaçmasın
      if (r.imported || r.updated || r.cancelled) {
        console.log(`[CRM oto-çekim] eklendi=${r.imported} güncellendi=${r.updated} iptal=${r.cancelled}`);
      }
    } catch (e) {
      console.warn('[CRM oto-çekim] hata:', e.message);
    } finally { running = false; }
  };
  const minutes = Math.max(1, parseInt(getSetting('crm_auto_pull_min', '5'), 10) || 5);
  const timer = setInterval(tick, minutes * 60 * 1000);
  timer.unref(); // süreç kapanışını engellemesin
  setTimeout(tick, 15000).unref(); // açılıştan 15 sn sonra ilk çekim
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Okul Kayıt Sistemi çalışıyor: http://localhost:${PORT}`);
  });
  startAutoPull();
}

module.exports = app;
