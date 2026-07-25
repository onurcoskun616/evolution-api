# Kendi Sunucuna Kurulum (Kalıcı) — CRM + QR ile Aynı Makinede

Bu rehber, Okul Kayıt Sistemi'ni **CRM ve QR takip yazılımının kurulu olduğu**
sunucuya, onlarla çakışmadan, **kalıcı** (veri sıfırlanmayan) biçimde kurmak içindir.
Teknik adımları Cem (ya da sunucu yöneticisi) uygulayabilir.

Yazılım: **Node.js + SQLite**. Ayrı bir veritabanı sunucusu (MySQL/Postgres) gerektirmez;
tüm veri tek bir kalıcı dosyada (`/data/okul.db`) tutulur. En temiz kurulum **Docker** iledir.

---

## Özet karar listesi (Cem için)

1. **Erişim adresi:** Bir alt alan adı önerilir → `okul.topkapiokullari.com`
   (CRM ile aynı sunucudaki mevcut web sunucusu/ters vekil üzerinden yönlendirilir).
2. **İç port:** Uygulama yalnız `127.0.0.1:8090` dinler (dışarı açık değil); web sunucusu
   bu porta proxy yapar. 8090 doluysa boş bir port seçin.
3. **HTTPS:** Mevcut CRM sertifika altyapısıyla (nginx/apache + certbot, ya da Caddy) sağlanır.
4. **Yedekleme:** Günlük otomatik yedek cron'u (aşağıda).

---

## 1) Docker ile kurulum (önerilen)

```bash
# Sunucuda, uygulamayı koyacağınız dizinde:
git clone <repo-url> okul
cd okul/okul-kayit-sistemi

# Rastgele JWT anahtarı + iç port için .env oluştur (deploy.sh bunu da yapar):
cat > .env <<EOF
OKUL_JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '=+/' | head -c 48)
PORT=3000
# Kampüsleri kendi kodlarınızla tanımlayın (kod:ad, virgülle):
OKUL_KAMPUSLER=MRK:İkitelli OSB,IST:İstanbul OSB,ESN:Esenyurt,KRC:Kıraç,CRL:Çorlu
EOF
chmod 600 .env

docker compose up -d --build
```

