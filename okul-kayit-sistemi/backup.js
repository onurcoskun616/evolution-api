/**
 * Tutarlı veritabanı yedeği alır (WAL dahil online backup) ve eski yedekleri temizler.
 * Kalıcı sunucuda günlük cron ile çalıştırılması önerilir.
 *
 * Çalıştırma:
 *   node backup.js                       (yerel/bare kurulum)
 *   docker exec okul-kayit-sistemi node backup.js   (Docker kurulumu)
 *
 * Ayarlar:
 *   OKUL_DATA_DIR         : veri dizini (yedekler <dizin>/backups/ altına yazılır)
 *   OKUL_BACKUP_KEEP_DAYS : kaç günlük yedek tutulsun (varsayılan 30)
 */
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./src/db');

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const file = path.join(dir, `okul-${stamp}.db`);

db.backup(file)
  .then(() => {
    console.log('Yedek alındı:', file);
    const keepDays = parseInt(process.env.OKUL_BACKUP_KEEP_DAYS || '30', 10);
    const cutoff = Date.now() - keepDays * 86400000;
    let removed = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!/^okul-.*\.db$/.test(f)) continue;
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); removed++; }
    }
    if (removed) console.log(`${removed} eski yedek silindi (>${keepDays} gün).`);
    process.exit(0);
  })
  .catch((e) => { console.error('Yedek hatası:', e.message); process.exit(1); });
