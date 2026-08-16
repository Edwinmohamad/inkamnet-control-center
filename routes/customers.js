const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../config/db');
const { audit } = require('../services/auditService');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

async function options() {
  const [sites] = await db.query(`SELECT id, code, name FROM sites WHERE is_active=1 ORDER BY code`);
  const [packages] = await db.query(`SELECT p.id,p.name,p.speed_label,p.price,p.site_id,s.code site_code FROM packages p LEFT JOIN sites s ON s.id=p.site_id WHERE p.is_active=1 ORDER BY COALESCE(s.code,'ZZZ'),p.price,p.name`);
  const [routers] = await db.query(`SELECT r.id,r.name,s.code site_code FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.is_active=1 ORDER BY s.code,r.name`);
  const [clusters] = await db.query(`SELECT cl.id,cl.name,s.code site_code FROM clusters cl JOIN sites s ON s.id=cl.site_id WHERE cl.status!='inactive' ORDER BY s.code,cl.name`);
  const [sales] = await db.query(`SELECT e.id,e.employee_code,e.name FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.is_active=1 AND p.category='sales' ORDER BY e.name`);
  return { sites, packages, routers, clusters, sales };
}

function customerFilter(req) {
  return { q:(req.query.q||'').trim(), site:req.query.site||'', status:req.query.status||'' };
}
function customerSql(filters) {
  let sql=`SELECT c.*,s.code site_code,s.name site_name,p.name package_name,p.price package_price,p.speed_label,r.name router_name,cl.name cluster_name,se.name sales_name,se.employee_code sales_code FROM customers c JOIN sites s ON s.id=c.site_id JOIN packages p ON p.id=c.package_id LEFT JOIN routers r ON r.id=c.router_id LEFT JOIN clusters cl ON cl.id=c.cluster_id LEFT JOIN employees se ON se.id=c.sales_id WHERE 1=1`;
  const params=[];
  if(filters.q){sql+=` AND (c.customer_code LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR c.address LIKE ? OR c.pppoe_username LIKE ?)`;params.push(...Array(5).fill(`%${filters.q}%`));}
  if(filters.site){sql+=` AND s.code=?`;params.push(filters.site);}
  if(filters.status){sql+=` AND c.customer_status=?`;params.push(filters.status);}
  sql+=` ORDER BY c.id DESC`;
  return {sql,params};
}
function plainCell(cell) {
  const v=cell?.value;
  if(v==null) return '';
  if(v instanceof Date) return v;
  if(typeof v==='object'){
    if(v.text!=null) return String(v.text);
    if(v.result!=null) return v.result;
    if(Array.isArray(v.richText)) return v.richText.map(x=>x.text||'').join('');
  }
  return v;
}
function dateString(value){
  if(!value) return null;
  if(value instanceof Date) return value.toISOString().slice(0,10);
  const s=String(value).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}
function boolValue(v, fallback=true){
  if(v==null || String(v).trim()==='') return fallback;
  return ['1','true','yes','ya','y','aktif'].includes(String(v).trim().toLowerCase());
}
function phoneString(v){
  if(v==null || String(v).trim()==='') return null;
  let s=String(v).trim().replace(/\.0$/,'');
  if(/^8\d{7,14}$/.test(s)) s='0'+s;
  return s;
}

function normalizeCodePart(value){return String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function autoCustomerEmail(customerCode){
  const local=String(customerCode||'pelanggan').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,48)||'pelanggan';
  return `${local}@customer.inkamnet.local`;
}

function styleWorkbook(ws){
  ws.views=[{state:'frozen',ySplit:1}];
  ws.autoFilter={from:'A1',to:ws.getRow(1).getCell(ws.columnCount).address};
  const row=ws.getRow(1);row.height=25;
  row.eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF6030E0'}};cell.alignment={vertical:'middle'};cell.border={bottom:{style:'thin',color:{argb:'FFF04030'}}};});
  ws.eachRow((r,n)=>{if(n>1)r.alignment={vertical:'middle'};});
}

router.get('/', async (req, res) => {
  const filters=customerFilter(req);const {sql,params}=customerSql(filters);
  const [customers]=await db.execute(sql,params);
  const [sites]=await db.query(`SELECT code,name FROM sites ORDER BY code`);
  const [[stats]]=await db.query(`SELECT COUNT(*) total,SUM(customer_status='active') active,SUM(customer_status='suspended') suspended,SUM(network_status='isolated') isolated FROM customers`);
  res.render('customers/index',{title:'Pelanggan',customers,sites,stats:stats||{},filters});
});

