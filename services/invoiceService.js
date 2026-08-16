const db = require('../config/db');

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function toSqlDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function calcProrata(price, activationDate, year, monthIndex) {
  const active = new Date(activationDate);
  const days = lastDayOfMonth(year, monthIndex);
  if (active.getFullYear() !== year || active.getMonth() !== monthIndex) return Number(price);
  const billableDays = Math.max(1, days - active.getDate() + 1);
  return Math.round((Number(price) / days) * billableDays);
}

async function nextInvoiceNumber(conn, siteCode, year, monthIndex) {
  const ym = `${year}/${String(monthIndex + 1).padStart(2, '0')}`;
  const [rows] = await conn.execute(
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(invoice_number,'/',-1) AS UNSIGNED)),0) AS max_seq
     FROM invoices WHERE period_year=? AND period_month=?`,
    [year, monthIndex + 1]
  );
  const seq = String(Number(rows[0].max_seq) + 1).padStart(6, '0');
  return `INV/INK/${siteCode}/${ym}/${seq}`;
}

/**
 * Generate/refresh tagihan bulanan secara idempotent.
 * - Satu customer hanya boleh memiliki satu invoice per periode (DB unique key + application check).
 * - Invoice yang sudah ada, termasuk PAID, tidak pernah di-reset / dibuat ulang.
 * - force=true hanya melewati batas hari generate, bukan melewati proteksi duplicate.
 * - Pelanggan yang aktivasi setelah akhir periode tidak akan dibuatkan tagihan periode lama.
 */
async function generateMonthlyInvoices(referenceDate = new Date(), force = false, actorUserId = null, options = {}) {
  const year = referenceDate.getFullYear();
  const monthIndex = referenceDate.getMonth();
  const month = monthIndex + 1;
  const todayOnly = new Date(year, monthIndex, referenceDate.getDate());
  const periodEnd = `${year}-${String(month).padStart(2,'0')}-${String(lastDayOfMonth(year,monthIndex)).padStart(2,'0')}`;
  const lockName = `inkamnet:invoice:${year}-${String(month).padStart(2,'0')}`;
  const conn = await db.getConnection();
  let created = 0;
  let skipped = 0;
  let eligible = 0;
  let existingPaid = 0;
  let existingOpen = 0;
  let skippedSchedule = 0;
  let lockAcquired = false;

  try {
    const [[lockRow]] = await conn.execute(`SELECT GET_LOCK(?,10) AS locked`,[lockName]);
    if (Number(lockRow?.locked) !== 1) throw new Error('Generate tagihan sedang dijalankan proses lain. Coba lagi beberapa detik.');
    lockAcquired = true;
    await conn.beginTransaction();

    const where = [`c.customer_status='active'`, `(c.activation_date IS NULL OR c.activation_date<=?)`];
    const params = [periodEnd];
    if (options.customerId) {
      where.push('c.id=?');
      params.push(Number(options.customerId));
    }
    if (options.siteCode) {
      where.push('s.code=?');
      params.push(String(options.siteCode));
    }

    const [customers] = await conn.execute(`
      SELECT c.*, p.price AS package_price, p.name AS package_name, s.code AS site_code,
             COALESCE(c.due_day, s.default_due_day, st.default_due_day, 5) AS effective_due_day,
             COALESCE(c.grace_days, s.default_grace_days, st.default_grace_days, 2) AS effective_grace_days,
             COALESCE(s.invoice_generate_days, st.invoice_generate_days, 3) AS generate_days
      FROM customers c
      JOIN packages p ON p.id=c.package_id
      JOIN sites s ON s.id=c.site_id
      CROSS JOIN settings st
      WHERE ${where.join(' AND ')}
      ORDER BY s.code,c.name
    `, params);

    eligible = customers.length;

    for (const c of customers) {
      const [exists] = await conn.execute(
        `SELECT id,status,paid_amount,outstanding FROM invoices WHERE customer_id=? AND period_year=? AND period_month=? LIMIT 1`,
        [c.id, year, month]
      );
      if (exists.length) {
        skipped++;
        if (exists[0].status === 'paid' || Number(exists[0].outstanding) <= 0) existingPaid++;
        else existingOpen++;
        continue;
      }

      const dueDay = Math.min(Number(c.effective_due_day), lastDayOfMonth(year, monthIndex));
      const dueDate = new Date(year, monthIndex, dueDay);
      const generateFrom = new Date(dueDate);
      generateFrom.setDate(generateFrom.getDate() - Number(c.generate_days || 3));
      if (!force && todayOnly < generateFrom) { skipped++; skippedSchedule++; continue; }

      let amount = Number(c.package_price);
      let isProrata = 0;
      if (c.prorata_enabled && c.activation_date) {
        const a = new Date(c.activation_date);
        if (a.getFullYear() === year && a.getMonth() === monthIndex) {
          amount = calcProrata(amount, c.activation_date, year, monthIndex);
          isProrata = 1;
        }
      }

      const invoiceNumber = await nextInvoiceNumber(conn, c.site_code, year, monthIndex);
      try {
        await conn.execute(`
          INSERT INTO invoices
          (invoice_number, customer_id, period_year, period_month, invoice_date, due_date,
           subtotal, total, outstanding, status, is_prorata, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)
        `, [invoiceNumber, c.id, year, month, toSqlDate(referenceDate), toSqlDate(dueDate), amount, amount, amount, isProrata, actorUserId]);
        created++;
      } catch (err) {
        // Proteksi terakhir jika request paralel / cron sempat membuat customer-period yang sama.
        if (err && err.code === 'ER_DUP_ENTRY') { skipped++; existingOpen++; continue; }
        throw err;
      }
    }

    await conn.commit();
    await db.execute(
      `INSERT INTO automation_logs (job_name, status, message) VALUES ('generate_monthly_invoices','success',?)`,
      [`Period ${year}-${String(month).padStart(2,'0')} · created ${created}, skipped ${skipped}, paid preserved ${existingPaid}, open preserved ${existingOpen}, schedule skipped ${skippedSchedule}, eligible ${eligible}${options.customerId?` · customer ${options.customerId}`:''}${options.siteCode?` · site ${options.siteCode}`:''}`]
    );
    return { created, skipped, eligible, existingPaid, existingOpen, skippedSchedule };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    await db.execute(
      `INSERT INTO automation_logs (job_name, status, message) VALUES ('generate_monthly_invoices','failed',?)`,
      [String(err.message).slice(0, 1000)]
    ).catch(() => {});
    throw err;
  } finally {
    if (lockAcquired) await conn.execute(`SELECT RELEASE_LOCK(?)`,[lockName]).catch(()=>{});
    conn.release();
  }
}

async function refreshInvoiceStatus(conn, invoiceId) {
  const [rows] = await conn.execute(`
    SELECT i.total, COALESCE(SUM(CASE WHEN p.status='confirmed' THEN p.amount ELSE 0 END),0) AS paid
    FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id
    WHERE i.id=? GROUP BY i.id
  `, [invoiceId]);
  if (!rows.length) return;
  const total = Number(rows[0].total);
  const paid = Number(rows[0].paid);
  const outstanding = Math.max(0, total - paid);
  let status = 'unpaid';
  if (paid > 0 && outstanding > 0) status = 'partial';
  if (outstanding <= 0) status = 'paid';
  await conn.execute(`UPDATE invoices SET paid_amount=?, outstanding=?, status=? WHERE id=?`, [paid, outstanding, status, invoiceId]);
}

module.exports = { generateMonthlyInvoices, refreshInvoiceStatus, calcProrata };
