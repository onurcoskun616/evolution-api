/**
 * Ortak doğrulayıcılar: TC Kimlik No (resmi algoritma) ve telefon normalizasyonu.
 */

/** TC Kimlik No: 11 hane, ilk hane 0 olamaz, 10. ve 11. hane kontrol basamakları. */
function isValidTC(tc) {
  tc = String(tc || '').trim();
  if (!/^[1-9]\d{10}$/.test(tc)) return false;
  const d = tc.split('').map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  const d10 = ((odd * 7 - even) % 10 + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d[9] === d10 && d[10] === d11;
}

/**
 * Telefonu doğrular ve "0532 111 22 33" biçimine getirir.
 * Dönüş: '' (boş girildi) | normalize edilmiş numara | null (GEÇERSİZ).
 * Kabul: 10 hane, başında 0 ile 11 hane, +90/90 önekli 12 hane.
 * İlk hane 5 (GSM) veya 2-4 (sabit hat) olmalıdır.
 */
function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  if (!/^[2-5]/.test(digits)) return null;
  return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`;
}

/** TC alanını doğrular; hata mesajı döner ya da null (geçerli/boş). */
function tcError(tc, label) {
  if (!tc || !String(tc).trim()) return null;
  return isValidTC(tc) ? null : `${label} için girilen TC Kimlik No geçersiz (kontrol basamağı tutmuyor).`;
}

/** Telefon alanını doğrular; { error } ya da { value } döner. */
function phoneField(phone, label) {
  const normalized = normalizePhone(phone);
  if (normalized === null) {
    return { error: `${label} için girilen telefon numarası geçersiz. Örnek biçim: 0532 111 22 33` };
  }
  return { value: normalized };
}

module.exports = { isValidTC, normalizePhone, tcError, phoneField };
