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
    `SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(invoice_number,'/',-1) AS UNSIGNED)),0) AS max_seq FROM invoices WHERE period_year=? AND period_month=?`,
    [year, monthIndex + 1]
  );
  const seq = String(Number(rows[0].max_seq) + 1).padStart(6, '0');
  return `INV/INK/${siteCode}/${ym}/${seq}`;
}

/**
 * Generate invoice bulanan.
 * options.customerId membatasi generate ke satu pelanggan.
 * options.siteCode membatasi generate ke satu site.
 */
async function generateMonthlyInvoices(referenceDate = new Date(), force = false, actorUserId = null, options = {}) {
  const year = referenceDate.getFullYear();
  const monthIndex = referenceDate.getMonth();
  const todayOnly = new Date(year, monthIndex, referenceDate.getDate());
  const conn = await db.getConnection();
  let created = 0;
  let skipped = 0;
  let eligible = 0;

  try {
    await conn.beginTransaction();

    const where = [`c.customer_status='active'`];
    const params = [];
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
      const dueDay = Math.min(Number(c.effective_due_day), lastDayOfMonth(year, monthIndex));
      const dueDate = new Date(year, monthIndex, dueDay);
      const generateFrom = new Date(dueDate);
      generateFrom.setDate(generateFrom.getDate() - Number(c.generate_days || 3));
      if (!force && todayOnly < generateFrom) { skipped++; continue; }

      const [exists] = await conn.execute(
        `SELECT id FROM invoices WHERE customer_id=? AND period_year=? AND period_month=? LIMIT 1`,
        [c.id, year, monthIndex + 1]
      );
      if (exists.length) { skipped++; continue; }

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
      await conn.execute(`
        INSERT INTO invoices
        (invoice_number, customer_id, period_year, period_month, invoice_date, due_date,
         subtotal, total, outstanding, status, is_prorata, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)
      `, [invoiceNumber, c.id, year, monthIndex + 1, toSqlDate(referenceDate), toSqlDate(dueDate), amount, amount, amount, isProrata, actorUserId]);
      created++;
    }

    await conn.commit();
    await db.execute(
      `INSERT INTO automation_logs (job_name, status, message) VALUES ('generate_monthly_invoices','success',?)`,
      [`Period ${year}-${String(monthIndex + 1).padStart(2,'0')} · created ${created}, skipped ${skipped}, eligible ${eligible}${options.customerId?` · customer ${options.customerId}`:''}${options.siteCode?` · site ${options.siteCode}`:''}`]
    );
    return { created, skipped, eligible };
  } catch (err) {
    await conn.rollback();
    await db.execute(
      `INSERT INTO automation_logs (job_name, status, message) VALUES ('generate_monthly_invoices','failed',?)`,
      [String(err.message).slice(0, 1000)]
    ).catch(() => {});
    throw err;
  } finally {
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
