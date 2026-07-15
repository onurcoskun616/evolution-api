const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { signToken, authenticate, effectivePermissions, ROLE_LABELS } = require('../auth');

const router = express.Router();

function userInfo(user) {
  const campus = user.campus_id
    ? db.prepare('SELECT id, name, code FROM campuses WHERE id = ?').get(user.campus_id)
    : null;
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    role_label: ROLE_LABELS[user.role] || user.role,
    campus,
    permissions: [...effectivePermissions(user)],
  };
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur.' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim().toLowerCase());
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  audit(user.id, 'LOGIN', 'user', user.id, '');
  res.json({ token: signToken(user), user: userInfo(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: userInfo(req.user) });
});

router.post('/change-password', authenticate, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalıdır.' });
  }
  if (!bcrypt.compareSync(current_password || '', req.user.password_hash)) {
    return res.status(400).json({ error: 'Mevcut şifre hatalı.' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(String(new_password), 10), req.user.id);
  audit(req.user.id, 'PASSWORD_CHANGE', 'user', req.user.id, '');
  res.json({ ok: true });
});

module.exports = router;
