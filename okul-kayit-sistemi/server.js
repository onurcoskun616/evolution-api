/**
 * Okul Kayıt ve Tahsilat Takip Sistemi
 * Çok kampüslü okul yönetimi: öğrenci kayıt, taksit/tahsilat takibi, raporlama.
 */
const path = require('path');
const express = require('express');
const { db } = require('./src/db');
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

// Form ve filtreler için sabitler
app.get('/api/meta', authenticate, (req, res) => {
  res.json({
    academic_years: db.prepare('SELECT * FROM academic_years ORDER BY start_date DESC').all(),
    payment_methods: Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label })),
    roles: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
    grades: ['Anaokulu', 'İlkokul Hazırlık', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
    enrollment_types: [
      { value: 'YENI_KAYIT', label: 'Yeni Kayıt' },
      { value: 'KAYIT_YENILEME', label: 'Kayıt Yenileme' },
      { value: 'NAKIL', label: 'Nakil' },
    ],
    student_statuses: [
      { value: 'AKTIF', label: 'Aktif' }, { value: 'ADAY', label: 'Aday' },
      { value: 'PASIF', label: 'Pasif' }, { value: 'MEZUN', label: 'Mezun' },
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

// SPA fallback
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hata yakalayıcı
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Okul Kayıt Sistemi çalışıyor: http://localhost:${PORT}`);
  });
}

module.exports = app;
