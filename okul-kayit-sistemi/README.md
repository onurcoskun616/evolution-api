# 🎓 Okul Kayıt ve Tahsilat Takip Sistemi

Çok kampüslü okullar için eksiksiz **öğrenci kayıt, taksit ve tahsilat takip** yazılımı.
5 kampüs, ~15.000 öğrenci ve 40-50 eşzamanlı kullanıcı için tasarlanmış ve test edilmiştir.

## Özellikler

### 🏫 Çok Kampüslü Yapı ve Yetkilendirme
- **Genel Merkez**: Tüm kampüsleri görür, karşılaştırır ve her kampüste işlem yapabilir.
- **Kampüs Müdürü**: Kendi kampüsünde her şeyi görür; kampüs personelini ve yetkilerini yönetir.
- **Kayıt Personeli**: Öğrenci/kayıt oluşturur, tahsilat alır (iptal yetkisi yoktur).
- **Muhasebe**: Tahsilat alır/iptal eder, taksit düzenler, rapor indirir.
- **Rapor (salt okunur)**: Yalnızca görüntüleme ve Excel indirme.
- Rol varsayılanlarının üzerine **kullanıcı bazında izin ekleme/kısıtlama** (18 ayrı izin).
- Tüm kritik işlemler **denetim kaydına (audit log)** yazılır.

### 🧑‍🎓 Öğrenci Kayıt
- Tam öğrenci dosyası: TC kimlik, doğum bilgileri, kan grubu, sınıf/şube, önceki okul,
  sağlık notları, adres, durum (Aktif / Aday / Pasif / Mezun / Kayıt Sildi).
- Sınırsız **veli/vasi kaydı**: yakınlık, telefon(lar), e-posta, meslek, iş yeri, birincil iletişim.
- Otomatik öğrenci numarası (`MRK-2026-00001`), TC mükerrer kontrolü.
- Ad, numara, TC, **veli adı/telefonuyla** arama; kampüs/sınıf/durum filtreleri.

### 💰 Ücret, Taksit ve Tahsilat
- Kayıt başına: liste ücreti, **indirim (oran/tutar + gerekçe)**, net ücret, peşinat,
  1-24 arası taksitlendirme, ilk vade tarihi seçimi.
- Kuruş güvenli taksit planı (taksitler toplamı her zaman net ücrete eşittir) ve **plan önizleme**.
- Ödeme türleri: **Nakit, Kredi Kartı, KMH, Senet, Havale/EFT, Çek, Mail Order**.
- Taksite veya genel bakiyeye tahsilat, **kısmi ödeme**, makbuz no, tahsil eden kaydı.
- Tahsilat **iptali** (taksit bakiyesi otomatik geri açılır), kayıt iptali, taksit vade/tutar düzenleme.
- Fazla ödeme engeli: tutar taksit kalanını veya kayıt bakiyesini aşamaz.

### 📅 Veli Taksit Takibi
- **Vadesi geçen** (gecikme gün sayısıyla), **30 gün içinde vadesi gelen**, **gelecek** taksitler.
- Veli adı ve telefonuyla birlikte liste → arama/hatırlatma için hazır.
- Tek tıkla "Tahsil Et".

### 📊 Raporlama ve Excel
Tüm raporlar ekranda önizlenir ve **biçimli .xlsx** olarak indirilir (başlık rengi, otomatik filtre,
dondurulmuş satır, ₺ para biçimi, toplam satırı):
1. Öğrenci Listesi (veli iletişimleriyle)
2. Kayıt / Sözleşme Listesi (ücret, indirim, tahsilat, bakiye)
3. Tahsilat Listesi (tarih aralığı filtreli)
4. Vadesi Geçen Taksitler
5. Yaklaşan Taksitler (30 gün)
6. Kampüs Özet Raporu (ciro, tahsilat oranı, gecikme)
7. Ödeme Türü Dağılımı

### 📈 Genel Bakış Paneli
Aktif öğrenci, kayıt, ciro, tahsilat oranı, kalan bakiye, geciken tutar, bugünkü tahsilat,
kampüs karşılaştırma tablosu, son 12 ay tahsilat grafiği, ödeme türü dağılımı.
Genel merkez kampüs ve öğretim yılı bazında filtreleyebilir.