router.get('/template.xlsx', async(req,res)=>{
  const {sites,packages,routers,clusters,sales}=await options();
  const wb=new ExcelJS.Workbook();wb.creator='INKAMNET Control Center';wb.created=new Date();
  const ws=wb.addWorksheet('PELANGGAN');
  ws.columns=[
    ['customer_code',18],['name',28],['phone',18],['email',28],['address',40],['sales_employee_code',18],['site_code',13],['package_name',24],['pppoe_username',24],['router_name',24],['cluster_name',24],['activation_date',17],['due_day',12],['grace_days',12],['customer_status',18],['prorata_enabled',18],['notes',35]
  ].map(([header,width])=>({header,key:header,width}));
  const sampleSite=sites[0]?.code||'KRW';
  const sampleSiteObj=sites.find(s=>s.code===sampleSite);
  const samplePackage=(packages.find(p=>p.site_id===null||Number(p.site_id)===Number(sampleSiteObj?.id))||packages[0])?.name||'20 Mbps';
  ws.addRow({customer_code:`${sampleSite}-15-001`,name:'Contoh Pelanggan',phone:'081234567890',email:'',address:'Alamat pelanggan',sales_employee_code:'',site_code:sampleSite,package_name:samplePackage,pppoe_username:'contoh001',router_name:routers.find(r=>r.site_code===sampleSite)?.name||'',cluster_name:clusters.find(c=>c.site_code===sampleSite)?.name||'',activation_date:new Date().toISOString().slice(0,10),due_day:15,grace_days:2,customer_status:'active',prorata_enabled:'YA',notes:'HAPUS BARIS CONTOH INI sebelum import data asli'});
  styleWorkbook(ws);
  ws.getColumn('activation_date').numFmt='yyyy-mm-dd';
  ws.getColumn('phone').numFmt='@';ws.getColumn('customer_code').numFmt='@';ws.getColumn('pppoe_username').numFmt='@';
  for(let row=2;row<=1000;row++){
    ws.getCell(`N${row}`).dataValidation={type:'list',allowBlank:false,formulae:['"active,suspended,terminated"']};
    ws.getCell(`O${row}`).dataValidation={type:'list',allowBlank:true,formulae:['"YA,TIDAK"']};
    ws.getCell(`L${row}`).dataValidation={type:'whole',operator:'between',allowBlank:true,formulae:[1,28]};
    ws.getCell(`M${row}`).dataValidation={type:'whole',operator:'between',allowBlank:true,formulae:[0,30]};
  }
  const info=wb.addWorksheet('PETUNJUK');info.columns=[{width:26},{width:95}];
  [
    ['INKAMNET CUSTOMER IMPORT','Isi sheet PELANGGAN lalu upload kembali melalui menu Pelanggan → Import Excel.'],
    ['WAJIB','customer_code, name, site_code, package_name'],
    ['SITE','Gunakan kode site persis seperti daftar REFERENSI (contoh KRW/KBG/CLM).'],
    ['PACKAGE','Gunakan nama paket persis seperti daftar REFERENSI.'],
    ['ROUTER / CLUSTER','Opsional. Jika diisi, nama harus cocok dan harus berada pada site yang sama.'],
    ['Tanggal Aktivasi','Format YYYY-MM-DD, contoh 2026-08-16.'],
    ['Status','active / suspended / terminated.'],
    ['Prorata','YA atau TIDAK.'],
    ['IMPORT MODE','Di web pilih: Lewati data yang sudah ada, atau Update berdasarkan customer_code.'],
    ['KEAMANAN','Import divalidasi lebih dulu. Jika ada baris error, seluruh import dibatalkan agar data tidak masuk setengah-setengah.']
  ].forEach(x=>info.addRow(x));
  info.getRow(1).font={bold:true,color:{argb:'FFF04030'},size:14};
  const ref=wb.addWorksheet('REFERENSI');ref.state='veryHidden';
  ref.addRow(['SITE_CODE','SITE_NAME','PACKAGE_NAME','ROUTER_NAME','ROUTER_SITE','CLUSTER_NAME','CLUSTER_SITE','SALES_EMPLOYEE_CODE','SALES_NAME']);
  const max=Math.max(sites.length,packages.length,routers.length,clusters.length,sales.length);
  for(let i=0;i<max;i++)ref.addRow([sites[i]?.code||'',sites[i]?.name||'',packages[i]?.name||'',routers[i]?.name||'',routers[i]?.site_code||'',clusters[i]?.name||'',clusters[i]?.site_code||'',sales[i]?.employee_code||'',sales[i]?.name||'']);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition','attachment; filename="template-import-pelanggan-INKAMNET.xlsx"');
  await wb.xlsx.write(res);res.end();
});

