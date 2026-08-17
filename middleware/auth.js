const db = require('../config/db');

const PERMISSIONS = [
  'dashboard', 'customers', 'billing', 'warehouse', 'support',
  'network', 'finance', 'reports', 'logs', 'settings'
];

const DEFAULT_PERMISSIONS = {
  admin: [...PERMISSIONS],
  staff: ['dashboard', 'customers', 'billing', 'support', 'reports']
};

function normalizePermissions(value, role = 'staff') {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  if (Array.isArray(parsed)) parsed = parsed.map(item => item === 'tickets' ? 'support' : item);
  const allowed = new Set(PERMISSIONS);
  let result = Array.isArray(parsed) ? parsed.filter(item => allowed.has(item)) : [];
  if (role !== 'admin') result = result.filter(item => item !== 'settings');
  if (!result.length) result.push(...(DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.staff));
  if (!result.includes('dashboard')) result.unshift('dashboard');
  if (role === 'admin' && !result.includes('settings')) result.push('settings');
  return [...new Set(result)];
}

async function loadPermissions(req, res, next) {
  if (!req.session?.user) {
    req.permissions = [];
    res.locals.permissions = [];
    res.locals.can = () => false;
    return next();
  }
  const role = req.session.user.role || 'staff';
  try {
    const [rows] = await db.execute(`SELECT permissions_json FROM role_permissions WHERE role_key=? LIMIT 1`, [role]);
    req.permissions = normalizePermissions(rows[0]?.permissions_json, role);
  } catch (err) {
    console.error('Gagal memuat role permission:', err.message);
    req.permissions = normalizePermissions(DEFAULT_PERMISSIONS[role], role);
  }
  res.locals.permissions = req.permissions;
  res.locals.can = permission => req.permissions.includes(permission);
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  res.locals.user = req.session.user;
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if ((req.permissions || []).includes(permission)) return next();
    return res.status(403).render('errors/403', {
      title: 'Akses Dibatasi',
      requiredPermission: permission
    });
  };
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.session.flash = { type: 'danger', message: 'Akses hanya untuk Admin.' };
    return res.redirect('/');
  }
  next();
}

module.exports = {
  PERMISSIONS,
  DEFAULT_PERMISSIONS,
  normalizePermissions,
  loadPermissions,
  requireAuth,
  requireAdmin,
  requirePermission
};
