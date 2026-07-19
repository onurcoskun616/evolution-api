# Topkapı CRM ↔ Okul Kayıt Sistemi Entegrasyonu (v1.0)

İş bölümü: **ön kayıt/aday takibi CRM'de**, **kesin kayıt Okul Kayıt Sistemi'nde**.
Sözleşme numarası yalnızca okul sisteminden üretilir. Okul sisteminde yalnızca
**kayıtlı**, **mezun**, **kayıt sildiren** öğrenciler bulunur.

İki ayrı API anahtarı vardır:
- **Okul API Anahtarı**: CRM'in okul sistemine erişimi için. Okul sisteminde
  Parametreler > CRM Entegrasyonu'ndan üretilir, CRM yöneticisine verilir.
- **CRM API Anahtarı**: Okul sisteminin CRM'e erişimi için. CRM yöneticisinden
  alınıp Parametreler > CRM Entegrasyonu > "CRM Taban Adresi/API Anahtarı"na girilir.

Tüm isteklerde `X-Api-Key` başlığı zorunludur. Header adı büyük/küçük harf duyarsızdır.

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
  "veli_adi": "...", "veli_telefon": "...", "veli2_adi": "...", "veli2_telefon": "...",
  "il": "İstanbul", "ilce": "Fatih", "mahalle": "..."
}
```

**Kayıt iptali** → `POST {taban}/api/okul/kayit-iptal/`
```json
{ "crm_id": 42, "iptal_nedeni": "Veli tarafından iptal talep edildi" }
```

İstekler 10 sn zaman aşımıyla, CRM'den gelmemiş (crm_id'siz) öğrenciler için gönderilmez.

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
