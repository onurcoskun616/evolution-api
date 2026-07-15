/**
 * Kimlik doğrulama ve yetkilendirme katmanı.
 * Roller ve rol bazlı izinler + kullanıcı bazında ek/kısıtlı izinler.
 */
const jwt = require('jsonwebtoken');
const { db } = require('./db');

const JWT_SECRET = process.env.OKUL_JWT_SECRET || 'okul-kayit-sistemi-gizli-anahtar-degistirin';
const TOKEN_TTL = '12h';

// Tüm izinlerin listesi
const ALL_PERMISSIONS = [
  'dashboard.view',
  'student.view', 'student.create', 'student.edit', 'student.delete',
  'enrollment.create', 'enrollment.edit', 'enrollment.cancel',
  'payment.create', 'payment.cancel', 'payment.view',
  'installment.edit',
  'report.view', 'report.export',
  'user.manage', 'campus.manage', 'settings.manage',
  'audit.view',
];

// Rol -> varsayılan izinler
const ROLE_PERMISSIONS = {
  GENEL_MERKEZ: [...ALL_PERMISSIONS],
  KAMPUS_MUDURU: [
    'dashboard.view',
    'student.view', 'student.create', 'student.edit', 'student.delete',
    'enrollment.create', 'enrollment.edit', 'enrollment.cancel',
    'payment.create', 'payment.cancel', 'payment.view',
    'installment.edit',
    'report.view', 'report.export',
    'user.manage', 'audit.view',
  ],
  KAYIT_PERSONELI: [
    'dashboard.view',
    'student.view', 'student.create', 'student.edit',
    'enrollment.create', 'enrollment.edit',
    'payment.create', 'payment.view',
    'report.view',
  ],
  MUHASEBE: [
    'dashboard.view',
    'student.view',
    'payment.create', 'payment.cancel', 'payment.view',
    'installment.edit',
    'report.view', 'report.export',
  ],
  RAPOR: ['dashboard.view', 'student.view', 'payment.view', 'report.view', 'report.export'],
};

const ROLE_LABELS = {
  GENEL_MERKEZ: 'Genel Merkez Yöneticisi',
  KAMPUS_MUDURU: 'Kampüs Müdürü',
  KAYIT_PERSONELI: 'Kayıt Personeli',
  MUHASEBE: 'Muhasebe',
  RAPOR: 'Raporlama (Salt Okunur)',
};

/** Kullanıcının etkin izin kümesini hesaplar. */
function effectivePermissions(user) {
  const base = new Set(ROLE_PERMISSIONS[user.role] || []);
  let extra = [];
  let revoked = [];
  try { extra = JSON.parse(user.extra_permissions || '[]'); } catch {}
  try { revoked = JSON.parse(user.revoked_permissions || '[]'); } catch {}
  for (const p of extra) base.add(p);
  for (const p of revoked) base.delete(p);
  return base;
}

function signToken(user) {
  return jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

const getUserStmt = () => db.prepare('SELECT * FROM users WHERE id = ? AND active = 1');

/** Express middleware: JWT doğrular, req.user'ı doldurur. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  if (!token) return res.status(401).json({ error: 'Oturum bulunamadı. Lütfen giriş yapın.' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yapın.' });
  }
  const user = getUserStmt().get(payload.uid);
  if (!user) return res.status(401).json({ error: 'Kullanıcı bulunamadı veya pasif.' });
  req.user = user;
  req.permissions = effectivePermissions(user);
  next();
}

/** Belirli bir izni zorunlu kılan middleware üretir. */
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.permissions.has(perm)) {
      return res.status(403).json({ error: 'Bu işlem için yetkiniz yok: ' + perm });
    }
    next();
  };
}

/**
 * Kampüs kapsamı: Genel merkez tüm kampüsleri görür,
 * diğer roller yalnızca kendi kampüslerini görür.
 * Dönüş: null => tüm kampüsler, sayı => tek kampüs kısıtı.
 */
function campusScope(req, requestedCampusId) {
  if (req.user.role === 'GENEL_MERKEZ') {
    return requestedCampusId ? Number(requestedCampusId) : null;
  }
  return req.user.campus_id;
}

/** Kullanıcının verilen kampüste işlem yapıp yapamayacağını kontrol eder. */
function assertCampusAccess(req, campusId) {
  if (req.user.role === 'GENEL_MERKEZ') return true;
  return Number(campusId) === Number(req.user.campus_id);
}

module.exports = {
  JWT_SECRET, ALL_PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABELS,
  effectivePermissions, signToken, authenticate, requirePermission,
  campusScope, assertCampusAccess,
};
