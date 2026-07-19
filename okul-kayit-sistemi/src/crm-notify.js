/**
 * CRM'e kayıt bildirimi (webhook). Kesin kayıt oluşunca öğrenci/sözleşme
 * bilgilerini CRM'in belirttiği URL'e POST eder.
 *
 * Ayarlar (Parametreler > Entegrasyon):
 *   crm_webhook_url    : bildirimin gönderileceği URL (boşsa bildirim yapılmaz)
 *   crm_webhook_secret : X-Webhook-Secret başlığında gönderilir (CRM doğrulaması için)
 */
const { db, getSetting } = require('./db');

async function notifyCrmEnrollment(enrollmentId) {
  const url = getSetting('crm_webhook_url', '').trim();
  if (!url) return { skipped: true };
  const { studentSnapshot } = require('./routes/integration');
  const enr = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(enrollmentId);
  if (!enr) return { skipped: true };
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(enr.student_id);
  if (!student) return { skipped: true };
  const secret = getSetting('crm_webhook_secret', '');
  const payload = {
    event: 'enrollment.created',
    sent_at: new Date().toISOString(),
    data: studentSnapshot(student),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'X-Webhook-Secret': secret } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { notifyCrmEnrollment };