**Çakışmayı önlemek için** `docker-compose.yml`'de port satırını yalnız yerele bağlayın
(CRM/QR 80-443'ü kullanıyorsa dokunmayın):

```yaml
    ports:
      - "127.0.0.1:8090:3000"   # yalnız sunucu içinden erişilir; dışarıya ters vekil açar
```

İlk açılışta yönetici şifresi loglara **bir kez** basılır — kaydedin:

```bash
docker logs okul-kayit-sistemi | sed -n '/Kurulum tamamlandı/,/önerilir/p'
# Kullanıcı adı: admin  ·  Şifre: (üretilen)
```

Veri, Docker kalıcı biriminde (`okul-data` → `/data`) durur; **konteyner yeniden başlasa
da/güncellense de silinmez.** `restart: unless-stopped` ile sunucu açılışında otomatik kalkar.

### Docker'sız alternatif (bare Node + PM2)
```bash
cd okul/okul-kayit-sistemi
npm ci --omit=dev
export OKUL_JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '=+/' | head -c 48)"
export OKUL_DATA_DIR=/var/lib/okul-kayit          # kalıcı dizin
export NODE_ENV=production PORT=8090
node setup.js                                     # yönetici + kampüsler (bir kez)
npm i -g pm2 && pm2 start server.js --name okul && pm2 save && pm2 startup
```

---

## 2) Ters vekil (reverse proxy) + HTTPS

Uygulama 8090'da; dışarıya `okul.topkapiokullari.com` adıyla açılır. DNS'te bu alt alan adını
sunucunun IP'sine yönlendirin.

**nginx** (CRM zaten nginx kullanıyorsa) — `/etc/nginx/sites-available/okul`:
```nginx
server {
    server_name okul.topkapiokullari.com;
    client_max_body_size 20m;                # Excel yüklemeleri için
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/okul /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d okul.topkapiokullari.com     # ücretsiz HTTPS
```

**Caddy** (otomatik HTTPS) — `Caddyfile`'a ekleyin:
```
okul.topkapiokullari.com {
    reverse_proxy 127.0.0.1:8090
}
```

**Apache** kullanıyorsanız: `ProxyPass / http://127.0.0.1:8090/` + `mod_proxy` + certbot.

---

## 3) Günlük otomatik yedekleme

Veri tek dosyada olsa da, kaza/silme/bozulmaya karşı günlük yedek önerilir.

```bash
# Docker kurulumunda — /etc/cron.d/okul-yedek:
0 2 * * * root docker exec okul-kayit-sistemi node backup.js >> /var/log/okul-yedek.log 2>&1
```
```bash
# Bare kurulumda (crontab -e):
0 2 * * * OKUL_DATA_DIR=/var/lib/okul-kayit node /path/okul-kayit-sistemi/backup.js
```
Yedekler `<veri-dizini>/backups/okul-YYYY-MM-DD-HH-MM-SS.db` olarak yazılır; 30 günden
eskiler otomatik silinir (`OKUL_BACKUP_KEEP_DAYS` ile değiştirilebilir). Bu klasörü
haftalık olarak sunucu dışına (başka disk/bulut) da kopyalamanızı öneririz.

Uygulama içinden anlık yedek: Genel Merkez hesabıyla `GET /api/backup` tutarlı bir `.db` indirir.

---

## 4) CRM entegrasyonunu yeni adrese göre güncelle

Adres `onrender.com`'dan `okul.topkapiokullari.com`'a taşınınca:

1. **CRM tarafında (Cem):** her kampüs için **"Okul Sistemi URL"** =
   `https://okul.topkapiokullari.com` yapın (sonuna `/api/...` **eklemeden**).
2. **Okul sisteminde (Parametreler > CRM Entegrasyonu):**
   - **CRM Taban Adresi** = CRM'in adresi (örn. `https://crm.topkapiokullari.com`).
   - Her kampüs için **CRM API Anahtarı**'nı girin (CRM'in verdiği, `okl_` ile başlamayan) + **Aktif**.
   - Her kampüs için **Okul API Anahtarı Üret** → çıkan `okl_...` anahtarını CRM'e verin.
   - **Bağlantıyı Test Et** ile doğrulayın (✅ HTTP 200 / "adaylar").

> Not: Yeni sunucuda veritabanı sıfırdan başlar; eski anahtarlar taşınmaz. Anahtarları
> yukarıdaki gibi yeniden tanımlayın. (Render ücretsizde veri kalıcı olmadığından taşınacak
> gerçek veri genelde yoktur.)

### Mevcut veriyi taşımak isterseniz
Eski kurulumda gerçek veri varsa: eski sistemde `GET /api/backup` ile `.db` indirin →
yeni sunucuda uygulamayı **ilk kez başlatmadan önce** bu dosyayı kalıcı dizine `okul.db`
olarak koyun (Docker: `docker cp okul.db okul-kayit-sistemi:/data/okul.db`, sonra
`docker compose restart`). Kullanıcı zaten varsa `setup.js` hiçbir şeyi bozmaz.

---

## 5) Güncelleme
```bash
cd okul && git pull
cd okul-kayit-sistemi && docker compose up -d --build   # veri korunur
# Bare: git pull && npm ci --omit=dev && pm2 restart okul
```

## Sık sorulanlar
- **CRM/QR ile çakışır mı?** Hayır — ayrı port (8090) + ayrı alt alan adı; veri kendi dosyasında.
  Aynı 80/443'ü mevcut web sunucusu paylaştırır.
- **Kaç kullanıcı?** SQLite WAL modunda 40-50 eşzamanlı kullanıcı rahatça desteklenir.
- **Sunucu yeniden başlarsa?** Docker `restart: unless-stopped` / PM2 `startup` ile otomatik kalkar; veri kalıcıdır.
