const db = require('../config/db');

async function ensureV14Schema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ticket_updates (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      progress_date DATE NOT NULL,
      progress_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('open','progress','pending','closed') NOT NULL DEFAULT 'progress',
      note TEXT NOT NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_updates_ticket(ticket_id),
      INDEX idx_ticket_updates_date(progress_date),
      CONSTRAINT fk_ticket_updates_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    )
  `);
}

async function ensureV15Schema() {
  await db.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS default_language ENUM('id','en') NOT NULL DEFAULT 'id' AFTER default_theme`);
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo VARCHAR(255) NULL AFTER role`);
  await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_id BIGINT UNSIGNED NULL AFTER cluster_id`);
  await db.query(`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assigned_employee_id BIGINT UNSIGNED NULL AFTER assigned_to`);
  await db.query(`ALTER TABLE technician_schedules ADD COLUMN IF NOT EXISTS technician_employee_id BIGINT UNSIGNED NULL AFTER technician_id`);

  await db.query(`CREATE TABLE IF NOT EXISTS departments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS positions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    department_id BIGINT UNSIGNED NULL,
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    category ENUM('sales','technical','admin','management','finance','other') NOT NULL DEFAULT 'other',
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_position_department(department_id),
    CONSTRAINT fk_position_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS employees (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    employee_code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NULL,
    phone VARCHAR(50) NULL,
    department_id BIGINT UNSIGNED NULL,
    position_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NULL,
    joined_at DATE NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_employee_name(name), INDEX idx_employee_department(department_id), INDEX idx_employee_position(position_id), INDEX idx_employee_user(user_id),
    CONSTRAINT fk_employee_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
    CONSTRAINT fk_employee_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS banks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    bank_name VARCHAR(120) NOT NULL,
    account_name VARCHAR(180) NOT NULL,
    account_number VARCHAR(80) NOT NULL,
    type ENUM('bank_transfer','cash','virtual_account','other') NOT NULL DEFAULT 'bank_transfer',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS payment_gateways (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    provider VARCHAR(120) NULL,
    channel VARCHAR(80) NULL,
    status ENUM('active','inactive','testing') NOT NULL DEFAULT 'inactive',
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS role_permissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_key VARCHAR(50) NOT NULL UNIQUE,
    role_name VARCHAR(100) NOT NULL,
    permissions_json JSON NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`);

  await db.query(`INSERT IGNORE INTO departments(code,name,description) VALUES
    ('OPS','Operasional','Operasional jaringan, support dan administrasi'),
    ('COM','Komersial','Sales, akuisisi dan hubungan pelanggan'),
    ('FIN','Keuangan','Kas, billing dan rekonsiliasi'),
    ('MGT','Manajemen','Pengelolaan dan pengambilan keputusan')`);

  await db.query(`INSERT IGNORE INTO positions(department_id,code,name,category) VALUES
    ((SELECT id FROM departments WHERE code='COM'),'SALES','Sales','sales'),
    ((SELECT id FROM departments WHERE code='OPS'),'TECH-SUPPORT','Technical Support','technical'),
    ((SELECT id FROM departments WHERE code='OPS'),'ADMIN-OPS','Admin Operasional','admin'),
    ((SELECT id FROM departments WHERE code='OPS'),'NOC','NOC / Network','technical'),
    ((SELECT id FROM departments WHERE code='MGT'),'MANAGEMENT','Management','management'),
    ((SELECT id FROM departments WHERE code='FIN'),'FINANCE','Finance / Billing','finance'),
    ((SELECT id FROM departments WHERE code='OPS'),'HELPER-TECH','Helper Teknisi','technical')`);

  await db.query(`INSERT IGNORE INTO role_permissions(role_key,role_name,permissions_json) VALUES
    ('admin','Administrator',JSON_ARRAY('dashboard','customers','billing','finance','network','tickets','reports','settings')),
    ('staff','Staff',JSON_ARRAY('dashboard','customers','billing','tickets','reports'))`);

  // Make every existing login account available in the employee directory without guessing a department/position.
  await db.query(`INSERT IGNORE INTO employees(employee_code,name,user_id,is_active)
    SELECT CONCAT('USR-',LPAD(u.id,4,'0')),u.name,u.id,u.is_active
    FROM users u LEFT JOIN employees e ON e.user_id=u.id
    WHERE e.id IS NULL`);

  // Preserve existing ticket PIC by linking the corresponding employee record when possible.
  await db.query(`UPDATE tickets t JOIN employees e ON e.user_id=t.assigned_to SET t.assigned_employee_id=e.id WHERE t.assigned_employee_id IS NULL AND t.assigned_to IS NOT NULL`);
  await db.query(`UPDATE technician_schedules ts JOIN employees e ON e.user_id=ts.technician_id SET ts.technician_employee_id=e.id WHERE ts.technician_employee_id IS NULL AND ts.technician_id IS NOT NULL`);
}


async function ensureV16Schema() {
  await db.query(`ALTER TABLE cash_categories ADD COLUMN IF NOT EXISTS code VARCHAR(20) NULL AFTER name`);
  await db.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS transaction_code VARCHAR(60) NULL AFTER id`);
  await db.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS proof_path VARCHAR(255) NULL AFTER notes`);
  await db.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS proof_original_name VARCHAR(255) NULL AFTER proof_path`);
  await db.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS proof_mime VARCHAR(100) NULL AFTER proof_original_name`);
  await db.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS proof_size BIGINT UNSIGNED NULL AFTER proof_mime`);
  await db.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS proof_uploaded_by BIGINT UNSIGNED NULL AFTER proof_size`);
  await db.query(`ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS proof_uploaded_at DATETIME NULL AFTER proof_uploaded_by`);

  await db.query(`UPDATE cash_categories SET code='BILL' WHERE name='Pendapatan Billing' AND (code IS NULL OR code='')`);
  await db.query(`UPDATE cash_categories SET code='SETOR' WHERE name='Setoran Cash Pelanggan' AND (code IS NULL OR code='')`);
  await db.query(`UPDATE cash_categories SET code='OPS' WHERE name='Pengeluaran Operasional' AND (code IS NULL OR code='')`);

  // Kategori pengeluaran/pemasukan dibuat manual dari menu Kategori Kas.
  // Hanya kategori sistem pembayaran yang tetap dipertahankan jika sudah ada.

  await db.query(`UPDATE cash_categories SET code=CONCAT('CAT',LPAD(id,3,'0')) WHERE code IS NULL OR code=''`);
  await db.query(`UPDATE cash_categories c JOIN (SELECT code,MIN(id) keep_id FROM cash_categories WHERE code IS NOT NULL AND code<>'' GROUP BY code HAVING COUNT(*)>1) d ON d.code=c.code SET c.code=CONCAT(LEFT(c.code,10),'-',LPAD(c.id,6,'0')) WHERE c.id<>d.keep_id`);
  await db.query(`ALTER TABLE cash_categories ADD UNIQUE INDEX IF NOT EXISTS uniq_cash_category_code(code)`);
  await db.query(`UPDATE cash_transactions SET transaction_code=CONCAT('LEG-',DATE_FORMAT(transaction_date,'%Y%m'),'-',LPAD(id,6,'0')) WHERE transaction_code IS NULL OR transaction_code=''`);
  await db.query(`ALTER TABLE cash_transactions ADD UNIQUE INDEX IF NOT EXISTS uniq_cash_transaction_code(transaction_code)`);
}

module.exports = { ensureV14Schema, ensureV15Schema, ensureV16Schema };
