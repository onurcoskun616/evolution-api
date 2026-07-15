const express = require('express');
const { db, audit, money, today } = require('../db');
const { requirePermission, assertCampusAccess, campusScope } = require('../auth');

const router = express.Router();

const PAYMENT_METHODS = ['NAKIT', 'KREDI_KARTI', 'KMH', 'SENET', 'HAVALE_EFT', 'CEK', 'MAIL_ORDER'];

/**
 * Taksit planı üretir. Kuruş farkları son taksitte toplanır,
 * böylece taksitlerin toplamı net ücrete eşit olur.
 */
function buildPlan({ net_fee, down_payment, installment_count, first_due_date }) {
  const net = money(net_fee);
  const down = money(down_payment);
  const count = Math.max(0, Math.min(24, parseInt(installment_count, 10) || 0));
  if (down > net) throw new Error('Peşinat, net ücretten büyük olamaz.');
  const remaining = money(net - down);
  if (remaining > 0 && count === 0) throw new Error('Kalan tutar için taksit sayısı seçilmelidir.');
  const plan = [];
  if (down > 0) {
    plan.push({ seq_no: 0, label: 'Peşinat', due_date: today(), amount: down });
  }
  if (count > 0 && remaining > 0) {
    const base = Math.floor((remaining / count) * 100) / 100;
    let start = first_due_date ? new Date(first_due_date + 'T00:00:00Z') : new Date();
    if (isNaN(start.getTime())) throw new Error('Geçersiz ilk taksit tarihi.');
    const day = start.getUTCDate();
    let allocated = 0;
    for (let i = 0; i < count; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, lastDay));
      const amount = i === count - 1 ? money(remaining - allocated) : base;
      allocated = money(allocated + amount);
      plan.push({
        seq_no: i + 1,
        label: `${i + 1}. Taksit`,
        due_date: d.toISOString().slice(0, 10),
        amount,
      });
    }
  }
  return plan;
}

function computeFees(b) {
  const list = money(b.list_fee);
  if (list <= 0) throw new Error('Liste ücreti sıfırdan büyük olmalıdır.');
  let discountAmount = money(b.discount_amount);
  let discountRate = Number(b.discount_rate) || 0;
  if (discountRate < 0 || discountRate > 100) throw new Error('İndirim oranı 0-100 arasında olmalıdır.');
  if (discountRate > 0 && !discountAmount) discountAmount = money(list * discountRate / 100);
  if (discountAmount < 0 || discountAmount > list) throw new Error('İndirim tutarı geçersiz.');
  if (!discountRate && discountAmount) discountRate = Math.round((discountAmount / list) * 10000) / 100;
  const net = money(list - discountAmount);
  return { list, discountAmount, discountRate, net };
}

/**
 * MEB ilan listesinden seçilen kalemleri doğrular; kalem bazlı indirimleri
 * (oran VEYA tutar) uygulayıp liste/indirim/net toplamlarını hesaplar.
 */
