# Topkapı CRM ↔ Okul Kayıt Sistemi Entegrasyonu (v1.0)

İş bölümü: **ön kayıt/aday takibi CRM'de**, **kesin kayıt Okul Kayıt Sistemi'nde**.
Sözleşme numarası yalnızca okul sisteminden üretilir. Okul sisteminde yalnızca
**kayıtlı**, **mezun**, **kayıt sildiren** öğrenciler bulunur.

Entegrasyon **kampüs bazlıdır**. CRM tabanı tüm kampüsler için ortaktır
(`https://crm.topkapiokullari.com`), fakat her kampüsün **ayrı** anahtar çifti vardır:
- **Okul API Anahtarı** (kampüs bazlı): CRM'in okul sistemine erişimi için. Okul
  sisteminde Parametreler > CRM Entegrasyonu > ilgili kampüs > "Okul API Anahtarı
  Üret" ile üretilir, CRM yöneticisine o kampüs için verilir.
- **CRM API Anahtarı** (kampüs bazlı): Okul sisteminin CRM'e erişimi için. CRM
  panelindeki kampüsün "CRM API Anahtarı" değeri alınıp okul sistemine o kampüs
  için girilir. Okul→CRM bildirimlerinde ilgili öğrencinin kampüsünün anahtarı kullanılır.

Tüm isteklerde `X-Api-Key` başlığı zorunludur (büyük/küçük harf duyarsız).
Anahtar yoksa **401**, geçersiz/pasifse **403** döner.

---

## 1) CRM → Okul: Aday gönderme

Okul sisteminin sağladığı uç. CRM "Okul Kayıt Sistemine Gönder" ile çağırır.

```
POST /api/integration/candidates
X-Api-Key: <OKUL_API_ANAHTARI>
Content-Type: application/json

{
  "crm_id": 42,                       // ZORUNLU — CRM öğrenci ID'si (kayıt/iptalde geri döner)
  "ad": "Ahmet", "soyad": "Yılmaz",
  "tc_kimlik": "12345678901",         // geçersizse 400
  "veli_adi": "Mehmet Yılmaz", "veli_telefon": "5321234567",
  "veli2_adi": "Ayşe Yılmaz", "veli2_telefon": "5339876543",
  "sinif": "10", "bolum": "Sayısal", "sube": "A",
  "mahalle": "Bağcılar Mah.", "il": "İstanbul", "ilce": "Fatih",
  "campus_code": "MRK"                // opsiyonel — hedef kampüs
}
```

- Başarı: **201 Created** (yeni) / **200 OK** (güncelleme) → gövde `{ "status": "received" }`.
- Aktarılmış (kesin kayda dönmüş) aday tekrar gönderilirse **200** `{status:"received", note:"already_enrolled"}` (üzerine yazılmaz).
- Eksik/geçersiz alanda **400** `{ "hata": "..." }`; anahtar yoksa **401**, geçersizse **403**.
- Telefonlar `0532 111 22 33` biçimine normalize edilir.

Kayıt personeli: **Yeni Kayıt → Yeni Öğrenci → CRM'den Getir** ile adayı arar, seçer;
form otomatik dolar. Alternatif: Parametreler'de **"CRM'den Adayları Çek"** düğmesi
CRM'in `GET /api/okul/adaylar/` ucundan adayları toplu içeri alır.

**Kampüslerarası kayıt:** CRM'de bir kampüse (örn. İstanbul OSB) bağlı görünen aday,
fiilen başka bir kampüse (örn. İkitelli OSB) kayıt olabilir. Bu nedenle **tüm kampüsler
tüm adayları görüp kayıt alabilir** — adayın `campus_code` etiketi yalnızca adayın CRM'de
hangi kampüste açıldığını gösteren bilgi amaçlıdır, kaydı kısıtlamaz. Öğrencinin gerçekte
hangi kampüse kayıt olduğu, kayıt sonucu bildiriminde (`kampus` / `kampus_kodu`) CRM'e
iletilir (bkz. bölüm 2).

---

## 2) Okul → CRM: Kayıt / iptal bildirimi

Parametreler'de CRM Taban Adresi + CRM API Anahtarı tanımlıysa otomatik çağrılır.

