const db = require('../config/db');
const mt = require('./mikrotikRest');

const EDITABLE_FIELDS = ['name','password','service','profile','local-address','remote-address','caller-id','comment','disabled'];
const EXEMPT_RULES = [
  {type:'admin',label:'Admin / Infrastruktur',pattern:/\b(admin|administrator|noc|monitor(?:ing)?|router|server|uptime|teknisi|technical|support|staff)\b/i},
  {type:'free',label:'Free / Internal',pattern:/\b(free|gratis|complimentary|sponsor|internal|owner)\b/i}
];

function bool(value) { return value === true || ['true','yes','on','1'].includes(String(value)); }
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

function statusOf(secret,active) {
  if (bool(secret.disabled) || /isolir|isolate/i.test(secret.profile||'')) return 'isolated';
  return active ? 'online' : 'offline';
}
function normalize(value) { return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function tokens(value) { return new Set(normalize(value).split(' ').filter(x=>x.length>=3)); }
function exemptOf(secret) {
  const text=[secret.name,secret.profile,secret.comment].join(' ');
  return EXEMPT_RULES.find(rule=>rule.pattern.test(text)) || null;
}
function matchScore(secret,customer) {
  const username=normalize(secret.name),comment=normalize(secret.comment),name=normalize(customer.name),code=normalize(customer.customer_code),registered=normalize(customer.pppoe_username);
  if (registered && username===registered) return 100;
  if (username && (username===code || comment.includes(code))) return 96;
  let score=0;
  if (username.length>=4 && name.replace(/ /g,'').includes(username.replace(/ /g,''))) score=82;
  if (name.length>=4 && username.replace(/ /g,'').includes(name.replace(/ /g,''))) score=Math.max(score,82);
  if (comment.includes(name) || name.includes(comment) && comment.length>=5) score=Math.max(score,88);
  const a=tokens(`${secret.name} ${secret.comment}`),b=tokens(`${customer.name} ${customer.customer_code}`),common=[...a].filter(x=>b.has(x)).length;
  if (common) score=Math.max(score,Math.round(common/Math.max(a.size,b.size)*75)+20);
  const digits=value=>(normalize(value).match(/\d+/g)||[]).join('');
  if (digits(secret.name) && digits(secret.name)===digits(customer.customer_code)) score=Math.max(score,90);
  return Math.min(score,100);
}

async function customersForSite(router) {
  const [rows]=await db.execute(`SELECT c.id,c.customer_code,c.name,c.billing_status,c.network_status,c.pppoe_username,c.router_id,c.site_id,p.name package_name,p.speed_label,
    (SELECT COALESCE(SUM(i.outstanding),0) FROM invoices i WHERE i.customer_id=c.id AND i.status IN ('unpaid','partial','overdue')) outstanding
    FROM customers c LEFT JOIN packages p ON p.id=c.package_id WHERE c.customer_status='active' AND c.site_id=? ORDER BY c.name`,[router.site_id]);
  return rows;
}

async function syncCustomerStatuses(secretRows) {
  const linked=secretRows.filter(x=>x.customer?.id);
  for(let offset=0;offset<linked.length;offset+=200){const chunk=linked.slice(offset,offset+200),cases=chunk.map(()=>`WHEN ? THEN ?`).join(' '),ids=chunk.map(x=>x.customer.id),params=chunk.flatMap(x=>[x.customer.id,x.status]).concat(ids);await db.execute(`UPDATE customers SET network_status=CASE id ${cases} ELSE network_status END WHERE id IN (${ids.map(()=>'?').join(',')})`,params);}
}

async function routerSnapshot(router) {
  const started=Date.now();
  try {
    const [resource,secrets,active,profiles,interfaces,customers]=await Promise.all([mt.testConnection(router),mt.listSecrets(router),mt.listActive(router),mt.listProfiles(router),mt.listInterfaces(router),customersForSite(router)]);
    const eligibleCustomers=customers.filter(x=>!x.router_id||Number(x.router_id)===Number(router.id));
    const activeMap=new Map(active.map(x=>[normalize(x.name),x])),linkedMap=new Map(eligibleCustomers.filter(x=>x.pppoe_username&&Number(x.router_id)===Number(router.id)).map(x=>[normalize(x.pppoe_username),x]));
    const secretRows=secrets.map(secret=>{
      const session=activeMap.get(normalize(secret.name))||null,customer=linkedMap.get(normalize(secret.name))||null,exempt=customer?null:exemptOf(secret);
      const suggestions=customer||exempt?[]:eligibleCustomers.map(c=>({customer:c,score:matchScore(secret,c)})).filter(x=>x.score>=45).sort((a,b)=>b.score-a.score).slice(0,3);
      return {...secret,status:statusOf(secret,session),active:session,customer,exempt,suggestions};
    }).sort((a,b)=>a.name.localeCompare(b.name));
    await syncCustomerStatuses(secretRows);
    const secretNames=new Set(secrets.map(x=>normalize(x.name)));
    const unmatchedCustomers=eligibleCustomers.filter(c=>!c.pppoe_username||!secretNames.has(normalize(c.pppoe_username))).map(customer=>{
      const candidates=secretRows.filter(x=>!x.customer&&!x.exempt).map(secret=>({secretId:secret['.id'],secretName:secret.name,score:matchScore(secret,customer)})).filter(x=>x.score>=45).sort((a,b)=>b.score-a.score).slice(0,3);
      return {...customer,suggestions:candidates};
    });
    const counts=secretRows.reduce((a,x)=>{a.total++;a[x.status]++;if(x.customer)a.linked++;else if(x.exempt)a.exempt++;else if(x.suggestions.length)a.suggested++;else a.unlinked++;return a;},{total:0,online:0,offline:0,isolated:0,linked:0,exempt:0,suggested:0,unlinked:0});
    await db.execute(`UPDATE routers SET last_status='online',last_error=NULL,last_seen_at=NOW() WHERE id=?`,[router.id]);
    return {ok:true,id:router.id,name:router.name,siteCode:router.site_code,siteName:router.site_name,latencyMs:Date.now()-started,resource,counts,secrets:secretRows,profiles,unmatchedCustomers,interfaces:interfaces.map(x=>({...x,rxByte:Number(x['rx-byte']||0),txByte:Number(x['tx-byte']||0)}))};
  } catch(error) {
    await db.execute(`UPDATE routers SET last_status='offline',last_error=? WHERE id=?`,[error.message.slice(0,500),router.id]);
    return {ok:false,id:router.id,name:router.name,siteCode:router.site_code,siteName:router.site_name,error:error.message,latencyMs:Date.now()-started,counts:{total:0,online:0,offline:0,isolated:0,linked:0,exempt:0,suggested:0,unlinked:0},secrets:[],profiles:[],interfaces:[],unmatchedCustomers:[]};
  }
}

async function allSnapshots(){const [routers]=await db.query(`SELECT r.*,s.code site_code,s.name site_name FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.is_active=1 ORDER BY s.code,r.name`);return Promise.all(routers.map(routerSnapshot));}
async function routerById(id){const [rows]=await db.execute(`SELECT r.*,s.code site_code,s.name site_name FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.id=? AND r.is_active=1`,[id]);if(!rows.length)throw new Error('Router tidak ditemukan atau tidak aktif');return rows[0];}
async function customerForRouter(router,customerId){const [rows]=await db.execute(`SELECT id,site_id,name,customer_code FROM customers WHERE id=? AND customer_status='active'`,[customerId]);if(!rows.length)throw new Error('Pelanggan billing tidak ditemukan');if(Number(rows[0].site_id)!==Number(router.site_id))throw new Error('Site pelanggan dan router harus sama');return rows[0];}

async function saveSecret(routerId,secretId,input,customerId){const router=await routerById(routerId),payload=cleanPayload(input);if(!payload.name)throw new Error('Username PPPoE wajib diisi');const customer=customerId?await customerForRouter(router,customerId):null;if(secretId)await mt.updateSecret(router,secretId,payload);else{if(!payload.password)throw new Error('Password wajib diisi untuk secret baru');await mt.createSecret(router,payload);}if(customer)await db.execute(`UPDATE customers SET router_id=?,pppoe_username=?,network_status=? WHERE id=?`,[router.id,payload.name,bool(payload.disabled)?'isolated':'offline',customer.id]);return {router,payload,customer};}
async function syncSecret(routerId,secretId,customerId){const router=await routerById(routerId),customer=await customerForRouter(router,customerId),secret=await mt.getSecret(router,secretId);if(!secret?.name)throw new Error('PPPoE secret tidak ditemukan');const existing=await db.execute(`SELECT id,name FROM customers WHERE router_id=? AND pppoe_username=? AND id<>? LIMIT 1`,[router.id,secret.name,customer.id]);if(existing[0].length)throw new Error(`Secret sudah terhubung ke ${existing[0][0].name}`);await db.execute(`UPDATE customers SET router_id=?,pppoe_username=?,network_status=? WHERE id=?`,[router.id,secret.name,statusOf(secret,null),customer.id]);return {router,secret,customer};}
async function removeSecret(routerId,secretId){const router=await routerById(routerId),result=await mt.deleteSecret(router,secretId);const [linked]=await db.execute(`SELECT id,customer_code,name FROM customers WHERE router_id=? AND pppoe_username=?`,[router.id,result.secret.name]);await db.execute(`UPDATE customers SET pppoe_username=NULL,network_status='offline' WHERE router_id=? AND pppoe_username=?`,[router.id,result.secret.name]);return {router,...result,linkedCustomers:linked};}
async function customersForRouter(routerId){const router=await routerById(routerId);return customersForSite(router);}

module.exports={allSnapshots,routerById,saveSecret,syncSecret,removeSecret,customersForRouter,cleanPayload,matchScore,exemptOf};