function resolveItems(campusId, yearId, items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('En az bir ücret kalemi seçilmelidir. Kalemler Parametreler sayfasındaki ilan listesinden gelir.');
  }
  const priceRows = db.prepare(`
    SELECT cp.fee_item_id, cp.price, fi.name, fi.active
    FROM campus_prices cp JOIN fee_items fi ON fi.id = cp.fee_item_id
    WHERE cp.campus_id = ? AND cp.academic_year_id = ?`).all(campusId, yearId);
  const priceMap = new Map(priceRows.map(r => [r.fee_item_id, r]));
  if (priceMap.size === 0) {
    throw new Error('Bu kampüs ve öğretim yılı için ilan edilmiş ücret listesi yok. Önce Parametreler sayfasından fiyatları girin.');
  }
  const resolved = [];
  let listFee = 0;
  let discountTotal = 0;
  const seen = new Set();
  for (const it of items) {
    const itemId = Number(it.fee_item_id);
    if (seen.has(itemId)) continue;
    seen.add(itemId);
    const row = priceMap.get(itemId);
    if (!row) throw new Error('Seçilen kalemlerden biri için bu kampüste ilan edilmiş fiyat yok.');
    if (!row.active) throw new Error(`"${row.name}" kalemi pasif durumda.`);
    const qty = Math.max(1, Math.min(20, parseInt(it.quantity, 10) || 1));
    const gross = money(row.price * qty);
    // Kalem bazlı indirim: oran veya tutar
    let dRate = Number(it.discount_rate) || 0;
    let dAmount = money(it.discount_amount);
    if (dRate < 0 || dRate > 100) {
      throw new Error(`"${row.name}" için indirim oranı 0-100 arasında olmalıdır.`);
    }
    if (dRate > 0 && !dAmount) dAmount = money(gross * dRate / 100);
    if (dAmount < 0 || dAmount > gross) {
      throw new Error(`"${row.name}" için indirim tutarı kalem tutarını aşamaz.`);
    }
    if (!dRate && dAmount) dRate = Math.round((dAmount / gross) * 10000) / 100;
    const netTotal = money(gross - dAmount);
    resolved.push({
      fee_item_id: itemId, name: row.name, unit_price: money(row.price), quantity: qty,
      total: gross, discount_rate: dRate, discount_amount: dAmount, net_total: netTotal,
    });
    listFee = money(listFee + gross);
    discountTotal = money(discountTotal + dAmount);
  }
  if (listFee <= 0) throw new Error('Seçilen kalemlerin toplamı sıfırdan büyük olmalıdır.');
  return { listFee, discountTotal, resolved };
}

/** Kalem toplamlarından kayıt geneli ücret özetini üretir. */
function feesFromItems(itemsInfo) {
  const list = itemsInfo.listFee;
  const discountAmount = itemsInfo.discountTotal;
  const net = money(list - discountAmount);
  if (net < 0) throw new Error('Net ücret sıfırın altına inemez.');
  return {
    list,
    discountAmount,
    discountRate: list > 0 ? Math.round((discountAmount / list) * 10000) / 100 : 0,
    net,
  };
}

/** Kampüsün indirim sınırlarını aşan indirimi engeller. */
function assertDiscountWithinLimits(campusId, yearId, fees) {
  const lim = db.prepare(`
    SELECT max_discount_rate, max_discount_amount FROM campus_discount_limits
    WHERE campus_id = ? AND academic_year_id = ?`).get(campusId, yearId);
  if (!lim) return;
  if (lim.max_discount_rate !== null && fees.discountRate > lim.max_discount_rate + 0.001) {
    throw new Error(`İndirim oranı bu kampüs için izin verilen azami %${lim.max_discount_rate} sınırını aşıyor.`);
  }
  if (lim.max_discount_amount !== null && fees.discountAmount > money(lim.max_discount_amount) + 0.001) {
    throw new Error(`İndirim tutarı bu kampüs için izin verilen azami ${Number(lim.max_discount_amount).toLocaleString('tr-TR')} TL sınırını aşıyor.`);
  }
}

