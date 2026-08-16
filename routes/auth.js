const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { title: 'Login', layout: false });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await db.execute(`SELECT id, name, username, password_hash, role, is_active FROM users WHERE username=? LIMIT 1`, [username]);
  const user = rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).render('auth/login', { title: 'Login', layout: false, error: 'Username atau password salah.' });
  }
  const sessionUser = { id: user.id, name: user.name, username: user.username, role: user.role };
  // Regenerate session after login to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) return res.status(500).send('Gagal membuat session login. Coba lagi.');
    req.session.user = sessionUser;
    req.session.save(() => res.redirect('/'));
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
