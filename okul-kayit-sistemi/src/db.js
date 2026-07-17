/**
 * Veritabanı katmanı - SQLite (better-sqlite3)
 * WAL modu ile 40-50 eşzamanlı kullanıcı rahatlıkla desteklenir.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.OKUL_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'okul.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
CREATE TABLE IF NOT EXISTS campuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  manager_name TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('GENEL_MERKEZ','KAMPUS_MUDURU','KAYIT_PERSONELI','MUHASEBE','RAPOR')),
  campus_id INTEGER REFERENCES campuses(id),
  extra_permissions TEXT NOT NULL DEFAULT '[]',
  revoked_permissions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_no TEXT NOT NULL UNIQUE,
  tc_no TEXT DEFAULT '',
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT DEFAULT '',
  birth_place TEXT DEFAULT '',
  gender TEXT DEFAULT '' CHECK (gender IN ('','ERKEK','KIZ')),
  blood_type TEXT DEFAULT '',
  nationality TEXT DEFAULT 'T.C.',
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  grade TEXT NOT NULL DEFAULT '',
  section TEXT DEFAULT '',
  previous_school TEXT DEFAULT '',
  health_notes TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  district TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'AKTIF' CHECK (status IN ('AKTIF','PASIF','MEZUN','KAYIT_SILDI','ADAY')),
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_students_campus ON students(campus_id);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN ('ANNE','BABA','VASI','DIGER')),
  full_name TEXT NOT NULL,
  tc_no TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  phone2 TEXT DEFAULT '',
  email TEXT DEFAULT '',
  occupation TEXT DEFAULT '',
  workplace TEXT DEFAULT '',
  education TEXT DEFAULT '',
  address TEXT DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_parents_student ON parents(student_id);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  enrollment_date TEXT NOT NULL,
  enrollment_type TEXT NOT NULL DEFAULT 'DIS_KAYIT' CHECK (enrollment_type IN ('DIS_KAYIT','IC_KAYIT','NAKIL')),
  grade TEXT NOT NULL DEFAULT '',
  list_fee REAL NOT NULL DEFAULT 0,
  discount_rate REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_reason TEXT DEFAULT '',
  net_fee REAL NOT NULL DEFAULT 0,
  down_payment REAL NOT NULL DEFAULT 0,
  installment_count INTEGER NOT NULL DEFAULT 0,
  default_payment_method TEXT NOT NULL DEFAULT 'NAKIT',
  payer_name TEXT DEFAULT '',
  payer_tc TEXT DEFAULT '',
  payer_phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'AKTIF' CHECK (status IN ('AKTIF','IPTAL','DONDURULDU','TAMAMLANDI')),
  cancel_reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(student_id, academic_year_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_campus_year ON enrollments(campus_id, academic_year_id);

CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  seq_no INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'BEKLIYOR' CHECK (status IN ('BEKLIYOR','KISMI','ODENDI','IPTAL')),
  UNIQUE(enrollment_id, seq_no)
);
CREATE INDEX IF NOT EXISTS idx_installments_enrollment ON installments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_installments_due ON installments(due_date, status);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  installment_id INTEGER REFERENCES installments(id),
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('NAKIT','KREDI_KARTI','KMH','SENET','HAVALE_EFT','CEK','MAIL_ORDER')),
  receipt_no TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  cancelled INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT DEFAULT '',
  cancelled_by INTEGER REFERENCES users(id),
  cancelled_at TEXT,
  received_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_enrollment ON payments(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- MEB ücret ilanı: kalem kataloğu
CREATE TABLE IF NOT EXISTS fee_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Kampüs + öğretim yılı bazında ilan edilen liste fiyatları
-- max_discount_*: o kaleme uygulanabilecek azami indirim (NULL = kampüs geneli sınır geçerli)
CREATE TABLE IF NOT EXISTS campus_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  fee_item_id INTEGER NOT NULL REFERENCES fee_items(id),
  price REAL NOT NULL DEFAULT 0,
  max_discount_rate REAL,
  max_discount_amount REAL,
  UNIQUE(campus_id, academic_year_id, fee_item_id)
);

-- Bölümler (meslek alanları) - kampüs bazında tanımlanır
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(campus_id, name)
);

-- Şube planı: kampüs + yıl + bölüm + sınıf kademesi için kaç şube açılacağı
CREATE TABLE IF NOT EXISTS section_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  grade TEXT NOT NULL,
  section_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(campus_id, academic_year_id, department_id, grade)
);

-- Kampüs bazında izin verilen azami indirim (NULL = sınırsız)
CREATE TABLE IF NOT EXISTS campus_discount_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campus_id INTEGER NOT NULL REFERENCES campuses(id),
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id),
  max_discount_rate REAL,
  max_discount_amount REAL,
  UNIQUE(campus_id, academic_year_id)
);

-- Kayıt sözleşmesindeki ücret kalemleri (ilan fiyatının anlık kopyası + kalem bazlı indirim)
CREATE TABLE IF NOT EXISTS enrollment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  fee_item_id INTEGER REFERENCES fee_items(id),
  name TEXT NOT NULL,
  unit_price REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  total REAL NOT NULL,
  discount_rate REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  net_total REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_enrollment_items ON enrollment_items(enrollment_id);
`);

// Eski veritabanları için kolon geçişi (kalem bazlı indirim alanları)
const eiCols = db.prepare('PRAGMA table_info(enrollment_items)').all().map(c => c.name);
if (!eiCols.includes('discount_rate')) {
  db.exec(`
    ALTER TABLE enrollment_items ADD COLUMN discount_rate REAL NOT NULL DEFAULT 0;
    ALTER TABLE enrollment_items ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;
    ALTER TABLE enrollment_items ADD COLUMN net_total REAL NOT NULL DEFAULT 0;
    UPDATE enrollment_items SET net_total = total;
  `);
}

// Kalem bazlı indirim sınırı geçişi
const cpCols = db.prepare('PRAGMA table_info(campus_prices)').all().map(c => c.name);
if (!cpCols.includes('max_discount_rate')) {
  db.exec(`
    ALTER TABLE campus_prices ADD COLUMN max_discount_rate REAL;
    ALTER TABLE campus_prices ADD COLUMN max_discount_amount REAL;
  `);
}

// Bölüm/şube geçişi: öğrenci ve kayıtlara bölüm + şube alanları
const stCols = db.prepare('PRAGMA table_info(students)').all().map(c => c.name);
if (!stCols.includes('department_id')) {
  db.exec('ALTER TABLE students ADD COLUMN department_id INTEGER REFERENCES departments(id)');
}
const enCols = db.prepare('PRAGMA table_info(enrollments)').all().map(c => c.name);
if (!enCols.includes('department_id')) {
  db.exec(`
    ALTER TABLE enrollments ADD COLUMN department_id INTEGER REFERENCES departments(id);
    ALTER TABLE enrollments ADD COLUMN section TEXT NOT NULL DEFAULT '';
  `);
}

// Evrak takibi ve önceki okul kataloğu tabloları
db.exec(`
CREATE TABLE IF NOT EXISTS document_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS student_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id),
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_by INTEGER REFERENCES users(id),
  UNIQUE(student_id, document_type_id)
);
CREATE INDEX IF NOT EXISTS idx_student_documents ON student_documents(student_id);

CREATE TABLE IF NOT EXISTS neighborhoods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(city, district, name)
);
CREATE INDEX IF NOT EXISTS idx_neighborhoods ON neighborhoods(city, district);

CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  district TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'ORTAOKUL' CHECK (type IN ('ORTAOKUL','LISE')),
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(city, district, name)
);
CREATE INDEX IF NOT EXISTS idx_schools_city ON schools(city, district);
`);

// Öğrenciye önceki okul referansı ve mahalle alanı
const stCols2 = db.prepare('PRAGMA table_info(students)').all().map(c => c.name);
if (!stCols2.includes('previous_school_id')) {
  db.exec('ALTER TABLE students ADD COLUMN previous_school_id INTEGER REFERENCES schools(id)');
}
if (!stCols2.includes('neighborhood')) {
  db.exec("ALTER TABLE students ADD COLUMN neighborhood TEXT NOT NULL DEFAULT ''");
}

// Varsayılan evrak türleri (boş katalogda bir kez eklenir)
const DEFAULT_DOCUMENT_TYPES = ['Fotoğraf', 'İkametgah Belgesi', 'Nüfus Cüzdanı Fotokopisi',
  'Öğrenci Belgesi', 'Sağlık Belgesi', 'Tasdikname', 'Veli Nüfus Cüzdanı Fotokopisi'];
if (db.prepare('SELECT COUNT(*) AS c FROM document_types').get().c === 0) {
  const insDoc = db.prepare('INSERT INTO document_types (name, sort_order) VALUES (?, ?)');
  DEFAULT_DOCUMENT_TYPES.forEach((name, i) => insDoc.run(name, i));
}

// Varsayılan ücret kalemleri (boş katalogda bir kez eklenir)
const DEFAULT_FEE_ITEMS = ['Eğitim Ücreti', 'Kıyafet Ücreti', 'Yemek Ücreti',
  'Kırtasiye Ücreti', 'Kitap Ücreti', 'Servis Ücreti'];
if (db.prepare('SELECT COUNT(*) AS c FROM fee_items').get().c === 0) {
  const ins = db.prepare('INSERT INTO fee_items (name, sort_order) VALUES (?, ?)');
  DEFAULT_FEE_ITEMS.forEach((name, i) => ins.run(name, i));
}

/** Para tutarlarını 2 ondalığa yuvarlar (kuruş hassasiyeti). */
function money(x) {
  return Math.round((Number(x) || 0) * 100) / 100;
}

/** Bugünün tarihi YYYY-MM-DD. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Denetim kaydı ekler. */
const auditStmt = db.prepare(
  `INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)`
);
function audit(userId, action, entity, entityId, detail) {
  auditStmt.run(userId || null, action, entity, entityId || null, detail || '');
}

module.exports = { db, money, today, audit, DATA_DIR };
