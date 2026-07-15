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
  if (res.status === 401) {
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
        <thead><tr><th>Öğrenci No</th><th>Ad Soyad</th><th>Sınıf</th><th>Kampüs</th>
        <th>Veli</th><th>Veli Telefon</th><th>Durum</th></tr></thead>
        <tbody>${d.students.map(s => `
          <tr class="clickable" onclick="location.hash='#/ogrenci/${s.id}'">
            <td>${esc(s.student_no)}</td>
            <td><b>${esc(s.first_name)} ${esc(s.last_name)}</b></td>
            <td>${esc(s.grade)}${s.section ? '-' + esc(s.section) : ''}</td>
            <td>${esc(s.campus_name)}</td>
            <td>${esc(s.parent_name || '-')}</td>
            <td>${esc(s.parent_phone || '-')}</td>
            <td>${badge(s.status)}</td>
          </tr>`).join('') || '<tr><td colspan="7" class="empty">Kayıt bulunamadı</td></tr>'}
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
          <tr><td class="muted">Sınıf / Şube</td><td>${esc(s.grade)}${s.section ? ' - ' + esc(s.section) : ''}</td></tr>
          <tr><td class="muted">Kan Grubu</td><td>${esc(s.blood_type || '-')}</td></tr>
          <tr><td class="muted">Önceki Okul</td><td>${esc(s.previous_school || '-')}</td></tr>
          <tr><td class="muted">Adres</td><td>${esc(s.address || '-')} ${esc(s.district || '')} ${esc(s.city || '')}</td></tr>
          <tr><td class="muted">Sağlık Notları</td><td>${esc(s.health_notes || '-')}</td></tr>
          <tr><td class="muted">Notlar</td><td>${esc(s.notes || '-')}</td></tr>
        </tbody></table></div>
      </div>
      <div class="card"><h3 class="flex">Veli Bilgileri <span class="spacer"></span>
        ${can('student.edit') ? '<button class="btn sm secondary" id="btn-add-parent">+ Veli Ekle</button>' : ''}</h3>
        ${d.parents.map(p => `
          <div class="card" style="margin-bottom:10px; padding:12px">
            <div class="flex"><b>${esc(p.full_name)}</b>
              <span class="badge ${p.relation === 'ANNE' ? 'blue' : p.relation === 'BABA' ? 'green' : 'gray'}">${p.relation === 'ANNE' ? 'Anne' : p.relation === 'BABA' ? 'Baba' : p.relation === 'VASI' ? 'Vasi' : 'Diğer'}</span>
              ${p.is_primary ? '<span class="badge yellow">Birincil İletişim</span>' : ''}
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

    <div id="enrollments-area"></div>`;

  // ---- Kayıtlar bölümü ----
  const area = $('#enrollments-area');
  area.innerHTML = d.enrollments.map(e => {
    const openInstallments = e.installments.filter(i => i.status === 'BEKLIYOR' || i.status === 'KISMI');
    return `
    <div class="card">
      <h3 class="flex">📚 ${esc(e.academic_year_name)} Kaydı ${badge(e.status)}
        <span class="muted" style="font-weight:400; font-size:12.5px">· ${esc(e.grade)}. sınıf · ${fmtDate(e.enrollment_date)}</span>
        <span class="spacer"></span>
        ${can('payment.create') && e.status !== 'IPTAL' && e.balance > 0 ? `<button class="btn sm success" data-pay="${e.id}">💰 Tahsilat Al</button>` : ''}
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
        <thead><tr><th>Kalem</th><th class="num">İlan Fiyatı</th><th class="num">Adet</th><th class="num">Tutar</th></tr></thead>
        <tbody>${e.items.map(it => `<tr>
          <td>${esc(it.name)}</td>
          <td class="num">${fmtTL(it.unit_price)}</td>
          <td class="num">${it.quantity}</td>
          <td class="num"><b>${fmtTL(it.total)}</b></td></tr>`).join('')}
        <tr><td colspan="3"><b>Liste Ücreti Toplamı</b></td>
          <td class="num"><b>${fmtTL(e.items.reduce((a, x) => a + x.total, 0))}</b></td></tr>
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
        <th>Makbuz No</th><th>Tahsil Eden</th><th>Durum</th>${can('payment.cancel') ? '<th></th>' : ''}</tr></thead>
        <tbody>${e.payments.map(p => `
          <tr style="${p.cancelled ? 'opacity:.55; text-decoration:line-through' : ''}">
            <td>${fmtDate(p.payment_date)}</td>
            <td>${esc(p.installment_label || 'Genel')}</td>
            <td class="num">${fmtTL(p.amount)}</td>
            <td>${METHOD_LABELS[p.method] || p.method}</td>
            <td>${esc(p.receipt_no || '-')}</td>
            <td>${esc(p.received_by_name || '-')}</td>
            <td>${p.cancelled ? '<span class="badge red">İptal</span>' : '<span class="badge green">Geçerli</span>'}</td>
            ${can('payment.cancel') ? `<td>${!p.cancelled ? `<button class="btn sm danger" data-cancel-pay="${p.id}">İptal</button>` : ''}</td>` : ''}
          </tr>`).join('') || '<tr><td colspan="8" class="empty">Tahsilat yok</td></tr>'}
        </tbody></table></div>
    </div>`;
  }).join('') || '<div class="card empty">Bu öğrencinin dönem kaydı bulunmuyor.</div>';

  // ---- Olay bağlama ----
  const reload = () => pageStudentDetail(id);

  if ($('#btn-edit-student')) $('#btn-edit-student').onclick = () => studentFormModal(s, reload);
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
}

// ---- Öğrenci formu (yeni/düzenle) ----
function studentFormFields(s = {}) {
  return `
    <div class="form-grid">
      <div class="field"><label>Adı *</label><input id="sf-first" value="${esc(s.first_name || '')}"></div>
      <div class="field"><label>Soyadı *</label><input id="sf-last" value="${esc(s.last_name || '')}"></div>
      <div class="field"><label>TC Kimlik No</label><input id="sf-tc" maxlength="11" value="${esc(s.tc_no || '')}"></div>
      <div class="field"><label>Doğum Tarihi</label><input type="date" id="sf-birth" value="${esc(s.birth_date || '')}"></div>
      <div class="field"><label>Doğum Yeri</label><input id="sf-bplace" value="${esc(s.birth_place || '')}"></div>
      <div class="field"><label>Cinsiyet</label><select id="sf-gender">
        <option value="">Seçiniz</option>
        <option value="KIZ" ${s.gender === 'KIZ' ? 'selected' : ''}>Kız</option>
        <option value="ERKEK" ${s.gender === 'ERKEK' ? 'selected' : ''}>Erkek</option></select></div>
      <div class="field"><label>Kan Grubu</label><select id="sf-blood">
        ${['', 'A Rh+', 'A Rh-', 'B Rh+', 'B Rh-', 'AB Rh+', 'AB Rh-', '0 Rh+', '0 Rh-'].map(b => `<option ${s.blood_type === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
      ${isHQ() ? `<div class="field"><label>Kampüs *</label><select id="sf-campus">
        ${CAMPUSES.map(c => `<option value="${c.id}" ${s.campus_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
      <div class="field"><label>Sınıf</label><select id="sf-grade">
        ${META.grades.map(g => `<option ${s.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      <div class="field"><label>Şube</label><input id="sf-section" value="${esc(s.section || '')}" maxlength="4"></div>
      <div class="field"><label>Önceki Okul</label><input id="sf-prev" value="${esc(s.previous_school || '')}"></div>
      <div class="field"><label>Durum</label><select id="sf-status">
        ${META.student_statuses.map(x => `<option value="${x.value}" ${(s.status || 'AKTIF') === x.value ? 'selected' : ''}>${x.label}</option>`).join('')}</select></div>
      <div class="field"><label>İl</label><input id="sf-city" value="${esc(s.city || 'İstanbul')}"></div>
      <div class="field"><label>İlçe</label><input id="sf-district" value="${esc(s.district || '')}"></div>
      <div class="field full"><label>Adres</label><input id="sf-address" value="${esc(s.address || '')}"></div>
      <div class="field full"><label>Sağlık Notları</label><input id="sf-health" value="${esc(s.health_notes || '')}"></div>
      <div class="field full"><label>Notlar</label><input id="sf-notes" value="${esc(s.notes || '')}"></div>
    </div>`;
}

function readStudentForm() {
  return {
    first_name: $('#sf-first').value.trim(),
    last_name: $('#sf-last').value.trim(),
    tc_no: $('#sf-tc').value.trim(),
    birth_date: $('#sf-birth').value,
    birth_place: $('#sf-bplace').value,
    gender: $('#sf-gender').value,
    blood_type: $('#sf-blood').value,
    campus_id: isHQ() ? Number($('#sf-campus').value) : USER.campus.id,
    grade: $('#sf-grade').value,
    section: $('#sf-section').value,
    previous_school: $('#sf-prev').value,
    status: $('#sf-status').value,
    city: $('#sf-city').value,
    district: $('#sf-district').value,
    address: $('#sf-address').value,
    health_notes: $('#sf-health').value,
    notes: $('#sf-notes').value,
  };
}

function studentFormModal(s, onSaved) {
  openModal('Öğrenci Bilgilerini Düzenle', studentFormFields(s), {
    footHtml: `<button class="btn secondary" data-x>Vazgeç</button><button class="btn" id="sf-save">Kaydet</button>`,
    onOpen(area) {
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
        ${[['ANNE', 'Anne'], ['BABA', 'Baba'], ['VASI', 'Vasi'], ['DIGER', 'Diğer']].map(([v, l]) => `<option value="${v}" ${p?.relation === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="field"><label>Ad Soyad *</label><input id="pf-name" value="${esc(p?.full_name || '')}"></div>
      <div class="field"><label>TC Kimlik No</label><input id="pf-tc" maxlength="11" value="${esc(p?.tc_no || '')}"></div>
      <div class="field"><label>Telefon</label><input id="pf-phone" value="${esc(p?.phone || '')}"></div>
      <div class="field"><label>Telefon 2</label><input id="pf-phone2" value="${esc(p?.phone2 || '')}"></div>
      <div class="field"><label>E-posta</label><input id="pf-email" value="${esc(p?.email || '')}"></div>
      <div class="field"><label>Meslek</label><input id="pf-occ" value="${esc(p?.occupation || '')}"></div>
      <div class="field"><label>İş Yeri</label><input id="pf-work" value="${esc(p?.workplace || '')}"></div>
      <div class="field"><label>Eğitim Durumu</label><input id="pf-edu" value="${esc(p?.education || '')}"></div>
      <div class="field full"><label>Adres</label><input id="pf-address" value="${esc(p?.address || '')}"></div>
      <div class="field"><label>Birincil İletişim mi?</label><select id="pf-primary">
        <option value="0" ${!p?.is_primary ? 'selected' : ''}>Hayır</option>
        <option value="1" ${p?.is_primary ? 'selected' : ''}>Evet</option></select></div>
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
          is_primary: $('#pf-primary').value === '1',
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
          await api('/payments', {
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
          toast('Tahsilat kaydedildi.', 'success'); closeModal(); onSaved();
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
        ${studentFormFields({})}
        <div class="section-title">Veli Bilgileri (Birincil)</div>
        <div class="form-grid">
          <div class="field"><label>Yakınlık *</label><select id="np-rel">
            <option value="ANNE">Anne</option><option value="BABA">Baba</option>
            <option value="VASI">Vasi</option><option value="DIGER">Diğer</option></select></div>
          <div class="field"><label>Ad Soyad *</label><input id="np-name"></div>
          <div class="field"><label>Telefon *</label><input id="np-phone"></div>
          <div class="field"><label>E-posta</label><input id="np-email"></div>
          <div class="field"><label>TC Kimlik No</label><input id="np-tc" maxlength="11"></div>
          <div class="field"><label>Meslek</label><input id="np-occ"></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>2. Ücret Kalemleri <span class="muted" style="font-weight:400; font-size:12.5px">· MEB'e ilan edilen liste fiyatlarından</span></h3>
      <div id="ne-items"><div class="empty">Kalemleri görmek için öğrenci (veya yeni öğrenci sekmesinde kampüs) ve öğretim yılı seçin.</div></div>
      <div class="flex mt" style="justify-content:flex-end; font-size:15px">
        Liste Ücreti Toplamı:&nbsp;<b id="ne-total">₺0,00</b>
      </div>
    </div>

    <div class="card">
      <h3>3. Kayıt, İndirim ve Taksit Bilgileri</h3>
      <p class="muted" id="ne-limit-hint" style="font-size:12.5px; margin-bottom:10px"></p>
      <div class="form-grid">
        ${yearSelect('ne-year', { allowAll: false })}
        <div class="field"><label>Kayıt Türü</label><select id="ne-type">
          ${META.enrollment_types.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select></div>
        <div class="field"><label>Kayıt Sınıfı</label><select id="ne-grade">
          ${META.grades.map(g => `<option>${g}</option>`).join('')}</select></div>
        <div class="field"><label>Kayıt Tarihi</label><input type="date" id="ne-date" value="${todayStr()}"></div>
        <div class="field"><label>İndirim Oranı (%)</label><input type="number" step="0.01" min="0" max="100" id="ne-discount" value="0"></div>
        <div class="field"><label>İndirim Gerekçesi</label><input id="ne-discount-reason" placeholder="Kardeş, erken kayıt, burs…"></div>
        <div class="field"><label>Peşinat (TL)</label><input type="number" step="0.01" min="0" id="ne-down" value="0"></div>
        <div class="field"><label>Taksit Sayısı</label><select id="ne-count">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => `<option value="${n}" ${n === 9 ? 'selected' : ''}>${n === 0 ? 'Peşin (taksitsiz)' : n + ' taksit'}</option>`).join('')}</select></div>
        <div class="field"><label>İlk Taksit Tarihi</label><input type="date" id="ne-first-due"></div>
        <div class="field"><label>Varsayılan Ödeme Türü</label><select id="ne-method">
          ${META.payment_methods.map(m => `<option value="${m.value}">${m.label}</option>`).join('')}</select></div>
        <div class="field"><label>Ödeme Sorumlusu (Veli)</label><input id="ne-payer"></div>
        <div class="field"><label>Ödeme Sorumlusu Telefon</label><input id="ne-payer-phone"></div>
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
    loadItems();
  };
  $('#tab-existing').onclick = () => setMode('existing');
  $('#tab-new').onclick = () => setMode('new');

  // ---- Ücret kalemleri (MEB ilan listesi) ----
  let itemsState = [];
  let limitsState = null;

  const currentCampusId = () => {
    if (mode === 'existing') return selectedStudent ? selectedStudent.campus_id : null;
    return isHQ() ? Number($('#sf-campus')?.value) : USER.campus.id;
  };

  const computeTotal = () => itemsState.reduce((a, i) =>
    i.checked && i.price ? a + i.price * i.qty : a, 0);

  function renderItemsTable() {
    const priced = itemsState.filter(i => i.active);
    $('#ne-items').innerHTML = priced.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th style="width:40px"></th><th>Kalem</th><th class="num">İlan Fiyatı</th>
        <th class="num" style="width:90px">Adet</th><th class="num">Tutar</th></tr></thead>
        <tbody>${priced.map((i, idx) => `
          <tr style="${i.price === null ? 'opacity:.5' : ''}">
            <td><input type="checkbox" style="width:auto" data-item-check="${idx}"
              ${i.checked ? 'checked' : ''} ${i.price === null ? 'disabled' : ''}></td>
            <td><b>${esc(i.name)}</b>${i.price === null ? ' <span class="muted" style="font-size:11.5px">(ilan edilmemiş)</span>' : ''}</td>
            <td class="num">${i.price === null ? '-' : fmtTL(i.price)}</td>
            <td class="num"><input type="number" min="1" max="20" value="${i.qty}" data-item-qty="${idx}"
              style="width:70px; text-align:right" ${i.price === null || !i.checked ? 'disabled' : ''}></td>
            <td class="num"><b>${i.checked && i.price ? fmtTL(i.price * i.qty) : '-'}</b></td>
          </tr>`).join('')}
        </tbody></table></div>` :
      '<div class="empty">Bu kampüs ve öğretim yılı için ilan edilmiş ücret listesi yok.<br>Önce <b>Parametreler</b> sayfasından liste fiyatlarını girin.</div>';
    $('#ne-total').textContent = fmtTL(computeTotal());
    $('#ne-limit-hint').textContent = limitsState &&
      (limitsState.max_discount_rate !== null || limitsState.max_discount_amount !== null)
      ? 'Bu kampüste izin verilen azami indirim: ' +
        [limitsState.max_discount_rate !== null ? `%${limitsState.max_discount_rate}` : null,
         limitsState.max_discount_amount !== null ? fmtTL(limitsState.max_discount_amount) : null]
          .filter(Boolean).join(' ve ')
      : '';
    $('#ne-items').querySelectorAll('[data-item-check]').forEach(cb => cb.onchange = () => {
      itemsState.filter(i => i.active)[Number(cb.dataset.itemCheck)].checked = cb.checked;
      renderItemsTable();
    });
    $('#ne-items').querySelectorAll('[data-item-qty]').forEach(inp => inp.onchange = () => {
      const it = itemsState.filter(i => i.active)[Number(inp.dataset.itemQty)];
      it.qty = Math.max(1, Math.min(20, parseInt(inp.value, 10) || 1));
      renderItemsTable();
    });
  }

  async function loadItems() {
    const campus = currentCampusId();
    const year = $('#ne-year').value;
    if (!campus || !year) {
      itemsState = []; limitsState = null;
      $('#ne-items').innerHTML = '<div class="empty">Kalemleri görmek için öğrenci (veya yeni öğrenci sekmesinde kampüs) ve öğretim yılı seçin.</div>';
      $('#ne-total').textContent = fmtTL(0);
      return;
    }
    try {
      const d = await api(`/parameters?campus_id=${campus}&academic_year_id=${year}`);
      if (!$('#ne-items')) return; // sayfa değişmiş
      limitsState = d.limits;
      itemsState = d.fee_items.map((i, idx) => ({
        id: i.id, name: i.name, price: i.price, active: !!i.active,
        checked: idx === 0 && i.price !== null, // ilk kalem (genelde Eğitim Ücreti) hazır seçili
        qty: 1,
      }));
      renderItemsTable();
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
    list_fee: computeTotal(),
    discount_rate: Number($('#ne-discount').value) || 0,
    down_payment: Number($('#ne-down').value) || 0,
    installment_count: Number($('#ne-count').value),
    first_due_date: $('#ne-first-due').value,
  });
  const selectedItems = () => itemsState
    .filter(i => i.checked && i.price !== null)
    .map(i => ({ fee_item_id: i.id, quantity: i.qty }));

  $('#ne-year').onchange = loadItems;
  const sfCampusSel = $('#sf-campus');
  if (sfCampusSel) sfCampusSel.onchange = loadItems;

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
      let studentId;
      if (mode === 'existing') {
        if (!selectedStudent) throw new Error('Lütfen bir öğrenci seçin veya "Yeni Öğrenci" sekmesinden oluşturun.');
        studentId = selectedStudent.id;
      } else {
        const body = readStudentForm();
        body.parents = [{
          relation: $('#np-rel').value, full_name: $('#np-name').value.trim(),
          phone: $('#np-phone').value, email: $('#np-email').value,
          tc_no: $('#np-tc').value, occupation: $('#np-occ').value, is_primary: true,
        }];
        if (!body.parents[0].full_name || !body.parents[0].phone) {
          throw new Error('Yeni öğrenci için veli adı ve telefonu zorunludur.');
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
          enrollment_type: $('#ne-type').value,
          enrollment_date: $('#ne-date').value,
          grade: $('#ne-grade').value,
          items,
          ...planBody(),
          discount_reason: $('#ne-discount-reason').value,
          default_payment_method: $('#ne-method').value,
          payer_name: $('#ne-payer').value,
          payer_phone: $('#ne-payer-phone').value,
          notes: $('#ne-notes').value,
        },
      });
      toast('Kayıt başarıyla oluşturuldu.', 'success');
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
      <div class="crumb">MEB'e bildirilen liste fiyatları ve kampüs indirim sınırları — kayıtlar bu listeden yapılır</div></div></div>
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
      <div class="section-title">İlan Edilen Liste Fiyatları</div>
      <p class="muted" style="font-size:12.5px; margin-bottom:10px">
        Fiyatı boş bırakılan kalem bu kampüste kayıt sırasında seçilemez.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Ücret Kalemi</th><th>Durum</th><th class="num" style="width:220px">İlan Edilen Ücret (TL)</th>
        ${editable ? '<th></th>' : ''}</tr></thead>
        <tbody>${d.fee_items.map(i => `
          <tr style="${!i.active ? 'opacity:.55' : ''}">
            <td><b>${esc(i.name)}</b></td>
            <td>${i.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Pasif</span>'}</td>
            <td class="num"><input type="number" step="0.01" min="0" data-price="${i.id}"
              value="${i.price ?? ''}" placeholder="İlan yok" ${!editable ? 'disabled' : ''}
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
      ${editable ? '<div class="flex mt"><span class="spacer"></span><button class="btn" id="pr-save">💾 Parametreleri Kaydet</button></div>' : ''}`;

    if (!editable) return;
    $('#pr-save').onclick = async () => {
      const prices = [...document.querySelectorAll('[data-price]')].map(inp => ({
        fee_item_id: Number(inp.dataset.price),
        price: inp.value === '' ? null : Number(inp.value),
      }));
      try {
        await api('/parameters', {
          method: 'PUT',
          body: {
            campus_id: Number(campusId()), academic_year_id: Number(yearId()),
            prices,
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
    document.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
      try {
        await api('/parameters/items/' + b.dataset.toggle, {
          method: 'PUT', body: { active: b.dataset.active !== '1' },
        });
        load();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  ['pr-campus', 'pr-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = load;
  });
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
