/* Okul Kayıt Sistemi - Tek Sayfa Uygulaması (vanilla JS) */
'use strict';

// ================= Yardımcılar =================
const $ = sel => document.querySelector(sel);
const app = () => $('#app');

let TOKEN = localStorage.getItem('okul_token') || '';
let USER = null;
let META = null;
let CAMPUSES = [];

const TL = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 });
const fmtTL = v => TL.format(Number(v) || 0);
const fmtDate = d => {
  if (!d) return '-';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toISOString().slice(0, 10);

const METHOD_LABELS = { NAKIT: 'Nakit', KREDI_KARTI: 'Kredi Kartı', KMH: 'KMH', SENET: 'Senet', HAVALE_EFT: 'Havale/EFT', CEK: 'Çek', MAIL_ORDER: 'Mail Order' };
const RELATION_LABELS = {
  ANNE: 'Anne', BABA: 'Baba', VASI: 'Vasi', ABI: 'Abi', ABLA: 'Abla', DEDE: 'Dede',
  NINE: 'Nine', AMCA: 'Amca', HALA: 'Hala', DAYI: 'Dayı', TEYZE: 'Teyze', KUZEN: 'Kuzen', DIGER: 'Diğer',
};
const STATUS_BADGES = {
  AKTIF: ['Aktif', 'green'], PASIF: ['Pasif', 'gray'], MEZUN: ['Mezun', 'blue'],
  KAYIT_SILDI: ['Kayıt Sildi', 'red'], ADAY: ['Aday', 'yellow'],
  IPTAL: ['İptal', 'red'], DONDURULDU: ['Donduruldu', 'yellow'], TAMAMLANDI: ['Tamamlandı', 'blue'],
  BEKLIYOR: ['Bekliyor', 'gray'], KISMI: ['Kısmi', 'yellow'], ODENDI: ['Ödendi', 'green'],
};
const badge = (status, overdue) => {
  if (overdue && (status === 'BEKLIYOR' || status === 'KISMI')) {
    return `<span class="badge red">${status === 'KISMI' ? 'Kısmi / Gecikmiş' : 'Gecikmiş'}</span>`;
  }
  const [label, color] = STATUS_BADGES[status] || [status, 'gray'];
  return `<span class="badge ${color}">${label}</span>`;
};

// ---- Tutarı yazıyla (senet ve makbuz için) ----
const _ONES = ['', 'BİR', 'İKİ', 'ÜÇ', 'DÖRT', 'BEŞ', 'ALTI', 'YEDİ', 'SEKİZ', 'DOKUZ'];
const _TENS = ['', 'ON', 'YİRMİ', 'OTUZ', 'KIRK', 'ELLİ', 'ALTMIŞ', 'YETMİŞ', 'SEKSEN', 'DOKSAN'];
function _tripleTR(n) {
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  return (h ? (h > 1 ? _ONES[h] : '') + 'YÜZ' : '') + _TENS[t] + _ONES[o];
}
function amountInWordsTR(amount) {
  amount = Math.round((Number(amount) || 0) * 100) / 100;
  let lira = Math.floor(amount);
  const kurus = Math.round((amount - lira) * 100);
  let liraText;
  if (lira === 0) liraText = 'SIFIR';
  else {
    const groups = [];
    while (lira > 0) { groups.push(lira % 1000); lira = Math.floor(lira / 1000); }
    const SCALE = ['', 'BİN', 'MİLYON', 'MİLYAR'];
    const parts = [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      if (!g) continue;
      parts.push((i === 1 && g === 1 ? '' : _tripleTR(g)) + SCALE[i]);
    }
    liraText = parts.join('');
  }
  return liraText + ' TÜRK LİRASI' + (kurus > 0 ? ' ' + _tripleTR(kurus) + ' KURUŞ' : '');
}

// ---- Yazdırma penceresi (dekont / senet) ----
function printHTML(title, bodyHtml) {
  const w = window.open('', '_blank', 'width=920,height=700');
  if (!w) { toast('Tarayıcı açılır pencereyi engelledi. Lütfen bu site için izin verin.', 'error'); return; }
  w.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12.5px; color: #111; padding: 18px; }
      .doc { border: 1.6px solid #222; border-radius: 6px; padding: 16px 18px; margin-bottom: 14px;
             page-break-inside: avoid; }
      .doc-head { display: flex; justify-content: space-between; align-items: flex-start;
                  border-bottom: 1.4px solid #222; padding-bottom: 8px; margin-bottom: 10px; }
      .doc-title { font-size: 15px; font-weight: 800; letter-spacing: .4px; }
      .org { font-weight: 700; font-size: 13.5px; }
      .org small { font-weight: 400; color: #444; display: block; }
      .copy-tag { font-size: 10.5px; font-weight: 700; border: 1px solid #222; padding: 2px 8px; border-radius: 10px; }
      table { width: 100%; border-collapse: collapse; margin: 6px 0; }
      td, th { padding: 5px 7px; border: 1px solid #999; text-align: left; vertical-align: top; }
      th { background: #f0f0f0; font-size: 11px; text-transform: uppercase; }
      .amount-big { font-size: 16px; font-weight: 800; }
      .words { font-weight: 700; padding: 7px; border: 1px dashed #555; background: #fafafa; margin: 6px 0; }
      .sig-row { display: flex; gap: 24px; margin-top: 18px; }
      .sig { flex: 1; border-top: 1px solid #333; padding-top: 5px; text-align: center; font-size: 11px; min-height: 52px; }
      .cutline { border-top: 1.5px dashed #888; margin: 12px 0; text-align: center; color: #888; font-size: 10px; }
      .senet-text { line-height: 1.65; margin: 8px 0; text-align: justify; }
      .muted { color: #555; }
      .page-break { page-break-after: always; }
      @media print { body { padding: 0; } .no-print { display: none; } }
    </style></head><body>
    <div class="no-print" style="text-align:right; margin-bottom:10px">
      <button onclick="window.print()" style="padding:8px 18px; font-size:14px; cursor:pointer">🖨️ Yazdır</button>
    </div>
    ${bodyHtml}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch {} }, 400);
}

// ---- TC Kimlik ve telefon doğrulama (sunucudaki algoritmanın aynısı) ----
function isValidTCClient(tc) {
  tc = String(tc || '').trim();
  if (!/^[1-9]\d{10}$/.test(tc)) return false;
  const d = tc.split('').map(Number);
  const odd = d[0] + d[2] + d[4] + d[6] + d[8];
  const even = d[1] + d[3] + d[5] + d[7];
  return d[9] === ((odd * 7 - even) % 10 + 10) % 10 &&
         d[10] === d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
}
function normalizePhoneClient(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10 || !/^[2-5]/.test(digits)) return null;
  return `0${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8)}`;
}
// data-tc / data-phone öznitelikli tüm alanlar odaktan çıkınca doğrulanır
document.addEventListener('focusout', e => {
  const el = e.target;
  if (!el || !el.matches) return;
  if (el.matches('[data-tc]')) {
    const v = el.value.trim();
    if (v && !isValidTCClient(v)) {
      el.style.borderColor = 'var(--danger)';
      toast('Girilen TC Kimlik No geçersiz — kontrol basamağı tutmuyor. Lütfen kontrol edin.', 'error');
    } else el.style.borderColor = '';
  }
  if (el.matches('[data-phone]')) {
    const v = el.value.trim();
    if (!v) { el.style.borderColor = ''; return; }
    const n = normalizePhoneClient(v);
    if (n === null) {
      el.style.borderColor = 'var(--danger)';
      toast('Telefon numarası geçersiz. Örnek: 0532 111 22 33', 'error');
    } else { el.value = n; el.style.borderColor = ''; }
  }
});

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-area').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // 401: giriş denemesinde gerçek hatayı göster; diğer isteklerde oturum düşmüştür
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    logout(false);
    throw new Error('Oturum sona erdi. Lütfen tekrar giriş yapın.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız oldu.');
  return data;
}

async function downloadExcel(path, filename) {
  const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + TOKEN } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'İndirme başarısız.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const can = perm => USER && USER.permissions.includes(perm);
const isHQ = () => USER && USER.role === 'GENEL_MERKEZ';

// ================= Modal =================
function openModal(title, bodyHtml, { footHtml = '', small = false, onOpen } = {}) {
  const area = $('#modal-area');
  area.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal ${small ? 'sm' : ''}">
        <div class="modal-head"><h3>${esc(title)}</h3><button class="close" data-close>&times;</button></div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
      </div>
    </div>`;
  area.querySelector('[data-close]').onclick = closeModal;
  area.querySelector('.modal-backdrop').addEventListener('mousedown', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  if (onOpen) onOpen(area);
  return area;
}
function closeModal() { $('#modal-area').innerHTML = ''; }

function confirmDialog(title, message) {
  return new Promise(resolve => {
    openModal(title, `<p>${esc(message)}</p>
      <div class="field mt"><label>Açıklama / Gerekçe (isteğe bağlı)</label>
      <input id="confirm-reason" placeholder="Gerekçe yazabilirsiniz"></div>`, {
      small: true,
      footHtml: `<button class="btn secondary" id="c-no">Vazgeç</button>
                 <button class="btn danger" id="c-yes">Onayla</button>`,
      onOpen(area) {
        area.querySelector('#c-no').onclick = () => { closeModal(); resolve(null); };
        area.querySelector('#c-yes').onclick = () => {
          const reason = area.querySelector('#confirm-reason').value;
          closeModal(); resolve({ reason });
        };
      },
    });
  });
}

// ================= Oturum =================
function logout(callApi = true) {
  TOKEN = ''; USER = null;
  localStorage.removeItem('okul_token');
  renderLogin();
}

function renderLogin() {
  document.title = 'Giriş - Okul Kayıt Sistemi';
  app().innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="login-logo">🎓</div>
        <h1>Okul Kayıt Sistemi</h1>
        <div class="sub">Çok kampüslü kayıt ve tahsilat takip platformu</div>
        <form id="login-form">
          <div class="field"><label>Kullanıcı Adı</label>
            <input id="login-user" autocomplete="username" required autofocus></div>
          <div class="field mt"><label>Şifre</label>
            <input id="login-pass" type="password" autocomplete="current-password" required></div>
          <button class="btn mt" style="width:100%; justify-content:center" type="submit">Giriş Yap</button>
        </form>
      </div>
    </div>`;
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: { username: $('#login-user').value, password: $('#login-pass').value },
      });
      TOKEN = data.token; USER = data.user;
      localStorage.setItem('okul_token', TOKEN);
      await loadGlobals();
      location.hash = '#/dashboard';
      renderShell();
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function loadGlobals() {
  const [meta, campuses] = await Promise.all([api('/meta'), api('/campuses')]);
  META = meta;
  CAMPUSES = campuses.campuses.filter(c => c.active);
}

// ================= Kabuk / Menü =================
const NAV = [
  { hash: '#/dashboard', label: '📊 Genel Bakış', perm: 'dashboard.view' },
  { hash: '#/ogrenciler', label: '🧑‍🎓 Öğrenciler', perm: 'student.view' },
  { hash: '#/yeni-kayit', label: '📝 Yeni Kayıt', perm: 'enrollment.create' },
  { hash: '#/tahsilatlar', label: '💰 Tahsilatlar', perm: 'payment.view' },
  { hash: '#/taksitler', label: '📅 Taksit Takibi', perm: 'payment.view' },
  { hash: '#/raporlar', label: '📈 Raporlar', perm: 'report.view' },
  { hash: '#/parametreler', label: '⚙️ Parametreler', perm: 'settings.manage' },
  { hash: '#/kullanicilar', label: '👥 Kullanıcılar', perm: 'user.manage' },
  { hash: '#/kampusler', label: '🏫 Kampüsler', perm: 'campus.manage' },
];

function renderShell() {
  document.title = 'Okul Kayıt Sistemi';
  const items = NAV.filter(n => can(n.perm))
    .map(n => `<a href="${n.hash}" data-nav="${n.hash}">${n.label}</a>`).join('');
  app().innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand"><span class="logo">🎓</span> Okul Kayıt<br>Sistemi</div>
        <nav>${items}</nav>
        <div class="user-box">
          <div class="name">${esc(USER.full_name)}</div>
          <div class="role">${esc(USER.role_label)}${USER.campus ? ' · ' + esc(USER.campus.name) : ' · Tüm Kampüsler'}</div>
          <div class="flex">
            <button class="btn sm secondary" id="btn-pass">Şifre</button>
            <button class="btn sm danger" id="btn-logout">Çıkış</button>
          </div>
        </div>
      </aside>
      <main class="main" id="page"></main>
    </div>`;
  $('#btn-logout').onclick = () => logout();
  $('#btn-pass').onclick = changePasswordModal;
  route();
}

function setActiveNav(hash) {
  document.querySelectorAll('[data-nav]').forEach(a => {
    a.classList.toggle('active', hash.startsWith(a.dataset.nav));
  });
}

function changePasswordModal() {
  openModal('Şifre Değiştir', `
    <div class="field"><label>Mevcut Şifre</label><input type="password" id="cp-old"></div>
    <div class="field mt"><label>Yeni Şifre (en az 6 karakter)</label><input type="password" id="cp-new"></div>`, {
    small: true,
    footHtml: `<button class="btn secondary" data-x>Vazgeç</button><button class="btn" id="cp-save">Kaydet</button>`,
    onOpen(area) {
      area.querySelector('[data-x]').onclick = closeModal;
      area.querySelector('#cp-save').onclick = async () => {
        try {
          await api('/auth/change-password', { method: 'POST', body: { current_password: $('#cp-old').value, new_password: $('#cp-new').value } });
          toast('Şifre güncellendi.', 'success'); closeModal();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

// ================= Ortak bileşenler =================
function campusSelect(id, { allowAll = true, value = '' } = {}) {
  if (!isHQ()) return ''; // kampüs kullanıcıları zaten kendi kampüsüne kilitli
  const opts = CAMPUSES.map(c => `<option value="${c.id}" ${String(value) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<div class="field"><label>Kampüs</label>
    <select id="${id}">${allowAll ? '<option value="">Tüm Kampüsler</option>' : ''}${opts}</select></div>`;
}

function yearSelect(id, { allowAll = true, value = '' } = {}) {
  const sel = value || (allowAll ? '' : (META.academic_years.find(y => y.active) || {}).id || '');
  const opts = META.academic_years.map(y =>
    `<option value="${y.id}" ${String(sel) === String(y.id) ? 'selected' : ''}>${esc(y.name)}${y.active ? ' (Aktif)' : ''}</option>`).join('');
  return `<div class="field"><label>Öğretim Yılı</label>
    <select id="${id}">${allowAll ? '<option value="">Tüm Yıllar</option>' : ''}${opts}</select></div>`;
}

function pagerHtml(page, pageSize, total) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="pager">
    <span>Toplam <b>${total.toLocaleString('tr-TR')}</b> kayıt · Sayfa ${page}/${pages}</span>
    <button class="btn sm secondary" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>&larr; Önceki</button>
    <button class="btn sm secondary" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Sonraki &rarr;</button>
  </div>`;
}

// ================= Yönlendirici =================
window.addEventListener('hashchange', () => { if (USER) route(); });

function route() {
  const hash = location.hash || '#/dashboard';
  setActiveNav(hash);
  const page = $('#page');
  if (!page) return;
  const parts = hash.slice(2).split('/');
  const handlers = {
    dashboard: pageDashboard,
    ogrenciler: pageStudents,
    ogrenci: () => pageStudentDetail(parts[1]),
    'yeni-kayit': pageNewEnrollment,
    tahsilatlar: pagePayments,
    taksitler: pageInstallments,
    raporlar: pageReports,
    parametreler: pageParameters,
    kullanicilar: pageUsers,
    kampusler: pageCampuses,
  };
  (handlers[parts[0]] || pageDashboard)();
}

// ================= Sayfa: Genel Bakış =================
async function pageDashboard() {
  const page = $('#page');
  page.innerHTML = `
    <div class="page-head"><div><h2>Genel Bakış</h2>
      <div class="crumb">${isHQ() ? 'Tüm kampüslerin konsolide görünümü' : esc(USER.campus?.name || '')}</div></div>
      <div class="toolbar mb0">${campusSelect('dash-campus')}${yearSelect('dash-year')}</div>
    </div>
    <div id="dash-body"><div class="empty">Yükleniyor…</div></div>`;

  async function load() {
    const campus = isHQ() ? ($('#dash-campus')?.value || '') : '';
    const year = $('#dash-year')?.value || '';
    const qs = new URLSearchParams();
    if (campus) qs.set('campus_id', campus);
    if (year) qs.set('academic_year_id', year);
    let d;
    try { d = await api('/dashboard?' + qs); } catch (e) { toast(e.message, 'error'); return; }
    if (!$('#dash-body')) return; // sayfa değişmiş
    const maxMonthly = Math.max(1, ...d.monthly_collections.map(m => m.total));
    const maxMethod = Math.max(1, ...d.by_method.map(m => m.total));
    $('#dash-body').innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="label">Aktif Öğrenci</div><div class="value">${d.students.active.toLocaleString('tr-TR')}</div>
          <div class="hint">Toplam ${d.students.total.toLocaleString('tr-TR')} öğrenci</div></div>
        <div class="stat"><div class="label">Kayıt Sayısı</div><div class="value">${d.enrollments.toLocaleString('tr-TR')}</div></div>
        <div class="stat"><div class="label">Toplam Ciro</div><div class="value">${fmtTL(d.total_fee)}</div></div>
        <div class="stat success"><div class="label">Tahsil Edilen</div><div class="value">${fmtTL(d.collected)}</div>
          <div class="hint">Tahsilat oranı %${d.collection_rate}</div></div>
        <div class="stat warning"><div class="label">Kalan Bakiye</div><div class="value">${fmtTL(d.balance)}</div></div>
        <div class="stat danger"><div class="label">Vadesi Geçen</div><div class="value">${fmtTL(d.overdue.amount)}</div>
          <div class="hint">${d.overdue.count.toLocaleString('tr-TR')} taksit gecikmede</div></div>
        <div class="stat"><div class="label">30 Gün İçinde Vadesi Gelen</div><div class="value">${fmtTL(d.upcoming30.amount)}</div>
          <div class="hint">${d.upcoming30.count.toLocaleString('tr-TR')} taksit</div></div>
        <div class="stat"><div class="label">Bugünkü Tahsilat</div><div class="value">${fmtTL(d.today_payments.amount)}</div>
          <div class="hint">${d.today_payments.count} işlem</div></div>
      </div>
      ${isHQ() ? `<div class="card"><h3>Kampüs Karşılaştırması</h3><div class="table-wrap"><table>
        <thead><tr><th>Kampüs</th><th class="num">Aktif Öğrenci</th><th class="num">Kayıt</th>
        <th class="num">Ciro</th><th class="num">Tahsilat</th><th class="num">Oran</th><th class="num">Geciken</th></tr></thead>
        <tbody>${d.per_campus.map(c => `<tr>
          <td><b>${esc(c.name)}</b></td>
          <td class="num">${c.active_students.toLocaleString('tr-TR')}</td>
          <td class="num">${c.enrollments.toLocaleString('tr-TR')}</td>
          <td class="num">${fmtTL(c.total_fee)}</td>
          <td class="num">${fmtTL(c.collected)}</td>
          <td class="num">%${c.collection_rate}</td>
          <td class="num" style="color:var(--danger)">${fmtTL(c.overdue)}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      <div class="two-col">
        <div class="card"><h3>Aylık Tahsilat (Son 12 Ay)</h3>
          <div class="bar-chart">${d.monthly_collections.map(m => `
            <div class="bar-col" title="${m.month}: ${fmtTL(m.total)}">
              <div class="bar" style="height:${Math.round((m.total / maxMonthly) * 130)}px"></div>
              <div class="bar-label">${m.month.slice(5)}/${m.month.slice(2, 4)}</div>
            </div>`).join('') || '<div class="empty">Veri yok</div>'}</div>
        </div>
        <div class="card"><h3>Ödeme Türü Dağılımı</h3>
          ${d.by_method.map(m => `<div class="method-row">
            <span class="m-label">${METHOD_LABELS[m.method] || m.method}</span>
            <div class="track"><div class="fill" style="width:${Math.round((m.total / maxMethod) * 100)}%"></div></div>
            <span class="m-val">${fmtTL(m.total)}</span></div>`).join('') || '<div class="empty">Veri yok</div>'}
        </div>
      </div>`;
  }
  page.querySelectorAll('#dash-campus, #dash-year').forEach(el => el && (el.onchange = load));
  await load();
}

// ================= Sayfa: Öğrenciler =================
async function pageStudents() {
  const page = $('#page');
  const state = { page: 1, search: '', campus: '', grade: '', status: 'AKTIF' };
  page.innerHTML = `
    <div class="page-head"><div><h2>Öğrenciler</h2><div class="crumb">Öğrenci arama, listeleme ve dosya görüntüleme</div></div>
      ${can('student.create') ? `<a class="btn" href="#/yeni-kayit">+ Yeni Kayıt</a>` : ''}
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="field grow"><label>Ara (ad, no, TC, veli adı/telefonu)</label>
          <input id="st-search" placeholder="En az 2 karakter yazın…"></div>
        ${campusSelect('st-campus')}
        <div class="field"><label>Sınıf</label><select id="st-grade"><option value="">Tümü</option>
          ${META.grades.map(g => `<option>${g}</option>`).join('')}</select></div>
        <div class="field"><label>Durum</label><select id="st-status"><option value="">Tümü</option>
          ${META.student_statuses.map(s => `<option value="${s.value}" ${s.value === 'AKTIF' ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
      </div>
      <div id="st-table"><div class="empty">Yükleniyor…</div></div>
    </div>`;

  async function load() {
    const qs = new URLSearchParams({ page: state.page, page_size: 25 });
    if (state.search.length >= 2) qs.set('search', state.search);
    if (state.campus) qs.set('campus_id', state.campus);
    if (state.grade) qs.set('grade', state.grade);
    if (state.status) qs.set('status', state.status);
    let d;
    try { d = await api('/students?' + qs); } catch (e) { toast(e.message, 'error'); return; }
    if (!$('#st-table')) return; // sayfa değişmiş
    $('#st-table').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Öğrenci No</th><th>Ad Soyad</th><th>Bölüm</th><th>Sınıf</th><th>Kampüs</th>
        <th>Veli</th><th>Veli Telefon</th><th>Durum</th></tr></thead>
        <tbody>${d.students.map(s => `
          <tr class="clickable" onclick="location.hash='#/ogrenci/${s.id}'">
            <td>${esc(s.student_no)}</td>
            <td><b>${esc(s.first_name)} ${esc(s.last_name)}</b></td>
            <td>${esc(s.department_name || '-')}</td>
            <td>${esc(s.grade)}${s.section ? '-' + esc(s.section) : ''}</td>
            <td>${esc(s.campus_name)}</td>
            <td>${esc(s.parent_name || '-')}</td>
            <td>${esc(s.parent_phone || '-')}</td>
            <td>${badge(s.status)}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="empty">Kayıt bulunamadı</td></tr>'}
        </tbody></table></div>
      ${pagerHtml(d.page, d.page_size, d.total)}`;
    $('#st-table').querySelectorAll('[data-page]').forEach(b => b.onclick = () => { state.page = Number(b.dataset.page); load(); });
  }

  let debounce;
  $('#st-search').oninput = e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.search = e.target.value.trim(); state.page = 1; load(); }, 350);
  };
  ['st-campus', 'st-grade', 'st-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = () => {
      state.campus = $('#st-campus')?.value || '';
      state.grade = $('#st-grade').value;
      state.status = $('#st-status').value;
      state.page = 1; load();
    };
  });
  await load();
}

// ================= Sayfa: Öğrenci Detay =================
async function pageStudentDetail(id) {
  const page = $('#page');
  page.innerHTML = '<div class="empty">Yükleniyor…</div>';
  let d;
  try { d = await api('/students/' + id); } catch (e) { page.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
  const s = d.student;

  page.innerHTML = `
    <div class="page-head">
      <div><h2>${esc(s.first_name)} ${esc(s.last_name)} ${badge(s.status)}</h2>
        <div class="crumb"><a href="#/ogrenciler">Öğrenciler</a> / ${esc(s.student_no)} · ${esc(s.campus_name)}</div></div>
      <div class="flex">
        ${can('student.edit') ? '<button class="btn secondary" id="btn-edit-student">✏️ Bilgileri Düzenle</button>' : ''}
        ${can('enrollment.create') ? '<button class="btn" id="btn-new-enrollment">📝 Yeni Dönem Kaydı</button>' : ''}
      </div>
    </div>

    <div class="two-col">
      <div class="card"><h3>Öğrenci Bilgileri</h3>
        <div class="table-wrap"><table><tbody>
          <tr><td class="muted" style="width:150px">TC Kimlik No</td><td>${esc(s.tc_no || '-')}</td></tr>
          <tr><td class="muted">Doğum Tarihi / Yeri</td><td>${fmtDate(s.birth_date)} · ${esc(s.birth_place || '-')}</td></tr>
          <tr><td class="muted">Cinsiyet</td><td>${s.gender === 'ERKEK' ? 'Erkek' : s.gender === 'KIZ' ? 'Kız' : '-'}</td></tr>
          <tr><td class="muted">Bölüm</td><td>${esc(s.department_name || '-')}</td></tr>
          <tr><td class="muted">Sınıf / Şube</td><td>${esc(s.grade)}${s.section ? ' - ' + esc(s.section) : ''}</td></tr>
          <tr><td class="muted">Önceki Okul</td><td>${esc(s.previous_school || '-')}</td></tr>
          <tr><td class="muted">Adres</td><td>${esc(s.address || '-')} ${esc(s.neighborhood || '')} ${esc(s.district || '')} ${esc(s.city || '')}</td></tr>
          <tr><td class="muted">Sağlık Notları</td><td>${esc(s.health_notes || '-')}</td></tr>
          <tr><td class="muted">Notlar</td><td>${esc(s.notes || '-')}</td></tr>
        </tbody></table></div>
      </div>
      <div class="card"><h3 class="flex">Veli Bilgileri <span class="spacer"></span>
        ${can('student.edit') ? '<button class="btn sm secondary" id="btn-add-parent">+ Veli Ekle</button>' : ''}</h3>
        ${d.parents.map(p => `
          <div class="card" style="margin-bottom:10px; padding:12px">
            <div class="flex"><b>${esc(p.full_name)}</b>
              <span class="badge ${p.relation === 'ANNE' ? 'blue' : p.relation === 'BABA' ? 'green' : 'gray'}">${RELATION_LABELS[p.relation] || p.relation}</span>
              ${p.is_guardian ? '<span class="badge yellow">Veli</span>' : ''}
              ${p.is_payer ? '<span class="badge red" style="background:#dbe8fb; color:#1d4f91">Ödeme Sorumlusu</span>' : ''}
              <span class="spacer"></span>
              ${can('student.edit') ? `<button class="btn sm secondary" data-edit-parent="${p.id}">Düzenle</button>` : ''}
            </div>
            <div class="muted mt" style="font-size:12.5px">
              📞 ${esc(p.phone || '-')} ${p.phone2 ? ' / ' + esc(p.phone2) : ''} · ✉️ ${esc(p.email || '-')}<br>
              ${esc(p.occupation || '')} ${p.workplace ? '· ' + esc(p.workplace) : ''} ${p.tc_no ? '· TC: ' + esc(p.tc_no) : ''}
            </div>
          </div>`).join('') || '<div class="empty">Veli kaydı yok</div>'}
      </div>
    </div>

    <div class="card">
      <h3>📎 Evrak Durumu
        ${(() => { const m = d.documents.filter(x => !x.received).length;
          return m ? `<span class="badge red">${m} eksik</span>` : '<span class="badge green">Tamam</span>'; })()}
      </h3>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
        ${d.documents.map(doc => `
          <label style="display:flex; gap:8px; align-items:center; font-weight:400; text-transform:none; cursor:${can('student.edit') ? 'pointer' : 'default'}">
            <input type="checkbox" style="width:auto" data-doc-toggle="${doc.id}"
              ${doc.received ? 'checked' : ''} ${!can('student.edit') ? 'disabled' : ''}>
            <span>${esc(doc.name)}
              ${doc.received ? `<small class="muted" style="display:block">${fmtDate(doc.received_at)} · ${esc(doc.received_by_name || '')}</small>`
                             : '<small style="display:block; color:var(--danger)">Eksik</small>'}</span>
          </label>`).join('')}
      </div>
    </div>

    <div id="enrollments-area"></div>`;

  // ---- Kayıtlar bölümü ----
  const area = $('#enrollments-area');
  area.innerHTML = d.enrollments.map(e => {
    const openInstallments = e.installments.filter(i => i.status === 'BEKLIYOR' || i.status === 'KISMI');
    return `
    <div class="card">
      <h3 class="flex">📚 ${esc(e.academic_year_name)} Kaydı ${badge(e.status)}
        ${e.contract_no ? `<span class="badge blue">Sözleşme No: ${esc(e.contract_no)}</span>` : ''}
        <span class="muted" style="font-weight:400; font-size:12.5px">· ${e.department_name ? esc(e.department_name) + ' · ' : ''}${esc(e.grade)}-${esc(e.section || '?')} · ${e.enrollment_type === 'DIS_KAYIT' ? 'Dış Kayıt' : e.enrollment_type === 'IC_KAYIT' ? 'İç Kayıt' : 'Nakil'} · ${fmtDate(e.enrollment_date)}</span>
        <span class="spacer"></span>
        ${can('payment.create') && e.status !== 'IPTAL' && e.balance > 0 ? `<button class="btn sm success" data-pay="${e.id}">💰 Tahsilat Al</button>` : ''}
        ${e.status !== 'IPTAL' && openInstallments.length ? `<button class="btn sm secondary" data-senet="${e.id}">📄 Senet Bas</button>` : ''}
        ${can('enrollment.cancel') && e.status !== 'IPTAL' ? `<button class="btn sm danger" data-cancel-enr="${e.id}">Kaydı İptal Et</button>` : ''}
      </h3>
      <div class="stat-grid" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
        <div class="stat"><div class="label">Liste Ücreti</div><div class="value" style="font-size:16px">${fmtTL(e.list_fee)}</div></div>
        <div class="stat"><div class="label">İndirim</div><div class="value" style="font-size:16px">%${e.discount_rate} (${fmtTL(e.discount_amount)})</div>
          <div class="hint">${esc(e.discount_reason || '')}</div></div>
        <div class="stat"><div class="label">Net Ücret</div><div class="value" style="font-size:16px">${fmtTL(e.net_fee)}</div></div>
        <div class="stat success"><div class="label">Ödenen</div><div class="value" style="font-size:16px">${fmtTL(e.total_paid)}</div></div>
        <div class="stat ${e.balance > 0 ? 'warning' : 'success'}"><div class="label">Kalan Bakiye</div><div class="value" style="font-size:16px">${fmtTL(e.balance)}</div></div>
      </div>
      <div class="muted" style="font-size:12.5px; margin-bottom:8px">
        Ödeme türü: <b>${METHOD_LABELS[e.default_payment_method] || e.default_payment_method}</b>
        ${e.payer_name ? ` · Ödeme sorumlusu: <b>${esc(e.payer_name)}</b> ${e.payer_phone ? '(' + esc(e.payer_phone) + ')' : ''}` : ''}
      </div>
      ${e.items && e.items.length ? `
      <div class="section-title">Ücret Kalemleri (İlan Listesinden)</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Kalem</th><th class="num">İlan Fiyatı</th><th class="num">Adet</th>
        <th class="num">Tutar</th><th class="num">İndirim</th><th class="num">Net</th></tr></thead>
        <tbody>${e.items.map(it => `<tr>
          <td>${esc(it.name)}</td>
          <td class="num">${fmtTL(it.unit_price)}</td>
          <td class="num">${it.quantity}</td>
          <td class="num">${fmtTL(it.total)}</td>
          <td class="num" style="color:var(--danger)">${it.discount_amount ? `${fmtTL(it.discount_amount)}${it.discount_rate ? ` (%${it.discount_rate})` : ''}` : '-'}</td>
          <td class="num"><b>${fmtTL(it.net_total ?? it.total)}</b></td></tr>`).join('')}
        <tr><td colspan="3"><b>TOPLAM</b></td>
          <td class="num"><b>${fmtTL(e.items.reduce((a, x) => a + x.total, 0))}</b></td>
          <td class="num" style="color:var(--danger)"><b>${fmtTL(e.items.reduce((a, x) => a + (x.discount_amount || 0), 0))}</b></td>
          <td class="num"><b>${fmtTL(e.items.reduce((a, x) => a + (x.net_total ?? x.total), 0))}</b></td></tr>
        </tbody></table></div>` : ''}
      <div class="section-title">Taksit Planı</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Taksit</th><th>Vade</th><th class="num">Tutar</th><th class="num">Ödenen</th>
        <th class="num">Kalan</th><th>Durum</th>${can('installment.edit') ? '<th></th>' : ''}</tr></thead>
        <tbody>${e.installments.map(i => `
          <tr>
            <td>${esc(i.label)}</td>
            <td>${fmtDate(i.due_date)}</td>
            <td class="num">${fmtTL(i.amount)}</td>
            <td class="num">${fmtTL(i.paid_amount)}</td>
            <td class="num"><b>${fmtTL(i.amount - i.paid_amount)}</b></td>
            <td>${badge(i.status, i.overdue)}</td>
            ${can('installment.edit') ? `<td>${i.status !== 'ODENDI' && i.status !== 'IPTAL' ? `<button class="btn sm secondary" data-edit-inst="${i.id}" data-enr="${e.id}">Düzenle</button>` : ''}</td>` : ''}
          </tr>`).join('')}
        </tbody></table></div>
      <div class="section-title">Tahsilat Geçmişi</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Taksit</th><th class="num">Tutar</th><th>Ödeme Türü</th>
        <th>Makbuz No</th><th>Tahsil Eden</th><th>Durum</th><th></th>${can('payment.cancel') ? '<th></th>' : ''}</tr></thead>
        <tbody>${e.payments.map(p => `
          <tr style="${p.cancelled ? 'opacity:.55; text-decoration:line-through' : ''}">
            <td>${fmtDate(p.payment_date)}</td>
            <td>${esc(p.installment_label || 'Genel')}</td>
            <td class="num">${fmtTL(p.amount)}</td>
            <td>${METHOD_LABELS[p.method] || p.method}</td>
            <td>${esc(p.receipt_no || '-')}</td>
            <td>${esc(p.received_by_name || '-')}</td>
            <td>${p.cancelled ? '<span class="badge red">İptal</span>' : '<span class="badge green">Geçerli</span>'}</td>
            <td>${!p.cancelled ? `<button class="btn sm secondary" data-print-pay="${p.id}" data-penr="${e.id}">🖨️ Dekont</button>` : ''}</td>
            ${can('payment.cancel') ? `<td>${!p.cancelled ? `<button class="btn sm danger" data-cancel-pay="${p.id}">İptal</button>` : ''}</td>` : ''}
          </tr>`).join('') || '<tr><td colspan="9" class="empty">Tahsilat yok</td></tr>'}
        </tbody></table></div>
    </div>`;
  }).join('') || '<div class="card empty">Bu öğrencinin dönem kaydı bulunmuyor.</div>';

  // ---- Olay bağlama ----
  const reload = () => pageStudentDetail(id);

  if ($('#btn-edit-student')) $('#btn-edit-student').onclick = () => studentFormModal(s, reload);
  page.querySelectorAll('[data-doc-toggle]').forEach(cb => cb.onchange = async () => {
    try {
      await api(`/students/${s.id}/documents/${cb.dataset.docToggle}`, {
        method: 'PUT', body: { received: cb.checked },
      });
      reload();
    } catch (e) { toast(e.message, 'error'); cb.checked = !cb.checked; }
  });
  if ($('#btn-add-parent')) $('#btn-add-parent').onclick = () => parentFormModal(s.id, null, reload);
  if ($('#btn-new-enrollment')) $('#btn-new-enrollment').onclick = () => { location.hash = `#/yeni-kayit/${s.id}`; };

  page.querySelectorAll('[data-edit-parent]').forEach(b => b.onclick = () => {
    const p = d.parents.find(x => x.id === Number(b.dataset.editParent));
    parentFormModal(s.id, p, reload);
  });
  page.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
    const e = d.enrollments.find(x => x.id === Number(b.dataset.pay));
    paymentModal(e, reload);
  });
  page.querySelectorAll('[data-cancel-enr]').forEach(b => b.onclick = async () => {
    const r = await confirmDialog('Kaydı İptal Et', 'Bu dönem kaydı iptal edilecek ve bekleyen taksitler kapatılacak. Emin misiniz?');
    if (!r) return;
    try { await api(`/enrollments/${b.dataset.cancelEnr}/cancel`, { method: 'POST', body: { reason: r.reason } }); toast('Kayıt iptal edildi.', 'success'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  });
  page.querySelectorAll('[data-cancel-pay]').forEach(b => b.onclick = async () => {
    const r = await confirmDialog('Tahsilatı İptal Et', 'Bu tahsilat iptal edilecek ve taksit bakiyesi geri açılacak. Emin misiniz?');
    if (!r) return;
    try { await api(`/payments/${b.dataset.cancelPay}/cancel`, { method: 'POST', body: { reason: r.reason } }); toast('Tahsilat iptal edildi.', 'success'); reload(); }
    catch (e) { toast(e.message, 'error'); }
  });
  page.querySelectorAll('[data-edit-inst]').forEach(b => b.onclick = () => {
    const e = d.enrollments.find(x => x.id === Number(b.dataset.enr));
    const inst = e.installments.find(i => i.id === Number(b.dataset.editInst));
    installmentEditModal(inst, reload);
  });
  const studentCampus = CAMPUSES.find(c => c.id === s.campus_id) || { name: s.campus_name };
  page.querySelectorAll('[data-senet]').forEach(b => b.onclick = () => {
    const e = d.enrollments.find(x => x.id === Number(b.dataset.senet));
    printSenetler(s, studentCampus, e, d.parents);
  });
  page.querySelectorAll('[data-print-pay]').forEach(b => b.onclick = () => {
    const e = d.enrollments.find(x => x.id === Number(b.dataset.penr));
    const p = e.payments.find(x => x.id === Number(b.dataset.printPay));
    printReceipt(s, studentCampus, e, p);
  });
}

// ---- Öğrenci formu (yeni/düzenle) ----
function studentFormFields(s = {}, opts = {}) {
  return `
    <div class="form-grid">
      <div class="field"><label>Adı *</label><input id="sf-first" value="${esc(s.first_name || '')}"></div>
      <div class="field"><label>Soyadı *</label><input id="sf-last" value="${esc(s.last_name || '')}"></div>
      <div class="field"><label>TC Kimlik No</label><input id="sf-tc" data-tc maxlength="11" value="${esc(s.tc_no || '')}"></div>
      <div class="field"><label>Doğum Tarihi</label><input type="date" id="sf-birth" value="${esc(s.birth_date || '')}"></div>
      <div class="field"><label>Doğum Yeri</label><input id="sf-bplace" value="${esc(s.birth_place || '')}"></div>
      <div class="field"><label>Cinsiyet</label><select id="sf-gender">
        <option value="">Seçiniz</option>
        <option value="KIZ" ${s.gender === 'KIZ' ? 'selected' : ''}>Kız</option>
        <option value="ERKEK" ${s.gender === 'ERKEK' ? 'selected' : ''}>Erkek</option></select></div>
      ${isHQ() ? `<div class="field"><label>Kampüs *</label><select id="sf-campus">
        ${CAMPUSES.map(c => `<option value="${c.id}" ${s.campus_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
      ${opts.noPlacement ? '' : `
      <div class="field"><label>Sınıf</label><select id="sf-grade">
        ${META.grades.map(g => `<option ${s.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="field"><label>Şube</label><input id="sf-section" value="${esc(s.section || '')}" maxlength="4"></div>`}
      <div class="field"><label>Durum</label><select id="sf-status">
        ${META.student_statuses.map(x => `<option value="${x.value}" ${(s.status || 'AKTIF') === x.value ? 'selected' : ''}>${x.label}</option>`).join('')}</select></div>
      <div class="field"><label>İl</label>
        <select id="sf-adr-city" style="display:none"></select>
        <input id="sf-city" value="${esc(s.city || 'İstanbul')}"></div>
      <div class="field"><label>İlçe</label>
        <select id="sf-adr-district" style="display:none" disabled></select>
        <input id="sf-district" value="${esc(s.district || '')}"></div>
      <div class="field"><label>Mahalle</label>
        <select id="sf-adr-hood" style="display:none" disabled></select>
        <input id="sf-hood" value="${esc(s.neighborhood || '')}" placeholder="Mahalle adı"></div>
      <div class="field full"><label>Adres (cadde/sokak/no)</label><input id="sf-address" value="${esc(s.address || '')}"></div>
      <div class="field"><label>Önceki Okul İli</label><select id="sf-psc-city"><option value="">Yükleniyor…</option></select></div>
      <div class="field"><label>Önceki Okul İlçesi</label><select id="sf-psc-district" disabled><option value="">Önce il seçin</option></select></div>
      <div class="field"><label>Önceki Okul</label><select id="sf-psc-school" disabled><option value="">Önce ilçe seçin</option></select></div>
      <div class="field full" id="sf-prev-wrap" style="${s.previous_school && !s.previous_school_id ? '' : 'display:none'}">
        <label>Önceki Okul (elle yazın)</label><input id="sf-prev" value="${esc(s.previous_school || '')}"></div>
      <div class="field full"><label>Sağlık Notları</label><input id="sf-health" value="${esc(s.health_notes || '')}"></div>
      <div class="field full"><label>Notlar</label><input id="sf-notes" value="${esc(s.notes || '')}"></div>
    </div>`;
}

/**
 * Adres il → ilçe → mahalle zinciri: katalog doluysa metin kutuları yerine
 * seçim listeleri gösterilir; "Listede yok" seçilirse elle giriş açılır.
 */
async function initAddressPicker(s = {}) {
  const citySel = $('#sf-adr-city');
  if (!citySel) return;
  const distSel = $('#sf-adr-district');
  const hoodSel = $('#sf-adr-hood');
  const cityTxt = $('#sf-city'), distTxt = $('#sf-district'), hoodTxt = $('#sf-hood');
  const MANUAL = '__manual';
  const fetchHoods = (city, district) => {
    const qs = new URLSearchParams();
    if (city) qs.set('city', city);
    if (district) qs.set('district', district);
    return api('/parameters/neighborhoods?' + qs);
  };
  const showManual = (sel, txt) => {
    const manual = sel.value === MANUAL;
    txt.style.display = manual ? '' : 'none';
    if (!manual) txt.value = sel.value || '';
  };
  try {
    const d0 = await fetchHoods();
    if (!$('#sf-adr-city')) return;
    if (!d0.cities.length) return; // katalog boş: metin girişleri kalsın
    // Selectleri görünür yap, metinleri gizle
    for (const [sel, txt] of [[citySel, cityTxt], [distSel, distTxt], [hoodSel, hoodTxt]]) {
      sel.style.display = ''; txt.style.display = 'none';
    }
    const opt = list => '<option value="">Seçiniz</option>' +
      list.map(x => `<option>${esc(x)}</option>`).join('') +
      `<option value="${MANUAL}">Listede yok — elle gir</option>`;
    citySel.innerHTML = opt(d0.cities);
    const fillDistricts = async () => {
      showManual(citySel, cityTxt);
      if (!citySel.value || citySel.value === MANUAL) {
        distSel.innerHTML = opt([]); distSel.disabled = citySel.value !== MANUAL;
        hoodSel.innerHTML = opt([]); hoodSel.disabled = true;
        if (citySel.value === MANUAL) { distSel.value = MANUAL; hoodSel.value = MANUAL; showManual(distSel, distTxt); showManual(hoodSel, hoodTxt); }
        return;
      }
      const d = await fetchHoods(citySel.value);
      distSel.innerHTML = opt(d.districts); distSel.disabled = false;
      hoodSel.innerHTML = opt([]); hoodSel.disabled = true;
      showManual(distSel, distTxt); showManual(hoodSel, hoodTxt);
    };
    const fillHoods = async () => {
      showManual(distSel, distTxt);
      if (!distSel.value || distSel.value === MANUAL) {
        hoodSel.innerHTML = opt([]); hoodSel.disabled = distSel.value !== MANUAL;
        if (distSel.value === MANUAL) { hoodSel.value = MANUAL; showManual(hoodSel, hoodTxt); }
        return;
      }
      const d = await fetchHoods(citySel.value, distSel.value);
      hoodSel.innerHTML = opt(d.neighborhoods.map(x => x.name)); hoodSel.disabled = false;
      showManual(hoodSel, hoodTxt);
    };
    citySel.onchange = fillDistricts;
    distSel.onchange = fillHoods;
    hoodSel.onchange = () => showManual(hoodSel, hoodTxt);
    // Kayıtlı değerleri geri yükle
    if (s.city && d0.cities.includes(s.city)) {
      citySel.value = s.city;
      await fillDistricts();
      const dists = [...distSel.options].map(o => o.value);
      if (s.district && dists.includes(s.district)) {
        distSel.value = s.district;
        await fillHoods();
        const hoods = [...hoodSel.options].map(o => o.value);
        if (s.neighborhood && hoods.includes(s.neighborhood)) hoodSel.value = s.neighborhood;
        else if (s.neighborhood) { hoodSel.value = '__manual'; showManual(hoodSel, hoodTxt); hoodTxt.value = s.neighborhood; }
      } else if (s.district) {
        distSel.value = '__manual'; showManual(distSel, distTxt); distTxt.value = s.district;
        hoodSel.value = '__manual'; hoodSel.disabled = false; showManual(hoodSel, hoodTxt); hoodTxt.value = s.neighborhood || '';
      }
    } else if (s.city) {
      citySel.value = '__manual'; await fillDistricts();
      cityTxt.value = s.city; distTxt.value = s.district || ''; hoodTxt.value = s.neighborhood || '';
    }
  } catch { /* katalog erişilemedi: metin girişleri kalsın */ }
}

/** Önceki okul il → ilçe → okul zincirini bağlar; kayıtlı seçimi geri yükler. */
async function initSchoolPicker(s = {}) {
  const citySel = $('#sf-psc-city');
  if (!citySel) return;
  const distSel = $('#sf-psc-district');
  const schSel = $('#sf-psc-school');
  const prevWrap = $('#sf-prev-wrap');
  const fetchSchools = (city, district) => {
    const qs = new URLSearchParams();
    if (city) qs.set('city', city);
    if (district) qs.set('district', district);
    return api('/parameters/schools?' + qs);
  };
  const fillDistricts = async () => {
    if (!citySel.value) {
      distSel.innerHTML = '<option value="">Önce il seçin</option>'; distSel.disabled = true;
      schSel.innerHTML = '<option value="">Önce ilçe seçin</option>'; schSel.disabled = true;
      return;
    }
    const d = await fetchSchools(citySel.value);
    distSel.innerHTML = '<option value="">Seçiniz</option>' +
      d.districts.map(x => `<option>${esc(x)}</option>`).join('');
    distSel.disabled = false;
    schSel.innerHTML = '<option value="">Önce ilçe seçin</option>'; schSel.disabled = true;
  };
  const fillSchools = async () => {
    if (!distSel.value) { schSel.innerHTML = '<option value="">Önce ilçe seçin</option>'; schSel.disabled = true; return; }
    const d = await fetchSchools(citySel.value, distSel.value);
    schSel.innerHTML = '<option value="">Seçiniz</option>' +
      d.schools.map(x => `<option value="${x.id}">${esc(x.name)} (${x.type === 'LISE' ? 'Lise' : 'Ortaokul'})</option>`).join('') +
      '<option value="__manual">Listede yok — elle yazacağım</option>';
    schSel.disabled = false;
  };
  try {
    const d0 = await fetchSchools();
    if (!$('#sf-psc-city')) return;
    citySel.innerHTML = '<option value="">Seçiniz</option>' +
      d0.cities.map(x => `<option>${esc(x)}</option>`).join('') +
      (d0.cities.length ? '' : '<option value="" disabled>(Katalog boş — Parametreler sayfasından yükleyin)</option>');
    citySel.onchange = () => { fillDistricts(); prevWrap.style.display = 'none'; };
    distSel.onchange = fillSchools;
    schSel.onchange = () => { prevWrap.style.display = schSel.value === '__manual' ? '' : 'none'; };
    if (s.previous_school_id && s.previous_school_city) {
      citySel.value = s.previous_school_city;
      await fillDistricts();
      distSel.value = s.previous_school_district || '';
      await fillSchools();
      schSel.value = String(s.previous_school_id);
    }
  } catch (e) { /* katalog yüklenemedi - elle yazma alanı yeterli */ }
}

function readStudentForm() {
  const schoolSel = $('#sf-psc-school');
  const schoolId = schoolSel && schoolSel.value && schoolSel.value !== '__manual' ? Number(schoolSel.value) : null;
  const body = {
    first_name: $('#sf-first').value.trim(),
    last_name: $('#sf-last').value.trim(),
    tc_no: $('#sf-tc').value.trim(),
    birth_date: $('#sf-birth').value,
    birth_place: $('#sf-bplace').value,
    gender: $('#sf-gender').value,
    campus_id: isHQ() ? Number($('#sf-campus').value) : USER.campus.id,
    previous_school_id: schoolId,
    status: $('#sf-status').value,
    city: (() => { const s2 = $('#sf-adr-city'); return s2 && s2.style.display !== 'none' && s2.value && s2.value !== '__manual' ? s2.value : $('#sf-city').value; })(),
    district: (() => { const s2 = $('#sf-adr-district'); return s2 && s2.style.display !== 'none' && s2.value && s2.value !== '__manual' ? s2.value : $('#sf-district').value; })(),
    neighborhood: (() => { const s2 = $('#sf-adr-hood'); return s2 && s2.style.display !== 'none' && s2.value && s2.value !== '__manual' ? s2.value : ($('#sf-hood') ? $('#sf-hood').value : ''); })(),
    address: $('#sf-address').value,
    health_notes: $('#sf-health').value,
    notes: $('#sf-notes').value,
  };
  if (!schoolId) body.previous_school = $('#sf-prev') ? $('#sf-prev').value : '';
  if ($('#sf-grade')) { body.grade = $('#sf-grade').value; body.section = $('#sf-section').value; }
  return body;
}

function studentFormModal(s, onSaved) {
  openModal('Öğrenci Bilgilerini Düzenle', studentFormFields(s), {
    footHtml: `<button class="btn secondary" data-x>Vazgeç</button><button class="btn" id="sf-save">Kaydet</button>`,
    onOpen(area) {
      initSchoolPicker(s);
      initAddressPicker(s);
      area.querySelector('[data-x]').onclick = closeModal;
      area.querySelector('#sf-save').onclick = async () => {
        try {
          await api('/students/' + s.id, { method: 'PUT', body: readStudentForm() });
          toast('Öğrenci güncellendi.', 'success'); closeModal(); onSaved();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

// ---- Veli formu ----
function parentFormModal(studentId, p, onSaved) {
  openModal(p ? 'Veli Bilgilerini Düzenle' : 'Veli Ekle', `
    <div class="form-grid">
      <div class="field"><label>Yakınlık *</label><select id="pf-rel">
        ${Object.entries(RELATION_LABELS).map(([v, l]) => `<option value="${v}" ${p?.relation === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Ad Soyad *</label><input id="pf-name" value="${esc(p?.full_name || '')}"></div>
      <div class="field"><label>TC Kimlik No</label><input id="pf-tc" data-tc maxlength="11" value="${esc(p?.tc_no || '')}"></div>
      <div class="field"><label>Telefon</label><input id="pf-phone" data-phone value="${esc(p?.phone || '')}"></div>
      <div class="field"><label>Telefon 2</label><input id="pf-phone2" data-phone value="${esc(p?.phone2 || '')}"></div>
      <div class="field"><label>E-posta</label><input id="pf-email" value="${esc(p?.email || '')}"></div>
      <div class="field"><label>Meslek</label><input id="pf-occ" value="${esc(p?.occupation || '')}"></div>
      <div class="field"><label>İş Yeri</label><input id="pf-work" value="${esc(p?.workplace || '')}"></div>
      <div class="field"><label>Eğitim Durumu</label><input id="pf-edu" value="${esc(p?.education || '')}"></div>
      <div class="field full"><label>Adres</label><input id="pf-address" value="${esc(p?.address || '')}"></div>
      <div class="field"><label>Velidir</label><select id="pf-guardian">
        <option value="0" ${!p?.is_guardian ? 'selected' : ''}>Hayır</option>
        <option value="1" ${p?.is_guardian ? 'selected' : ''}>Evet (diğerlerinden kalkar)</option></select></div>
      <div class="field"><label>Ödeme Sorumlusudur</label><select id="pf-payer">
        <option value="0" ${!p?.is_payer ? 'selected' : ''}>Hayır</option>
        <option value="1" ${p?.is_payer ? 'selected' : ''}>Evet (diğerlerinden kalkar)</option></select></div>
    </div>`, {
    footHtml: `${p ? '<button class="btn danger" id="pf-del" style="margin-right:auto">Sil</button>' : ''}
      <button class="btn secondary" data-x>Vazgeç</button><button class="btn" id="pf-save">Kaydet</button>`,
    onOpen(area) {
      area.querySelector('[data-x]').onclick = closeModal;
      area.querySelector('#pf-save').onclick = async () => {
        const body = {
          relation: $('#pf-rel').value, full_name: $('#pf-name').value.trim(),
          tc_no: $('#pf-tc').value, phone: $('#pf-phone').value, phone2: $('#pf-phone2').value,
          email: $('#pf-email').value, occupation: $('#pf-occ').value, workplace: $('#pf-work').value,
          education: $('#pf-edu').value, address: $('#pf-address').value,
          is_guardian: $('#pf-guardian').value === '1',
          is_payer: $('#pf-payer').value === '1',
        };
        try {
          if (p) await api(`/students/${studentId}/parents/${p.id}`, { method: 'PUT', body });
          else await api(`/students/${studentId}/parents`, { method: 'POST', body });
          toast('Veli bilgisi kaydedildi.', 'success'); closeModal(); onSaved();
        } catch (e) { toast(e.message, 'error'); }
      };
      const del = area.querySelector('#pf-del');
      if (del) del.onclick = async () => {
        try {
          await api(`/students/${studentId}/parents/${p.id}`, { method: 'DELETE' });
          toast('Veli kaydı silindi.', 'success'); closeModal(); onSaved();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

// ---- Tahsilat modalı ----
function paymentModal(enrollment, onSaved, preselectedInstallmentId) {
  const open = enrollment.installments
    ? enrollment.installments.filter(i => i.status === 'BEKLIYOR' || i.status === 'KISMI')
    : [];
  openModal(`Tahsilat Al · ${esc(enrollment.academic_year_name || '')}`, `
    <div class="form-grid">
      <div class="field full"><label>Taksit</label><select id="pm-inst">
        <option value="">Genel ödeme (taksit seçmeden)</option>
        ${open.map(i => `<option value="${i.id}" data-remaining="${(i.amount - i.paid_amount).toFixed(2)}"
          ${preselectedInstallmentId === i.id ? 'selected' : ''}>
          ${esc(i.label)} · Vade ${fmtDate(i.due_date)} · Kalan ${fmtTL(i.amount - i.paid_amount)}</option>`).join('')}
      </select></div>
      <div class="field"><label>Tutar (TL) *</label><input type="number" step="0.01" min="0.01" id="pm-amount"></div>
      <div class="field"><label>Tarih *</label><input type="date" id="pm-date" value="${todayStr()}"></div>
      <div class="field"><label>Ödeme Türü *</label><select id="pm-method">
        ${META.payment_methods.map(m => `<option value="${m.value}" ${m.value === (enrollment.default_payment_method || 'NAKIT') ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
      <div class="field"><label>Makbuz No</label><input id="pm-receipt"></div>
      <div class="field full"><label>Açıklama</label><input id="pm-notes"></div>
    </div>
    <p class="muted mt" style="font-size:12.5px">Kalan bakiye: <b>${fmtTL(enrollment.balance ?? 0)}</b></p>`, {
    footHtml: `<button class="btn secondary" data-x>Vazgeç</button><button class="btn success" id="pm-save">💰 Tahsilatı Kaydet</button>`,
    onOpen(area) {
      const instSel = area.querySelector('#pm-inst');
      const amount = area.querySelector('#pm-amount');
      const syncAmount = () => {
        const opt = instSel.selectedOptions[0];
        if (opt && opt.dataset.remaining) amount.value = opt.dataset.remaining;
      };
      instSel.onchange = syncAmount;
      syncAmount();
      area.querySelector('[data-x]').onclick = closeModal;
      area.querySelector('#pm-save').onclick = async () => {
        try {
          const saved = await api('/payments', {
            method: 'POST',
            body: {
              enrollment_id: enrollment.id,
              installment_id: instSel.value ? Number(instSel.value) : null,
              amount: Number(amount.value),
              payment_date: area.querySelector('#pm-date').value,
              method: area.querySelector('#pm-method').value,
              receipt_no: area.querySelector('#pm-receipt').value,
              notes: area.querySelector('#pm-notes').value,
            },
          });
          toast(`Tahsilat kaydedildi. Makbuz No: ${saved.receipt_no}. Dekontu tahsilat satırındaki 🖨️ düğmesiyle yazdırabilirsiniz.`, 'success');
          closeModal(); onSaved();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

// ---- Taksit düzenleme modalı ----
function installmentEditModal(inst, onSaved) {
  openModal(`Taksit Düzenle · ${esc(inst.label)}`, `
    <div class="form-grid">
      <div class="field"><label>Vade Tarihi</label><input type="date" id="ie-due" value="${esc(inst.due_date)}"></div>
      <div class="field"><label>Tutar (TL)</label><input type="number" step="0.01" id="ie-amount" value="${inst.amount}"></div>
    </div>
    <p class="muted mt" style="font-size:12.5px">Ödenen: ${fmtTL(inst.paid_amount)} · Tutar ödenen tutarın altına indirilemez.</p>`, {
    small: true,
    footHtml: `<button class="btn secondary" data-x>Vazgeç</button><button class="btn" id="ie-save">Kaydet</button>`,
    onOpen(area) {
      area.querySelector('[data-x]').onclick = closeModal;
      area.querySelector('#ie-save').onclick = async () => {
        try {
          await api(`/enrollments/installments/${inst.id}`, {
            method: 'PUT',
            body: { due_date: $('#ie-due').value, amount: Number($('#ie-amount').value) },
          });
          toast('Taksit güncellendi.', 'success'); closeModal(); onSaved();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

// ---- Tahsilat makbuzu (dekont) yazdırma ----
function printReceipt(student, campus, enrollment, payment) {
  const copy = tag => `
    <div class="doc">
      <div class="doc-head">
        <div class="org">${esc(campus?.name || '')}
          <small>${esc(campus?.address || '')} ${campus?.phone ? '· Tel: ' + esc(campus.phone) : ''}</small></div>
        <div style="text-align:right">
          <div class="doc-title">TAHSİLAT MAKBUZU</div>
          <div class="muted">Makbuz No: <b>${esc(payment.receipt_no || '-')}</b></div>
          ${enrollment.contract_no ? `<div class="muted">Sözleşme No: <b>${esc(enrollment.contract_no)}</b></div>` : ''}
          <div class="muted">Tarih: <b>${fmtDate(payment.payment_date)}</b></div>
        </div>
      </div>
      <table>
        <tr><th style="width:22%">Öğrenci</th><td>${esc(student.first_name)} ${esc(student.last_name)} (${esc(student.student_no)})</td>
            <th style="width:18%">Sınıf</th><td>${esc(enrollment.grade || student.grade || '-')}</td></tr>
        <tr><th>Öğretim Yılı</th><td>${esc(enrollment.academic_year_name || '')}</td>
            <th>Ödeme Türü</th><td>${METHOD_LABELS[payment.method] || payment.method}</td></tr>
        <tr><th>Ödeme Kalemi</th><td>${esc(payment.installment_label || 'Genel Ödeme')}</td>
            <th>Ödemeyi Yapan</th><td>${esc(enrollment.payer_name || '-')}</td></tr>
        <tr><th>Tahsil Edilen</th><td colspan="3" class="amount-big">${fmtTL(payment.amount)}</td></tr>
      </table>
      <div class="words">YALNIZ: ${amountInWordsTR(payment.amount)}</div>
      <div class="sig-row">
        <div class="sig">Tahsil Eden<br><b>${esc(payment.received_by_name || '')}</b><br>İmza / Kaşe</div>
        <div class="sig">Ödemeyi Yapan<br><b>${esc(enrollment.payer_name || '')}</b><br>İmza</div>
      </div>
      <div style="text-align:right; margin-top:6px"><span class="copy-tag">${tag}</span></div>
    </div>`;
  printHTML(`Makbuz ${payment.receipt_no || ''}`,
    copy('VELİ NÜSHASI') + '<div class="cutline">✂ — — — — — — — — — — — — — — — — — — — — — —</div>' + copy('KURUM NÜSHASI'));
}

// ---- Senet (bono) yazdırma: açık her taksit için bir senet ----
function printSenetler(student, campus, enrollment, parents) {
  const open = enrollment.installments.filter(i =>
    (i.status === 'BEKLIYOR' || i.status === 'KISMI') && (i.amount - i.paid_amount) > 0.009);
  if (!open.length) { toast('Bu kayıtta senede bağlanacak açık taksit yok.', 'error'); return; }
  const primary = (parents || []).find(p => p.is_primary) || (parents || [])[0] || {};
  const borclu = {
    name: enrollment.payer_name || primary.full_name || '',
    tc: enrollment.payer_tc || primary.tc_no || '',
    phone: enrollment.payer_phone || primary.phone || '',
    address: primary.address || student.address || '',
  };
  const docs = open.map((inst, idx) => {
    const tutar = Math.round((inst.amount - inst.paid_amount) * 100) / 100;
    return `
    <div class="doc" ${(idx + 1) % 3 === 0 ? 'style="page-break-after:always"' : ''}>
      <div class="doc-head">
        <div class="doc-title">BONO<br><small style="font-weight:400; font-size:10.5px">(EMRE MUHARRER SENET)</small></div>
        <table style="width:auto; margin:0">
          <tr><th>Senet No</th><td>${enrollment.contract_no ? esc(enrollment.contract_no) + '-' : ''}${inst.seq_no}</td>
              <th>Tanzim Tarihi</th><td>${fmtDate(todayStr())}</td></tr>
          <tr><th>Vade Tarihi</th><td><b>${fmtDate(inst.due_date)}</b></th>
              <th>Tutar</th><td class="amount-big">${fmtTL(tutar)}</td></tr>
        </table>
      </div>
      <div class="words">YALNIZ: ${amountInWordsTR(tutar)}</div>
      <p class="senet-text">
        İşbu bono karşılığında <b>${fmtDate(inst.due_date)}</b> tarihinde
        <b>${esc(campus?.name || '')}</b> emrine yukarıda yazılı
        <b>${fmtTL(tutar)}</b> (${amountInWordsTR(tutar)}) tutarını kayıtsız şartsız
        ödeyeceğim. Bedeli malen ahzolunmuştur. İşbu bono
        <b>${esc(student.first_name)} ${esc(student.last_name)} (${esc(student.student_no)})</b> adlı öğrencinin
        <b>${esc(enrollment.academic_year_name || '')}</b> öğretim yılı ${esc(inst.label)} bedeline ilişkindir.
        Ödeme yeri: ${esc(campus?.address || campus?.name || '')}.
      </p>
      <table>
        <tr><th style="width:14%">Borçlu</th><td><b>${esc(borclu.name)}</b></td>
            <th style="width:14%">T.C. No</th><td>${esc(borclu.tc || '-')}</td></tr>
        <tr><th>Adres</th><td>${esc(borclu.address || '-')}</td>
            <th>Telefon</th><td>${esc(borclu.phone || '-')}</td></tr>
      </table>
      <div class="sig-row">
        <div class="sig">Alacaklı<br><b>${esc(campus?.name || '')}</b><br>Kaşe / İmza</div>
        <div class="sig">Borçlu<br><b>${esc(borclu.name)}</b><br>İmza</div>
      </div>
    </div>`;
  }).join('');
  printHTML(`Senetler - ${student.student_no}`, docs);
}

// ================= Sayfa: Yeni Kayıt =================
async function pageNewEnrollment() {
  const page = $('#page');
  const parts = location.hash.slice(2).split('/');
  const prefStudentId = parts[1] ? Number(parts[1]) : null;
  let selectedStudent = null;

  page.innerHTML = `
    <div class="page-head"><div><h2>Yeni Kayıt</h2>
      <div class="crumb">Öğrenci seçin veya yeni öğrenci oluşturun, ardından ücret ve taksit planını belirleyin</div></div></div>

    <div class="card">
      <h3>1. Öğrenci</h3>
      <div class="tabs">
        <button id="tab-existing" class="active">Mevcut Öğrenci</button>
        <button id="tab-new">Yeni Öğrenci</button>
      </div>
      <div id="student-existing">
        <div class="field"><label>Öğrenci ara (ad, no, TC)</label>
          <input id="ne-search" placeholder="En az 2 karakter…"></div>
        <div id="ne-results" class="mt"></div>
        <div id="ne-selected" class="mt"></div>
      </div>
      <div id="student-new" style="display:none">
        <div class="card mb0" style="background:#f2f7ff; border-color:#c9dcf7; padding:12px; margin-bottom:14px">
          <div class="flex">
            <b>🔗 CRM'den Getir</b>
            <span class="muted" style="font-size:12px">Ön kayıt/aday bilgilerini CRM'den çekerek formu otomatik doldurun</span>
            <span class="spacer"></span>
            <input id="crm-search" placeholder="Aday ara: ad, TC, form no" style="max-width:240px">
            <button class="btn sm secondary" id="crm-search-btn" type="button">Ara</button>
          </div>
          <div id="crm-results" class="mt"></div>
          <div id="crm-selected"></div>
        </div>
        ${studentFormFields({}, { noPlacement: true })}
        <div class="section-title">Sınıf Yerleşimi <span class="muted" style="font-weight:400; text-transform:none">· kayıt bilgilerine otomatik aktarılır</span></div>
        <div class="form-grid">
          <div class="field"><label>Kayıt Sınıfı *</label><select id="ne1-grade">
            ${META.grades.map(g => `<option>${g}</option>`).join('')}</select></div>
          <div class="field"><label>Bölüm *</label><select id="ne1-dept"><option value="">Kampüs seçin</option></select></div>
          <div class="field"><label>Şube * <span class="muted" style="font-weight:400">(azami 30)</span></label>
            <select id="ne1-section"><option value="">Önce bölüm seçin</option></select></div>
        </div>
        <div class="section-title">Anne Bilgileri *</div>
        <div class="form-grid">
          <div class="field"><label>Ad Soyad *</label><input id="anne-name"></div>
          <div class="field"><label>TC Kimlik No</label><input id="anne-tc" data-tc maxlength="11"></div>
          <div class="field"><label>Cep Tel</label><input id="anne-phone" data-phone></div>
          <div class="field"><label>E-posta</label><input id="anne-email"></div>
          <div class="field"><label>Meslek</label><input id="anne-occ"></div>
        </div>
        <div class="section-title">Baba Bilgileri *</div>
        <div class="form-grid">
          <div class="field"><label>Ad Soyad *</label><input id="baba-name"></div>
          <div class="field"><label>TC Kimlik No</label><input id="baba-tc" data-tc maxlength="11"></div>
          <div class="field"><label>Cep Tel</label><input id="baba-phone" data-phone></div>
          <div class="field"><label>E-posta</label><input id="baba-email"></div>
          <div class="field"><label>Meslek</label><input id="baba-occ"></div>
        </div>
        <div class="section-title">Veli ve Ödeme Sorumlusu Seçimi</div>
        <div class="form-grid">
          <div class="field"><label>Veli Kimdir? *</label><select id="fam-guardian">
            <option value="ANNE">Anne</option><option value="BABA">Baba</option>
            <option value="DIGER">Başka Kişi (aşağıda)</option></select></div>
          <div class="field"><label>Ödeme Sorumlusu Kimdir? *</label><select id="fam-payer">
            <option value="ANNE">Anne</option><option value="BABA">Baba</option>
            <option value="DIGER">Başka Kişi (aşağıda)</option></select></div>
        </div>
        <div id="other-person" style="display:none">
          <div class="section-title">Diğer Şahıs Bilgileri</div>
          <div class="form-grid">
            <div class="field"><label>Yakınlık *</label><select id="op-rel">
              ${['ABI', 'ABLA', 'DEDE', 'NINE', 'AMCA', 'HALA', 'DAYI', 'TEYZE', 'KUZEN', 'VASI', 'DIGER']
                .map(r => `<option value="${r}">${RELATION_LABELS[r]}</option>`).join('')}</select></div>
            <div class="field"><label>Ad Soyad *</label><input id="op-name"></div>
            <div class="field"><label>TC Kimlik No</label><input id="op-tc" data-tc maxlength="11"></div>
            <div class="field"><label>Cep Tel *</label><input id="op-phone" data-phone></div>
            <div class="field"><label>E-posta</label><input id="op-email"></div>
            <div class="field"><label>Meslek</label><input id="op-occ"></div>
          </div>
        </div>
        <div class="section-title">Evrak Listesi <span class="muted" style="font-weight:400; text-transform:none">· teslim alınanları işaretleyin, eksikler sonradan tamamlanabilir</span></div>
        <div class="form-grid" id="sf-docs" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
          <span class="muted">Yükleniyor…</span>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>2. Ücret Kalemleri <span class="muted" style="font-weight:400; font-size:12.5px">· MEB'e ilan edilen liste fiyatlarından</span></h3>
      <div id="ne-items"><div class="empty">Kalemleri görmek için öğrenci (veya yeni öğrenci sekmesinde kampüs) ve öğretim yılı seçin.</div></div>
      <div class="flex mt" style="justify-content:flex-end; gap:22px; font-size:14px">
        <span>Liste: <b id="ne-total-list">₺0,00</b></span>
        <span style="color:var(--danger)">İndirim: <b id="ne-total-disc">₺0,00</b></span>
        <span style="font-size:15px">Net Toplam: <b id="ne-total-net">₺0,00</b></span>
      </div>
    </div>

    <div class="card">
      <h3>3. Kayıt, İndirim ve Taksit Bilgileri</h3>
      <p class="muted" id="ne-limit-hint" style="font-size:12.5px; margin-bottom:10px"></p>
      <div class="form-grid">
        ${yearSelect('ne-year', { allowAll: false })}
        <div class="field"><label>Kayıt Türü</label><select id="ne-type">
          ${META.enrollment_types.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select></div>
        <div class="field"><label>Kayıt Sınıfı *</label><select id="ne-grade">
          ${META.grades.map(g => `<option>${g}</option>`).join('')}</select></div>
        <div class="field"><label>Bölüm *</label><select id="ne-dept"><option value="">Önce öğrenci/kampüs seçin</option></select></div>
        <div class="field"><label>Şube * <span class="muted" style="font-weight:400">(azami 30 öğrenci)</span></label>
          <select id="ne-section"><option value="">Önce bölüm seçin</option></select></div>
        <div class="field"><label>Kayıt Tarihi</label><input type="date" id="ne-date" value="${todayStr()}"></div>
        <div class="field"><label>İndirim Gerekçesi</label><input id="ne-discount-reason" placeholder="Kardeş, erken kayıt, burs…"></div>
        <div class="field"><label>Varsayılan Ödeme Türü</label><select id="ne-method">
          ${META.payment_methods.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}</select></div>
        <div class="field"><label>Peşinat (TL)</label><input type="number" step="0.01" min="0" id="ne-down" value="0"></div>
        <div class="field"><label>Taksit Sayısı</label><select id="ne-count">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => `<option value="${n}" ${n === 9 ? 'selected' : ''}>${n === 0 ? 'Peşin (taksitsiz)' : n + ' taksit'}</option>`).join('')}</select></div>
        <div class="field"><label>İlk Taksit Tarihi</label><input type="date" id="ne-first-due"></div>
        <div class="field"><label>Ödeme Sorumlusu (Veli)</label>
          <div class="flex" style="gap:6px; flex-wrap:nowrap">
            <input id="ne-payer" style="flex:1">
            <button class="btn sm secondary" id="ne-payer-pick" type="button" title="Birincil veli bilgilerinden doldur">👤 Veliden Al</button>
          </div></div>
        <div class="field"><label>Ödeme Sorumlusu Telefon</label><input id="ne-payer-phone" data-phone></div>
        <div class="field"><label>Ödeme Sorumlusu TC</label><input id="ne-payer-tc" data-tc maxlength="11"></div>
        <div class="field full"><label>Notlar</label><input id="ne-notes"></div>
      </div>
      <div class="flex mt">
        <button class="btn secondary" id="ne-preview">📋 Taksit Planını Önizle</button>
        <span class="spacer"></span>
        <button class="btn" id="ne-save">✅ Kaydı Tamamla</button>
      </div>
      <div id="ne-plan" class="mt"></div>
    </div>`;

  // İlk taksit tarihi varsayılanı: gelecek ayın 15'i
  const now = new Date();
  const firstDue = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 15));
  $('#ne-first-due').value = firstDue.toISOString().slice(0, 10);

  // ---- Sekmeler ----
  let mode = 'existing';
  const setMode = m => {
    mode = m;
    $('#tab-existing').classList.toggle('active', m === 'existing');
    $('#tab-new').classList.toggle('active', m === 'new');
    $('#student-existing').style.display = m === 'existing' ? '' : 'none';
    $('#student-new').style.display = m === 'new' ? '' : 'none';
    // Yeni öğrenci = dış kayıt, mevcut öğrenci = iç kayıt (değiştirilebilir)
    const typeSel = $('#ne-type');
    if (typeSel) typeSel.value = m === 'new' ? 'DIS_KAYIT' : 'IC_KAYIT';
    loadItems();
  };
  $('#tab-existing').onclick = () => setMode('existing');
  $('#tab-new').onclick = () => setMode('new');

  // ---- CRM aday getirme (yeni öğrenci sekmesi) ----
  let selectedCrmFormId = '';
  async function crmSearch() {
    const term = $('#crm-search').value.trim();
    try {
      const d = await api('/students/crm/candidates?search=' + encodeURIComponent(term));
      if (!$('#crm-results')) return;
      $('#crm-results').innerHTML = d.candidates.length ? `
        <div class="table-wrap"><table>
          <tbody>${d.candidates.map(c => `
            <tr class="clickable" data-crm="${c.id}">
              <td><b>${esc(c.first_name)} ${esc(c.last_name)}</b></td>
              <td>${esc(c.grade || '-')}. sınıf</td>
              <td>${esc(c.city || '')} ${esc(c.district || '')}</td>
              <td class="muted" style="font-size:11.5px">Form: ${esc(c.crm_form_id)}${c.campus_code ? ' · ' + esc(c.campus_code) : ''}</td>
            </tr>`).join('')}</tbody></table></div>` :
        '<div class="muted" style="padding:8px">Bekleyen aday bulunamadı.</div>';
      $('#crm-results').querySelectorAll('[data-crm]').forEach(row => row.onclick = () => {
        fillFromCandidate(d.candidates.find(c => c.id === Number(row.dataset.crm)));
      });
    } catch (e) { toast(e.message, 'error'); }
  }
  function fillFromCandidate(c) {
    if (!c) return;
    selectedCrmFormId = c.crm_form_id;
    const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
    set('#sf-first', c.first_name); set('#sf-last', c.last_name); set('#sf-tc', c.tc_no);
    set('#sf-birth', c.birth_date);
    if ($('#sf-gender')) $('#sf-gender').value = c.gender || '';
    set('#sf-city', c.city); set('#sf-district', c.district); set('#sf-hood', c.neighborhood);
    set('#sf-address', c.address);
    if (c.grade && $('#ne1-grade')) { $('#ne1-grade').value = c.grade; }
    // Kampüs (genel merkez için) aday kampüs koduna göre
    if (isHQ() && c.campus_code && $('#sf-campus')) {
      const camp = CAMPUSES.find(x => x.code === c.campus_code);
      if (camp) $('#sf-campus').value = String(camp.id);
    }
    // Veliler: anne/baba/diğer alanlarına dağıt
    const anne = (c.parents || []).find(p => p.relation === 'ANNE');
    const baba = (c.parents || []).find(p => p.relation === 'BABA');
    if (anne) { set('#anne-name', anne.full_name); set('#anne-tc', anne.tc_no); set('#anne-phone', anne.phone); set('#anne-email', anne.email); set('#anne-occ', anne.occupation); }
    if (baba) { set('#baba-name', baba.full_name); set('#baba-tc', baba.tc_no); set('#baba-phone', baba.phone); set('#baba-email', baba.email); set('#baba-occ', baba.occupation); }
    $('#crm-selected').innerHTML = `<div class="card mb0 mt" style="padding:10px; background:#eef5ee">
      ✔ CRM adayı forma aktarıldı: <b>${esc(c.first_name)} ${esc(c.last_name)}</b> (Form: ${esc(c.crm_form_id)}).
      Kayıt tamamlanınca okul no, sözleşme no ve sınıf bilgileri CRM'e geri iletilecek.</div>`;
    $('#crm-results').innerHTML = '';
    $('#crm-search').value = '';
    if ($('#sf-campus')) loadItems();
  }
  $('#crm-search-btn').onclick = crmSearch;
  $('#crm-search').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); crmSearch(); } });

  // ---- Ücret kalemleri (MEB ilan listesi, kalem bazlı indirim) ----
  let itemsState = [];
  let limitsState = null;

  const currentCampusId = () => {
    if (mode === 'existing') return selectedStudent ? selectedStudent.campus_id : null;
    return isHQ() ? Number($('#sf-campus')?.value) : USER.campus.id;
  };

  const itemGross = i => (i.checked && i.price ? i.price * i.qty : 0);
  const itemDiscount = i => {
    const gross = itemGross(i);
    if (!gross) return 0;
    if (i.discRate) return Math.min(gross, Math.round(gross * i.discRate) / 100);
    if (i.discAmount) return Math.min(gross, i.discAmount);
    return 0;
  };
  const totalGross = () => itemsState.reduce((a, i) => a + itemGross(i), 0);
  const totalDiscount = () => itemsState.reduce((a, i) => a + itemDiscount(i), 0);

  function renderItemsTable() {
    const priced = itemsState.filter(i => i.active);
    $('#ne-items').innerHTML = priced.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th style="width:40px"></th><th>Kalem</th><th class="num">İlan Fiyatı</th>
        <th class="num" style="width:80px">Adet</th><th class="num">Tutar</th>
        <th class="num" style="width:100px">İndirim %</th><th class="num" style="width:130px">İndirim TL</th>
        <th class="num">Net</th></tr></thead>
        <tbody>${priced.map((i, idx) => {
          const gross = itemGross(i);
          const disc = itemDiscount(i);
          const dis = i.price === null || !i.checked ? 'disabled' : '';
          return `
          <tr style="${i.price === null ? 'opacity:.5' : ''}">
            <td><input type="checkbox" style="width:auto" data-item-check="${idx}"
              ${i.checked ? 'checked' : ''} ${i.price === null ? 'disabled' : ''}></td>
            <td><b>${esc(i.name)}</b>${i.price === null ? ' <span class="muted" style="font-size:11.5px">(ilan edilmemiş)</span>' : ''}</td>
            <td class="num">${i.price === null ? '-' : fmtTL(i.price)}</td>
            <td class="num"><input type="number" min="1" max="20" value="${i.qty}" data-item-qty="${idx}"
              style="width:64px; text-align:right" ${dis}></td>
            <td class="num">${i.checked && i.price ? fmtTL(gross) : '-'}</td>
            <td class="num"><input type="number" min="0" max="100" step="0.01"
              placeholder="${i.maxRate != null ? '≤%' + i.maxRate : '%'}"
              title="${i.maxRate != null ? 'Bu kalem için azami indirim: %' + i.maxRate : ''}"
              value="${i.discRate || ''}" data-item-rate="${idx}" style="width:80px; text-align:right" ${dis}></td>
            <td class="num"><input type="number" min="0" step="0.01"
              placeholder="${i.maxAmount != null ? '≤' + i.maxAmount : 'TL'}"
              title="${i.maxAmount != null ? 'Bu kalem için azami indirim: ' + fmtTL(i.maxAmount) : ''}"
              value="${i.discRate ? disc.toFixed(2) : (i.discAmount || '')}" data-item-amount="${idx}"
              style="width:110px; text-align:right" ${dis} ${i.discRate ? 'readonly' : ''}></td>
            <td class="num"><b>${i.checked && i.price ? fmtTL(gross - disc) : '-'}</b></td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
      <p class="muted" style="font-size:12px; margin-top:6px">Her kaleme ayrı indirim uygulayabilirsiniz:
        oran (%) girerseniz tutar otomatik hesaplanır; oranı boş bırakıp doğrudan TL tutarı da girebilirsiniz.</p>` :
      '<div class="empty">Bu kampüs ve öğretim yılı için ilan edilmiş ücret listesi yok.<br>Önce <b>Parametreler</b> sayfasından liste fiyatlarını girin.</div>';
    $('#ne-total-list').textContent = fmtTL(totalGross());
    $('#ne-total-disc').textContent = fmtTL(totalDiscount());
    $('#ne-total-net').textContent = fmtTL(totalGross() - totalDiscount());
    $('#ne-limit-hint').textContent = limitsState &&
      (limitsState.max_discount_rate !== null || limitsState.max_discount_amount !== null)
      ? 'Bu kampüste izin verilen azami toplam indirim: ' +
        [limitsState.max_discount_rate !== null ? `%${limitsState.max_discount_rate}` : null,
         limitsState.max_discount_amount !== null ? fmtTL(limitsState.max_discount_amount) : null]
          .filter(Boolean).join(' ve ')
      : '';
    const active = itemsState.filter(i => i.active);
    $('#ne-items').querySelectorAll('[data-item-check]').forEach(cb => cb.onchange = () => {
      active[Number(cb.dataset.itemCheck)].checked = cb.checked;
      renderItemsTable();
    });
    $('#ne-items').querySelectorAll('[data-item-qty]').forEach(inp => inp.onchange = () => {
      const it = active[Number(inp.dataset.itemQty)];
      it.qty = Math.max(1, Math.min(20, parseInt(inp.value, 10) || 1));
      renderItemsTable();
    });
    $('#ne-items').querySelectorAll('[data-item-rate]').forEach(inp => inp.onchange = () => {
      const it = active[Number(inp.dataset.itemRate)];
      let v = parseFloat(inp.value);
      v = isNaN(v) || v <= 0 ? 0 : Math.min(100, v);
      if (it.maxRate != null && v > it.maxRate) {
        toast(`"${it.name}" için azami indirim oranı %${it.maxRate} — değer buna indirildi.`, 'error');
        v = it.maxRate;
      }
      it.discRate = v;
      if (it.discRate) it.discAmount = 0;
      renderItemsTable();
    });
    $('#ne-items').querySelectorAll('[data-item-amount]').forEach(inp => inp.onchange = () => {
      const it = active[Number(inp.dataset.itemAmount)];
      if (it.discRate) return; // oran girildiyse tutar otomatik
      let v = parseFloat(inp.value);
      v = isNaN(v) || v <= 0 ? 0 : v;
      if (it.maxAmount != null && v > it.maxAmount) {
        toast(`"${it.name}" için azami indirim tutarı ${fmtTL(it.maxAmount)} — değer buna indirildi.`, 'error');
        v = it.maxAmount;
      }
      it.discAmount = v;
      renderItemsTable();
    });
  }

  async function loadSections() {
    const campus = currentCampusId();
    const year = $('#ne-year')?.value;
    const dept = $('#ne-dept')?.value;
    const grade = $('#ne-grade')?.value;
    const sel = $('#ne-section');
    if (!sel) return;
    if (!campus || !year || !dept || !grade) {
      sel.innerHTML = '<option value="">Önce bölüm seçin</option>';
      return;
    }
    try {
      const d = await api(`/parameters/sections?campus_id=${campus}&academic_year_id=${year}&department_id=${dept}&grade=${grade}`);
      if (!$('#ne-section')) return;
      if (d.plan_missing) {
        sel.innerHTML = '<option value="">⚠ Şube planı tanımlanmamış (Parametreler)</option>';
        return;
      }
      const optionsHtml = d.sections.map(x =>
        `<option value="${x.section}" ${x.full ? 'disabled' : ''}>${x.section} şubesi (${x.current}/${x.capacity})${x.full ? ' - DOLU' : ''}</option>`
      ).join('') || '<option value="">Şube yok</option>';
      const firstOpen = d.sections.find(x => !x.full);
      for (const id of ['#ne-section', '#ne1-section']) {
        const el = $(id);
        if (!el) continue;
        el.innerHTML = optionsHtml;
        if (firstOpen) el.value = firstOpen.section;
      }
    } catch (e) { toast(e.message, 'error'); }
  }

  async function loadItems() {
    const campus = currentCampusId();
    const year = $('#ne-year').value;
    if (!campus || !year) {
      itemsState = []; limitsState = null;
      $('#ne-items').innerHTML = '<div class="empty">Kalemleri görmek için öğrenci (veya yeni öğrenci sekmesinde kampüs) ve öğretim yılı seçin.</div>';
      $('#ne-dept').innerHTML = '<option value="">Önce öğrenci/kampüs seçin</option>';
      loadSections();
      return;
    }
    try {
      const d = await api(`/parameters?campus_id=${campus}&academic_year_id=${year}`);
      if (!$('#ne-items')) return; // sayfa değişmiş
      limitsState = d.limits;
      itemsState = d.fee_items.map((i, idx) => ({
        id: i.id, name: i.name, price: i.price, active: !!i.active,
        checked: idx === 0 && i.price !== null, // ilk kalem (genelde Eğitim Ücreti) hazır seçili
        qty: 1, discRate: 0, discAmount: 0,
        maxRate: i.max_discount_rate, maxAmount: i.max_discount_amount,
      }));
      renderItemsTable();
      // Bölüm listesi
      const active = (d.departments || []).filter(x => x.active);
      const deptHtml = active.length
        ? active.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')
        : '<option value="">⚠ Bölüm tanımlanmamış (Parametreler)</option>';
      for (const id of ['#ne-dept', '#ne1-dept']) {
        const el = $(id);
        if (!el) continue;
        const prev = el.value;
        el.innerHTML = deptHtml;
        if (prev && active.some(x => String(x.id) === prev)) el.value = prev;
      }
      // Öğrencinin mevcut bölümü varsa seç
      if (mode === 'existing' && selectedStudent?.department_id &&
          active.some(x => x.id === selectedStudent.department_id)) {
        $('#ne-dept').value = String(selectedStudent.department_id);
      }
      await loadSections();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Öğrenci arama ----
  function showSelected() {
    $('#ne-selected').innerHTML = selectedStudent ? `
      <div class="card mb0" style="padding:12px; background:#eef5ee">
        Seçilen öğrenci: <b>${esc(selectedStudent.first_name)} ${esc(selectedStudent.last_name)}</b>
        (${esc(selectedStudent.student_no)}) · ${esc(selectedStudent.campus_name)}
      </div>` : '';
    if (selectedStudent) {
      $('#ne-grade').value = META.grades.includes(selectedStudent.grade) ? selectedStudent.grade : META.grades[0];
      // Ödeme sorumlusu boşsa birincil veliden doldur
      if (!$('#ne-payer').value.trim()) {
        api('/students/' + selectedStudent.id).then(d => {
          const p = d.parents.find(x => x.is_payer) || d.parents.find(x => x.is_primary) || d.parents[0];
          if (p && $('#ne-payer') && !$('#ne-payer').value.trim()) {
            $('#ne-payer').value = p.full_name;
            $('#ne-payer-phone').value = p.phone || '';
            $('#ne-payer-tc').value = p.tc_no || '';
          }
        }).catch(() => {});
      }
    }
    loadItems();
  }
  let debounce;
  $('#ne-search').oninput = e => {
    clearTimeout(debounce);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#ne-results').innerHTML = ''; return; }
    debounce = setTimeout(async () => {
      try {
        const d = await api('/students?' + new URLSearchParams({ search: q, page_size: 10 }));
        $('#ne-results').innerHTML = `<div class="table-wrap"><table>
          <tbody>${d.students.map(s => `
            <tr class="clickable" data-pick="${s.id}">
              <td>${esc(s.student_no)}</td><td><b>${esc(s.first_name)} ${esc(s.last_name)}</b></td>
              <td>${esc(s.grade)}</td><td>${esc(s.campus_name)}</td><td>${esc(s.parent_name || '')}</td>
            </tr>`).join('') || '<tr><td class="empty">Sonuç yok</td></tr>'}
          </tbody></table></div>`;
        $('#ne-results').querySelectorAll('[data-pick]').forEach(row => row.onclick = () => {
          selectedStudent = d.students.find(s => s.id === Number(row.dataset.pick));
          $('#ne-results').innerHTML = '';
          $('#ne-search').value = '';
          showSelected();
        });
      } catch (err) { toast(err.message, 'error'); }
    }, 300);
  };

  if (prefStudentId) {
    try {
      const d = await api('/students/' + prefStudentId);
      selectedStudent = { ...d.student, campus_name: d.student.campus_name };
      showSelected();
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Plan önizleme ----
  const planBody = () => ({
    list_fee: totalGross(),
    discount_amount: totalDiscount(),
    down_payment: Number($('#ne-down').value) || 0,
    installment_count: Number($('#ne-count').value),
    first_due_date: $('#ne-first-due').value,
  });
  const selectedItems = () => itemsState
    .filter(i => i.checked && i.price !== null)
    .map(i => ({
      fee_item_id: i.id, quantity: i.qty,
      discount_rate: i.discRate || 0,
      discount_amount: i.discRate ? 0 : (i.discAmount || 0),
    }));

  $('#ne-year').onchange = loadItems;
  // 1. bölümdeki yerleşim ile 3. bölümdeki kayıt alanları birbirine bağlı çalışır
  const syncPlacement = from => {
    const map = [['#ne1-grade', '#ne-grade'], ['#ne1-dept', '#ne-dept'], ['#ne1-section', '#ne-section']];
    for (const [a, b] of map) {
      const src2 = from === 'step1' ? $(a) : $(b);
      const dst = from === 'step1' ? $(b) : $(a);
      if (src2 && dst) dst.value = src2.value;
    }
  };
  $('#ne-dept').onchange = () => { syncPlacement('step3'); loadSections(); };
  $('#ne-grade').onchange = () => { syncPlacement('step3'); loadSections(); };
  $('#ne-section').onchange = () => syncPlacement('step3');
  for (const [id, mirror] of [['#ne1-grade', true], ['#ne1-dept', true], ['#ne1-section', false]]) {
    const el = $(id);
    if (el) el.onchange = () => { syncPlacement('step1'); if (mirror) loadSections(); };
  }
  const sfCampusSel = $('#sf-campus');
  if (sfCampusSel) sfCampusSel.onchange = loadItems;

  // Evrak listesi + önceki okul zinciri (yeni öğrenci sekmesi)
  (async () => {
    try {
      const d = await api('/parameters/documents');
      const wrap = $('#sf-docs');
      if (!wrap) return;
      wrap.innerHTML = d.document_types.filter(x => x.active).map(x => `
        <label style="display:flex; gap:8px; align-items:center; font-weight:400; text-transform:none">
          <input type="checkbox" style="width:auto" data-doc="${x.id}"> ${esc(x.name)}</label>`).join('');
    } catch {}
  })();
  initSchoolPicker({});
  initAddressPicker({});

  // Diğer şahıs bloğu: veli/ödeme sorumlusu 'Başka Kişi' seçilirse açılır
  const currentPayerFields = () => {
    const sel = $('#fam-payer').value;
    if (sel === 'ANNE') return { name: $('#anne-name').value.trim(), phone: $('#anne-phone').value, tc: $('#anne-tc').value };
    if (sel === 'BABA') return { name: $('#baba-name').value.trim(), phone: $('#baba-phone').value, tc: $('#baba-tc').value };
    return { name: $('#op-name').value.trim(), phone: $('#op-phone').value, tc: $('#op-tc').value };
  };
  const fillPayerFromFamily = force => {
    if (mode !== 'new') return;
    const p = currentPayerFields();
    if (!p.name) return;
    if (force || !$('#ne-payer').value.trim()) {
      $('#ne-payer').value = p.name;
      $('#ne-payer-phone').value = p.phone || '';
      $('#ne-payer-tc').value = p.tc || '';
    }
  };
  const syncOtherPerson = () => {
    const show = $('#fam-guardian').value === 'DIGER' || $('#fam-payer').value === 'DIGER';
    $('#other-person').style.display = show ? '' : 'none';
  };
  $('#fam-guardian').onchange = syncOtherPerson;
  $('#fam-payer').onchange = () => { syncOtherPerson(); fillPayerFromFamily(true); };
  for (const id of ['anne-name', 'baba-name', 'op-name', 'anne-phone', 'baba-phone', 'op-phone', 'anne-tc', 'baba-tc', 'op-tc']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('blur', () => {
      const owner = id.startsWith('anne') ? 'ANNE' : id.startsWith('baba') ? 'BABA' : 'DIGER';
      fillPayerFromFamily($('#fam-payer').value === owner);
    });
  }

  // Ödeme sorumlusu: seçili kişiden doldur
  $('#ne-payer-pick').onclick = async () => {
    if (mode === 'new') {
      const p = currentPayerFields();
      if (!p.name) return toast('Önce 1. bölümde ödeme sorumlusu olarak seçtiğiniz kişinin adını girin.', 'error');
      $('#ne-payer').value = p.name;
      $('#ne-payer-phone').value = p.phone || '';
      $('#ne-payer-tc').value = p.tc || '';
      toast('Ödeme sorumlusu bilgileri dolduruldu.', 'success');
    } else {
      if (!selectedStudent) return toast('Önce bir öğrenci seçin.', 'error');
      try {
        const d = await api('/students/' + selectedStudent.id);
        const p = d.parents.find(x => x.is_payer) || d.parents.find(x => x.is_primary) || d.parents[0];
        if (!p) return toast('Bu öğrencinin veli kaydı yok.', 'error');
        $('#ne-payer').value = p.full_name;
        $('#ne-payer-phone').value = p.phone || '';
        $('#ne-payer-tc').value = p.tc_no || '';
        toast(`Ödeme sorumlusu: ${p.full_name} (${RELATION_LABELS[p.relation] || 'Veli'})`, 'success');
      } catch (e) { toast(e.message, 'error'); }
    }
  };

  $('#ne-preview').onclick = async () => {
    try {
      const d = await api('/enrollments/preview-plan', { method: 'POST', body: planBody() });
      $('#ne-plan').innerHTML = `
        <div class="section-title">Taksit Planı Önizleme · Net Ücret: ${fmtTL(d.net_fee)}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Taksit</th><th>Vade Tarihi</th><th class="num">Tutar</th></tr></thead>
          <tbody>${d.plan.map(p => `<tr><td>${esc(p.label)}</td><td>${fmtDate(p.due_date)}</td>
            <td class="num">${fmtTL(p.amount)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="2">TOPLAM</th><th class="num">${fmtTL(d.plan.reduce((a, p) => a + p.amount, 0))}</th></tr></tfoot>
        </table></div>`;
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---- Kaydet ----
  $('#ne-save').onclick = async () => {
    try {
      // Kayıt türünü baştan yakala: yeni öğrenci oluşturulunca mod değişse de tür korunur
      const enrollmentType = $('#ne-type').value;
      let studentId;
      if (mode === 'existing') {
        if (!selectedStudent) throw new Error('Lütfen bir öğrenci seçin veya "Yeni Öğrenci" sekmesinden oluşturun.');
        studentId = selectedStudent.id;
      } else {
        const body = readStudentForm();
        const guardianSel = $('#fam-guardian').value;
        const payerSel = $('#fam-payer').value;
        const anne = {
          relation: 'ANNE', full_name: $('#anne-name').value.trim(),
          tc_no: $('#anne-tc').value, phone: $('#anne-phone').value,
          email: $('#anne-email').value, occupation: $('#anne-occ').value,
          is_guardian: guardianSel === 'ANNE', is_payer: payerSel === 'ANNE',
        };
        const baba = {
          relation: 'BABA', full_name: $('#baba-name').value.trim(),
          tc_no: $('#baba-tc').value, phone: $('#baba-phone').value,
          email: $('#baba-email').value, occupation: $('#baba-occ').value,
          is_guardian: guardianSel === 'BABA', is_payer: payerSel === 'BABA',
        };
        if (!anne.full_name) throw new Error('Anne ad soyad zorunludur.');
        if (!baba.full_name) throw new Error('Baba ad soyad zorunludur.');
        body.parents = [anne, baba];
        if (guardianSel === 'DIGER' || payerSel === 'DIGER') {
          const other = {
            relation: $('#op-rel').value, full_name: $('#op-name').value.trim(),
            tc_no: $('#op-tc').value, phone: $('#op-phone').value,
            email: $('#op-email').value, occupation: $('#op-occ').value,
            is_guardian: guardianSel === 'DIGER', is_payer: payerSel === 'DIGER',
          };
          if (!other.full_name || !other.phone) {
            throw new Error('Diğer şahıs için ad soyad ve telefon zorunludur.');
          }
          body.parents.push(other);
        }
        body.documents = [...document.querySelectorAll('#sf-docs [data-doc]:checked')]
          .map(cb => Number(cb.dataset.doc));
        if (selectedCrmFormId) body.crm_form_id = selectedCrmFormId;
        // Ödeme sorumlusu alanları HER ZAMAN seçilen kişiden dolar (seçim belirleyicidir)
        const payerP = body.parents.find(x => x.is_payer);
        if (payerP) {
          $('#ne-payer').value = payerP.full_name;
          $('#ne-payer-phone').value = payerP.phone || '';
          $('#ne-payer-tc').value = payerP.tc_no || '';
        }
        const created = await api('/students', { method: 'POST', body });
        studentId = created.id;
        toast(`Öğrenci oluşturuldu: ${created.student_no}`, 'success');
        // Kayıt adımı hata verirse ikinci denemede öğrenci mükerrer oluşmasın:
        // öğrenciyi seçili hale getirip "Mevcut Öğrenci" moduna geç
        selectedStudent = {
          id: created.id, student_no: created.student_no,
          first_name: body.first_name, last_name: body.last_name,
          campus_id: body.campus_id, grade: body.grade,
          campus_name: (CAMPUSES.find(c => c.id === Number(body.campus_id)) || {}).name || '',
        };
        setMode('existing');
        showSelected();
      }
      const items = selectedItems();
      if (!items.length) throw new Error('En az bir ücret kalemi seçmelisiniz.');
      const enrollment = await api('/enrollments', {
        method: 'POST',
        body: {
          student_id: studentId,
          academic_year_id: Number($('#ne-year').value),
          enrollment_type: enrollmentType,
          enrollment_date: $('#ne-date').value,
          grade: $('#ne-grade').value,
          department_id: Number($('#ne-dept').value) || null,
          section: $('#ne-section').value,
          items,
          ...planBody(),
          discount_reason: $('#ne-discount-reason').value,
          default_payment_method: $('#ne-method').value,
          payer_name: $('#ne-payer').value,
          payer_phone: $('#ne-payer-phone').value,
          payer_tc: $('#ne-payer-tc').value,
          notes: $('#ne-notes').value,
        },
      });
      toast(`Kayıt başarıyla oluşturuldu. Sözleşme No: ${enrollment.contract_no}`, 'success');
      location.hash = '#/ogrenci/' + studentId;
    } catch (e) { toast(e.message, 'error'); }
  };
}

// ================= Sayfa: Tahsilatlar =================
async function pagePayments() {
  const page = $('#page');
  const state = { page: 1 };
  page.innerHTML = `
    <div class="page-head"><div><h2>Tahsilatlar</h2><div class="crumb">Alınan ödemelerin listesi</div></div>
      ${can('report.export') ? '<button class="btn secondary" id="pay-excel">⬇️ Excel İndir</button>' : ''}</div>
    <div class="card">
      <div class="toolbar">
        ${campusSelect('pay-campus')}
        <div class="field"><label>Başlangıç</label><input type="date" id="pay-start"></div>
        <div class="field"><label>Bitiş</label><input type="date" id="pay-end"></div>
        <div class="field"><label>Ödeme Türü</label><select id="pay-method"><option value="">Tümü</option>
          ${META.payment_methods.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}</select></div>
        <button class="btn" id="pay-filter">Filtrele</button>
      </div>
      <div id="pay-summary"></div>
      <div id="pay-table"><div class="empty">Yükleniyor…</div></div>
    </div>`;

  const buildQs = () => {
    const qs = new URLSearchParams({ page: state.page, page_size: 25 });
    const campus = $('#pay-campus')?.value; if (campus) qs.set('campus_id', campus);
    if ($('#pay-start').value) qs.set('start_date', $('#pay-start').value);
    if ($('#pay-end').value) qs.set('end_date', $('#pay-end').value);
    if ($('#pay-method').value) qs.set('method', $('#pay-method').value);
    return qs;
  };

  async function load() {
    let d;
    try { d = await api('/payments?' + buildQs()); } catch (e) { toast(e.message, 'error'); return; }
    if (!$('#pay-summary')) return; // sayfa değişmiş
    $('#pay-summary').innerHTML = `<p class="muted" style="margin-bottom:10px">
      Filtreye uyan <b>${d.total.toLocaleString('tr-TR')}</b> işlem · Toplam tutar: <b>${fmtTL(d.total_amount)}</b></p>`;
    $('#pay-table').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Öğrenci</th><th>Kampüs</th><th>Taksit</th>
        <th class="num">Tutar</th><th>Ödeme Türü</th><th>Makbuz</th><th>Tahsil Eden</th></tr></thead>
        <tbody>${d.payments.map(p => `
          <tr class="clickable" onclick="location.hash='#/ogrenci/${p.enrollment_id ? '' : ''}'" style="${p.cancelled ? 'opacity:.5;text-decoration:line-through' : ''}">
            <td>${fmtDate(p.payment_date)}</td>
            <td><b>${esc(p.student_name)}</b><br><span class="muted" style="font-size:11.5px">${esc(p.student_no)}</span></td>
            <td>${esc(p.campus_name)}</td>
            <td>${esc(p.installment_label || 'Genel')}</td>
            <td class="num"><b>${fmtTL(p.amount)}</b></td>
            <td>${METHOD_LABELS[p.method] || p.method}</td>
            <td>${esc(p.receipt_no || '-')}</td>
            <td>${esc(p.received_by_name || '-')}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="empty">Kayıt yok</td></tr>'}
        </tbody></table></div>
      ${pagerHtml(d.page, d.page_size, d.total)}`;
    $('#pay-table').querySelectorAll('[data-page]').forEach(b => b.onclick = () => { state.page = Number(b.dataset.page); load(); });
  }
  $('#pay-filter').onclick = () => { state.page = 1; load(); };
  const excelBtn = $('#pay-excel');
  if (excelBtn) excelBtn.onclick = async () => {
    try {
      const qs = buildQs(); qs.delete('page'); qs.delete('page_size');
      await downloadExcel('/reports/tahsilatlar/excel?' + qs, `tahsilatlar-${todayStr()}.xlsx`);
    } catch (e) { toast(e.message, 'error'); }
  };
  await load();
}

// ================= Sayfa: Taksit Takibi =================
async function pageInstallments() {
  const page = $('#page');
  const state = { page: 1, filter: 'overdue' };
  page.innerHTML = `
    <div class="page-head"><div><h2>Taksit Takibi</h2>
      <div class="crumb">Vadesi geçen, yaklaşan ve gelecek taksitlerin takibi</div></div>
      ${can('report.export') ? '<button class="btn secondary" id="inst-excel">⬇️ Excel İndir</button>' : ''}</div>
    <div class="card">
      <div class="tabs">
        <button data-f="overdue" class="active">🔴 Vadesi Geçen</button>
        <button data-f="upcoming">🟡 30 Gün İçinde</button>
        <button data-f="future">🟢 Gelecek Tüm Taksitler</button>
        <button data-f="">Tümü (Açık)</button>
      </div>
      <div class="toolbar">
        ${campusSelect('inst-campus')}
        <div class="field grow"><label>Öğrenci ara</label><input id="inst-search" placeholder="Ad veya öğrenci no"></div>
      </div>
      <div id="inst-summary"></div>
      <div id="inst-table"><div class="empty">Yükleniyor…</div></div>
    </div>`;

  const buildQs = () => {
    const qs = new URLSearchParams({ page: state.page, page_size: 25 });
    if (state.filter) qs.set('filter', state.filter);
    const campus = $('#inst-campus')?.value; if (campus) qs.set('campus_id', campus);
    const search = $('#inst-search').value.trim(); if (search) qs.set('search', search);
    return qs;
  };

  async function load() {
    let d;
    try { d = await api('/payments/installments?' + buildQs()); } catch (e) { toast(e.message, 'error'); return; }
    if (!$('#inst-summary')) return; // sayfa değişmiş
    $('#inst-summary').innerHTML = `<p class="muted" style="margin-bottom:10px">
      <b>${d.total.toLocaleString('tr-TR')}</b> açık taksit · Toplam kalan: <b style="color:var(--danger)">${fmtTL(d.total_remaining)}</b></p>`;
    $('#inst-table').innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Vade</th>${state.filter === 'overdue' ? '<th class="num">Gecikme</th>' : ''}<th>Taksit</th><th>Öğrenci</th>
        <th>Kampüs</th><th>Yıl</th><th class="num">Tutar</th><th class="num">Kalan</th><th>Veli</th><th>Telefon</th>
        ${can('payment.create') ? '<th></th>' : ''}</tr></thead>
        <tbody>${d.installments.map(i => `
          <tr>
            <td>${fmtDate(i.due_date)}</td>
            ${state.filter === 'overdue' ? `<td class="num" style="color:var(--danger)"><b>${i.days_overdue} gün</b></td>` : ''}
            <td>${esc(i.label)}</td>
            <td class="clickable" onclick="location.hash='#/ogrenci/${i.student_id}'"><b>${esc(i.student_name)}</b><br>
              <span class="muted" style="font-size:11.5px">${esc(i.student_no)}</span></td>
            <td>${esc(i.campus_name)}</td>
            <td>${esc(i.academic_year_name)}</td>
            <td class="num">${fmtTL(i.amount)}</td>
            <td class="num"><b>${fmtTL(i.remaining)}</b></td>
            <td>${esc(i.parent_name || '-')}</td>
            <td>${esc(i.parent_phone || '-')}</td>
            ${can('payment.create') ? `<td><button class="btn sm success" data-quick-pay="${i.enrollment_id}" data-inst="${i.id}">Tahsil Et</button></td>` : ''}
          </tr>`).join('') || '<tr><td colspan="11" class="empty">Taksit bulunamadı 🎉</td></tr>'}
        </tbody></table></div>
      ${pagerHtml(d.page, d.page_size, d.total)}`;
    $('#inst-table').querySelectorAll('[data-page]').forEach(b => b.onclick = () => { state.page = Number(b.dataset.page); load(); });
    $('#inst-table').querySelectorAll('[data-quick-pay]').forEach(b => b.onclick = async () => {
      // Öğrenci detayından tam kayıt verisini çekip tahsilat modali aç
      const row = d.installments.find(x => x.id === Number(b.dataset.inst));
      try {
        const sd = await api('/students/' + row.student_id);
        const enr = sd.enrollments.find(e => e.id === row.enrollment_id);
        paymentModal(enr, load, row.id);
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  page.querySelectorAll('.tabs [data-f]').forEach(b => b.onclick = () => {
    page.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    state.filter = b.dataset.f; state.page = 1; load();
  });
  const campusSel = $('#inst-campus');
  if (campusSel) campusSel.onchange = () => { state.page = 1; load(); };
  let debounce;
  $('#inst-search').oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => { state.page = 1; load(); }, 350); };
  const excelBtn = $('#inst-excel');
  if (excelBtn) excelBtn.onclick = async () => {
    try {
      const type = state.filter === 'upcoming' ? 'yaklasan-taksitler' : 'geciken-taksitler';
      const qs = new URLSearchParams();
      const campus = $('#inst-campus')?.value; if (campus) qs.set('campus_id', campus);
      await downloadExcel(`/reports/${type}/excel?` + qs, `${type}-${todayStr()}.xlsx`);
    } catch (e) { toast(e.message, 'error'); }
  };
  await load();
}

// ================= Sayfa: Raporlar =================
async function pageReports() {
  const page = $('#page');
  let defs;
  try { defs = (await api('/reports')).reports; } catch (e) { page.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
  page.innerHTML = `
    <div class="page-head"><div><h2>Raporlar</h2>
      <div class="crumb">Raporları görüntüleyin ve Excel (.xlsx) olarak indirin</div></div></div>
    <div class="card">
      <div class="toolbar">
        <div class="field grow"><label>Rapor</label><select id="rp-type">
          ${defs.map(r => `<option value="${r.key}">${r.name}</option>`).join('')}</select></div>
        ${campusSelect('rp-campus')}
        ${yearSelect('rp-year')}
        <div class="field"><label>Başlangıç (tahsilat)</label><input type="date" id="rp-start"></div>
        <div class="field"><label>Bitiş (tahsilat)</label><input type="date" id="rp-end"></div>
        <button class="btn secondary" id="rp-preview">👁️ Önizle</button>
        ${can('report.export') ? '<button class="btn" id="rp-excel">⬇️ Excel İndir</button>' : ''}
      </div>
      <p class="muted" id="rp-desc" style="margin-bottom:12px"></p>
      <div id="rp-table"></div>
    </div>`;

  const updateDesc = () => {
    const def = defs.find(r => r.key === $('#rp-type').value);
    $('#rp-desc').textContent = def ? def.desc : '';
  };
  $('#rp-type').onchange = updateDesc;
  updateDesc();

  const buildQs = () => {
    const qs = new URLSearchParams();
    const campus = $('#rp-campus')?.value; if (campus) qs.set('campus_id', campus);
    if ($('#rp-year').value) qs.set('academic_year_id', $('#rp-year').value);
    if ($('#rp-start').value) qs.set('start_date', $('#rp-start').value);
    if ($('#rp-end').value) qs.set('end_date', $('#rp-end').value);
    return qs;
  };

  $('#rp-preview').onclick = async () => {
    $('#rp-table').innerHTML = '<div class="empty">Hazırlanıyor…</div>';
    try {
      const d = await api(`/reports/${$('#rp-type').value}/preview?` + buildQs());
      $('#rp-table').innerHTML = `
        <p class="muted" style="margin-bottom:8px">Toplam ${d.total_rows.toLocaleString('tr-TR')} satır
          ${d.total_rows > 200 ? '(ilk 200 satır gösteriliyor; tamamı Excel indirmede yer alır)' : ''}</p>
        <div class="table-wrap"><table>
          <thead><tr>${d.columns.map(c => `<th class="${c.money ? 'num' : ''}">${esc(c.header)}</th>`).join('')}</tr></thead>
          <tbody>${d.rows.map(r => `<tr>${d.columns.map(c =>
            `<td class="${c.money ? 'num' : ''}">${c.money ? fmtTL(r[c.key]) : esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')
          || `<tr><td colspan="${d.columns.length}" class="empty">Veri yok</td></tr>`}</tbody>
        </table></div>`;
    } catch (e) { $('#rp-table').innerHTML = ''; toast(e.message, 'error'); }
  };

  const excelBtn = $('#rp-excel');
  if (excelBtn) excelBtn.onclick = async () => {
    excelBtn.disabled = true;
    try {
      const type = $('#rp-type').value;
      await downloadExcel(`/reports/${type}/excel?` + buildQs(), `${type}-${todayStr()}.xlsx`);
      toast('Excel dosyası indirildi.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    excelBtn.disabled = false;
  };
}

// ================= Sayfa: Parametreler (MEB Ücret İlanları) =================
async function pageParameters() {
  const page = $('#page');
  page.innerHTML = `
    <div class="page-head"><div><h2>Parametreler · Ücret İlanları</h2>
      <div class="crumb">MEB'e bildirilen liste fiyatları ve kampüs indirim sınırları — kayıtlar bu listeden yapılır</div></div>
      ${can('settings.manage') ? '<button class="btn secondary" id="pr-backup">💾 Veritabanı Yedeği İndir</button>' : ''}</div>
    <div class="card">
      <div class="toolbar">
        ${campusSelect('pr-campus', { allowAll: false })}
        ${yearSelect('pr-year', { allowAll: false })}
      </div>
      <div id="pr-body"><div class="empty">Yükleniyor…</div></div>
    </div>`;

  const campusId = () => isHQ() ? $('#pr-campus').value : USER.campus.id;
  const yearId = () => $('#pr-year').value;

  async function load() {
    let d;
    try {
      d = await api(`/parameters?campus_id=${campusId()}&academic_year_id=${yearId()}`);
    } catch (e) { toast(e.message, 'error'); return; }
    if (!$('#pr-body')) return; // sayfa değişmiş
    const editable = can('settings.manage');
    $('#pr-body').innerHTML = `
      <div class="section-title">İlan Edilen Liste Fiyatları ve Kalem Bazlı İndirim Sınırları</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        Fiyatı boş bırakılan kalem kayıt sırasında seçilemez.
        Azami indirim alanları boş bırakılırsa o kaleme sınır uygulanmaz (yalnız kampüs geneli sınır geçerli olur).</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Ücret Kalemi</th><th>Durum</th><th class="num" style="width:180px">İlan Edilen Ücret (TL)</th>
        <th class="num" style="width:120px">Azami İnd. %</th><th class="num" style="width:150px">Azami İnd. TL</th>
        ${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${d.fee_items.map(i => `
          <tr style="${!i.active ? 'opacity:.55' : ''}">
            <td><b>${esc(i.name)}</b></td>
            <td>${i.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
            <td class="num"><input type="number" step="0.01" min="0" data-price="${i.id}"
              value="${i.price ?? ''}" placeholder="İlan yok" ${!editable ? 'disabled' : ''}
              style="text-align:right"></td>
            <td class="num"><input type="number" step="0.01" min="0" max="100" data-maxrate="${i.id}"
              value="${i.max_discount_rate ?? ''}" placeholder="Sınırsız" ${!editable ? 'disabled' : ''}
              style="text-align:right"></td>
            <td class="num"><input type="number" step="0.01" min="0" data-maxamount="${i.id}"
              value="${i.max_discount_amount ?? ''}" placeholder="Sınırsız" ${!editable ? 'disabled' : ''}
              style="text-align:right"></td>
            ${editable ? `<td class="right"><button class="btn sm secondary" data-toggle="${i.id}" data-active="${i.active}">
              ${i.active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>` : ''}
          </tr>`).join('')}
        </tbody></table></div>
      ${editable ? `
      <div class="flex mt">
        <input id="pr-new-item" placeholder="Yeni kalem adı (örn: Etüt Ücreti)" style="max-width:280px">
        <button class="btn sm secondary" id="pr-add-item">+ Kalem Ekle</button>
      </div>` : ''}

      <div class="section-title mt">Bölümler ve Şube Planı</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        Her bölüm için sınıf kademesinde (9-12) kaç şube açılacağını belirleyin.
        Şubeler A'dan başlar ve her şubeye en fazla <b>${d.max_class_size}</b> öğrenci kaydedilir.
        0 veya boş: o kademede şube açılmaz.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Bölüm</th><th>Durum</th>
          ${d.grades.map(g => `<th class="num" style="width:110px">${g}. Sınıf Şube</th>`).join('')}
          ${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${(d.departments || []).map(dep => `
          <tr style="${!dep.active ? 'opacity:.55' : ''}">
            <td><b>${esc(dep.name)}</b></td>
            <td>${dep.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
            ${d.grades.map(g => `<td class="num">
              <input type="number" min="0" max="10" data-plan="${dep.id}|${g}"
                value="${d.section_plans[`${dep.id}|${g}`] ?? ''}" placeholder="0"
                style="width:70px; text-align:right" ${!editable ? 'disabled' : ''}></td>`).join('')}
            ${editable ? `<td class="right"><button class="btn sm secondary" data-dept-toggle="${dep.id}" data-active="${dep.active}">
              ${dep.active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>` : ''}
          </tr>`).join('') || `<tr><td colspan="8" class="empty">Henüz bölüm tanımlanmadı</td></tr>`}
        </tbody></table></div>
      ${editable ? `
      <div class="flex mt">
        <input id="pr-new-dept" placeholder="Yeni bölüm adı (örn: Bilişim Teknolojileri)" style="max-width:320px">
        <button class="btn sm secondary" id="pr-add-dept">+ Bölüm Ekle</button>
      </div>` : ''}

      <div class="section-title mt">Kayıt Evrak Listesi</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        Öğrenci kaydında istenen evraklar. Eksik evraklar öğrenci kartından işaretlenir ve
        "Eksik Evraklar" raporundan takip edilir.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Evrak</th><th>Durum</th>${editable ? '<th></th>' : ''}</tr></thead>
        <tbody id="pr-docs-body"><tr><td class="muted">Yükleniyor…</td></tr></tbody>
      </table></div>
      ${editable ? `
      <div class="flex mt">
        <input id="pr-new-doc" placeholder="Yeni evrak adı (örn: Aşı Kartı)" style="max-width:280px">
        <button class="btn sm secondary" id="pr-add-doc">+ Evrak Ekle</button>
      </div>` : ''}

      <div class="section-title mt">Önceki Okul Kataloğu</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        Öğrenci formundaki "Önceki Okul" seçimi bu katalogdan gelir (il → ilçe → okul).
        Excel sütunları: <b>A: İl, B: İlçe, C: Okul Adı, D: Tür (Ortaokul/Lise)</b> — ilk satır başlık olabilir, mevcut okullar atlanır.</p>
      ${editable ? `
      <div class="toolbar">
        <div class="field"><label>Excel'den Yükle (.xlsx)</label><input type="file" id="pr-school-file" accept=".xlsx"></div>
        <button class="btn sm" id="pr-school-import">⬆️ Yükle</button>
        <span class="spacer"></span>
      </div>
      <div class="toolbar">
        <div class="field"><label>İl</label><input id="pr-sch-city" placeholder="İstanbul" style="max-width:140px"></div>
        <div class="field"><label>İlçe</label><input id="pr-sch-district" placeholder="Esenyurt" style="max-width:140px"></div>
        <div class="field grow"><label>Okul Adı</label><input id="pr-sch-name" placeholder="... Ortaokulu"></div>
        <div class="field"><label>Tür</label><select id="pr-sch-type" style="max-width:130px">
          <option value="ORTAOKUL">Ortaokul</option><option value="LISE">Lise</option></select></div>
        <button class="btn sm secondary" id="pr-add-school">+ Okul Ekle</button>
      </div>` : ''}
      <div class="toolbar">
        <div class="field grow"><label>Katalogda ara</label><input id="pr-sch-search" placeholder="Okul adı yazın…"></div>
      </div>
      <div id="pr-schools-table"><div class="muted" style="padding:8px">Aramak için yazın veya tümünü görmek için boş bırakın.</div></div>

      <div class="section-title mt">Adres Kataloğu (İl / İlçe / Mahalle)</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        Öğrenci formundaki adres alanları bu katalogdan seçilir (il → ilçe → mahalle).
        Excel sütunları: <b>A: İl, B: İlçe, C: Mahalle</b> — ilk satır başlık olabilir, mevcut kayıtlar atlanır.</p>
      ${editable ? `
      <div class="toolbar">
        <div class="field"><label>Excel'den Yükle (.xlsx)</label><input type="file" id="pr-hood-file" accept=".xlsx"></div>
        <button class="btn sm" id="pr-hood-import">⬆️ Yükle</button>
        <span class="spacer"></span>
      </div>
      <div class="toolbar">
        <div class="field"><label>İl</label><input id="pr-hood-city" placeholder="İstanbul" style="max-width:140px"></div>
        <div class="field"><label>İlçe</label><input id="pr-hood-district" placeholder="Esenyurt" style="max-width:140px"></div>
        <div class="field grow"><label>Mahalle</label><input id="pr-hood-name" placeholder="... Mahallesi"></div>
        <button class="btn sm secondary" id="pr-add-hood">+ Mahalle Ekle</button>
      </div>` : ''}
      <div class="toolbar">
        <div class="field grow"><label>Katalogda ara</label><input id="pr-hood-search" placeholder="Mahalle adı yazın…"></div>
      </div>
      <div id="pr-hoods-table"></div>

      <div class="section-title mt">Kampüs İndirim Sınırları</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        Kayıt sırasında bu sınırların üzerinde indirim yapılamaz. Boş bırakılan sınır uygulanmaz.</p>
      <div class="form-grid" style="max-width:520px">
        <div class="field"><label>Azami İndirim Oranı (%)</label>
          <input type="number" step="0.01" min="0" max="100" id="pr-max-rate"
            value="${d.limits.max_discount_rate ?? ''}" placeholder="Sınırsız" ${!editable ? 'disabled' : ''}></div>
        <div class="field"><label>Azami İndirim Tutarı (TL)</label>
          <input type="number" step="0.01" min="0" id="pr-max-amount"
            value="${d.limits.max_discount_amount ?? ''}" placeholder="Sınırsız" ${!editable ? 'disabled' : ''}></div>
      </div>
      ${editable ? '<div class="flex mt"><span class="spacer"></span><button class="btn" id="pr-save">💾 Parametreleri Kaydet</button></div>' : ''}

      ${editable ? `
      <div class="section-title mt">🔗 CRM Entegrasyonu</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        CRM yazılımı bu API anahtarıyla aday öğrenci gönderir ve kayıt sonuçlarını (okul no,
        sözleşme no, sınıf/şube, kayıt tarihi) çeker. Webhook adresi girilirse her kesin kayıt
        anında CRM'e otomatik bildirim de gönderilir.</p>
      <div id="pr-integration"><div class="muted" style="padding:8px">Yükleniyor…</div></div>` : ''}`;

    if (!editable) return;
    $('#pr-save').onclick = async () => {
      const prices = [...document.querySelectorAll('[data-price]')].map(inp => {
        const id = inp.dataset.price;
        const maxRate = document.querySelector(`[data-maxrate="${id}"]`);
        const maxAmount = document.querySelector(`[data-maxamount="${id}"]`);
        return {
          fee_item_id: Number(id),
          price: inp.value === '' ? null : Number(inp.value),
          max_discount_rate: maxRate && maxRate.value !== '' ? Number(maxRate.value) : null,
          max_discount_amount: maxAmount && maxAmount.value !== '' ? Number(maxAmount.value) : null,
        };
      });
      const section_plans = [...document.querySelectorAll('[data-plan]')].map(inp => {
        const [deptId, grade] = inp.dataset.plan.split('|');
        return { department_id: Number(deptId), grade, section_count: inp.value === '' ? 0 : Number(inp.value) };
      });
      try {
        await api('/parameters', {
          method: 'PUT',
          body: {
            campus_id: Number(campusId()), academic_year_id: Number(yearId()),
            prices, section_plans,
            max_discount_rate: $('#pr-max-rate').value === '' ? null : Number($('#pr-max-rate').value),
            max_discount_amount: $('#pr-max-amount').value === '' ? null : Number($('#pr-max-amount').value),
          },
        });
        toast('Parametreler kaydedildi.', 'success'); load();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#pr-add-item').onclick = async () => {
      const name = $('#pr-new-item').value.trim();
      if (!name) return toast('Kalem adı yazın.', 'error');
      try {
        await api('/parameters/items', { method: 'POST', body: { name } });
        toast('Kalem eklendi. Fiyatını girip kaydetmeyi unutmayın.', 'success'); load();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#pr-add-dept').onclick = async () => {
      const name = $('#pr-new-dept').value.trim();
      if (!name) return toast('Bölüm adı yazın.', 'error');
      try {
        await api('/parameters/departments', {
          method: 'POST', body: { campus_id: Number(campusId()), name },
        });
        toast('Bölüm eklendi. Şube planını girip kaydetmeyi unutmayın.', 'success'); load();
      } catch (e) { toast(e.message, 'error'); }
    };
    document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      try {
        await api('/parameters/items/' + b.dataset.toggle, {
          method: 'PUT', body: { active: b.dataset.active !== '1' },
        });
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
    document.querySelectorAll('[data-dept-toggle]').forEach(b => b.onclick = async () => {
      try {
        await api('/parameters/departments/' + b.dataset.deptToggle, {
          method: 'PUT', body: { active: b.dataset.active !== '1' },
        });
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
    $('#pr-add-doc').onclick = async () => {
      const name = $('#pr-new-doc').value.trim();
      if (!name) return toast('Evrak adı yazın.', 'error');
      try {
        await api('/parameters/documents', { method: 'POST', body: { name } });
        toast('Evrak türü eklendi.', 'success'); loadDocs();
        $('#pr-new-doc').value = '';
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#pr-school-import').onclick = async () => {
      const file = $('#pr-school-file').files[0];
      if (!file) return toast('Önce bir .xlsx dosyası seçin.', 'error');
      try {
        const buf = await file.arrayBuffer();
        const res = await fetch('/api/parameters/schools/import', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/octet-stream' },
          body: buf,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Yükleme başarısız.');
        toast(`Okul yükleme tamam: ${data.added} eklendi, ${data.skipped} zaten vardı, ${data.invalid} satır atlandı.`, 'success');
        loadSchools();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#pr-hood-import').onclick = async () => {
      const file = $('#pr-hood-file').files[0];
      if (!file) return toast('Önce bir .xlsx dosyası seçin.', 'error');
      try {
        const buf = await file.arrayBuffer();
        const res = await fetch('/api/parameters/neighborhoods/import', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/octet-stream' },
          body: buf,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Yükleme başarısız.');
        toast(`Mahalle yükleme tamam: ${data.added} eklendi, ${data.skipped} zaten vardı, ${data.invalid} satır atlandı.`, 'success');
        loadHoods();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#pr-add-hood').onclick = async () => {
      try {
        await api('/parameters/neighborhoods', {
          method: 'POST',
          body: { city: $('#pr-hood-city').value, district: $('#pr-hood-district').value, name: $('#pr-hood-name').value },
        });
        toast('Mahalle eklendi.', 'success'); $('#pr-hood-name').value = ''; loadHoods();
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#pr-add-school').onclick = async () => {
      try {
        await api('/parameters/schools', {
          method: 'POST',
          body: {
            city: $('#pr-sch-city').value, district: $('#pr-sch-district').value,
            name: $('#pr-sch-name').value, type: $('#pr-sch-type').value,
          },
        });
        toast('Okul eklendi.', 'success'); $('#pr-sch-name').value = ''; loadSchools();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  // ---- Evrak türleri listesi ----
  async function loadDocs() {
    try {
      const d = await api('/parameters/documents');
      const body = $('#pr-docs-body');
      if (!body) return;
      const editable = can('settings.manage');
      body.innerHTML = d.document_types.map(x => `
        <tr style="${!x.active ? 'opacity:.55' : ''}">
          <td><b>${esc(x.name)}</b></td>
          <td>${x.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
          ${editable ? `<td class="right"><button class="btn sm secondary" data-doc-tgl="${x.id}" data-active="${x.active}">
            ${x.active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>` : ''}
        </tr>`).join('');
      body.querySelectorAll('[data-doc-tgl]').forEach(b => b.onclick = async () => {
        try {
          await api('/parameters/documents/' + b.dataset.docTgl, {
            method: 'PUT', body: { active: b.dataset.active !== '1' },
          });
          loadDocs();
        } catch (e) { toast(e.message, 'error'); }
      });
    } catch (e) { toast(e.message, 'error'); }
  }

  // ---- Okul kataloğu listesi ----
  async function loadSchools() {
    const wrap = $('#pr-schools-table');
    if (!wrap) return;
    try {
      const qs = new URLSearchParams({ include_passive: 1 });
      const search = $('#pr-sch-search')?.value.trim();
      if (search) qs.set('search', search);
      const d = await api('/parameters/schools?' + qs);
      const editable = can('settings.manage');
      wrap.innerHTML = `
        <p class="muted" style="font-size:12px; margin-bottom:6px">Katalogda ${d.schools.length >= 500 ? '500+' : d.schools.length} okul gösteriliyor · ${d.cities.length} il</p>
        <div class="table-wrap"><table>
          <thead><tr><th>İl</th><th>İlçe</th><th>Okul</th><th>Tür</th><th>Durum</th>${editable ? '<th></th>' : ''}</tr></thead>
          <tbody>${d.schools.slice(0, 100).map(x => `
            <tr style="${!x.active ? 'opacity:.55' : ''}">
              <td>${esc(x.city)}</td><td>${esc(x.district)}</td><td><b>${esc(x.name)}</b></td>
              <td>${x.type === 'LISE' ? 'Lise' : 'Ortaokul'}</td>
              <td>${x.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
              ${editable ? `<td class="right"><button class="btn sm secondary" data-sch-tgl="${x.id}" data-active="${x.active}">
                ${x.active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>` : ''}
            </tr>`).join('') || '<tr><td colspan="6" class="empty">Katalog boş — Excel ile yükleyin veya elle ekleyin</td></tr>'}
          </tbody></table></div>`;
      wrap.querySelectorAll('[data-sch-tgl]').forEach(b => b.onclick = async () => {
        try {
          await api('/parameters/schools/' + b.dataset.schTgl, {
            method: 'PUT', body: { active: b.dataset.active !== '1' },
          });
          loadSchools();
        } catch (e) { toast(e.message, 'error'); }
      });
    } catch (e) { toast(e.message, 'error'); }
  }
  // ---- Mahalle kataloğu listesi ----
  async function loadHoods() {
    const wrap = $('#pr-hoods-table');
    if (!wrap) return;
    try {
      const qs = new URLSearchParams({ include_passive: 1 });
      const search = $('#pr-hood-search')?.value.trim();
      if (search) qs.set('search', search);
      const d = await api('/parameters/neighborhoods?' + qs);
      const editable = can('settings.manage');
      wrap.innerHTML = `
        <p class="muted" style="font-size:12px; margin-bottom:6px">Katalogda ${d.neighborhoods.length >= 500 ? '500+' : d.neighborhoods.length} mahalle gösteriliyor · ${d.cities.length} il</p>
        <div class="table-wrap"><table>
          <thead><tr><th>İl</th><th>İlçe</th><th>Mahalle</th><th>Durum</th>${editable ? '<th></th>' : ''}</tr></thead>
          <tbody>${d.neighborhoods.slice(0, 100).map(x => `
            <tr style="${!x.active ? 'opacity:.55' : ''}">
              <td>${esc(x.city)}</td><td>${esc(x.district)}</td><td><b>${esc(x.name)}</b></td>
              <td>${x.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
              ${editable ? `<td class="right"><button class="btn sm secondary" data-hood-tgl="${x.id}" data-active="${x.active}">
                ${x.active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>` : ''}
            </tr>`).join('') || '<tr><td colspan="5" class="empty">Katalog boş — Excel ile yükleyin veya elle ekleyin</td></tr>'}
          </tbody></table></div>`;
      wrap.querySelectorAll('[data-hood-tgl]').forEach(b => b.onclick = async () => {
        try {
          await api('/parameters/neighborhoods/' + b.dataset.hoodTgl, {
            method: 'PUT', body: { active: b.dataset.active !== '1' },
          });
          loadHoods();
        } catch (e) { toast(e.message, 'error'); }
      });
    } catch (e) { toast(e.message, 'error'); }
  }
  if (!window.__schSearchBound) {
    window.__schSearchBound = true;
    let schDebounce;
    document.addEventListener('input', e => {
      if (e.target && e.target.id === 'pr-sch-search') {
        clearTimeout(schDebounce);
        schDebounce = setTimeout(loadSchools, 350);
      }
      if (e.target && e.target.id === 'pr-hood-search') {
        clearTimeout(schDebounce);
        schDebounce = setTimeout(loadHoods, 350);
      }
    });
  }

  ['pr-campus', 'pr-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = load;
  });
  // ---- CRM entegrasyon ayarları ----
  async function loadIntegration() {
    const wrap = $('#pr-integration');
    if (!wrap) return;
    try {
      const d = await api('/parameters/integration');
      const base = location.origin + '/api/integration';
      wrap.innerHTML = `
        <div class="form-grid" style="max-width:720px">
          <div class="field full"><label>Webhook URL (CRM'in dinlediği adres)</label>
            <input id="pr-webhook-url" value="${esc(d.webhook_url)}" placeholder="https://crm.example.com/okul-webhook"></div>
          <div class="field full"><label>Webhook Gizli Anahtarı (X-Webhook-Secret başlığında gönderilir)</label>
            <input id="pr-webhook-secret" value="${esc(d.webhook_secret)}" placeholder="İsteğe bağlı doğrulama anahtarı"></div>
        </div>
        <div class="flex mt"><span class="spacer"></span><button class="btn sm" id="pr-webhook-save">Webhook Ayarını Kaydet</button></div>
        <div class="section-title mt" style="font-size:12px">API Anahtarları</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Ad</th><th>Anahtar</th><th>Durum</th><th></th></tr></thead>
          <tbody>${d.api_keys.map(k => `
            <tr style="${!k.active ? 'opacity:.55' : ''}">
              <td>${esc(k.name)}</td>
              <td><code style="font-size:11px">${esc(k.key.slice(0, 12))}…${esc(k.key.slice(-4))}</code>
                <button class="btn sm secondary" data-copy="${esc(k.key)}">Kopyala</button></td>
              <td>${k.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
              <td class="right"><button class="btn sm secondary" data-key-tgl="${k.id}" data-active="${k.active}">
                ${k.active ? 'Pasifleştir' : 'Aktifleştir'}</button></td>
            </tr>`).join('') || '<tr><td colspan="4" class="empty">Henüz API anahtarı yok</td></tr>'}
          </tbody></table></div>
        <div class="flex mt">
          <input id="pr-key-name" placeholder="Anahtar adı (örn: DerCRM)" style="max-width:240px">
          <button class="btn sm secondary" id="pr-key-add">+ API Anahtarı Oluştur</button>
        </div>
        <p class="muted mt" style="font-size:11.5px">
          CRM uç noktaları (başlık: <code>X-API-Key</code>):<br>
          • Aday gönder: <code>POST ${esc(base)}/candidates</code><br>
          • Öğrenci sorgula: <code>GET ${esc(base)}/students/{crm_form_id}</code><br>
          • Kayıt akışı: <code>GET ${esc(base)}/enrollments?after_id=0</code></p>`;
      $('#pr-webhook-save').onclick = async () => {
        try {
          await api('/parameters/integration/webhook', {
            method: 'PUT',
            body: { webhook_url: $('#pr-webhook-url').value, webhook_secret: $('#pr-webhook-secret').value },
          });
          toast('Webhook ayarı kaydedildi.', 'success');
        } catch (e) { toast(e.message, 'error'); }
      };
      $('#pr-key-add').onclick = async () => {
        try {
          const r = await api('/parameters/integration/keys', {
            method: 'POST', body: { name: $('#pr-key-name').value.trim() },
          });
          toast('API anahtarı oluşturuldu. Kopyalayıp CRM tarafına girin.', 'success');
          await navigator.clipboard?.writeText(r.key).catch(() => {});
          loadIntegration();
        } catch (e) { toast(e.message, 'error'); }
      };
      wrap.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); toast('Anahtar panoya kopyalandı.', 'success'); }
        catch { toast('Kopyalanamadı: ' + b.dataset.copy, 'error'); }
      });
      wrap.querySelectorAll('[data-key-tgl]').forEach(b => b.onclick = async () => {
        try {
          await api('/parameters/integration/keys/' + b.dataset.keyTgl, {
            method: 'PUT', body: { active: b.dataset.active !== '1' },
          });
          loadIntegration();
        } catch (e) { toast(e.message, 'error'); }
      });
    } catch (e) { /* yetki yoksa sessiz geç */ }
  }

  const origLoad = load;
  load = async function () { await origLoad(); loadDocs(); loadSchools(); loadHoods(); loadIntegration(); };
  const backupBtn = $('#pr-backup');
  if (backupBtn) backupBtn.onclick = async () => {
    backupBtn.disabled = true;
    try {
      await downloadExcel('/backup', `okul-yedek-${todayStr()}.db`);
      toast('Yedek indirildi. Dosyayı güvenli bir yerde saklayın.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    backupBtn.disabled = false;
  };
  await load();
}

// ================= Sayfa: Kullanıcılar =================
async function pageUsers() {
  const page = $('#page');
  let d;
  try { d = await api('/users'); } catch (e) { page.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }

  page.innerHTML = `
    <div class="page-head"><div><h2>Kullanıcılar ve Yetkiler</h2>
      <div class="crumb">${isHQ() ? 'Tüm kampüslerin kullanıcıları' : 'Kampüsünüzün kullanıcıları'}</div></div>
      <button class="btn" id="u-new">+ Yeni Kullanıcı</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Kullanıcı Adı</th><th>Ad Soyad</th><th>Rol</th><th>Kampüs</th><th>Durum</th><th></th></tr></thead>
      <tbody>${d.users.map(u => `
        <tr>
          <td>${esc(u.username)}</td><td><b>${esc(u.full_name)}</b></td>
          <td>${esc(u.role_label)}</td><td>${esc(u.campus_name || 'Tümü')}</td>
          <td>${u.active ? '<span class="badge green">Aktif</span>' : '<span class="badge red">Pasif</span>'}</td>
          <td class="right"><button class="btn sm secondary" data-edit="${u.id}">Düzenle</button></td>
        </tr>`).join('')}
      </tbody></table></div></div>`;

  const permLabels = {
    'dashboard.view': 'Genel bakış', 'student.view': 'Öğrenci görüntüleme', 'student.create': 'Öğrenci ekleme',
    'student.edit': 'Öğrenci düzenleme', 'student.delete': 'Öğrenci silme', 'enrollment.create': 'Kayıt oluşturma',
    'enrollment.edit': 'Kayıt düzenleme', 'enrollment.cancel': 'Kayıt iptali', 'payment.create': 'Tahsilat alma',
    'payment.cancel': 'Tahsilat iptali', 'payment.view': 'Tahsilat görüntüleme', 'installment.edit': 'Taksit düzenleme',
    'report.view': 'Rapor görüntüleme', 'report.export': 'Excel indirme', 'user.manage': 'Kullanıcı yönetimi',
    'campus.manage': 'Kampüs yönetimi', 'settings.manage': 'Ayarlar', 'audit.view': 'Denetim kaydı',
  };

  function userModal(u) {
    const rolePerms = u ? (d.role_permissions[u.role] || []) : [];
    const extra = u ? JSON.parse(u.extra_permissions || '[]') : [];
    const revoked = u ? JSON.parse(u.revoked_permissions || '[]') : [];
    const roles = d.roles.filter(r => isHQ() || r.value !== 'GENEL_MERKEZ');
    openModal(u ? `Kullanıcı Düzenle · ${u.username}` : 'Yeni Kullanıcı', `
      <div class="form-grid">
        ${u ? '' : `<div class="field"><label>Kullanıcı Adı *</label><input id="uf-username"></div>`}
        <div class="field"><label>Ad Soyad *</label><input id="uf-name" value="${esc(u?.full_name || '')}"></div>
        <div class="field"><label>Rol *</label><select id="uf-role">
          ${roles.map(r => `<option value="${r.value}" ${u?.role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}</select></div>
        ${isHQ() ? `<div class="field"><label>Kampüs</label><select id="uf-campus">
          <option value="">— (Genel Merkez)</option>
          ${CAMPUSES.map(c => `<option value="${c.id}" ${u?.campus_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
        <div class="field"><label>${u ? 'Yeni Şifre (boş = değişmez)' : 'Şifre *'}</label><input type="password" id="uf-pass"></div>
        <div class="field"><label>Durum</label><select id="uf-active">
          <option value="1" ${!u || u.active ? 'selected' : ''}>Aktif</option>
          <option value="0" ${u && !u.active ? 'selected' : ''}>Pasif</option></select></div>
      </div>
      <div class="section-title">Yetki Ayarları (rol varsayılanının üzerine)</div>
      <p class="muted" style="font-size:12px; margin-bottom:8px">İşaretli = izinli. Rol varsayılanından eklenen/çıkarılan izinler kullanıcıya özel kaydedilir.</p>
      <div class="form-grid" id="uf-perms" style="grid-template-columns: repeat(auto-fill, minmax(230px, 1fr))">
        ${d.all_permissions.map(p => {
          const inRole = rolePerms.includes(p);
          const checked = u ? ((inRole && !revoked.includes(p)) || extra.includes(p)) : inRole;
          return `<label style="display:flex; gap:8px; align-items:center; font-weight:400; text-transform:none">
            <input type="checkbox" style="width:auto" data-perm="${p}" ${checked ? 'checked' : ''}> ${permLabels[p] || p}</label>`;
        }).join('')}
      </div>`, {
      footHtml: `<button class="btn secondary" data-x>Vazgeç</button><button class="btn" id="uf-save">Kaydet</button>`,
      onOpen(area) {
        const roleSel = area.querySelector('#uf-role');
        const syncPerms = () => {
          const rp = d.role_permissions[roleSel.value] || [];
          area.querySelectorAll('[data-perm]').forEach(cb => { cb.checked = rp.includes(cb.dataset.perm); });
        };
        if (!u) syncPerms();
        roleSel.onchange = syncPerms;
        area.querySelector('[data-x]').onclick = closeModal;
        area.querySelector('#uf-save').onclick = async () => {
          const role = roleSel.value;
          const rp = d.role_permissions[role] || [];
          const checkedPerms = [...area.querySelectorAll('[data-perm]')].filter(c => c.checked).map(c => c.dataset.perm);
          const body = {
            full_name: area.querySelector('#uf-name').value.trim(),
            role,
            campus_id: isHQ() ? (area.querySelector('#uf-campus').value || null) : USER.campus.id,
            active: area.querySelector('#uf-active').value === '1',
            extra_permissions: checkedPerms.filter(p => !rp.includes(p)),
            revoked_permissions: rp.filter(p => !checkedPerms.includes(p)),
          };
          const pass = area.querySelector('#uf-pass').value;
          if (pass) body.password = pass;
          try {
            if (u) await api('/users/' + u.id, { method: 'PUT', body });
            else {
              body.username = area.querySelector('#uf-username').value.trim();
              if (!body.password) throw new Error('Yeni kullanıcı için şifre zorunludur.');
              await api('/users', { method: 'POST', body });
            }
            toast('Kullanıcı kaydedildi.', 'success'); closeModal(); pageUsers();
          } catch (e) { toast(e.message, 'error'); }
        };
      },
    });
  }

  $('#u-new').onclick = () => userModal(null);
  page.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    userModal(d.users.find(u => u.id === Number(b.dataset.edit)));
  });
}

// ================= Sayfa: Kampüsler =================
async function pageCampuses() {
  const page = $('#page');
  let d;
  try { d = await api('/campuses'); } catch (e) { page.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
  page.innerHTML = `
    <div class="page-head"><div><h2>Kampüsler</h2><div class="crumb">Kampüs tanımları ve yönetimi</div></div>
      <button class="btn" id="c-new">+ Yeni Kampüs</button></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Kod</th><th>Kampüs</th><th>Müdür</th><th>Telefon</th><th>Adres</th><th>Durum</th><th></th></tr></thead>
      <tbody>${d.campuses.map(c => `
        <tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td><td>${esc(c.manager_name || '-')}</td>
        <td>${esc(c.phone || '-')}</td><td>${esc(c.address || '-')}</td>
        <td>${c.active ? '<span class="badge green">Aktif</span>' : '<span class="badge red">Pasif</span>'}</td>
        <td class="right"><button class="btn sm secondary" data-edit="${c.id}">Düzenle</button></td></tr>`).join('')}
      </tbody></table></div></div>`;

  function campusModal(c) {
    openModal(c ? 'Kampüs Düzenle' : 'Yeni Kampüs', `
      <div class="form-grid">
        <div class="field"><label>Kod *</label><input id="cf-code" value="${esc(c?.code || '')}" ${c ? 'disabled' : ''} maxlength="6"></div>
        <div class="field"><label>Kampüs Adı *</label><input id="cf-name" value="${esc(c?.name || '')}"></div>
        <div class="field"><label>Müdür</label><input id="cf-mgr" value="${esc(c?.manager_name || '')}"></div>
        <div class="field"><label>Telefon</label><input id="cf-phone" value="${esc(c?.phone || '')}"></div>
        <div class="field full"><label>Adres</label><input id="cf-address" value="${esc(c?.address || '')}"></div>
        ${c ? `<div class="field"><label>Durum</label><select id="cf-active">
          <option value="1" ${c.active ? 'selected' : ''}>Aktif</option>
          <option value="0" ${!c.active ? 'selected' : ''}>Pasif</option></select></div>` : ''}
      </div>`, {
      small: true,
      footHtml: `<button class="btn secondary" data-x>Vazgeç</button><button class="btn" id="cf-save">Kaydet</button>`,
      onOpen(area) {
        area.querySelector('[data-x]').onclick = closeModal;
        area.querySelector('#cf-save').onclick = async () => {
          const body = {
            name: area.querySelector('#cf-name').value.trim(),
            manager_name: area.querySelector('#cf-mgr').value,
            phone: area.querySelector('#cf-phone').value,
            address: area.querySelector('#cf-address').value,
          };
          try {
            if (c) {
              body.active = area.querySelector('#cf-active').value === '1';
              await api('/campuses/' + c.id, { method: 'PUT', body });
            } else {
              body.code = area.querySelector('#cf-code').value.trim();
              await api('/campuses', { method: 'POST', body });
            }
            toast('Kampüs kaydedildi.', 'success'); closeModal();
            await loadGlobals(); pageCampuses();
          } catch (e) { toast(e.message, 'error'); }
        };
      },
    });
  }
  $('#c-new').onclick = () => campusModal(null);
  page.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    campusModal(d.campuses.find(c => c.id === Number(b.dataset.edit)));
  });
}

// ================= Başlangıç =================
(async function init() {
  if (!TOKEN) return renderLogin();
  try {
    const me = await api('/auth/me');
    USER = me.user;
    await loadGlobals();
    renderShell();
  } catch {
    renderLogin();
  }
})();