// ---- Taksit planı önizleme ----
router.post('/preview-plan', requirePermission('enrollment.create'), (req, res) => {
  try {
    const b = req.body || {};
    const { net } = computeFees(b);
    const plan = buildPlan({
      net_fee: net,
      down_payment: b.down_payment,
      installment_count: b.installment_count,
      first_due_date: b.first_due_date,
    });
    res.json({ net_fee: net, plan });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Kayıt listesi ----
router.get('/', requirePermission('student.view'), (req, res) => {
  const q = req.query || {};
  const scope = campusScope(req, q.campus_id);
  const where = ['1=1'];
  const params = {};
  if (scope !== null) { where.push('e.campus_id = @campus'); params.campus = scope; }
  if (q.academic_year_id) { where.push('e.academic_year_id = @yr'); params.yr = Number(q.academic_year_id); }
  if (q.status) { where.push('e.status = @st'); params.st = q.status; }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM enrollments e WHERE ${where.join(' AND ')}`).get(params).c;
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(q.page_size, 10) || 25));
  params.limit = pageSize; params.offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT e.*, s.student_no, s.first_name || ' ' || s.last_name AS student_name,
      c.name AS campus_name, ay.name AS academic_year_name,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.enrollment_id = e.id AND p.cancelled = 0) AS total_paid
    FROM enrollments e
    JOIN students s ON s.id = e.student_id
    JOIN campuses c ON c.id = e.campus_id
    JOIN academic_years ay ON ay.id = e.academic_year_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.created_at DESC
    LIMIT @limit OFFSET @offset`).all(params);
  for (const r of rows) r.balance = money(r.net_fee - r.total_paid);
  res.json({ enrollments: rows, total, page, page_size: pageSize });
});

// ---- Yeni kayıt ----
router.post('/', requirePermission('enrollment.create'), (req, res) => {
  const b = req.body || {};
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(b.student_id);
  if (!student) return res.status(400).json({ error: 'Öğrenci bulunamadı.' });
  if (!assertCampusAccess(req, student.campus_id)) {
    return res.status(403).json({ error: 'Bu öğrenci başka bir kampüse kayıtlı.' });
  }
  const year = db.prepare('SELECT * FROM academic_years WHERE id = ?').get(b.academic_year_id);
  if (!year) return res.status(400).json({ error: 'Öğretim yılı seçimi zorunludur.' });
  const dup = db.prepare(
    `SELECT id FROM enrollments WHERE student_id = ? AND academic_year_id = ? AND status != 'IPTAL'`
  ).get(student.id, year.id);
  if (dup) return res.status(400).json({ error: `${year.name} yılı için bu öğrencinin zaten aktif kaydı var.` });
  if (b.default_payment_method && !PAYMENT_METHODS.includes(b.default_payment_method)) {
    return res.status(400).json({ error: 'Geçersiz ödeme türü.' });
  }
  let fees, plan, itemsInfo;
  try {
    itemsInfo = resolveItems(student.campus_id, year.id, b.items);
    fees = feesFromItems(itemsInfo);
    assertDiscountWithinLimits(student.campus_id, year.id, fees);
    plan = buildPlan({
      net_fee: fees.net,
      down_payment: b.down_payment,
      installment_count: b.installment_count,
      first_due_date: b.first_due_date,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const result = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO enrollments (student_id, academic_year_id, campus_id, enrollment_date, enrollment_type,
        grade, list_fee, discount_rate, discount_amount, discount_reason, net_fee, down_payment,
        installment_count, default_payment_method, payer_name, payer_tc, payer_phone, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(student.id, year.id, student.campus_id,
        b.enrollment_date || today(),
        ['YENI_KAYIT', 'KAYIT_YENILEME', 'NAKIL'].includes(b.enrollment_type) ? b.enrollment_type : 'YENI_KAYIT',
        b.grade || student.grade,
        fees.list, fees.discountRate, fees.discountAmount, b.discount_reason || '',
        fees.net, money(b.down_payment),
        plan.filter(p => p.seq_no > 0).length,
        b.default_payment_method || 'NAKIT',
        b.payer_name || '', b.payer_tc || '', b.payer_phone || '',
        b.notes || '', req.user.id);
    const enrollmentId = info.lastInsertRowid;
    const ins = db.prepare(`
      INSERT INTO installments (enrollment_id, seq_no, label, due_date, amount)
      VALUES (?, ?, ?, ?, ?)`);
    for (const p of plan) ins.run(enrollmentId, p.seq_no, p.label, p.due_date, p.amount);
    const insItem = db.prepare(`
      INSERT INTO enrollment_items (enrollment_id, fee_item_id, name, unit_price, quantity, total,
        discount_rate, discount_amount, net_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const it of itemsInfo.resolved) {
      insItem.run(enrollmentId, it.fee_item_id, it.name, it.unit_price, it.quantity, it.total,
        it.discount_rate, it.discount_amount, it.net_total);
    }
    return enrollmentId;
  })();
  audit(req.user.id, 'CREATE', 'enrollment', result, `${student.student_no} / ${year.name}`);
  res.json({ id: result });
});

// ---- Kayıt güncelle (ödemesiz alanlar + ödemesiz plan yeniden oluşturma) ----
router.put('/:id', requirePermission('enrollment.edit'), (req, res) => {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  if (!assertCampusAccess(req, e.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  if (e.status === 'IPTAL') return res.status(400).json({ error: 'İptal edilmiş kayıt düzenlenemez.' });
  const b = req.body || {};
  const paidCount = db.prepare(
    'SELECT COUNT(*) AS c FROM payments WHERE enrollment_id = ? AND cancelled = 0').get(e.id).c;

  // Ücret/plan değişikliği yalnızca hiç tahsilat yoksa yapılabilir
  const planFields = ['items', 'down_payment', 'installment_count', 'first_due_date'];
  const planChange = planFields.some(f => b[f] !== undefined);
  if (planChange) {
    if (paidCount > 0) {
      return res.status(400).json({ error: 'Tahsilat yapılmış kayıtta ücret planı değiştirilemez. Önce tahsilatları iptal edin.' });
    }
    let fees, plan, itemsInfo = null;
    try {
      if (b.items !== undefined) {
        itemsInfo = resolveItems(e.campus_id, e.academic_year_id, b.items);
        fees = feesFromItems(itemsInfo);
      } else {
        // Kalemler değişmiyorsa mevcut ücret özeti korunur, yalnızca plan yeniden kurulur
        fees = { list: e.list_fee, discountAmount: e.discount_amount, discountRate: e.discount_rate, net: e.net_fee };
      }
      assertDiscountWithinLimits(e.campus_id, e.academic_year_id, fees);
      plan = buildPlan({
        net_fee: fees.net,
        down_payment: b.down_payment !== undefined ? b.down_payment : e.down_payment,
        installment_count: b.installment_count !== undefined ? b.installment_count : e.installment_count,
        first_due_date: b.first_due_date,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM installments WHERE enrollment_id = ?').run(e.id);
      db.prepare(`
        UPDATE enrollments SET list_fee = ?, discount_rate = ?, discount_amount = ?, net_fee = ?,
          down_payment = ?, installment_count = ? WHERE id = ?`)
        .run(fees.list, fees.discountRate, fees.discountAmount, fees.net,
          money(b.down_payment !== undefined ? b.down_payment : e.down_payment),
          plan.filter(p => p.seq_no > 0).length, e.id);
      const ins = db.prepare(
        'INSERT INTO installments (enrollment_id, seq_no, label, due_date, amount) VALUES (?, ?, ?, ?, ?)');
      for (const p of plan) ins.run(e.id, p.seq_no, p.label, p.due_date, p.amount);
      if (itemsInfo) {
        db.prepare('DELETE FROM enrollment_items WHERE enrollment_id = ?').run(e.id);
        const insItem = db.prepare(`
          INSERT INTO enrollment_items (enrollment_id, fee_item_id, name, unit_price, quantity, total,
            discount_rate, discount_amount, net_total)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const it of itemsInfo.resolved) {
          insItem.run(e.id, it.fee_item_id, it.name, it.unit_price, it.quantity, it.total,
            it.discount_rate, it.discount_amount, it.net_total);
        }
      }
    })();
  }
  db.prepare(`
    UPDATE enrollments SET discount_reason = ?, payer_name = ?, payer_tc = ?, payer_phone = ?,
      default_payment_method = ?, notes = ?, grade = ? WHERE id = ?`)
    .run(
      b.discount_reason !== undefined ? b.discount_reason : e.discount_reason,
      b.payer_name !== undefined ? b.payer_name : e.payer_name,
      b.payer_tc !== undefined ? b.payer_tc : e.payer_tc,
      b.payer_phone !== undefined ? b.payer_phone : e.payer_phone,
      PAYMENT_METHODS.includes(b.default_payment_method) ? b.default_payment_method : e.default_payment_method,
      b.notes !== undefined ? b.notes : e.notes,
      b.grade !== undefined ? b.grade : e.grade,
      e.id);
  audit(req.user.id, 'UPDATE', 'enrollment', e.id, planChange ? 'plan yeniden oluşturuldu' : '');
  res.json({ ok: true });
});

// ---- Kayıt iptal ----
router.post('/:id/cancel', requirePermission('enrollment.cancel'), (req, res) => {
  const e = db.prepare('SELECT * FROM enrollments WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Kayıt bulunamadı.' });
  if (!assertCampusAccess(req, e.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  if (e.status === 'IPTAL') return res.status(400).json({ error: 'Kayıt zaten iptal edilmiş.' });
  db.transaction(() => {
    db.prepare(`UPDATE enrollments SET status = 'IPTAL', cancel_reason = ? WHERE id = ?`)
      .run((req.body && req.body.reason) || '', e.id);
    db.prepare(`UPDATE installments SET status = 'IPTAL' WHERE enrollment_id = ? AND status IN ('BEKLIYOR','KISMI')`)
      .run(e.id);
  })();
  audit(req.user.id, 'CANCEL', 'enrollment', e.id, (req.body && req.body.reason) || '');
  res.json({ ok: true });
});

// ---- Taksit vadesi/tutarı düzenleme (tekil) ----
router.put('/installments/:installmentId', requirePermission('installment.edit'), (req, res) => {
  const inst = db.prepare(`
    SELECT i.*, e.campus_id, e.net_fee, e.id AS eid FROM installments i
    JOIN enrollments e ON e.id = i.enrollment_id WHERE i.id = ?`).get(req.params.installmentId);
  if (!inst) return res.status(404).json({ error: 'Taksit bulunamadı.' });
  if (!assertCampusAccess(req, inst.campus_id)) return res.status(403).json({ error: 'Yetkisiz kampüs.' });
  if (inst.status === 'ODENDI') return res.status(400).json({ error: 'Ödenmiş taksit düzenlenemez.' });
  const b = req.body || {};
  const newDue = b.due_date || inst.due_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDue)) return res.status(400).json({ error: 'Geçersiz vade tarihi.' });
  let newAmount = inst.amount;
  if (b.amount !== undefined) {
    newAmount = money(b.amount);
    if (newAmount < inst.paid_amount) {
      return res.status(400).json({ error: 'Taksit tutarı, ödenen tutardan küçük olamaz.' });
    }
    // Toplam plan tutarı net ücreti aşmasın / altına düşmesin kontrolü sadece uyarı amaçlı değil, blokaj:
    const otherSum = db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM installments WHERE enrollment_id = ? AND id != ? AND status != 'IPTAL'`
    ).get(inst.eid, inst.id).s;
    if (money(otherSum + newAmount) > money(inst.net_fee)) {
      return res.status(400).json({ error: 'Taksitler toplamı net ücreti aşamaz.' });
    }
  }
  const status = inst.paid_amount <= 0 ? 'BEKLIYOR' : (inst.paid_amount >= newAmount ? 'ODENDI' : 'KISMI');
  db.prepare('UPDATE installments SET due_date = ?, amount = ?, status = ? WHERE id = ?')
    .run(newDue, newAmount, status, inst.id);
  audit(req.user.id, 'UPDATE', 'installment', inst.id, `vade=${newDue} tutar=${newAmount}`);
  res.json({ ok: true });
});

module.exports = router;
module.exports.buildPlan = buildPlan;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;
