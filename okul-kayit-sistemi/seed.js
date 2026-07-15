/**
 * Demo/başlangıç verisi üretir:
 *  - 5 kampüs, genel merkez + kampüs kullanıcıları
 *  - 2025-2026 ve 2026-2027 öğretim yılları
 *  - ~15.000 öğrenci, veli bilgileri, kayıtlar, taksit planları ve tahsilatlar
 *
 * Çalıştırma: npm run seed  (mevcut veritabanını SIFIRLAR)
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.OKUL_DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'okul.db');
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(DB_FILE + suffix)) fs.unlinkSync(DB_FILE + suffix);
}

const { db, money } = require('./src/db');

const STUDENT_COUNT = parseInt(process.env.SEED_STUDENTS || '15000', 10);

// ---- Tekrarlanabilir rastgele üreteç (mulberry32) ----
let seed = 0x9e3779b9;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const MALE_NAMES = ['Ahmet', 'Mehmet', 'Mustafa', 'Ali', 'Emre', 'Burak', 'Yusuf', 'Ömer', 'Eymen', 'Kerem',
  'Arda', 'Çınar', 'Mert', 'Kaan', 'Deniz', 'Efe', 'Baran', 'Emir', 'Alp', 'Doruk', 'Yiğit', 'Umut',
  'Berat', 'Tuna', 'Onur', 'Serkan', 'Hakan', 'Cem', 'Barış', 'Ege'];
const FEMALE_NAMES = ['Zeynep', 'Elif', 'Yağmur', 'Azra', 'Ecrin', 'Defne', 'Nehir', 'Miray', 'Eylül', 'Zümra',
  'Asel', 'İkra', 'Duru', 'Lina', 'Meryem', 'Fatma', 'Ayşe', 'Emine', 'Selin', 'Ceren', 'İrem',
  'Buse', 'Melis', 'Naz', 'Derin', 'Ada', 'Masal', 'Öykü', 'Nisan', 'İpek'];
const SURNAMES = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir',
  'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek',
  'Polat', 'Korkmaz', 'Özcan', 'Erdoğan', 'Güneş', 'Akın', 'Aksoy', 'Türk', 'Avcı', 'Bulut',
  'Tekin', 'Kaplan', 'Yavuz', 'Sarı', 'Ateş', 'Güler', 'Turan', 'Taş', 'Uçar', 'Erdem'];
const OCCUPATIONS = ['Mühendis', 'Öğretmen', 'Doktor', 'Avukat', 'Esnaf', 'Memur', 'Bankacı', 'Hemşire',
  'Mimar', 'Muhasebeci', 'Serbest Meslek', 'Yönetici', 'Eczacı', 'Polis', 'Ev Hanımı', 'Akademisyen'];
const DISTRICTS = ['Kadıköy', 'Üsküdar', 'Beşiktaş', 'Şişli', 'Bakırköy', 'Maltepe', 'Kartal', 'Pendik',
  'Ataşehir', 'Beylikdüzü', 'Başakşehir', 'Fatih', 'Zeytinburnu', 'Bahçelievler', 'Sarıyer'];
const GRADES = ['9', '10', '11', '12'];
const SECTIONS = ['A', 'B', 'C', 'D', 'E'];
const DEPARTMENTS = ['Bilişim Teknolojileri', 'Elektrik-Elektronik Teknolojisi', 'Makine Teknolojisi',
  'Muhasebe ve Finansman', 'Sağlık Hizmetleri'];
const METHODS = ['NAKIT', 'KREDI_KARTI', 'KREDI_KARTI', 'KREDI_KARTI', 'HAVALE_EFT', 'HAVALE_EFT', 'KMH', 'SENET', 'CEK', 'NAKIT'];

function fakeTc() {
  let s = String(rint(1, 9));
  for (let i = 0; i < 10; i++) s += String(rint(0, 9));
  return s;
}
function fakePhone() {
  return `05${rint(30, 55)} ${rint(100, 999)} ${String(rint(0, 99)).padStart(2, '0')} ${String(rint(0, 99)).padStart(2, '0')}`;
}
function dateStr(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, lastDay));
  return dt.toISOString().slice(0, 10);
}

function gradeFee() {
  return rint(210, 260) * 1000; // lise eğitim ücreti bandı
}

console.time('seed');

// ---- Kampüsler ----
const CAMPUSES = [
  { code: 'MRK', name: 'İkitelli OSB', district: 'Başakşehir' },
  { code: 'IST', name: 'İstanbul OSB', district: 'Başakşehir' },
  { code: 'ESN', name: 'Esenyurt', district: 'Esenyurt' },
  { code: 'KRC', name: 'Kıraç', district: 'Esenyurt' },
  { code: 'CRL', name: 'Çorlu', district: 'Çorlu / Tekirdağ' },
];
const insCampus = db.prepare(
  'INSERT INTO campuses (code, name, address, phone, manager_name) VALUES (?, ?, ?, ?, ?)');
const campusIds = [];
for (const c of CAMPUSES) {
  const mgr = `${pick(MALE_NAMES.concat(FEMALE_NAMES))} ${pick(SURNAMES)}`;
  const info = insCampus.run(c.code, c.name, `${c.district}, İstanbul`, fakePhone(), mgr);
  campusIds.push({ id: Number(info.lastInsertRowid), ...c, manager: mgr });
}

// ---- Kullanıcılar ----
const HASH = bcrypt.hashSync('123456', 10);
const insUser = db.prepare(
  'INSERT INTO users (username, password_hash, full_name, role, campus_id) VALUES (?, ?, ?, ?, ?)');
insUser.run('genelmudur', HASH, 'Genel Merkez Yöneticisi', 'GENEL_MERKEZ', null);
const campusUserIds = {};
for (const c of campusIds) {
  const lower = c.code.toLowerCase();
  const mid = insUser.run(`${lower}.mudur`, HASH, `${c.manager}`, 'KAMPUS_MUDURU', c.id).lastInsertRowid;
  const kid = insUser.run(`${lower}.kayit`, HASH, `${pick(FEMALE_NAMES)} ${pick(SURNAMES)}`, 'KAYIT_PERSONELI', c.id).lastInsertRowid;
  const aid = insUser.run(`${lower}.muhasebe`, HASH, `${pick(MALE_NAMES)} ${pick(SURNAMES)}`, 'MUHASEBE', c.id).lastInsertRowid;
  campusUserIds[c.id] = [Number(mid), Number(kid), Number(aid)];
}

// ---- Öğretim yılları ----
const insYear = db.prepare(
  'INSERT INTO academic_years (name, start_date, end_date, active) VALUES (?, ?, ?, ?)');
const YEAR_2025 = Number(insYear.run('2025-2026', '2025-09-08', '2026-06-19', 0).lastInsertRowid);
const YEAR_2026 = Number(insYear.run('2026-2027', '2026-09-07', '2027-06-18', 1).lastInsertRowid);

// ---- Bölümler ve şube planları ----
const insDept = db.prepare('INSERT INTO departments (campus_id, name) VALUES (?, ?)');
const insPlan = db.prepare(
  'INSERT INTO section_plans (campus_id, academic_year_id, department_id, grade, section_count) VALUES (?, ?, ?, ?, ?)');
const campusDepts = {}; // campus_id -> [deptId...]
for (const c of campusIds) {
  campusDepts[c.id] = [];
  for (const name of DEPARTMENTS) {
    const deptId = Number(insDept.run(c.id, name).lastInsertRowid);
    campusDepts[c.id].push(deptId);
    for (const yearId of [YEAR_2025, YEAR_2026]) {
      for (const g of GRADES) insPlan.run(c.id, yearId, deptId, g, SECTIONS.length);
    }
  }
}

// ---- MEB ilan listeleri (kampüs + yıl bazında liste fiyatları ve indirim sınırları) ----
const feeItems = db.prepare('SELECT id, name FROM fee_items ORDER BY sort_order, id').all();
const BASE_PRICES = {
  'Eğitim Ücreti': 180000, 'Kıyafet Ücreti': 14000, 'Yemek Ücreti': 38000,
  'Kırtasiye Ücreti': 6500, 'Kitap Ücreti': 9500, 'Servis Ücreti': 32000,
};
const insPrice = db.prepare(
  'INSERT INTO campus_prices (campus_id, academic_year_id, fee_item_id, price) VALUES (?, ?, ?, ?)');
const insLimit = db.prepare(
  'INSERT INTO campus_discount_limits (campus_id, academic_year_id, max_discount_rate, max_discount_amount) VALUES (?, ?, ?, ?)');
for (const c of campusIds) {
  for (const [yearId, factor] of [[YEAR_2025, 1], [YEAR_2026, 1.35]]) {
    for (const fi of feeItems) {
      const base = BASE_PRICES[fi.name] || 10000;
      insPrice.run(c.id, yearId, fi.id, Math.round(base * factor * (0.95 + rnd() * 0.1) / 100) * 100);
    }
    insLimit.run(c.id, yearId, 25, 100000);
  }
}

// ---- Öğrenciler + kayıtlar + taksitler + tahsilatlar ----
const insStudent = db.prepare(`
  INSERT INTO students (student_no, tc_no, first_name, last_name, birth_date, birth_place, gender,
    blood_type, campus_id, department_id, grade, section, address, city, district, status, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insParent = db.prepare(`
  INSERT INTO parents (student_id, relation, full_name, tc_no, phone, email, occupation, workplace, address, is_primary)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insEnrollment = db.prepare(`
  INSERT INTO enrollments (student_id, academic_year_id, campus_id, enrollment_date, enrollment_type,
    grade, department_id, section, list_fee, discount_rate, discount_amount, discount_reason, net_fee, down_payment,
    installment_count, default_payment_method, payer_name, payer_phone, status, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insInstallment = db.prepare(`
  INSERT INTO installments (enrollment_id, seq_no, label, due_date, amount, paid_amount, status)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const insPayment = db.prepare(`
  INSERT INTO payments (enrollment_id, installment_id, payment_date, amount, method, receipt_no, received_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);

const DISCOUNT_REASONS = ['', '', '', 'Kardeş indirimi', 'Erken kayıt indirimi', 'Personel indirimi', 'Başarı bursu', 'Kurumsal anlaşma'];
const TODAY = '2026-07-15' <= new Date().toISOString().slice(0, 10)
  ? new Date().toISOString().slice(0, 10)
  : '2026-07-15';

let receiptSeq = 0;
function nextReceipt(code) {
  receiptSeq++;
  return `${code}-${String(receiptSeq).padStart(7, '0')}`;
}

/**
 * Bir kayıt için taksit planı üretir, geçmiş vadeleri ödenmiş/gecikmiş olarak işaretler.
 * payBehavior: 0 => tümü ödendi, 1 => son 1-2 taksit gecikmiş, 2 => düzensiz ödeyen
 */
