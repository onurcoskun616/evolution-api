/**
 * Uçtan uca duman testi: sunucuyu başlatır, tüm ana akışları API üzerinden doğrular.
 * Çalıştırma: npm test  (önce `npm run seed` çalıştırılmış olmalı)
 */
const assert = require('assert');
const http = require('http');
const { execSync } = require('child_process');

// Testler taze veri varsayar: sunucu yüklenmeden ÖNCE veritabanını yeniden oluştur
console.log('Test öncesi veritabanı yeniden oluşturuluyor (npm run seed)…');
execSync('node seed.js', { cwd: __dirname + '/..', stdio: 'ignore' });

const app = require('../server');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
let passed = 0, failed = 0;

async function req(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}\n    ${e.message}`);
  }
}

async function main() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(PORT, r));
  console.log('Testler başlıyor…\n');

  let hqToken, campusToken, muhasebeToken, campusId;

  await test('Giriş: genel merkez', async () => {
    const r = await req('POST', '/auth/login', { body: { username: 'genelmudur', password: '123456' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.token);
    assert.equal(r.data.user.role, 'GENEL_MERKEZ');
    hqToken = r.data.token;
  });

  await test('Giriş: hatalı şifre reddedilir', async () => {
    const r = await req('POST', '/auth/login', { body: { username: 'genelmudur', password: 'yanlis' } });
    assert.equal(r.status, 401);
  });

  await test('Giriş: kampüs müdürü ve muhasebe', async () => {
    let r = await req('POST', '/auth/login', { body: { username: 'mrk.mudur', password: '123456' } });
    assert.equal(r.status, 200);
    campusToken = r.data.token;
    campusId = r.data.user.campus.id;
    r = await req('POST', '/auth/login', { body: { username: 'mrk.muhasebe', password: '123456' } });
    assert.equal(r.status, 200);
    muhasebeToken = r.data.token;
  });

  await test('Yetkisiz erişim reddedilir', async () => {
    const r = await req('GET', '/students');
    assert.equal(r.status, 401);
  });

  await test('Meta bilgileri gelir', async () => {
    const r = await req('GET', '/meta', { token: hqToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.academic_years.length >= 2);
    assert.ok(r.data.payment_methods.some(m => m.value === 'KMH'));
    assert.ok(r.data.payment_methods.some(m => m.value === 'SENET'));
  });

  await test('Genel merkez dashboard: tüm kampüsler görünür', async () => {
    const r = await req('GET', '/dashboard', { token: hqToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.per_campus.length, 5);
    assert.ok(r.data.students.total === 15000, `öğrenci sayısı ${r.data.students.total}`);
    assert.ok(r.data.collected > 0);
    assert.ok(r.data.overdue.count > 0, 'geciken taksit olmalı');
    assert.ok(r.data.upcoming30.count > 0, 'yaklaşan taksit olmalı');
  });

  await test('Kampüs müdürü dashboard: sadece kendi kampüsü', async () => {
    const r = await req('GET', '/dashboard', { token: campusToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.per_campus.length, 1);
    assert.equal(r.data.students.total, 3000);
  });

  await test('Öğrenci listesi: arama ve sayfalama', async () => {
    const r = await req('GET', '/students?page=1&page_size=25', { token: hqToken });
    assert.equal(r.status, 200);
    assert.equal(r.data.students.length, 25);
    assert.equal(r.data.total, 15000);
    const r2 = await req('GET', '/students?search=' + encodeURIComponent(r.data.students[0].student_no), { token: hqToken });
    assert.equal(r2.data.students.length, 1);
  });

  await test('Kampüs kullanıcısı başka kampüsün öğrencisini göremez', async () => {
    const other = await req('GET', '/students?page_size=10', { token: hqToken });
    const foreign = other.data.students.find(s => s.campus_id !== campusId)
      || (await req('GET', '/students?campus_id=2&page_size=1', { token: hqToken })).data.students[0];
    const r = await req('GET', '/students/' + foreign.id, { token: campusToken });
    assert.equal(r.status, 403);
    // Liste de kampüsle sınırlı
    const list = await req('GET', '/students?page_size=100', { token: campusToken });
    assert.ok(list.data.students.every(s => s.campus_id === campusId));
  });

  let studentId, enrollmentId, installments;

  await test('Yeni öğrenci + veli oluşturma', async () => {
    const r = await req('POST', '/students', {
      token: campusToken,
      body: {
        first_name: 'Test', last_name: 'Öğrenci', campus_id: campusId,
        tc_no: '99988877766', gender: 'KIZ', grade: '5', section: 'A',
        birth_date: '2015-03-10', city: 'İstanbul', district: 'Fatih',
        parents: [
          { relation: 'ANNE', full_name: 'Test Anne', phone: '0532 111 22 33', is_primary: true },
          { relation: 'BABA', full_name: 'Test Baba', phone: '0533 444 55 66' },
        ],
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    studentId = r.data.id;
    assert.ok(r.data.student_no.startsWith('MRK-'));
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    assert.equal(d.data.parents.length, 2);
  });

  await test('Aynı TC ile ikinci öğrenci reddedilir', async () => {
    const r = await req('POST', '/students', {
      token: campusToken,
      body: { first_name: 'X', last_name: 'Y', campus_id: campusId, tc_no: '99988877766' },
    });
    assert.equal(r.status, 400);
  });

  await test('Taksit planı önizleme: kuruş toplamı doğru', async () => {
    const r = await req('POST', '/enrollments/preview-plan', {
      token: campusToken,
      body: { list_fee: 100000, discount_rate: 10, down_payment: 10000, installment_count: 7, first_due_date: '2026-09-15' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.net_fee, 90000);
    const sum = r.data.plan.reduce((a, p) => a + p.amount, 0);
    assert.equal(Math.round(sum * 100) / 100, 90000, `plan toplamı ${sum}`);
    assert.equal(r.data.plan.length, 8); // peşinat + 7 taksit
  });

  await test('Kayıt oluşturma (KMH, 9 taksit)', async () => {
    const meta = await req('GET', '/meta', { token: campusToken });
    const activeYear = meta.data.academic_years.find(y => y.active);
    const r = await req('POST', '/enrollments', {
      token: campusToken,
      body: {
        student_id: studentId, academic_year_id: activeYear.id,
        enrollment_type: 'YENI_KAYIT', grade: '5',
        list_fee: 180000, discount_rate: 15, discount_reason: 'Erken kayıt indirimi',
        down_payment: 18000, installment_count: 9, first_due_date: '2026-09-15',
        default_payment_method: 'KMH', payer_name: 'Test Anne', payer_phone: '0532 111 22 33',
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    enrollmentId = r.data.id;
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    const e = d.data.enrollments.find(x => x.id === enrollmentId);
    assert.equal(e.net_fee, 153000);
    assert.equal(e.installments.length, 10);
    installments = e.installments;
    const total = e.installments.reduce((a, i) => a + i.amount, 0);
    assert.equal(Math.round(total * 100) / 100, 153000);
  });

  await test('Aynı yıl için ikinci kayıt reddedilir', async () => {
    const meta = await req('GET', '/meta', { token: campusToken });
    const activeYear = meta.data.academic_years.find(y => y.active);
    const r = await req('POST', '/enrollments', {
      token: campusToken,
      body: { student_id: studentId, academic_year_id: activeYear.id, list_fee: 1000, installment_count: 1, first_due_date: '2026-09-15' },
    });
    assert.equal(r.status, 400);
  });

  let paymentId;

  await test('Tahsilat: peşinat nakit ödenir', async () => {
    const pesinat = installments.find(i => i.seq_no === 0);
    const r = await req('POST', '/payments', {
      token: muhasebeToken,
      body: { enrollment_id: enrollmentId, installment_id: pesinat.id, amount: 18000, method: 'NAKIT', receipt_no: 'TEST-001' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    paymentId = r.data.id;
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    const e = d.data.enrollments.find(x => x.id === enrollmentId);
    assert.equal(e.installments.find(i => i.seq_no === 0).status, 'ODENDI');
    assert.equal(e.total_paid, 18000);
    assert.equal(e.balance, 135000);
  });

  await test('Tahsilat: kısmi ödeme taksiti KISMI yapar', async () => {
    const taksit1 = installments.find(i => i.seq_no === 1);
    const r = await req('POST', '/payments', {
      token: muhasebeToken,
      body: { enrollment_id: enrollmentId, installment_id: taksit1.id, amount: 5000, method: 'KREDI_KARTI' },
    });
    assert.equal(r.status, 200);
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    const i = d.data.enrollments.find(x => x.id === enrollmentId).installments.find(i => i.seq_no === 1);
    assert.equal(i.status, 'KISMI');
    assert.equal(i.paid_amount, 5000);
  });

  await test('Tahsilat: taksit kalanını aşan tutar reddedilir', async () => {
    const taksit1 = installments.find(i => i.seq_no === 1);
    const r = await req('POST', '/payments', {
      token: muhasebeToken,
      body: { enrollment_id: enrollmentId, installment_id: taksit1.id, amount: 999999, method: 'NAKIT' },
    });
    assert.equal(r.status, 400);
  });

  await test('Tahsilat iptali: taksit yeniden açılır', async () => {
    const r = await req('POST', `/payments/${paymentId}/cancel`, {
      token: campusToken, body: { reason: 'Test iptali' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    const e = d.data.enrollments.find(x => x.id === enrollmentId);
    assert.equal(e.installments.find(i => i.seq_no === 0).status, 'BEKLIYOR');
    assert.equal(e.total_paid, 5000);
  });

  await test('Kayıt personeli tahsilat iptal edemez (yetki)', async () => {
    const login = await req('POST', '/auth/login', { body: { username: 'mrk.kayit', password: '123456' } });
    const r = await req('POST', `/payments/${paymentId}/cancel`, { token: login.data.token, body: {} });
    assert.equal(r.status, 403);
  });

  await test('Taksit vade/tutar düzenleme', async () => {
    const taksit2 = installments.find(i => i.seq_no === 2);
    const r = await req('PUT', `/enrollments/installments/${taksit2.id}`, {
      token: campusToken, body: { due_date: '2026-10-20' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    const i = d.data.enrollments.find(x => x.id === enrollmentId).installments.find(i => i.seq_no === 2);
    assert.equal(i.due_date, '2026-10-20');
  });

  await test('Taksit takibi: geciken/yaklaşan listeler', async () => {
    let r = await req('GET', '/payments/installments?filter=overdue&page_size=10', { token: hqToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.total > 0, 'geciken taksit olmalı');
    assert.ok(r.data.installments.every(i => i.days_overdue > 0));
    r = await req('GET', '/payments/installments?filter=upcoming&page_size=10', { token: hqToken });
    assert.ok(r.data.total > 0, 'yaklaşan taksit olmalı');
  });

  await test('Tahsilat listesi: filtre ve toplam', async () => {
    const r = await req('GET', '/payments?method=SENET&page_size=10', { token: hqToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.total > 0);
    assert.ok(r.data.payments.every(p => p.method === 'SENET'));
    assert.ok(r.data.total_amount > 0);
  });

  await test('Excel: kampüs özet raporu indirilir', async () => {
    const res = await req('GET', '/reports/kampus-ozet/excel', { token: hqToken, raw: true });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').includes('spreadsheetml'));
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000, `dosya boyutu ${buf.length}`);
    assert.equal(buf[0], 0x50); // 'P' - xlsx zip imzası
    assert.equal(buf[1], 0x4b); // 'K'
  });

  await test('Excel: geciken taksitler raporu indirilir', async () => {
    const res = await req('GET', '/reports/geciken-taksitler/excel', { token: campusToken, raw: true });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
  });

  await test('Excel: 15 bin satırlık öğrenci raporu indirilir', async () => {
    const res = await req('GET', '/reports/ogrenciler/excel', { token: hqToken, raw: true });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 100000, `dosya boyutu ${buf.length}`);
  });

  await test('Rapor önizleme çalışır', async () => {
    const r = await req('GET', '/reports/kayitlar/preview', { token: hqToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.total_rows > 20000);
    assert.equal(r.data.rows.length, 200);
  });

  await test('Muhasebe rolü kullanıcı yönetemez', async () => {
    const r = await req('GET', '/users', { token: muhasebeToken });
    assert.equal(r.status, 403);
  });

  await test('Kampüs müdürü kullanıcı oluşturabilir (kendi kampüsü)', async () => {
    const r = await req('POST', '/users', {
      token: campusToken,
      body: { username: 'test.kayit2', full_name: 'Test Personel', role: 'KAYIT_PERSONELI', campus_id: campusId, password: 'test1234' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // Genel merkez rolü atayamaz
    const r2 = await req('POST', '/users', {
      token: campusToken,
      body: { username: 'test.hq', full_name: 'X', role: 'GENEL_MERKEZ', password: 'test1234' },
    });
    assert.equal(r2.status, 403);
  });

  await test('Yetki kısıtlama: revoked_permissions çalışır', async () => {
    const users = await req('GET', '/users', { token: hqToken });
    const u = users.data.users.find(x => x.username === 'test.kayit2');
    const r = await req('PUT', '/users/' + u.id, {
      token: hqToken, body: { revoked_permissions: ['payment.create'] },
    });
    assert.equal(r.status, 200);
    const login = await req('POST', '/auth/login', { body: { username: 'test.kayit2', password: 'test1234' } });
    assert.ok(!login.data.user.permissions.includes('payment.create'));
    const pay = await req('POST', '/payments', {
      token: login.data.token,
      body: { enrollment_id: enrollmentId, amount: 100, method: 'NAKIT' },
    });
    assert.equal(pay.status, 403);
  });

  await test('Kayıt iptali: bekleyen taksitler kapanır', async () => {
    // Yeni test öğrencisi ve kaydı oluşturup iptal et
    const s = await req('POST', '/students', {
      token: campusToken,
      body: { first_name: 'İptal', last_name: 'Testi', campus_id: campusId },
    });
    const meta = await req('GET', '/meta', { token: campusToken });
    const activeYear = meta.data.academic_years.find(y => y.active);
    const e = await req('POST', '/enrollments', {
      token: campusToken,
      body: { student_id: s.data.id, academic_year_id: activeYear.id, list_fee: 50000, installment_count: 5, first_due_date: '2026-09-15' },
    });
    const r = await req('POST', `/enrollments/${e.data.id}/cancel`, { token: campusToken, body: { reason: 'Vazgeçildi' } });
    assert.equal(r.status, 200);
    const d = await req('GET', '/students/' + s.data.id, { token: campusToken });
    const enr = d.data.enrollments[0];
    assert.equal(enr.status, 'IPTAL');
    assert.ok(enr.installments.every(i => i.status === 'IPTAL'));
    // İptal edilmiş kayda tahsilat yapılamaz
    const pay = await req('POST', '/payments', {
      token: muhasebeToken, body: { enrollment_id: e.data.id, amount: 100, method: 'NAKIT' },
    });
    assert.equal(pay.status, 400);
  });

  await test('Denetim kaydı tutulur', async () => {
    const r = await req('GET', '/audit', { token: hqToken });
    assert.equal(r.status, 200);
    assert.ok(r.data.audit.length > 5);
    assert.ok(r.data.audit.some(a => a.action === 'CANCEL'));
  });

  await test('Eşzamanlılık: 50 paralel istek sorunsuz', async () => {
    const started = Date.now();
    const jobs = [];
    for (let i = 0; i < 50; i++) {
      jobs.push(req('GET', `/students?page=${(i % 10) + 1}&page_size=25`, { token: hqToken }));
      jobs.push(req('GET', '/dashboard', { token: i % 2 ? hqToken : campusToken }));
    }
    const results = await Promise.all(jobs);
    assert.ok(results.every(r => r.status === 200));
    console.log(`    (100 istek ${Date.now() - started} ms'de tamamlandı)`);
  });

  server.close();
  console.log(`\nSonuç: ${passed} başarılı, ${failed} başarısız`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