**Kesin kayıt** → `POST {taban}/api/okul/kayit-sonucu/` (X-Api-Key: CRM anahtarı)
```json
{
  "crm_id": 42,
  "sozlesme_no": "100042",
  "okul_no": "MRK-2026-00042",
  "kayit_tarihi": "2026-09-01T00:00:00",
  "sinif": "10", "bolum": "Bilişim Teknolojileri", "sube": "A",
  "kampus": "İkitelli OSB", "kampus_kodu": "MRK",
  "veli_adi": "...", "veli_telefon": "...", "veli2_adi": "...", "veli2_telefon": "...",
  "il": "İstanbul", "ilce": "Fatih", "mahalle": "..."
}
```

`kampus` / `kampus_kodu` = öğrencinin **fiilen** kayıt olduğu kampüs (CRM'deki aday
kampüsünden farklı olabilir). Bildirim, gerçek kayıt kampüsünün CRM anahtarıyla gönderilir.

**Kayıt iptali** → `POST {taban}/api/okul/kayit-iptal/`
```json
{ "crm_id": 42, "iptal_nedeni": "Veli tarafından iptal talep edildi" }
```

İstekler 10 sn zaman aşımıyla, CRM'den gelmemiş (crm_id'siz) öğrenciler için gönderilmez.

### Kampüslerarası kayıt — örnek istek/yanıt (CRM ekibi için)

Senaryo: Veli CRM'de **İstanbul OSB** kampüsü altında aday olarak açıldı (aday gönderimi
İstanbul OSB'nin Okul API anahtarıyla yapıldı, `crm_id: 42`), fakat öğrenci fiilen
**İkitelli OSB (MRK)** kampüsüne kesin kayıt oldu.

Okul sisteminin CRM'e gönderdiği **istek** (İkitelli OSB'nin CRM anahtarıyla):
```http
POST /api/okul/kayit-sonucu/ HTTP/1.1
Host: crm.topkapiokullari.com
X-Api-Key: <İKİTELLİ_OSB_CRM_ANAHTARI>
Content-Type: application/json

{
  "crm_id": 42,
  "sozlesme_no": "100042",
  "okul_no": "MRK-2026-00042",
  "kayit_tarihi": "2026-09-01T00:00:00",
  "sinif": "10", "bolum": "Bilişim Teknolojileri", "sube": "A",
  "kampus": "İkitelli OSB", "kampus_kodu": "MRK",
  "veli_adi": "Mehmet Yılmaz", "veli_telefon": "0532 111 22 33",
  "veli2_adi": "Ayşe Yılmaz", "veli2_telefon": "0533 987 65 43",
  "il": "İstanbul", "ilce": "Başakşehir", "mahalle": "Ziya Gökalp Mah."
}
```

CRM'den beklenen **yanıt** (200 OK):
```json
{ "durum": "ok" }
```

**CRM ekibinin dikkat etmesi gerekenler:**
1. `crm_id` (42) mevcut aday kartını işaret eder — **yeni kart açılmamalı**, bu kart
   "kesin kayıt" durumuna güncellenmelidir.
2. Kaydın hangi kampüsün "kesin kayıt listesi"nde görüneceği **`kampus_kodu`** alanına
   göre belirlenmelidir (aday başlangıçta İstanbul OSB'de açılmış olsa da). Bu örnekte
   öğrenci **İkitelli OSB (MRK)** listesinde yer almalıdır.
3. `kampus_kodu` değerleri: `MRK` (İkitelli OSB), `IST` (İstanbul OSB), `ESN` (Esenyurt),
   `KRC` (Kıraç), `CRL` (Çorlu). `kampus` alanı okunabilir kampüs adıdır.
4. Bildirim, öğrencinin **fiilen kayıt olduğu** kampüsün CRM anahtarıyla gelir; anahtarın
   ait olduğu kampüs ile `kampus_kodu` her zaman aynıdır.

---

## 3) Okul sisteminin sağladığı ek sorgu uçları (X-Api-Key: Okul anahtarı)
```
GET  /api/integration/candidates?status=BEKLIYOR   // aday listesi
GET  /api/integration/students/{crm_id}            // öğrencinin tam görüntüsü (okul no, sözleşme, sınıf...)
GET  /api/integration/enrollments?after_id=0       // sözleşme akışı (artan id, 500'lük sayfa, next_after_id imleci)
DELETE /api/integration/candidates/{crm_id}        // aday iptal (kayda dönmemişse)
```

## HTTP durum kodları
200 OK · 201 Created · 400 (eksik/geçersiz, `hata` alanı) · 401 (anahtar yok) ·
403 (anahtar geçersiz/pasif) · 404 (bulunamadı) · 405 (yanlış metod).