router.get('/export.xlsx', async(req,res)=>{
  const filters=customerFilter(req);const {sql,params}=customerSql(filters);const [rows]=await db.execute(sql,params);
  const wb=new ExcelJS.Workbook();wb.creator='INKAMNET Control Center';
  const ws=wb.addWorksheet('PELANGGAN');
  ws.columns=[['customer_code',18],['name',28],['phone',18],['email',28],['address',40],['sales_employee_code',18],['sales_name',24],['site_code',12],['package_name',24],['pppoe_username',22],['router_name',22],['cluster_name',22],['activation_date',17],['due_day',12],['grace_days',12],['customer_status',18],['billing_status',18],['network_status',20],['prorata_enabled',16],['notes',35]].map(([header,width])=>({header,key:header,width}));
  rows.forEach(r=>ws.addRow({customer_code:r.customer_code,name:r.name,phone:r.phone,email:r.email,address:r.address,sales_employee_code:r.sales_code||'',sales_name:r.sales_name||'',site_code:r.site_code,package_name:r.package_name,pppoe_username:r.pppoe_username,router_name:r.router_name,cluster_name:r.cluster_name,activation_date:r.activation_date?new Date(r.activation_date):'',due_day:r.due_day,grace_days:r.grace_days,customer_status:r.customer_status,billing_status:r.billing_status,network_status:r.network_status,prorata_enabled:r.prorata_enabled?'YA':'TIDAK',notes:r.notes}));
  styleWorkbook(ws);ws.getColumn('phone').numFmt='@';ws.getColumn('activation_date').numFmt='yyyy-mm-dd';
  const filename=`pelanggan-INKAMNET${filters.site?'-'+filters.site:''}-${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);await wb.xlsx.write(res);res.end();
});

router.post('/import', requireAdmin, async(req,res)=>{
  try {
  if(!req.file) throw new Error('Pilih file Excel .xlsx terlebih dahulu.');
  if(!req.file.buffer || req.file.buffer.length<4 || req.file.buffer.subarray(0,2).toString()!=='PK') throw new Error('Isi file bukan workbook XLSX yang valid.');
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(req.file.buffer);
  const ws=workbook.getWorksheet('PELANGGAN')||workbook.worksheets[0];if(!ws)throw new Error('Workbook tidak memiliki sheet pelanggan.');
  if(ws.rowCount>5001) throw new Error('Maksimal 5.000 pelanggan per sekali import. Pecah file menjadi beberapa batch.');
  const headers={};ws.getRow(1).eachCell((cell,col)=>{headers[String(plainCell(cell)).trim().toLowerCase()]=col;});
  const required=['customer_code','name','site_code','package_name'];const missing=required.filter(h=>!headers[h]);if(missing.length)throw new Error(`Kolom wajib tidak ada: ${missing.join(', ')}`);
  const [sites]=await db.query(`SELECT id,code FROM sites WHERE is_active=1`);const siteMap=new Map(sites.map(x=>[x.code.toUpperCase(),x.id]));
  const [packages]=await db.query(`SELECT id,name,site_id FROM packages WHERE is_active=1`);
  const [routers]=await db.query(`SELECT id,name,site_id FROM routers WHERE is_active=1`);const [clusters]=await db.query(`SELECT id,name,site_id FROM clusters WHERE status!='inactive'`);const [sales]=await db.query(`SELECT e.id,e.employee_code,e.name FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.is_active=1 AND p.category='sales'`);
  const value=(row,key)=>headers[key]?plainCell(row.getCell(headers[key])):'';
  const data=[],errors=[],seenCodes=new Set();
  for(let n=2;n<=ws.rowCount;n++){
    const row=ws.getRow(n);const code=String(value(row,'customer_code')||'').trim();const name=String(value(row,'name')||'').trim();
    if(!code&&!name)continue;
    const siteCode=String(value(row,'site_code')||'').trim().toUpperCase(), packageName=String(value(row,'package_name')||'').trim();
    const siteId=siteMap.get(siteCode);
    const packageKey=packageName.toLowerCase();
    const packageObj=packages.find(x=>x.name.trim().toLowerCase()===packageKey && Number(x.site_id)===Number(siteId)) || packages.find(x=>x.name.trim().toLowerCase()===packageKey && x.site_id===null);
    const packageId=packageObj?.id;
    if(!code)errors.push(`Baris ${n}: customer_code kosong`);if(code&&seenCodes.has(code.toLowerCase()))errors.push(`Baris ${n}: customer_code '${code}' duplikat di file`);if(code)seenCodes.add(code.toLowerCase());if(!name)errors.push(`Baris ${n}: name kosong`);if(!siteId)errors.push(`Baris ${n}: site_code '${siteCode}' tidak ditemukan`);if(!packageId)errors.push(`Baris ${n}: package_name '${packageName}' tidak ditemukan / tidak tersedia untuk site ${siteCode}`);
    const status=String(value(row,'customer_status')||'active').trim().toLowerCase();if(!['active','suspended','terminated'].includes(status))errors.push(`Baris ${n}: customer_status tidak valid`);
    const dueRaw=value(row,'due_day'), graceRaw=value(row,'grace_days');const due=dueRaw===''?null:Number(dueRaw), grace=graceRaw===''?null:Number(graceRaw);
    if(due!==null&&(!Number.isInteger(due)||due<1||due>28))errors.push(`Baris ${n}: due_day harus 1-28`);if(grace!==null&&(!Number.isInteger(grace)||grace<0||grace>30))errors.push(`Baris ${n}: grace_days harus 0-30`);
    const routerName=String(value(row,'router_name')||'').trim(), clusterName=String(value(row,'cluster_name')||'').trim();
    const routerObj=routerName?routers.find(r=>r.site_id===siteId&&r.name.toLowerCase()===routerName.toLowerCase()):null;const clusterObj=clusterName?clusters.find(c=>c.site_id===siteId&&c.name.toLowerCase()===clusterName.toLowerCase()):null;
    if(routerName&&!routerObj)errors.push(`Baris ${n}: router '${routerName}' tidak ditemukan di site ${siteCode}`);if(clusterName&&!clusterObj)errors.push(`Baris ${n}: cluster '${clusterName}' tidak ditemukan di site ${siteCode}`);
    const activationRaw=value(row,'activation_date'), activation=activationRaw?dateString(activationRaw):null;if(activationRaw&&!activation)errors.push(`Baris ${n}: activation_date tidak valid`);
    const salesCode=String(value(row,'sales_employee_code')||'').trim().toUpperCase();const salesObj=salesCode?sales.find(x=>String(x.employee_code).toUpperCase()===salesCode):null;if(salesCode&&!salesObj)errors.push(`Baris ${n}: sales_employee_code '${salesCode}' tidak ditemukan / bukan posisi Sales`);
    data.push({row:n,customer_code:code,name,phone:phoneString(value(row,'phone')),email:String(value(row,'email')||'').trim()||null,address:String(value(row,'address')||'').trim()||null,sales_id:salesObj?.id||null,site_id:siteId,package_id:packageId,router_id:routerObj?.id||null,cluster_id:clusterObj?.id||null,pppoe_username:String(value(row,'pppoe_username')||'').trim()||null,activation_date:activation,due_day:due,grace_days:grace,customer_status:status,prorata_enabled:boolValue(value(row,'prorata_enabled'),true)?1:0,notes:String(value(row,'notes')||'').trim()||null});
  }
  if(!data.length)throw new Error('Tidak ada data pelanggan pada file.');
  if(errors.length){req.session.flash={type:'danger',message:`Import dibatalkan. ${errors.slice(0,8).join(' | ')}${errors.length>8?` | +${errors.length-8} error lain`:''}`};return res.redirect('/customers');}
  const mode=req.body.import_mode==='update'?'update':'skip';const conn=await db.getConnection();let inserted=0,updated=0,skipped=0;
  try{await conn.beginTransaction();
    for(const d of data){const [exists]=await conn.execute(`SELECT id FROM customers WHERE customer_code=? LIMIT 1`,[d.customer_code]);
      if(exists.length&&mode==='skip'){skipped++;continue;}
      if(exists.length){await conn.execute(`UPDATE customers SET name=?,phone=?,email=?,address=?,sales_id=?,site_id=?,router_id=?,cluster_id=?,package_id=?,pppoe_username=?,activation_date=?,due_day=?,grace_days=?,customer_status=?,prorata_enabled=?,notes=? WHERE id=?`,[d.name,d.phone,d.email,d.address,d.sales_id,d.site_id,d.router_id,d.cluster_id,d.package_id,d.pppoe_username,d.activation_date,d.due_day,d.grace_days,d.customer_status,d.prorata_enabled,d.notes,exists[0].id]);updated++;}
      else{await conn.execute(`INSERT INTO customers(customer_code,name,phone,email,address,sales_id,site_id,router_id,cluster_id,package_id,pppoe_username,activation_date,due_day,grace_days,customer_status,billing_status,network_status,prorata_enabled,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'unpaid','offline',?,?)`,[d.customer_code,d.name,d.phone,d.email,d.address,d.sales_id,d.site_id,d.router_id,d.cluster_id,d.package_id,d.pppoe_username,d.activation_date,d.due_day,d.grace_days,d.customer_status,d.prorata_enabled,d.notes]);inserted++;}
    }
    await conn.commit();
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  await audit({userId:req.session.user.id,action:'import',entityType:'customer',entityId:null,description:`Excel import: ${inserted} baru, ${updated} update, ${skipped} skip`,ip:req.ip});
  req.session.flash={type:'success',message:`Import Excel selesai: ${inserted} pelanggan baru, ${updated} diperbarui, ${skipped} dilewati.`};return res.redirect('/customers');
  } catch (err) {
    console.error('Customer XLSX import gagal:', err.message);
    req.session.flash={type:'danger',message:`Import Excel gagal: ${err.message}`};
    return res.redirect('/customers');
  }
});

router.get('/generate-code', async(req,res)=>{
  const siteId=Number(req.query.site_id||0);
  if(!siteId) return res.status(400).json({error:'Pilih site terlebih dahulu.'});
  const [siteRows]=await db.execute(`SELECT s.id,s.code,COALESCE(s.default_due_day,st.default_due_day,15) default_due_day FROM sites s CROSS JOIN settings st WHERE s.id=? AND st.id=1 LIMIT 1`,[siteId]);
  if(!siteRows.length) return res.status(404).json({error:'Site tidak ditemukan.'});
  const site=siteRows[0];
  const dueRaw=Number(req.query.due_day||site.default_due_day||15);
  const due=Math.max(1,Math.min(28,Number.isFinite(dueRaw)?dueRaw:15));
  const prefix=`${normalizeCodePart(site.code)}-${String(due).padStart(2,'0')}-`;
  const [[row]]=await db.execute(`SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(customer_code,'-',-1) AS UNSIGNED)),0) seq FROM customers WHERE customer_code LIKE ?`,[`${prefix}%`]);
  let seq=Number(row.seq||0)+1, code='';
  while(seq<100000){
    code=`${prefix}${String(seq).padStart(3,'0')}`;
    const [exists]=await db.execute(`SELECT id FROM customers WHERE customer_code=? LIMIT 1`,[code]);
    if(!exists.length) break;
    seq++;
  }
  res.json({code,email:autoCustomerEmail(code),site_code:site.code,due_day:due});
});

router.get('/new', async (req, res) => res.render('customers/form', { title: 'Tambah Pelanggan', customer: null, ...(await options()) }));
router.post('/', async (req, res) => {
  const b=req.body; const customerCode=String(b.customer_code||'').trim().toUpperCase();
  if(!customerCode){req.session.flash={type:'danger',message:'Customer ID wajib diisi / Generate ID terlebih dahulu.'};return res.redirect('/customers/new');}
  const [dup]=await db.execute(`SELECT id FROM customers WHERE customer_code=? LIMIT 1`,[customerCode]);
  if(dup.length){req.session.flash={type:'danger',message:`Customer ID ${customerCode} sudah digunakan.`};return res.redirect('/customers/new');}
  const siteId=Number(b.site_id||0),packageId=Number(b.package_id||0);
  const [packageRows]=await db.execute(`SELECT id,site_id FROM packages WHERE id=? AND is_active=1 LIMIT 1`,[packageId]);
  if(!packageRows.length || (packageRows[0].site_id!==null && Number(packageRows[0].site_id)!==siteId)){
    req.session.flash={type:'danger',message:'Paket internet tidak sesuai dengan Site pelanggan. Pilih paket untuk Site yang benar.'};return res.redirect('/customers/new');
  }
  const email=b.email_mode==='auto'?autoCustomerEmail(customerCode):(String(b.email||'').trim()||null);
  const [result]=await db.execute(`INSERT INTO customers (customer_code,name,phone,email,address,sales_id,site_id,router_id,cluster_id,package_id,pppoe_username,activation_date,due_day,grace_days,customer_status,billing_status,network_status,prorata_enabled,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[customerCode,b.name,b.phone||null,email,b.address||null,b.sales_id||null,siteId,b.router_id||null,b.cluster_id||null,packageId,b.pppoe_username||null,b.activation_date||null,b.due_day||null,b.grace_days||null,b.customer_status||'active','unpaid','offline',b.prorata_enabled?1:0,b.notes||null]);
  await audit({userId:req.session.user.id,action:'create',entityType:'customer',entityId:result.insertId,description:`Tambah ${customerCode} - ${b.name}`,ip:req.ip});
  req.session.flash={type:'success',message:`Pelanggan berhasil ditambahkan dengan Customer ID ${customerCode}.`};res.redirect('/customers');
});
router.get('/:id/edit', async(req,res)=>{const [rows]=await db.execute(`SELECT * FROM customers WHERE id=?`,[req.params.id]);if(!rows.length)return res.status(404).send('Pelanggan tidak ditemukan');res.render('customers/form',{title:'Edit Pelanggan',customer:rows[0],...(await options())});});
router.post('/:id',async(req,res)=>{
  const b=req.body; const customerCode=String(b.customer_code||'').trim().toUpperCase();
  const [dup]=await db.execute(`SELECT id FROM customers WHERE customer_code=? AND id<>? LIMIT 1`,[customerCode,req.params.id]);
  if(dup.length){req.session.flash={type:'danger',message:`Customer ID ${customerCode} sudah digunakan pelanggan lain.`};return res.redirect(`/customers/${req.params.id}/edit`);}
  const siteId=Number(b.site_id||0),packageId=Number(b.package_id||0);
  const [packageRows]=await db.execute(`SELECT id,site_id FROM packages WHERE id=? AND is_active=1 LIMIT 1`,[packageId]);
  if(!packageRows.length || (packageRows[0].site_id!==null && Number(packageRows[0].site_id)!==siteId)){
    req.session.flash={type:'danger',message:'Paket internet tidak sesuai dengan Site pelanggan. Pilih paket untuk Site yang benar.'};return res.redirect(`/customers/${req.params.id}/edit`);
  }
  const email=b.email_mode==='auto'?autoCustomerEmail(customerCode):(String(b.email||'').trim()||null);
  await db.execute(`UPDATE customers SET customer_code=?,name=?,phone=?,email=?,address=?,sales_id=?,site_id=?,router_id=?,cluster_id=?,package_id=?,pppoe_username=?,activation_date=?,due_day=?,grace_days=?,customer_status=?,prorata_enabled=?,notes=? WHERE id=?`,[customerCode,b.name,b.phone||null,email,b.address||null,b.sales_id||null,siteId,b.router_id||null,b.cluster_id||null,packageId,b.pppoe_username||null,b.activation_date||null,b.due_day||null,b.grace_days||null,b.customer_status,b.prorata_enabled?1:0,b.notes||null,req.params.id]);
  await audit({userId:req.session.user.id,action:'update',entityType:'customer',entityId:req.params.id,description:`Update ${customerCode} - ${b.name}`,ip:req.ip});req.session.flash={type:'success',message:'Data pelanggan diperbarui.'};res.redirect('/customers');
});
router.get('/:id',async(req,res)=>{const [rows]=await db.execute(`SELECT c.*,s.code site_code,s.name site_name,p.name package_name,p.price package_price,r.name router_name,cl.name cluster_name,se.name sales_name FROM customers c JOIN sites s ON s.id=c.site_id JOIN packages p ON p.id=c.package_id LEFT JOIN routers r ON r.id=c.router_id LEFT JOIN clusters cl ON cl.id=c.cluster_id LEFT JOIN employees se ON se.id=c.sales_id WHERE c.id=?`,[req.params.id]);if(!rows.length)return res.status(404).send('Pelanggan tidak ditemukan');const [invoices]=await db.execute(`SELECT * FROM invoices WHERE customer_id=? ORDER BY period_year DESC,period_month DESC`,[req.params.id]);res.render('customers/detail',{title:rows[0].name,customer:rows[0],invoices});});
module.exports=router;
