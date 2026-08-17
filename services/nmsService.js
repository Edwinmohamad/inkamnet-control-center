const db = require('../config/db');
const mt = require('./mikrotikRest');

const EDITABLE_FIELDS = ['name','password','service','profile','local-address','remote-address','caller-id','comment','disabled'];

function bool(value) { return value === true || value === 'true' || value === 'yes' || value === 'on' || value === '1'; }
function cleanPayload(input = {}) {
  const payload = {};
  for (const key of EDITABLE_FIELDS) {
    if (input[key] === undefined || input[key] === null) continue;
    const value = String(input[key]).trim();
    if (key === 'password' && !value) continue;
    payload[key] = key === 'disabled' ? (bool(input[key]) ? 'true' : 'false') : value;
  }
  payload.service = payload.service || 'pppoe';
  return payload;
}

function statusOf(secret, active) {
  const isolated = bool(secret.disabled) || /isolir|isolate/i.test(secret.profile || '');
  if (isolated) return 'isolated';
  return active ? 'online' : 'offline';
}

async function syncCustomerStatuses(secretRows) {
  const linked = secretRows.filter(x => x.customer?.id);
  for (let offset=0; offset<linked.length; offset+=200) {
    const chunk=linked.slice(offset,offset+200);
    const cases=chunk.map(()=>`WHEN ? THEN ?`).join(' ');
    const ids=chunk.map(x=>x.customer.id);
    const params=chunk.flatMap(x=>[x.customer.id,x.status]).concat(ids);
    await db.execute(`UPDATE customers SET network_status=CASE id ${cases} ELSE network_status END WHERE id IN (${ids.map(()=>'?').join(',')})`,params);
  }
}

async function customerMap(router) {
  const [rows] = await db.execute(`SELECT c.id,c.customer_code,c.name,c.billing_status,c.network_status,
    c.pppoe_username,c.router_id,c.site_id,p.name package_name,p.speed_label,
    (SELECT COALESCE(SUM(i.outstanding),0) FROM invoices i WHERE i.customer_id=c.id AND i.status IN ('unpaid','partial','overdue')) outstanding
    FROM customers c LEFT JOIN packages p ON p.id=c.package_id
    WHERE c.customer_status='active' AND (c.router_id=? OR (c.router_id IS NULL AND c.site_id=?))`, [router.id, router.site_id]);
  return new Map(rows.filter(x => x.pppoe_username).map(x => [String(x.pppoe_username).toLowerCase(), x]));
}

async function routerSnapshot(router) {
  const started = Date.now();
  try {
    const [resource, secrets, active, profiles, interfaces, customers] = await Promise.all([
      mt.testConnection(router), mt.listSecrets(router), mt.listActive(router), mt.listProfiles(router),
      mt.listInterfaces(router), customerMap(router)
    ]);
    const activeMap = new Map(active.map(x => [String(x.name).toLowerCase(), x]));
    const secretRows = secrets.map(secret => {
      const key = String(secret.name || '').toLowerCase();
      const session = activeMap.get(key) || null;
      const customer = customers.get(key) || null;
      return { ...secret, status: statusOf(secret, session), active: session, customer };
    }).sort((a,b) => a.name.localeCompare(b.name));
    await syncCustomerStatuses(secretRows);
    const counts = secretRows.reduce((a,x) => { a.total++; a[x.status]++; if (x.customer) a.linked++; return a; }, {total:0,online:0,offline:0,isolated:0,linked:0});
    await db.execute(`UPDATE routers SET last_status='online',last_error=NULL,last_seen_at=NOW() WHERE id=?`, [router.id]);
    return {
      ok:true, id:router.id, name:router.name, siteCode:router.site_code, siteName:router.site_name,
      latencyMs:Date.now()-started, resource, counts, secrets:secretRows, profiles,
      interfaces:interfaces.map(x => ({...x, rxByte:Number(x['rx-byte']||0), txByte:Number(x['tx-byte']||0)}))
    };
  } catch (error) {
    await db.execute(`UPDATE routers SET last_status='offline',last_error=? WHERE id=?`, [error.message.slice(0,500),router.id]);
    return {ok:false,id:router.id,name:router.name,siteCode:router.site_code,siteName:router.site_name,error:error.message,latencyMs:Date.now()-started,counts:{total:0,online:0,offline:0,isolated:0,linked:0},secrets:[],profiles:[],interfaces:[]};
  }
}

async function allSnapshots() {
  const [routers] = await db.query(`SELECT r.*,s.code site_code,s.name site_name FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.is_active=1 ORDER BY s.code,r.name`);
  return Promise.all(routers.map(routerSnapshot));
}

async function routerById(id) {
  const [rows] = await db.execute(`SELECT r.*,s.code site_code,s.name site_name FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.id=? AND r.is_active=1`, [id]);
  if (!rows.length) throw new Error('Router tidak ditemukan atau tidak aktif');
  return rows[0];
}

async function saveSecret(routerId, secretId, input, customerId) {
  const router = await routerById(routerId);
  const payload = cleanPayload(input);
  if (!payload.name) throw new Error('Username PPPoE wajib diisi');
  let customer = null;
  if (customerId) {
    const [rows] = await db.execute(`SELECT id,site_id FROM customers WHERE id=? AND customer_status='active'`, [customerId]);
    if (!rows.length) throw new Error('Pelanggan billing tidak ditemukan');
    if (Number(rows[0].site_id) !== Number(router.site_id)) throw new Error('Site pelanggan dan router harus sama');
    customer = rows[0];
  }
  if (secretId) await mt.updateSecret(router, secretId, payload);
  else {
    if (!payload.password) throw new Error('Password wajib diisi untuk secret baru');
    await mt.createSecret(router, payload);
  }
  if (customer) {
    await db.execute(`UPDATE customers SET router_id=?,pppoe_username=?,network_status=? WHERE id=?`, [router.id,payload.name,bool(payload.disabled)?'isolated':'offline',customer.id]);
  }
  return {router,payload};
}

async function customersForRouter(routerId) {
  const router = await routerById(routerId);
  const [rows] = await db.execute(`SELECT c.id,c.customer_code,c.name,c.pppoe_username,p.name package_name FROM customers c LEFT JOIN packages p ON p.id=c.package_id WHERE c.site_id=? AND c.customer_status='active' ORDER BY c.name`, [router.site_id]);
  return rows;
}

module.exports = { allSnapshots, routerById, saveSecret, customersForRouter, cleanPayload };
