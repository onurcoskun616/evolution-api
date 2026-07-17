const express = require('express');
const { db, audit } = require('../db');
const { requirePermission } = require('../auth');
const { phoneField } = require('../validate');

const router = express.Router();

// Tüm giriş yapmış kullanıcılar kampüs listesini görebilir (formlar için gerekli)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM campuses ORDER BY name').all();
  res.json({ campuses: rows });
});

router.post('/', requirePermission('campus.manage'), (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.code) return res.status(400).json({ error: 'Kampüs adı ve kodu zorunludur.' });
  if (db.prepare('SELECT id FROM campuses WHERE code = ?').get(String(b.code).trim().toUpperCase())) {
    return res.status(400).json({ error: 'Bu kampüs kodu zaten kullanılıyor.' });
  }
  if (b.phone !== undefined) {
    const r = phoneField(b.phone, 'Kampüs');
    if (r.error) return res.status(400).json({ error: r.error });
    b.phone = r.value;
  }
  const info = db.prepare(`
    INSERT INTO campuses (code, name, address, phone, manager_name)
    VALUES (?, ?, ?, ?, ?)`)
    .run(String(b.code).trim().toUpperCase(), String(b.name).trim(),
      b.address || '', b.phone || '', b.manager_name || '');
  audit(req.user.id, 'CREATE', 'campus', info.lastInsertRowid, b.name);
  res.json({ id: info.lastInsertRowid });
});

router.put('/:id', requirePermission('campus.manage'), (req, res) => {
  const campus = db.prepare('SELECT * FROM campuses WHERE id = ?').get(req.params.id);
  if (!campus) return res.status(404).json({ error: 'Kampüs bulunamadı.' });
  const b = req.body || {};
  if (b.phone !== undefined) {
    const r = phoneField(b.phone, 'Kampüs');
    if (r.error) return res.status(400).json({ error: r.error });
    b.phone = r.value;
  }
  db.prepare(`
    UPDATE campuses SET name = ?, address = ?, phone = ?, manager_name = ?, active = ? WHERE id = ?`)
    .run(
      b.name !== undefined ? String(b.name).trim() : campus.name,
      b.address !== undefined ? b.address : campus.address,
      b.phone !== undefined ? b.phone : campus.phone,
      b.manager_name !== undefined ? b.manager_name : campus.manager_name,
      b.active !== undefined ? (b.active ? 1 : 0) : campus.active,
      campus.id
    );
  audit(req.user.id, 'UPDATE', 'campus', campus.id, campus.name);
  res.json({ ok: true });
});

module.exports = router;
