# CRM ↔ Okul Kayıt Sistemi Entegrasyonu

İş bölümü:
- **Ön kayıt / aday takibi → CRM'de** yürütülür.
- **Kesin kayıt → Okul Kayıt Sistemi'nde** yapılır. Bu sistemde yalnızca
  **kayıtlı**, **mezun** ve **kayıt sildiren** öğrenciler bulunur.

Tüm entegrasyon uçları `X-API-Key` başlığı ister. Anahtar, **Parametreler → CRM
Entegrasyonu** ekranından oluşturulur (`okl_...` ile başlar).

Temel adres: `https://<okul-kayit-adresiniz>/api/integration`

## 1) CRM → Okul: Aday gönderme

Öğretmen/danışman CRM'de ön kaydı tamamlayınca adayı okul sistemine iletir.

```
POST /api/integration/candidates
X-API-Key: okl_xxx
Content-Type: application/json

{
  "crm_form_id": "FORM-2026-1008",     // CRM'deki tekil form kimliği (zorunlu)
  "campus_code": "KRC",                 // hedef kampüs kodu (opsiyonel)
  "first_name": "Emre", "last_name": "Sarı",
  "tc_no": "12345678950",               // geçersizse reddedilir
  "birth_date": "2011-04-10", "gender": "ERKEK", "grade": "9",
  "city": "İstanbul", "district": "Esenyurt", "neighborhood": "Merkez Mah.",
  "address": "...",
  "parents": [
    { "relation": "ANNE", "full_name": "Zeynep Sarı", "tc_no": "...", "phone": "5321112233" },
    { "relation": "BABA", "full_name": "Eymen Sarı", "phone": "05461112233" }
  ],
  "notes": "..."
}
```

- Telefonlar otomatik `0532 111 22 33` biçimine getirilir; geçersiz TC/telefon reddedilir.
- Aynı `crm_form_id` tekrar gönderilirse aday **güncellenir** (henüz kayda dönüşmediyse).
- Kayıt personeli, **Yeni Kayıt → Yeni Öğrenci → CRM'den Getir** ile adayı arar,
  seçer; form otomatik dolar. Kesin kayıt tamamlanınca aday `AKTARILDI` olur.

## 2) Okul → CRM: Kayıt sonucu

Kesin kayıt oluşunca okul no + 6 haneli sözleşme no + sınıf/bölüm/şube + kayıt
tarihi CRM'e iki yoldan ulaşır:

**a) Webhook (anlık):** Parametreler'de webhook URL tanımlıysa her kayıtta:
```
POST <webhook_url>
X-Webhook-Secret: <tanımlı secret>
{ "event": "enrollment.created", "sent_at": "...", "data": { ...öğrenci... } }
```

**b) Sorgu (CRM çeker):**
```
GET /api/integration/students/{crm_form_id}     // tek öğrencinin tam görüntüsü
GET /api/integration/enrollments?after_id=0      // sözleşme akışı (artan id, 500'lük sayfa)
```

`data` / öğrenci görüntüsü örneği:
```json
{
  "crm_form_id": "FORM-2026-1008",
  "okul_no": "KRC-2026-00042",
  "ad": "Emre", "soyad": "Sarı", "durum": "AKTIF",
  "kampus": "Kıraç", "bolum": "Bilişim Teknolojileri", "sinif": "9", "sube": "A",
  "adres": { "il": "İstanbul", "ilce": "Esenyurt", "mahalle": "...", "adres": "..." },
  "veliler": [ { "yakinlik": "ANNE", "ad_soyad": "...", "telefon": "0532 ...", "veli_mi": true, "odeme_sorumlusu_mu": true } ],
  "kayitlar": [ {
    "sozlesme_no": "100042", "ogretim_yili": "2026-2027", "kayit_tarihi": "2026-07-19",
    "kayit_turu": "DIS_KAYIT", "sinif": "9", "sube": "A",
    "net_ucret": 245300, "tahsil_edilen": 25000, "bakiye": 220300
  } ]
}
```

## Diğer uçlar
```
GET    /api/integration/candidates?status=BEKLIYOR   // aday listesi
DELETE /api/integration/candidates/{crm_form_id}     // aday iptal (kayda dönmemişse)
```

## Sözleşme akışını senkron tutmak (öneri)
CRM tarafında son işlenen `id` saklanır; periyodik olarak
`GET /enrollments?after_id=<son_id>` çağrılır, dönen `next_after_id` bir sonraki
tur için kullanılır. Böylece yalnızca yeni sözleşmeler çekilir.
