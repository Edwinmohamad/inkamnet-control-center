function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  res.locals.user = req.session.user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.session.flash = { type: 'danger', message: 'Akses hanya untuk Admin.' };
    return res.redirect('/');
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
