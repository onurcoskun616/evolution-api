/**
 * ÜRETİM kurulumu: demo verisi OLMADAN sistemi kullanıma hazırlar.
 *  - "admin" kullanıcısı (Genel Merkez) oluşturur ve tek seferlik rastgele şifre basar
 *  - Aktif öğretim yılını oluşturur
 *  - 5 kampüsü tanımlar (OKUL_KAMPUSLER ortam değişkeniyle özelleştirilebilir:
 *    "KOD1:Ad 1,KOD2:Ad 2,..." biçiminde)
 *
 * Idempotenttir: veritabanında kullanıcı varsa hiçbir şeye dokunmadan çıkar.
 * Çalıştırma: npm run setup
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./src/db');

const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (existing > 0) {
  console.log('Veritabanında kullanıcı zaten var, kurulum atlandı.');
  console.log('Sıfırdan kurulum için data/okul.db dosyasını silip tekrar çalıştırın.');
  process.exit(0);
}

// Öğretim yılı: içinde bulunulan yıla göre (Eylül başlangıçlı)
const now = new Date();
const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
const yearName = `${startYear}-${startYear + 1}`;

// Kampüsler
const campusSpec = process.env.OKUL_KAMPUSLER ||
  'MRK:Merkez Kampüs,AND:Anadolu Kampüsü,AVR:Avrupa Kampüsü,GOL:Göl Kampüsü,SHL:Sahil Kampüsü';
const campuses = campusSpec.split(',').map(s => {
  const [code, ...name] = s.split(':');
  return { code: code.trim().toUpperCase(), name: name.join(':').trim() };
}).filter(c => c.code && c.name);

const adminPassword = process.env.OKUL_ADMIN_SIFRE || crypto.randomBytes(9).toString('base64url');

db.transaction(() => {
  db.prepare('INSERT INTO academic_years (name, start_date, end_date, active) VALUES (?, ?, ?, 1)')
    .run(yearName, `${startYear}-09-01`, `${startYear + 1}-06-30`);
  const ins = db.prepare('INSERT INTO campuses (code, name) VALUES (?, ?)');
  for (const c of campuses) ins.run(c.code, c.name);
  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, campus_id)
    VALUES ('admin', ?, 'Sistem Yöneticisi', 'GENEL_MERKEZ', NULL)`)
    .run(bcrypt.hashSync(adminPassword, 10));
})();

console.log('Kurulum tamamlandı.');
console.log(`  Öğretim yılı : ${yearName} (aktif)`);
console.log(`  Kampüsler    : ${campuses.map(c => c.name).join(', ')}`);
console.log('');
console.log('  Yönetici girişi:');
console.log('    Kullanıcı adı : admin');
console.log(`    Şifre         : ${adminPassword}`);
console.log('');
console.log('  Bu şifreyi güvenli bir yere kaydedin; bir daha gösterilmeyecek.');
console.log('  Giriş yaptıktan sonra "Şifre" düğmesinden değiştirmeniz önerilir.');