## Kurulum ve Çalıştırma (geliştirme / demo)

```bash
cd okul-kayit-sistemi
npm install          # bağımlılıkları kurar
npm run seed         # 5 kampüs + 15.000 öğrencilik demo verisini oluşturur (DİKKAT: veritabanını sıfırlar)
npm start            # http://localhost:3000
```

## 🚀 Canlıya Alma (üretim)

Bir Linux sunucuda (VPS — ör. Hetzner, DigitalOcean, Turhost, Natro; 2 GB RAM yeterli)
tek komutla kurulum:

```bash
git clone <repo-url> && cd <repo>/okul-kayit-sistemi
sudo bash deploy.sh
```

Betik sırasıyla: Docker'ı kurar → rastgele `OKUL_JWT_SECRET` ile `.env` oluşturur →
uygulamayı derleyip başlatır → **tek seferlik admin şifresini** ekrana basar.
Üretim kurulumu (`setup.js`) demo verisi içermez; boş sistemle başlar,
kampüsler ve öğretim yılı hazır gelir, kullanıcıları siz eklersiniz.

- Veritabanı `okul-data` Docker volume'ünde kalıcıdır; konteyner güncellemelerinde silinmez.
- Güncelleme: `git pull && docker compose up -d --build`
- Yedekleme: `docker run --rm -v okul-kayit-sistemi_okul-data:/data -v $(pwd):/backup alpine cp /data/okul.db /backup/yedek-$(date +%F).db`

### Alan adı + HTTPS (önerilen)

Sunucuya [Caddy](https://caddyserver.com) kurup şu `Caddyfile` ile otomatik SSL alın:

```
kayit.okulunuz.com {
    reverse_proxy localhost:3000
}
```

### PaaS ile (sunucusuz seçenek)

Depo GitHub'da olduğu için [Railway](https://railway.app), [Render](https://render.com)
veya [Fly.io](https://fly.io)'ya "GitHub'dan deploy" ile bağlanabilir; `Dockerfile`
otomatik algılanır. Ortam değişkeni olarak `OKUL_JWT_SECRET` tanımlamanız ve verinin
kalıcılığı için `/data` yoluna bir disk/volume eklemeniz yeterlidir.

### Demo giriş bilgileri (şifre: `123456`)
| Kullanıcı | Rol | Kapsam |
|---|---|---|
| `genelmudur` | Genel Merkez | Tüm kampüsler |
| `mrk.mudur` / `mrk.kayit` / `mrk.muhasebe` | Müdür / Kayıt / Muhasebe | Merkez Kampüs |
| `and.*`, `avr.*`, `gol.*`, `shl.*` | aynı üçlü | Anadolu, Avrupa, Göl, Sahil |

> Üretimde `OKUL_JWT_SECRET` ortam değişkenini mutlaka değiştirin ve
> demo şifrelerini güncelleyin.

## Testler

```bash
npm test   # 32 uçtan uca API testi (yetki, kayıt, taksit, tahsilat, Excel, eşzamanlılık)
```

## Teknik Mimari
- **Backend**: Node.js + Express, JWT kimlik doğrulama, bcrypt şifreleme.
- **Veritabanı**: SQLite (better-sqlite3, WAL modu) — 15k öğrenci / 260k+ taksit ile test edildi;
  40-50 eşzamanlı kullanıcıyı tek süreçte rahatlıkla karşılar. Dosya: `data/okul.db`.
- **Excel**: exceljs ile sunucu tarafında üretim.
- **Frontend**: Bağımlılıksız tek sayfa uygulaması (vanilla JS), tamamen Türkçe arayüz.
- Para tutarları kuruş hassasiyetinde yuvarlanır; taksit bölüşümünde kuruş farkı son taksite eklenir.

### Ortam değişkenleri
| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Sunucu portu |
| `OKUL_JWT_SECRET` | (demo değer) | JWT imza anahtarı — üretimde değiştirin |
| `OKUL_DATA_DIR` | `./data` | Veritabanı dizini |
| `SEED_STUDENTS` | `15000` | Seed öğrenci sayısı |
