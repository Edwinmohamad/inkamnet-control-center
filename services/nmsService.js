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
  for(let offset=0;offset<linked.length;offset+=200){
    const chunk=linked.slice(offset,offset+200),cases=chunk.map(()=>`WHEN ? THEN ?`).join(' '),ids=chunk.map(x=>x.customer.id),statusParams=chunk.flatMap(x=>[x.customer.id,x.status]);
    await db.execute(`UPDATE customers SET status_changed_at=IF(network_status<>CASE id ${cases} ELSE network_status END,NOW(),status_changed_at),network_status=CASE id ${cases} ELSE network_status END WHERE id IN (${ids.map(()=>'?').join(',')})`,[...statusParams,...statusParams,...ids]);
  }
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

async function saveSecret(routerId,secretId,input,customerId){const router=await routerById(routerId),payload=cleanPayload(input);if(!payload.name)throw new Error('Username PPPoE wajib diisi');const customer=customerId?await customerForRouter(router,customerId):null;if(secretId)await mt.updateSecret(router,secretId,payload);else{if(!payload.password)throw new Error('Password wajib diisi untuk secret baru');await mt.createSecret(router,payload);}if(customer){const status=bool(payload.disabled)?'isolated':'offline';await db.execute(`UPDATE customers SET status_changed_at=IF(network_status<>?,NOW(),status_changed_at),router_id=?,pppoe_username=?,network_status=? WHERE id=?`,[status,router.id,payload.name,status,customer.id]);}return {router,payload,customer};}
async function syncSecret(routerId,secretId,customerId){
  const router=await routerById(routerId),customer=await customerForRouter(router,customerId),secret=await mt.getSecret(router,secretId);
  if(!secret?.name)throw new Error('PPPoE secret tidak ditemukan');
  const lockName=`inkamnet_pppoe_${router.id}_${normalize(secret.name).replace(/\s/g,'_').slice(0,35)}`;
  const conn=await db.getConnection();let locked=false;
  try{
    const [[lock]]=await conn.execute(`SELECT GET_LOCK(?,8) locked`,[lockName]);locked=Number(lock?.locked)===1;if(!locked)throw new Error('Sinkronisasi secret sedang diproses pengguna lain. Coba lagi.');
    await conn.beginTransaction();
    const [freshRows]=await conn.execute(`SELECT id,name,customer_code,site_id FROM customers WHERE id=? AND customer_status='active' FOR UPDATE`,[customer.id]);
    const fresh=freshRows[0];if(!fresh)throw new Error('Pelanggan sudah tidak aktif.');if(Number(fresh.site_id)!==Number(router.site_id))throw new Error('Site pelanggan dan router tidak sama.');
    const [existing]=await conn.execute(`SELECT id,name FROM customers WHERE site_id=? AND LOWER(TRIM(pppoe_username))=LOWER(TRIM(?)) AND id<>? LIMIT 1 FOR UPDATE`,[fresh.site_id,secret.name,fresh.id]);
    if(existing.length)throw new Error(`Username PPPoE sudah terhubung ke ${existing[0].name} pada site yang sama.`);
    const status=statusOf(secret,null);
    await conn.execute(`UPDATE customers SET status_changed_at=IF(network_status<>?,NOW(),status_changed_at),router_id=?,pppoe_username=?,network_status=? WHERE id=?`,[status,router.id,secret.name,status,fresh.id]);
    await conn.commit();return {router,secret,customer:{...customer,...fresh}};
  }catch(error){try{await conn.rollback();}catch(_){}throw error;}finally{if(locked){try{await conn.execute(`SELECT RELEASE_LOCK(?)`,[lockName]);}catch(_){}}conn.release();}
}