function createEnrollment(studentId, campus, yearId, grade, deptId, section, enrollDate, type, firstDue, count, payBehavior, userIds, parentName, parentPhone) {
  const listFee = gradeFee(grade);
  const discountRate = pick([0, 0, 0, 5, 10, 10, 15, 20, 25]);
  const discountAmount = money(listFee * discountRate / 100);
  const netFee = money(listFee - discountAmount);
  const downPayment = money(Math.round(netFee * pick([0.1, 0.15, 0.2]) / 1000) * 1000);
  const method = pick(METHODS);
  const reason = discountRate > 0 ? pick(DISCOUNT_REASONS.slice(3)) : '';

  const eid = Number(insEnrollment.run(studentId, yearId, campus.id, enrollDate, type, String(grade),
    deptId, section, listFee, discountRate, discountAmount, reason, netFee, downPayment, count, method,
    parentName, parentPhone, 'AKTIF', userIds[1]).lastInsertRowid);

  const remaining = money(netFee - downPayment);
  const base = Math.floor((remaining / count) * 100) / 100;
  const rows = [{ seq: 0, label: 'Peşinat', due: enrollDate, amount: downPayment }];
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    const amount = i === count - 1 ? money(remaining - allocated) : base;
    allocated = money(allocated + amount);
    rows.push({ seq: i + 1, label: `${i + 1}. Taksit`, due: addMonths(firstDue, i), amount });
  }

  let fullyPaid = true;
  for (const r of rows) {
    let paid = 0;
    if (r.due <= TODAY) {
      if (payBehavior === 0) paid = r.amount;
      else if (payBehavior === 1) paid = r.due < addMonths(TODAY, -2) ? r.amount : (rnd() < 0.4 ? money(r.amount * 0.5) : 0);
      else paid = rnd() < 0.55 ? r.amount : (rnd() < 0.3 ? money(r.amount * pick([0.25, 0.5])) : 0);
    } else if (r.seq === 0) {
      paid = r.amount; // peşinat her zaman kayıt anında alınır
    }
    paid = money(Math.min(paid, r.amount));
    const status = paid <= 0 ? 'BEKLIYOR' : paid >= r.amount ? 'ODENDI' : 'KISMI';
    if (status !== 'ODENDI') fullyPaid = false;
    const iid = Number(insInstallment.run(eid, r.seq, r.label, r.due, r.amount, paid, status).lastInsertRowid);
    if (paid > 0) {
      const payDate = r.due <= TODAY ? r.due : enrollDate;
      insPayment.run(eid, iid, payDate, paid, r.seq === 0 ? pick(['NAKIT', 'KREDI_KARTI', 'HAVALE_EFT']) : method,
        nextReceipt(campus.code), pick(userIds));
    }
  }
  if (fullyPaid) db.prepare(`UPDATE enrollments SET status = 'TAMAMLANDI' WHERE id = ?`).run(eid);
  return eid;
}

