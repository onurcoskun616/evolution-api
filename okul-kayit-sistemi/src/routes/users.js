const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { requirePermission, ALL_PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABELS } = require('../auth');

const router = express.Router();

// Kampüs müdürü yalnızca kendi kampüsünün kullanıcılarını yönetebilir,
// genel merkez rolü atayamaz.
function canManageTarget(req, targetRole, targetCampusId) {
  if (req.user.role === 'GENEL_MERKEZ') return true;
  if (targetRole === 'GENEL_MERKEZ') return false;
  return Number(targetCampusId) === Number(req.user.campus_id);
}

router.get('/', requirePermission('user.manage'), (req, res) => {
  let rows;
  if (req.user.role === 'GENEL_MERKEZ') {
    rows = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.campus_id, u.active,
             u.extra_permissions, u.revoked_permissions, u.created_at, c.name AS campus_name
      FROM users u LEFT JOIN campuses c ON c.id = u.campus_id
      ORDER BY u.role, u.full_name`).all();
  } else {
    rows = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.campus_id, u.active,
             u.extra_permissions, u.revoked_permissions, u.created_at, c.name AS campus_name
      FROM users u LEFT JOIN campuses c ON c.id = u.campus_id
      WHERE u.campus_id = ? AND u.role != 'GENEL_MERKEZ'
      ORDER BY u.role, u.full_name`).all(req.user.campus_id);
  }
  res.json({
    users: rows.map(u => ({ ...u, role_label: ROLE_LABELS[u.role] || u.role })),
    roles: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })),
    all_permissions: ALL_PERMISSIONS,
    role_permissions: ROLE_PERMISSIONS,
  });
});

router.post('/', requirePermission('user.manage'), (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase();
  if (!username || !b.full_name || !b.role || !b.password) {
    return res.status(400).json({ error: 'Kullanıcı adı, ad soyad, rol ve şifre zorunludur.' });
  }
  if (String(b.password).length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
  if (!ROLE_LABELS[b.role]) return res.status(400).json({ error: 'Geçersiz rol.' });
  const campusId = b.role === 'GENEL_MERKEZ' ? null : Number(b.campus_id) || null;
  if (b.role !== 'GENEL_MERKEZ' && !campusId) {
    return res.status(400).json({ error: 'Bu rol için kampüs seçimi zorunludur.' });
  }
  if (!canManageTarget(req, b.role, campusId)) {
    return res.status(403).json({ error: 'Bu kullanıcıyı oluşturma yetkiniz yok.' });
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(400).json({ error: 'Bu kullanıcı adı zaten kullanılıyor.' });
  }
  const info = db.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, campus_id, extra_permissions, revoked_permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(username, bcrypt.hashSync(String(b.password), 10), String(b.full_name).trim(), b.role,
      campusId, JSON.stringify(b.extra_permissions || []), JSON.stringify(b.revoked_permissions || []));
  audit(req.user.id, 'CREATE', 'user', info.lastInsertRowid, username);
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id', requirePermission('user.manage'), (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  if (!canManageTarget(req, target.role, target.campus_id)) {
    return res.status(403).json({ error: 'Bu kullanıcıyı düzenleme yetkiniz yok.' });
  }
  const b = req.body || {};
  const role = b.role && ROLE_LABELS[b.role] ? b.role : target.role;
  const campusId = role === 'GENEL_MERKEZ' ? null : (b.campus_id !== undefined ? Number(b.campus_id) || null : target.campus_id);
  if (role !== 'GENEL_MERKEZ' && !campusId) {
    return res.status(400).json({ error: 'Bu rol için kampüs seçimi zorunludur.' });
  }
  if (!canManageTarget(req, role, campusId)) {
    return res.status(403).json({ error: 'Bu rol/kampüs atamasını yapma yetkiniz yok.' });
  }
  db.prepare(`
    UPDATE users SET full_name = ?, role = ?, campus_id = ?, active = ?,
      extra_permissions = ?, revoked_permissions = ? WHERE id = ?`)
    .run(
      b.full_name !== undefined ? String(b.full_name).trim() : target.full_name,
      role, campusId,
      b.active !== undefined ? (b.active ? 1 : 0) : target.active,
      JSON.stringify(b.extra_permissions !== undefined ? b.extra_permissions : JSON.parse(target.extra_permissions)),
      JSON.stringify(b.revoked_permissions !== undefined ? b.revoked_permissions : JSON.parse(target.revoked_permissions)),
      target.id
    );
  if (b.password) {
    if (String(b.password).length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalıdır.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(String(b.password), 10), target.id);
  }
  audit(req.user.id, 'UPDATE', 'user', target.id, target.username);
  res.json({ ok: true });
});

module.exports = router;