async function customerSyncSuggestions(customerId){
  const [customerRows]=await db.execute(`SELECT c.id,c.customer_code,c.name,c.site_id,c.pppoe_username,c.router_id,s.code site_code,s.name site_name FROM customers c JOIN sites s ON s.id=c.site_id WHERE c.id=? AND c.customer_status='active' LIMIT 1`,[customerId]);
  const customer=customerRows[0];if(!customer)throw new Error('Pelanggan aktif tidak ditemukan.');
  const [routers]=await db.execute(`SELECT r.*,s.code site_code,s.name site_name FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.site_id=? AND r.is_active=1 ORDER BY r.name`,[customer.site_id]);
  if(!routers.length)throw new Error(`Belum ada router aktif pada site ${customer.site_code}.`);
  const [linked]=await db.execute(`SELECT id,name,router_id,pppoe_username FROM customers WHERE site_id=? AND id<>? AND pppoe_username IS NOT NULL`,[customer.site_id,customer.id]);
  // Username billing harus unik di seluruh site, bukan hanya per-router.
  const occupiedNames=new Set(linked.map(row=>normalize(row.pppoe_username)).filter(Boolean));
  const scanned=await Promise.all(routers.map(async router=>{try{return {router,secrets:await mt.listSecrets(router),error:null};}catch(error){return {router,secrets:[],error:error.message};}}));
  const nameCounts=new Map();for(const item of scanned)for(const secret of item.secrets){const key=normalize(secret.name);if(key)nameCounts.set(key,(nameCounts.get(key)||0)+1);}
  const suggestions=[];
  for(const item of scanned)for(const secret of item.secrets){
    const key=normalize(secret.name);if(!key||!secret['.id']||exemptOf(secret)||occupiedNames.has(key))continue;
    const score=matchScore(secret,customer),duplicateAcrossRouters=(nameCounts.get(key)||0)>1;
    if(score<35||duplicateAcrossRouters)continue;
    suggestions.push({secretId:secret['.id'],secretName:secret.name,profile:secret.profile||'-',comment:secret.comment||'',disabled:bool(secret.disabled),routerId:item.router.id,routerName:item.router.name,siteCode:item.router.site_code,score});
  }
  suggestions.sort((a,b)=>b.score-a.score||a.secretName.localeCompare(b.secretName));
  return {customer,suggestions:suggestions.slice(0,12),routerFailures:scanned.filter(item=>item.error).map(item=>`${item.router.name}: ${item.error}`),duplicateNames:[...nameCounts].filter(([,count])=>count>1).map(([name])=>name)};
}
async function removeSecret(routerId,secretId){const router=await routerById(routerId),result=await mt.deleteSecret(router,secretId);const [linked]=await db.execute(`SELECT id,customer_code,name FROM customers WHERE router_id=? AND pppoe_username=?`,[router.id,result.secret.name]);await db.execute(`UPDATE customers SET status_changed_at=IF(network_status<>'offline',NOW(),status_changed_at),pppoe_username=NULL,network_status='offline' WHERE router_id=? AND pppoe_username=?`,[router.id,result.secret.name]);return {router,...result,linkedCustomers:linked};}
async function disconnectSecret(routerId,secretId){const router=await routerById(routerId),result=await mt.disconnectSecret(router,secretId);if(result.disconnected)await db.execute(`UPDATE customers SET status_changed_at=IF(network_status<>'offline',NOW(),status_changed_at),network_status='offline' WHERE router_id=? AND pppoe_username=?`,[router.id,result.secret.name]);return {router,...result};}
async function customersForRouter(routerId){const router=await routerById(routerId);return customersForSite(router);}

async function syncActiveCustomers(siteCode=''){
  const scopedSite=String(siteCode||'').trim().toUpperCase();
  let routerSql=`SELECT r.*,s.code site_code,s.name site_name FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.is_active=1`;
  const routerParams=[];
  if(scopedSite){routerSql+=` AND s.code=?`;routerParams.push(scopedSite);}
  routerSql+=` ORDER BY s.code,r.name`;
  const [routers]=await db.execute(routerSql,routerParams);
  if(scopedSite&&!routers.length)throw new Error(`Router aktif untuk site ${scopedSite} tidak ditemukan.`);

  const routerData=await Promise.all(routers.map(async router=>{
    try{
      const [secrets,active]=await Promise.all([mt.listSecrets(router),mt.listActive(router)]);
      const activeNames=new Set(active.map(row=>normalize(row.name)));
      return {ok:true,router,secrets,activeNames};
    }catch(error){
      return {ok:false,router,error:error.message};
    }
  }));

  const secretIndex=new Map();
  for(const item of routerData.filter(row=>row.ok)){
    for(const secret of item.secrets){
      const name=normalize(secret.name);if(!name)continue;
      const key=`${item.router.site_id}:${name}`;
      const entries=secretIndex.get(key)||[];
      entries.push({router:item.router,secret,status:statusOf(secret,item.activeNames.has(name))});
      secretIndex.set(key,entries);
    }
  }

  let customerSql=`SELECT c.id,c.customer_code,c.name,c.site_id,c.pppoe_username,s.code site_code FROM customers c JOIN sites s ON s.id=c.site_id WHERE c.customer_status='active'`;
  const customerParams=[];
  if(scopedSite){customerSql+=` AND s.code=?`;customerParams.push(scopedSite);}
  customerSql+=` ORDER BY s.code,c.name`;
  const [customers]=await db.execute(customerSql,customerParams);
  const summary={scope:scopedSite||'Semua Site',routers:routers.length,routerFailures:routerData.filter(row=>!row.ok).length,customers:customers.length,matched:0,online:0,offline:0,isolated:0,unconfigured:0,unmatched:0,duplicate:0};
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    for(const customer of customers){
      const username=normalize(customer.pppoe_username);
      if(!username){summary.unconfigured++;continue;}
      const matches=secretIndex.get(`${customer.site_id}:${username}`)||[];
      if(matches.length===0){summary.unmatched++;continue;}
      if(matches.length>1){summary.duplicate++;continue;}
      const match=matches[0];
      await conn.execute(`UPDATE customers SET status_changed_at=IF(network_status<>?,NOW(),status_changed_at),router_id=?,network_status=? WHERE id=?`,[match.status,match.router.id,match.status,customer.id]);
      summary.matched++;summary[match.status]=(summary[match.status]||0)+1;
    }
    await conn.commit();
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  summary.failures=routerData.filter(row=>!row.ok).map(row=>`${row.router.site_code} / ${row.router.name}: ${row.error}`);
  return summary;
}

module.exports={allSnapshots,routerById,saveSecret,syncSecret,customerSyncSuggestions,removeSecret,disconnectSecret,customersForRouter,syncActiveCustomers,cleanPayload,matchScore,exemptOf};