// Şube atama sayaçları: aynı (yıl, bölüm, sınıf) içinde şubeler 30'ar 30'ar dolar
const sectionCounters = {};
function assignSection(campusId, yearId, deptId, grade) {
  const key = `${campusId}|${yearId}|${deptId}|${grade}`;
  const idx = sectionCounters[key] || 0;
  sectionCounters[key] = idx + 1;
  return SECTIONS[Math.min(Math.floor(idx / 30), SECTIONS.length - 1)];
}

const seedAll = db.transaction(() => {
  const perCampus = Math.floor(STUDENT_COUNT / campusIds.length);
  const currentCount = Math.floor(perCampus * 0.80);   // aktif + bu yıl kayıtlı
  const nonRenewCount = Math.floor(perCampus * 0.133); // kayıt yenilemeyen
  let counter = 0;
  for (const campus of CAMPUSES.map((c, i) => campusIds[i])) {
    const userIds = campusUserIds[campus.id];
    const depts = campusDepts[campus.id];
    for (let n = 0; n < perCampus; n++) {
      counter++;
      const gender = rnd() < 0.5 ? 'ERKEK' : 'KIZ';
      const first = gender === 'ERKEK' ? pick(MALE_NAMES) : pick(FEMALE_NAMES);
      const last = pick(SURNAMES);
      const deptId = depts[n % depts.length];

      // Kategori ve sınıf ataması
      let category, grade;
      if (n < currentCount) {
        category = 'current';
        grade = GRADES[Math.floor(n / depts.length) % GRADES.length]; // 9-12 dengeli
      } else if (n < currentCount + nonRenewCount) {
        category = 'nonrenew';
        grade = GRADES[n % 3]; // geçen yıl 9-11 okuyordu, yenilemedi
      } else {
        category = 'graduate';
        grade = '12'; // geçen yıl mezun oldu
      }
      const gradeNum = Number(grade);
      const birthYear = 2026 - (6 + gradeNum + rint(0, 1));
      const district = pick(DISTRICTS);
      const studentNo = `${campus.code}-2025-${String(n + 1).padStart(5, '0')}`;

      // Öğrenci kartındaki güncel yerleşim
      let studentGrade, studentSection, status;
      if (category === 'current') {
        studentGrade = grade;
        studentSection = assignSection(campus.id, YEAR_2026, deptId, grade);
        status = 'AKTIF';
      } else if (category === 'nonrenew') {
        studentGrade = grade; // son bilinen sınıfı (geçen yıl)
        studentSection = assignSection(campus.id, YEAR_2025, deptId, grade);
        status = 'AKTIF'; // yenilemedi ama kaydı silinmedi -> raporda görünür
      } else {
        studentGrade = '12';
        studentSection = assignSection(campus.id, YEAR_2025, deptId, '12');
        status = 'MEZUN';
      }

      const sid = Number(insStudent.run(studentNo, fakeTc(), first, last,
        dateStr(birthYear, rint(1, 12), rint(1, 28)), 'İstanbul', gender,
        pick(['A Rh+', 'A Rh-', 'B Rh+', '0 Rh+', '0 Rh-', 'AB Rh+', '']),
        campus.id, deptId, studentGrade, studentSection,
        `${district} Mah. ${rint(1, 99)}. Sok. No:${rint(1, 60)}`, 'İstanbul', district,
        status, userIds[1]).lastInsertRowid);

      const motherName = `${pick(FEMALE_NAMES)} ${last}`;
      const fatherName = `${pick(MALE_NAMES)} ${last}`;
      const primaryIsMother = rnd() < 0.45;
      const motherPhone = fakePhone();
      const fatherPhone = fakePhone();
      insParent.run(sid, 'ANNE', motherName, fakeTc(), motherPhone,
        `${first.toLowerCase()}.anne${counter}@example.com`.replace(/[çğıöşü]/g, ch => 'cgiosu'['çğıöşü'.indexOf(ch)]),
        pick(OCCUPATIONS), '', '', primaryIsMother ? 1 : 0);
      insParent.run(sid, 'BABA', fatherName, fakeTc(), fatherPhone,
        `${first.toLowerCase()}.baba${counter}@example.com`.replace(/[çğıöşü]/g, ch => 'cgiosu'['çğıöşü'.indexOf(ch)]),
        pick(OCCUPATIONS), '', '', primaryIsMother ? 0 : 1);
      const payerName = primaryIsMother ? motherName : fatherName;
      const payerPhone = primaryIsMother ? motherPhone : fatherPhone;

      // Geçmiş yıl ödeme davranışı: %78 tam, %15 gecikmeli, %7 sorunlu
      const behavior = rnd() < 0.78 ? 0 : rnd() < 0.68 ? 1 : 2;

      if (category === 'current') {
        if (gradeNum === 9) {
          // Bu yıl DIŞ KAYIT (okula yeni girdi) - geçmiş yıl kaydı yok
          createEnrollment(sid, campus, YEAR_2026, grade, deptId, studentSection,
            dateStr(2026, rint(5, 7), rint(1, 14)), 'DIS_KAYIT', dateStr(2026, 8, rint(1, 28)),
            rint(9, 10), 0, userIds, payerName, payerPhone);
        } else {
          // Geçen yıl bir alt sınıfta okudu, bu yıl İÇ KAYIT ile üst sınıfa geçti
          const prevGrade = String(gradeNum - 1);
          const prevSection = assignSection(campus.id, YEAR_2025, deptId, prevGrade);
          createEnrollment(sid, campus, YEAR_2025, prevGrade, deptId, prevSection,
            dateStr(2025, rint(5, 8), rint(1, 28)), gradeNum - 1 === 9 ? 'DIS_KAYIT' : 'IC_KAYIT',
            '2025-09-15', rint(8, 10), behavior, userIds, payerName, payerPhone);
          createEnrollment(sid, campus, YEAR_2026, grade, deptId, studentSection,
            dateStr(2026, rint(5, 7), rint(1, 14)), 'IC_KAYIT', dateStr(2026, 8, rint(1, 28)),
            rint(9, 10), 0, userIds, payerName, payerPhone);
        }
      } else {
        // Yenilemeyen (9-11) veya mezun (12): sadece geçen yıl kaydı var
        createEnrollment(sid, campus, YEAR_2025, grade, deptId, studentSection,
          dateStr(2025, rint(5, 8), rint(1, 28)), gradeNum === 9 ? 'DIS_KAYIT' : 'IC_KAYIT',
          '2025-09-15', rint(8, 10), category === 'nonrenew' ? pick([1, 2]) : behavior,
          userIds, payerName, payerPhone);
      }
    }
  }
  return counter;
});

const total = seedAll();
console.timeEnd('seed');

const stats = {
  campuses: db.prepare('SELECT COUNT(*) c FROM campuses').get().c,
  users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
  students: db.prepare('SELECT COUNT(*) c FROM students').get().c,
  enrollments: db.prepare('SELECT COUNT(*) c FROM enrollments').get().c,
  installments: db.prepare('SELECT COUNT(*) c FROM installments').get().c,
  payments: db.prepare('SELECT COUNT(*) c FROM payments').get().c,
};
console.log('Seed tamamlandı:', stats);
console.log('\nGiriş bilgileri (şifre: 123456):');
console.log('  genelmudur           -> Genel Merkez (tüm kampüsler)');
for (const c of campusIds) {
  const lower = c.code.toLowerCase();
  console.log(`  ${lower}.mudur / ${lower}.kayit / ${lower}.muhasebe  -> ${c.name}`);
}
