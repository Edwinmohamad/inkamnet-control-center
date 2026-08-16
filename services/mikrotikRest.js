const http = require('http');
const https = require('https');
const { URL } = require('url');
const { decrypt } = require('./cryptoService');

function request(router, method, path, body = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const base = router.base_url.replace(/\/$/, '');
    const url = new URL(base + path);
    const transport = url.protocol === 'https:' ? https : http;
    const password = decrypt(router.password_enc);
    const data = body == null ? null : JSON.stringify(body);
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${router.username}:${password}`).toString('base64'),
        'Accept': 'application/json',
        ...(data ? {'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)} : {})
      },
      rejectUnauthorized: router.verify_tls !== 0 && router.verify_tls !== false,
      timeout: timeoutMs
    }, res => {
      let raw='';
      res.setEncoding('utf8');
      res.on('data', c => raw += c);
      res.on('end', () => {
        let parsed = null;
        if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = raw; } }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const msg = parsed?.detail || parsed?.message || raw || `HTTP ${res.statusCode}`;
        const err = new Error(`MikroTik ${res.statusCode}: ${msg}`);
        err.statusCode = res.statusCode;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('MikroTik timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function testConnection(router) {
  const result = await request(router, 'GET', '/system/resource?.proplist=board-name,version,uptime,cpu-load,free-memory,total-memory');
  return Array.isArray(result) ? result[0] : result;
}

async function findSecret(router, username) {
  const result = await request(router, 'GET', `/ppp/secret?name=${encodeURIComponent(username)}&.proplist=.id,name,disabled,profile,service,comment`);
  return Array.isArray(result) ? result[0] || null : result;
}

async function findActive(router, username) {
  const result = await request(router, 'GET', `/ppp/active?name=${encodeURIComponent(username)}&.proplist=.id,name,address,uptime,caller-id,service`);
  return Array.isArray(result) ? result[0] || null : result;
}

async function isolatePppoe(router, username) {
  const secret = await findSecret(router, username);
  if (!secret) throw new Error(`PPPoE secret '${username}' tidak ditemukan`);
  await request(router, 'PATCH', `/ppp/secret/${encodeURIComponent(secret['.id'])}`, { disabled: 'true' });
  const active = await findActive(router, username);
  if (active?.['.id']) await request(router, 'DELETE', `/ppp/active/${encodeURIComponent(active['.id'])}`);
  return { secret, disconnected: !!active };
}

async function unisolatePppoe(router, username) {
  const secret = await findSecret(router, username);
  if (!secret) throw new Error(`PPPoE secret '${username}' tidak ditemukan`);
  await request(router, 'PATCH', `/ppp/secret/${encodeURIComponent(secret['.id'])}`, { disabled: 'false' });
  return { secret };
}

module.exports = { request, testConnection, findSecret, findActive, isolatePppoe, unisolatePppoe };
