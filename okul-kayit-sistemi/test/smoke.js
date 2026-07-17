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
        tc_no: '12345678950', gender: 'KIZ', grade: '10',
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
      body: { first_name: 'X', last_name: 'Y', campus_id: campusId, tc_no: '12345678950' },
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

  let activeYearId, pricedItems, expectedNet, depts, freePlacement;

  await test('Parametreler: ilan listesi, bölümler ve şube planı seed ile hazır', async () => {
    const meta = await req('GET', '/meta', { token: campusToken });
    activeYearId = meta.data.academic_years.find(y => y.active).id;
    const r = await req('GET', `/parameters?academic_year_id=${activeYearId}`, { token: campusToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    pricedItems = r.data.fee_items.filter(i => i.price !== null);
    assert.ok(pricedItems.length >= 6, 'tüm kalemlerin ilan fiyatı olmalı');
    assert.equal(r.data.limits.max_discount_rate, 25);
    assert.equal(r.data.limits.max_discount_amount, 100000);
    depts = r.data.departments;
    assert.equal(depts.length, 5, 'kampüste 5 bölüm olmalı');
    assert.equal(r.data.section_plans[`${depts[0].id}|9`], 5, '9. sınıf şube planı 5 olmalı');
    assert.equal(r.data.max_class_size, 30);
  });

  await test('Şube doluluk sorgusu: dolu ve boş şubeler görünür', async () => {
    const r = await req('GET',
      `/parameters/sections?academic_year_id=${activeYearId}&department_id=${depts[0].id}&grade=10`,
      { token: campusToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.sections.length, 5);
    const fullOnes = r.data.sections.filter(s => s.full);
    const openOnes = r.data.sections.filter(s => !s.full);
    assert.ok(fullOnes.length >= 1, 'seed sonrasında dolu şube olmalı');
    assert.ok(openOnes.length >= 1, 'boş şube kalmalı');
    assert.ok(r.data.sections.every(s => s.current <= 30), '30 üstü şube olamaz');
    freePlacement = { grade: '10', department_id: depts[0].id, section: openOnes[0].section };
  });

  await test('Kayıt oluşturma (kalem bazlı indirim: eğitim %15, yemek 5000 TL)', async () => {
    const money = x => Math.round(x * 100) / 100;
    const [egitim, yemek] = [pricedItems[0], pricedItems[2]];
    const listFee = money(egitim.price + yemek.price);
    const egitimDisc = money(egitim.price * 0.15);
    const expectedDisc = money(egitimDisc + 5000);
    expectedNet = money(listFee - expectedDisc);
    const r = await req('POST', '/enrollments', {
      token: campusToken,
      body: {
        student_id: studentId, academic_year_id: activeYearId,
        enrollment_type: 'IC_KAYIT', ...freePlacement,
        items: [
          { fee_item_id: egitim.id, quantity: 1, discount_rate: 15 },
          { fee_item_id: yemek.id, quantity: 1, discount_amount: 5000 },
        ],
        discount_reason: 'Erken kayıt + yemek desteği',
        down_payment: 10000, installment_count: 9, first_due_date: '2026-09-15',
        default_payment_method: 'KMH', payer_name: 'Test Anne', payer_phone: '0532 111 22 33',
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    enrollmentId = r.data.id;
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    const e = d.data.enrollments.find(x => x.id === enrollmentId);
    assert.equal(e.list_fee, listFee, `liste ücreti kalemlerden hesaplanmalı: ${e.list_fee} != ${listFee}`);
    assert.equal(e.discount_amount, expectedDisc, `indirim toplamı: ${e.discount_amount} != ${expectedDisc}`);
    assert.equal(e.net_fee, expectedNet);
    assert.equal(e.items.length, 2);
    const eItem = e.items.find(i => i.fee_item_id === egitim.id);
    assert.equal(eItem.discount_rate, 15);
    assert.equal(eItem.discount_amount, egitimDisc);
    assert.equal(eItem.net_total, money(egitim.price - egitimDisc));
    const yItem = e.items.find(i => i.fee_item_id === yemek.id);
    assert.equal(yItem.discount_amount, 5000);
    assert.equal(e.installments.length, 10);
    installments = e.installments;
    const total = e.installments.reduce((a, i) => a + i.amount, 0);
    assert.equal(money(total), expectedNet);
  });

  await test('Kalem indirimi kalem tutarını aşamaz', async () => {
    const s = await req('POST', '/students', {
      token: campusToken, body: { first_name: 'Aşkın', last_name: 'İndirim', campus_id: campusId },
    });
    const r = await req('POST', '/enrollments', {
      token: campusToken,
      body: {
        student_id: s.data.id, academic_year_id: activeYearId, ...freePlacement,
        items: [{ fee_item_id: pricedItems[1].id, quantity: 1, discount_amount: pricedItems[1].price + 1000 }],
        installment_count: 3, first_due_date: '2026-09-15',
      },
    });
    assert.equal(r.status, 400);
    assert.ok(/aşamaz/i.test(r.data.error), r.data.error);
  });

  await test('Aynı yıl için ikinci kayıt reddedilir', async () => {
    const r = await req('POST', '/enrollments', {
      token: campusToken,
      body: { student_id: studentId, academic_year_id: activeYearId, items: [{ fee_item_id: pricedItems[0].id }], installment_count: 1, first_due_date: '2026-09-15' },
    });
    assert.equal(r.status, 400);
  });

  await test('Kayıt: ücret kalemi seçilmeden reddedilir', async () => {
    const s = await req('POST', '/students', {
      token: campusToken, body: { first_name: 'Kalemsiz', last_name: 'Test', campus_id: campusId },
    });
    const r = await req('POST', '/enrollments', {
      token: campusToken,
      body: { student_id: s.data.id, academic_year_id: activeYearId, ...freePlacement, installment_count: 5, first_due_date: '2026-09-15' },
    });
    assert.equal(r.status, 400);
    assert.ok(/kalem/i.test(r.data.error), r.data.error);
    // bölümsüz kayıt da reddedilir
    const r2 = await req('POST', '/enrollments', {
      token: campusToken,
      body: { student_id: s.data.id, academic_year_id: activeYearId, grade: '10',
        items: [{ fee_item_id: pricedItems[0].id }], installment_count: 5, first_due_date: '2026-09-15' },
    });
    assert.equal(r2.status, 400);
    assert.ok(/bölüm/i.test(r2.data.error), r2.data.error);
  });

  await test('İndirim sınırı: azami toplam oran (%25) aşılırsa kayıt reddedilir', async () => {
    const s = await req('POST', '/students', {
      token: campusToken, body: { first_name: 'İndirim', last_name: 'Sınırı', campus_id: campusId },
    });
    const mk = itemDiscount => ({
      student_id: s.data.id, academic_year_id: activeYearId, ...freePlacement,
      items: [{ fee_item_id: pricedItems[0].id, quantity: 1, ...itemDiscount }],
      installment_count: 5, first_due_date: '2026-09-15',
    });
    const rejected = await req('POST', '/enrollments', {
      token: campusToken, body: mk({ discount_rate: 40 }),
    });
    assert.equal(rejected.status, 400);
    assert.ok(/azami/i.test(rejected.data.error), rejected.data.error);
    const ok = await req('POST', '/enrollments', {
      token: campusToken, body: mk({ discount_rate: 20 }),
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
  });

  await test('İndirim sınırı: azami toplam tutar (100.000 TL) aşılırsa reddedilir', async () => {
    const s = await req('POST', '/students', {
      token: campusToken, body: { first_name: 'Tutar', last_name: 'Sınırı', campus_id: campusId },
    });
    // 2 adet eğitim ücreti -> yüksek brüt; 110.000 TL indirim oran sınırına takılmadan tutar sınırını aşar
    const r = await req('POST', '/enrollments', {
      token: campusToken,
      body: {
        student_id: s.data.id, academic_year_id: activeYearId, ...freePlacement,
        items: [{ fee_item_id: pricedItems[0].id, quantity: 2, discount_amount: 110000 }],
        installment_count: 5, first_due_date: '2026-09-15',
      },
    });
    assert.equal(r.status, 400);
    assert.ok(/azami.*TL|TL.*azami/i.test(r.data.error), r.data.error);
  });

  await test('Parametreler: kampüs müdürü düzenleyemez, genel merkez düzenler', async () => {
    const denied = await req('PUT', '/parameters', {
      token: campusToken,
      body: { campus_id: campusId, academic_year_id: activeYearId, prices: [] },
    });
    assert.equal(denied.status, 403);
    const first = pricedItems[0];
    const r = await req('PUT', '/parameters', {
      token: hqToken,
      body: {
        campus_id: campusId, academic_year_id: activeYearId,
        prices: [{ fee_item_id: first.id, price: 199000 }],
        max_discount_rate: 30, max_discount_amount: 120000,
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.fee_items.find(i => i.id === first.id).price, 199000);
    assert.equal(r.data.limits.max_discount_rate, 30);
  });

  await test('Kalem bazlı indirim sınırı: kaleme özel azami oran/tutar uygulanır', async () => {
    const yemek = pricedItems[2];
    // Yemek ücretine kaleme özel sınır koy: azami %5 ve 3.000 TL
    const upd = await req('PUT', '/parameters', {
      token: hqToken,
      body: {
        campus_id: campusId, academic_year_id: activeYearId,
        prices: [{ fee_item_id: yemek.id, price: yemek.price, max_discount_rate: 5, max_discount_amount: 3000 }],
      },
    });
    assert.equal(upd.status, 200, JSON.stringify(upd.data));
    const updated = upd.data.fee_items.find(i => i.id === yemek.id);
    assert.equal(updated.max_discount_rate, 5);
    assert.equal(updated.max_discount_amount, 3000);
    // %10 indirim -> kalem sınırını aşar, reddedilir
    const s = await req('POST', '/students', {
      token: campusToken, body: { first_name: 'Kalem', last_name: 'Sınırı', campus_id: campusId },
    });
    const mk = disc => ({
      student_id: s.data.id, academic_year_id: activeYearId, ...freePlacement,
      items: [{ fee_item_id: yemek.id, quantity: 1, ...disc }],
      installment_count: 3, first_due_date: '2026-09-15',
    });
    const rejRate = await req('POST', '/enrollments', { token: campusToken, body: mk({ discount_rate: 10 }) });
    assert.equal(rejRate.status, 400);
    assert.ok(/azami indirim oranı %5/.test(rejRate.data.error), rejRate.data.error);
    // %4 ama tutarı 3.000 TL'yi aşan durum yok (yemek ~%4 = ~2.6k) -> kabul edilir
    const ok = await req('POST', '/enrollments', { token: campusToken, body: mk({ discount_rate: 4 }) });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    // Sınırı geri kaldır (sonraki testleri etkilemesin)
    const reset = await req('PUT', '/parameters', {
      token: hqToken,
      body: {
        campus_id: campusId, academic_year_id: activeYearId,
        prices: [{ fee_item_id: yemek.id, price: yemek.price, max_discount_rate: null, max_discount_amount: null }],
      },
    });
    assert.equal(reset.data.fee_items.find(i => i.id === yemek.id).max_discount_rate, null);
  });

  await test('Yeni ücret kalemi eklenip fiyatlandırılabilir', async () => {
    const r = await req('POST', '/parameters/items', { token: hqToken, body: { name: 'Etüt Ücreti' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const upd = await req('PUT', '/parameters', {
      token: hqToken,
      body: { campus_id: campusId, academic_year_id: activeYearId, prices: [{ fee_item_id: r.data.id, price: 15000 }] },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.fee_items.find(i => i.id === r.data.id).price, 15000);
    const dup = await req('POST', '/parameters/items', { token: hqToken, body: { name: 'Etüt Ücreti' } });
    assert.equal(dup.status, 400);
  });

  let paymentId;

  await test('Tahsilat: peşinat nakit ödenir', async () => {
    const pesinat = installments.find(i => i.seq_no === 0);
    const r = await req('POST', '/payments', {
      token: muhasebeToken,
      body: { enrollment_id: enrollmentId, installment_id: pesinat.id, amount: pesinat.amount, method: 'NAKIT', receipt_no: 'TEST-001' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    paymentId = r.data.id;
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    const e = d.data.enrollments.find(x => x.id === enrollmentId);
    assert.equal(e.installments.find(i => i.seq_no === 0).status, 'ODENDI');
    assert.equal(e.total_paid, pesinat.amount);
    assert.equal(e.balance, Math.round((expectedNet - pesinat.amount) * 100) / 100);
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

  await test('Makbuz no otomatik üretilir (kampüs bazlı seri, ardışık)', async () => {
    const taksit2 = installments.find(i => i.seq_no === 2);
    const r1 = await req('POST', '/payments', {
      token: muhasebeToken,
      body: { enrollment_id: enrollmentId, installment_id: taksit2.id, amount: 100, method: 'SENET' },
    });
    assert.equal(r1.status, 200, JSON.stringify(r1.data));
    assert.ok(/^MRK-\d{4}-\d{6}$/.test(r1.data.receipt_no), 'format hatalı: ' + r1.data.receipt_no);
    const r2 = await req('POST', '/payments', {
      token: muhasebeToken,
      body: { enrollment_id: enrollmentId, installment_id: taksit2.id, amount: 100, method: 'SENET' },
    });
    const n1 = parseInt(r1.data.receipt_no.slice(-6), 10);
    const n2 = parseInt(r2.data.receipt_no.slice(-6), 10);
    assert.equal(n2, n1 + 1, `${r1.data.receipt_no} -> ${r2.data.receipt_no}`);
  });

  await test('Veritabanı yedeği indirilebilir (yalnız yetkili)', async () => {
    const denied = await req('GET', '/backup', { token: muhasebeToken, raw: true });
    assert.equal(denied.status, 403);
    const res = await req('GET', '/backup', { token: hqToken, raw: true });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000000, `yedek boyutu ${buf.length}`);
    assert.equal(buf.slice(0, 15).toString(), 'SQLite format 3');
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
    const e = await req('POST', '/enrollments', {
      token: campusToken,
      body: {
        student_id: s.data.id, academic_year_id: activeYearId, ...freePlacement,
        items: [{ fee_item_id: pricedItems[0].id, quantity: 1 }],
        installment_count: 5, first_due_date: '2026-09-15',
      },
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

  await test('Şube kapasitesi: 30 öğrenci sınırı aşılamaz', async () => {
    // dept[1] / 9. sınıf: seed'de A-D dolu, E boş -> E'yi 30'a kadar doldur
    const secR = await req('GET',
      `/parameters/sections?academic_year_id=${activeYearId}&department_id=${depts[1].id}&grade=9`,
      { token: campusToken });
    const openSec = secR.data.sections.find(x => !x.full);
    assert.ok(openSec, 'boş şube olmalı');
    const room = openSec.capacity - openSec.current;
    const mkEnroll = async () => {
      const s = await req('POST', '/students', {
        token: campusToken, body: { first_name: 'Kapasite', last_name: 'Testi', campus_id: campusId },
      });
      return req('POST', '/enrollments', {
        token: campusToken,
        body: {
          student_id: s.data.id, academic_year_id: activeYearId,
          grade: '9', department_id: depts[1].id, section: openSec.section,
          items: [{ fee_item_id: pricedItems[0].id }], installment_count: 5, first_due_date: '2026-09-15',
        },
      });
    };
    for (let i = 0; i < room; i++) {
      const r = await mkEnroll();
      assert.equal(r.status, 200, `${i + 1}. kayıt başarısız: ${JSON.stringify(r.data)}`);
    }
    const overflow = await mkEnroll();
    assert.equal(overflow.status, 400);
    assert.ok(/dolu/i.test(overflow.data.error), overflow.data.error);
    // doluluk sorgusu da şubeyi dolu göstermeli
    const after = await req('GET',
      `/parameters/sections?academic_year_id=${activeYearId}&department_id=${depts[1].id}&grade=9`,
      { token: campusToken });
    assert.ok(after.data.sections.find(x => x.section === openSec.section).full);
  });

  await test('Bölüm/şube değişikliği: kayıt güncellenir, öğrenci senkronlanır', async () => {
    // test öğrencimizin (enrollmentId) bölümünü değiştir
    const secR = await req('GET',
      `/parameters/sections?academic_year_id=${activeYearId}&department_id=${depts[2].id}&grade=10`,
      { token: campusToken });
    const open = secR.data.sections.find(x => !x.full);
    const r = await req('PUT', '/enrollments/' + enrollmentId, {
      token: campusToken,
      body: { department_id: depts[2].id, section: open.section },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const d = await req('GET', '/students/' + studentId, { token: campusToken });
    assert.equal(d.data.student.department_id, depts[2].id, 'öğrenci kartı senkronlanmalı');
    assert.equal(d.data.student.section, open.section);
  });

  await test('Yeni bölüm eklenip şube planı tanımlanabilir', async () => {
    const r = await req('POST', '/parameters/departments', {
      token: hqToken, body: { campus_id: campusId, name: 'Yenilenebilir Enerji Teknolojileri' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const upd = await req('PUT', '/parameters', {
      token: hqToken,
      body: {
        campus_id: campusId, academic_year_id: activeYearId,
        section_plans: [{ department_id: r.data.id, grade: '9', section_count: 2 }],
      },
    });
    assert.equal(upd.status, 200);
    const sec = await req('GET',
      `/parameters/sections?campus_id=${campusId}&academic_year_id=${activeYearId}&department_id=${r.data.id}&grade=9`,
      { token: hqToken });
    assert.equal(sec.data.sections.length, 2);
    assert.ok(sec.data.sections.every(x => x.current === 0));
    // kampüs müdürü bölüm ekleyemez (settings.manage yok)
    const denied = await req('POST', '/parameters/departments', {
      token: campusToken, body: { campus_id: campusId, name: 'X Bölümü' },
    });
    assert.equal(denied.status, 403);
  });

  await test('Kayıt yenilemeyenler raporu: geçen yıl kayıtlı, bu yıl kayıtsız', async () => {
    const r = await req('GET', `/reports/kayit-yenilemeyenler/preview?academic_year_id=${activeYearId}`, { token: hqToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.total_rows > 1500, `yenilemeyen sayısı: ${r.data.total_rows}`);
    // kampüs müdürü yalnız kendi kampüsünü görür
    const rc = await req('GET', `/reports/kayit-yenilemeyenler/preview?academic_year_id=${activeYearId}`, { token: campusToken });
    assert.ok(rc.data.total_rows < r.data.total_rows);
    assert.ok(rc.data.total_rows > 300, `kampüs yenilemeyen: ${rc.data.total_rows}`);
    // Excel de inmeli
    const xls = await req('GET', `/reports/kayit-yenilemeyenler/excel?academic_year_id=${activeYearId}`, { token: hqToken, raw: true });
    assert.equal(xls.status, 200);
    const buf = Buffer.from(await xls.arrayBuffer());
    assert.ok(buf.length > 10000);
  });

  await test('Evrak takibi: kayıtta işaretleme, sonradan tamamlama', async () => {
    const docs = await req('GET', '/parameters/documents', { token: campusToken });
    assert.equal(docs.status, 200);
    const types = docs.data.document_types.filter(x => x.active);
    assert.ok(types.length >= 7, 'varsayılan 7 evrak türü olmalı');
    // İlk 3 evrak teslim alınmış olarak öğrenci oluştur
    const s = await req('POST', '/students', {
      token: campusToken,
      body: {
        first_name: 'Evrak', last_name: 'Testi', campus_id: campusId,
        documents: types.slice(0, 3).map(t => t.id),
      },
    });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    let d = await req('GET', '/students/' + s.data.id, { token: campusToken });
    assert.equal(d.data.documents.filter(x => x.received).length, 3);
    assert.equal(d.data.documents.filter(x => !x.received).length, types.length - 3);
    // Veli sonradan bir evrak getirdi
    const missing = d.data.documents.find(x => !x.received);
    const r = await req('PUT', `/students/${s.data.id}/documents/${missing.id}`, {
      token: campusToken, body: { received: true },
    });
    assert.equal(r.status, 200);
    d = await req('GET', '/students/' + s.data.id, { token: campusToken });
    assert.equal(d.data.documents.filter(x => x.received).length, 4);
    // Yanlış işaretleme geri alınabilir
    await req('PUT', `/students/${s.data.id}/documents/${missing.id}`, {
      token: campusToken, body: { received: false },
    });
    d = await req('GET', '/students/' + s.data.id, { token: campusToken });
    assert.equal(d.data.documents.filter(x => x.received).length, 3);
  });

  await test('Eksik evrak raporu: öğrenci ve evrak bazında', async () => {
    const r = await req('GET', '/reports/eksik-evraklar/preview', { token: campusToken });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.total_rows > 500, `eksik evraklı öğrenci: ${r.data.total_rows}`);
    assert.ok(r.data.columns.some(c => /Fotoğraf/i.test(c.header)), 'evrak sütunları olmalı');
    const row = r.data.rows[0];
    assert.ok(row.missing_count >= 1);
    const xls = await req('GET', '/reports/eksik-evraklar/excel', { token: campusToken, raw: true });
    assert.equal(xls.status, 200);
  });

  await test('Okul kataloğu: ekleme, filtreleme ve öğrenciye bağlama', async () => {
    const add = await req('POST', '/parameters/schools', {
      token: hqToken,
      body: { city: 'İstanbul', district: 'Test İlçe', name: 'Test Ortaokulu', type: 'ORTAOKUL' },
    });
    assert.equal(add.status, 200, JSON.stringify(add.data));
    const list = await req('GET', '/parameters/schools?city=' + encodeURIComponent('İstanbul'), { token: campusToken });
    assert.ok(list.data.cities.includes('İstanbul'));
    assert.ok(list.data.districts.includes('Test İlçe'));
    assert.ok(list.data.schools.some(x => x.name === 'Test Ortaokulu'));
    // Öğrenciye önceki okul bağla
    const s = await req('POST', '/students', {
      token: campusToken,
      body: { first_name: 'Okul', last_name: 'Bağlama', campus_id: campusId, previous_school_id: add.data.id },
    });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const d = await req('GET', '/students/' + s.data.id, { token: campusToken });
    assert.equal(d.data.student.previous_school_name, 'Test Ortaokulu');
    assert.ok(d.data.student.previous_school.includes('Test Ortaokulu'));
    // Kampüs müdürü okul ekleyemez
    const denied = await req('POST', '/parameters/schools', {
      token: campusToken, body: { city: 'X', district: 'Y', name: 'Z' },
    });
    assert.equal(denied.status, 403);
  });

  await test('Okul kataloğu: Excel ile toplu yükleme', async () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Okullar');
    ws.addRow(['İl', 'İlçe', 'Okul Adı', 'Tür']); // başlık
    ws.addRow(['Kocaeli', 'Gebze', 'Gebze Ortaokulu', 'Ortaokul']);
    ws.addRow(['Kocaeli', 'Gebze', 'Gebze Anadolu Lisesi', 'Lise']);
    ws.addRow(['Kocaeli', 'İzmit', 'İzmit Cumhuriyet Ortaokulu', '']);
    ws.addRow(['', '', 'Eksik Satır', '']); // geçersiz
    ws.addRow(['Kocaeli', 'Gebze', 'Gebze Ortaokulu', 'Ortaokul']); // mükerrer
    const buf = await wb.xlsx.writeBuffer();
    const res = await fetch(BASE + '/api/parameters/schools/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + hqToken, 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.added, 3, `eklendi: ${data.added}`);
    assert.equal(data.skipped, 1);
    assert.equal(data.invalid, 1);
    const list = await req('GET', '/parameters/schools?city=Kocaeli', { token: campusToken });
    assert.equal(list.data.schools.length, 3);
    assert.equal(list.data.schools.find(x => x.name === 'Gebze Anadolu Lisesi').type, 'LISE');
  });

  await test('TC Kimlik doğrulama: geçersiz TC reddedilir', async () => {
    // Öğrenci TC'si: kontrol basamağı tutmuyor
    let r = await req('POST', '/students', {
      token: campusToken,
      body: { first_name: 'Tc', last_name: 'Bozuk', campus_id: campusId, tc_no: '12345678901' },
    });
    assert.equal(r.status, 400);
    assert.ok(/TC Kimlik/i.test(r.data.error), r.data.error);
    // Veli TC'si geçersiz
    r = await req('POST', '/students', {
      token: campusToken,
      body: {
        first_name: 'Veli', last_name: 'TcBozuk', campus_id: campusId,
        parents: [{ relation: 'ANNE', full_name: 'Bozuk Tc Anne', tc_no: '11111111111', phone: '0532 111 22 33' }],
      },
    });
    assert.equal(r.status, 400);
    assert.ok(/Bozuk Tc Anne/.test(r.data.error), r.data.error);
    // Ödeme sorumlusu TC'si geçersiz -> kayıt reddedilir
    const s = await req('POST', '/students', {
      token: campusToken, body: { first_name: 'Payer', last_name: 'Tc', campus_id: campusId },
    });
    r = await req('POST', '/enrollments', {
      token: campusToken,
      body: {
        student_id: s.data.id, academic_year_id: activeYearId, ...freePlacement,
        items: [{ fee_item_id: pricedItems[0].id }], installment_count: 3, first_due_date: '2026-09-15',
        payer_tc: '98765432100',
      },
    });
    assert.equal(r.status, 400);
    assert.ok(/Ödeme sorumlusu/i.test(r.data.error), r.data.error);
  });

  await test('Telefon doğrulama: geçersiz reddedilir, geçerli normalize edilir', async () => {
    // Geçersiz telefon
    let r = await req('POST', '/students', {
      token: campusToken,
      body: {
        first_name: 'Tel', last_name: 'Bozuk', campus_id: campusId,
        parents: [{ relation: 'BABA', full_name: 'Bozuk Tel Baba', phone: '123' }],
      },
    });
    assert.equal(r.status, 400);
    assert.ok(/telefon/i.test(r.data.error), r.data.error);
    // Farklı biçimlerde girilen numaralar normalize edilir
    r = await req('POST', '/students', {
      token: campusToken,
      body: {
        first_name: 'Tel', last_name: 'Normalize', campus_id: campusId,
        parents: [
          { relation: 'ANNE', full_name: 'Anne N', phone: '5321234567', is_primary: true },
          { relation: 'BABA', full_name: 'Baba N', phone: '+90 (533) 765 43 21' },
        ],
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const d = await req('GET', '/students/' + r.data.id, { token: campusToken });
    assert.equal(d.data.parents.find(p => p.full_name === 'Anne N').phone, '0532 123 45 67');
    assert.equal(d.data.parents.find(p => p.full_name === 'Baba N').phone, '0533 765 43 21');
  });

  await test('Adres kataloğu: mahalle ekleme, Excel yükleme ve öğrenciye yazma', async () => {
    const add = await req('POST', '/parameters/neighborhoods', {
      token: hqToken, body: { city: 'İstanbul', district: 'Esenyurt', name: 'Test Mahallesi' },
    });
    assert.equal(add.status, 200, JSON.stringify(add.data));
    // Excel ile yükleme
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Mahalleler');
    ws.addRow(['İl', 'İlçe', 'Mahalle']);
    ws.addRow(['Ankara', 'Çankaya', 'Bahçelievler Mahallesi']);
    ws.addRow(['Ankara', 'Çankaya', 'Ayrancı Mahallesi']);
    ws.addRow(['İstanbul', 'Esenyurt', 'Test Mahallesi']); // mükerrer
    const buf = await wb.xlsx.writeBuffer();
    const res = await fetch(BASE + '/api/parameters/neighborhoods/import', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + hqToken, 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(data.added, 2);
    assert.equal(data.skipped, 1);
    const list = await req('GET', '/parameters/neighborhoods?city=Ankara', { token: campusToken });
    assert.equal(list.data.districts.length, 1);
    assert.equal(list.data.neighborhoods.length, 2);
    // Öğrenci adresine mahalle yazılır
    const s = await req('POST', '/students', {
      token: campusToken,
      body: {
        first_name: 'Adres', last_name: 'Testi', campus_id: campusId,
        city: 'İstanbul', district: 'Esenyurt', neighborhood: 'Test Mahallesi', address: '5. Sok. No:3',
      },
    });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    const d = await req('GET', '/students/' + s.data.id, { token: campusToken });
    assert.equal(d.data.student.neighborhood, 'Test Mahallesi');
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
