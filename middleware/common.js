function commonLocals(req, res, next) {
  res.locals.appName = process.env.APP_NAME || 'INKAMNET Billing';
  res.locals.user = req.session?.user || null;
  res.locals.currentPath = req.originalUrl ? req.originalUrl.split('?')[0] : req.path || '/';
  res.locals.flash = req.session?.flash || null;
  if (req.session?.flash) delete req.session.flash;
  res.locals.formatRupiah = (value) => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0
  }).format(Number(value || 0));
  res.locals.formatDate = (value) => {
    if (!value) return '-';
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(value));
  };
  next();
}
module.exports = commonLocals;
