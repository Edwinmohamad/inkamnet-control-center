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
  return { q:(req.query.q||'').trim(), site:req.query.site||'', cluster:req.query.cluster||'', status:req.query.status||'' };
}
function customerSql(filters) {
  let sql=`SELECT c.*,s.code site_code,s.name site_name,p.name package_name,p.price package_price,p.speed_label,r.name router_name,cl.name cluster_name,se.name sales_name,se.employee_code sales_code,(SELECT i.id FROM invoices i WHERE i.customer_id=c.id AND i.status IN ('unpaid','partial','overdue') AND i.outstanding>0 ORDER BY i.period_year DESC,i.period_month DESC,i.id DESC LIMIT 1) open_invoice_id FROM customers c JOIN sites s ON s.id=c.site_id JOIN packages p ON p.id=c.package_id LEFT JOIN routers r ON r.id=c.router_id LEFT JOIN clusters cl ON cl.id=c.cluster_id LEFT JOIN employees se ON se.id=c.sales_id WHERE 1=1`;
  const params=[];
  if(filters.q){sql+=` AND (c.customer_code LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR c.address LIKE ? OR c.pppoe_username LIKE ? OR s.code LIKE ? OR cl.name LIKE ?)`;params.push(...Array(7).fill(`%${filters.q}%`));}
  if(filters.site){sql+=` AND s.code=?`;params.push(filters.site);}
  if(filters.cluster){sql+=` AND c.cluster_id=?`;params.push(Number(filters.cluster));}
  if(filters.status==='inactive'){sql+=` AND c.customer_status<>'active'`;}else if(filters.status){sql+=` AND c.customer_status=?`;params.push(filters.status);}
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

async function nextImportedCustomerCode(conn, siteCode, dueDay, sequenceCache){
  const due=Math.max(1,Math.min(28,Number(dueDay)||15));
  const prefix=`${normalizeCodePart(siteCode)}-${String(due).padStart(2,'0')}-`;
  let seq=sequenceCache.get(prefix);
  if(seq==null){
    const [[row]]=await conn.execute(`SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(customer_code,'-',-1) AS UNSIGNED)),0) seq FROM customers WHERE customer_code LIKE ?`,[`${prefix}%`]);
    seq=Number(row?.seq||0)+1;
  }
  let code='';
  while(seq<1000000){
    code=`${prefix}${String(seq).padStart(3,'0')}`;
    const [exists]=await conn.execute(`SELECT id FROM customers WHERE customer_code=? LIMIT 1`,[code]);
    if(!exists.length)break;
    seq++;
  }
  if(!code)throw new Error(`Tidak dapat membuat Customer ID untuk site ${siteCode}.`);
  sequenceCache.set(prefix,seq+1);
  return code;
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
  const [clusters]=await db.query(`SELECT cl.id,cl.name,s.code site_code FROM clusters cl JOIN sites s ON s.id=cl.site_id WHERE cl.status!='inactive' ORDER BY s.code,cl.name`);
  const [[stats]]=await db.query(`SELECT COUNT(*) total,SUM(customer_status='active') active,SUM(customer_status='suspended') suspended,SUM(network_status='isolated') isolated FROM customers`);
  res.render('customers/index',{title:'Pelanggan',customers,sites,clusters,stats:stats||{},filters});
});


const IMPORT_ALIASES={
  name:['name','nama','nama pelanggan'],
  site_code:['site_code','site','server','lokasi server','site / pop'],
  package_name:['package_name','paket internet','paket','nama paket'],
  address:['address','alamat'],
  email:['email','e-mail'],
  phone:['phone','whatsapp','no whatsapp','nomor whatsapp','no. whatsapp'],
  activation_date:['activation_date','tanggal instalasi','tanggal aktivasi','aktif sejak'],
  due_day:['due_day','tanggal jatuh tempo','jatuh tempo'],
  pppoe_username:['pppoe_username','pppoe username','username pppoe'],
  router_name:['router_name','router','nama router'],
  cluster_name:['cluster_name','cluster','odp','cluster / odp'],
  sales_employee_code:['sales_employee_code','sales','kode sales'],
  grace_days:['grace_days','grace days','toleransi hari'],
  customer_status:['customer_status','status pelanggan','status'],
  prorata_enabled:['prorata_enabled','prorata','pakai prorata'],
  notes:['notes','catatan','keterangan']
};
function normalizeImportHeader(value){
  return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
}
function findImportHeaderRow(ws){
  for(let r=1;r<=Math.min(ws.rowCount,30);r++){
    const row=ws.getRow(r);
    const values=[];
    row.eachCell({includeEmpty:false},cell=>values.push(normalizeImportHeader(plainCell(cell))));
    const hasName=values.some(v=>IMPORT_ALIASES.name.includes(v));
    const hasSite=values.some(v=>IMPORT_ALIASES.site_code.includes(v));
    const hasPackage=values.some(v=>IMPORT_ALIASES.package_name.includes(v));
    if(hasName&&hasSite&&hasPackage)return r;
  }
  return 0;
}
function mapImportHeaders(row){
  const headers={};
  row.eachCell((cell,col)=>{
    const raw=normalizeImportHeader(plainCell(cell));
    for(const [key,aliases] of Object.entries(IMPORT_ALIASES)){
      if(!headers[key]&&aliases.includes(raw))headers[key]=col;
    }
  });
  return headers;
}
router.get('/template.xlsx', async(req,res)=>{
  const {sites,packages,routers,clusters,sales}=await options();
  const wb=new ExcelJS.Workbook();wb.creator='INKAMNET Control Center';wb.created=new Date();
  const ws=wb.addWorksheet('PELANGGAN',{views:[{state:'frozen',ySplit:12}]});
  const widths=[4,28,15,24,42,28,18,18,18,24,24,24,18,16,16,18,34];
  widths.forEach((w,i)=>ws.getColumn(i+1).width=w);

  ws.getCell('A1').value='#';ws.getCell('B1').value='INKAMNET - TEMPLATE EXCEL IMPORT PELANGGAN';
  ws.mergeCells('B1:Q1');
  ws.getCell('B1').font={bold:true,size:16,color:{argb:'FF6030E0'}};
  ws.getCell('B1').alignment={vertical:'middle'};ws.getRow(1).height=28;

  const instructions=[
    'INSTRUKSI UNTUK IMPORT (HARAP DIBACA DULU)',
    'Sebelum import, pastikan Site / POP dan Paket Internet sudah dibuat di aplikasi.',
    'Baris dengan kolom pertama berisi # akan diabaikan oleh sistem.',
    'Customer ID TIDAK perlu diisi. Sistem generate otomatis berdasarkan Site + Jatuh Tempo + nomor urut.',
    'Nama Site dan Paket Internet harus sesuai dengan data yang sudah dibuat. Import TIDAK membuat Site/Paket baru.',
    'Jika Cluster / Router diisi, datanya harus sudah ada dan harus berada pada Site yang sama.',
    'Format tanggal: DD/MM/YYYY atau YYYY-MM-DD. Contoh 16/08/2026.',
    'Seluruh baris divalidasi dahulu. Jika ada satu baris error, seluruh import dibatalkan agar data tidak masuk setengah-setengah.'
  ];
  instructions.forEach((txt,i)=>{
    const r=i+3;ws.getCell(`A${r}`).value='#';ws.getCell(`B${r}`).value=i===0?txt:`- ${txt}`;
    ws.mergeCells(`B${r}:Q${r}`);
    ws.getCell(`B${r}`).font={bold:i===0,color:{argb:i===0?'FFF04030':'FF4B5563'}};
  });

  const requiredNotes=['#','*WAJIB','*WAJIB','*WAJIB','*WAJIB','Opsional','*WAJIB','*WAJIB','*WAJIB','Opsional','Opsional','Opsional','Opsional','Opsional','Opsional','Opsional','Opsional'];
  const headers=['#','Nama','Site','Paket Internet','Alamat','Email','Whatsapp','Tanggal Instalasi','Tanggal Jatuh Tempo','PPPoE Username','Router','Cluster','Sales','Grace Days','Status Pelanggan','Prorata','Catatan'];
  ws.getRow(11).values=requiredNotes;
  ws.getRow(12).values=headers;
  ws.getRow(11).height=42;ws.getRow(12).height=24;
  ws.getRow(11).eachCell((cell,col)=>{
    cell.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    cell.font={bold:col>1&&String(cell.value).includes('WAJIB'),color:{argb:col>1&&String(cell.value).includes('WAJIB')?'FFF04030':'FF667085'},size:10};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8FAFC'}};
    cell.border={top:{style:'thin',color:{argb:'FFD0D5DD'}},bottom:{style:'thin',color:{argb:'FFD0D5DD'}}};
  });
  ws.getRow(12).eachCell((cell,col)=>{
    cell.font={bold:true,color:{argb:'FFFFFFFF'}};
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:col===1?'FF111827':'FF6030E0'}};
    cell.alignment={vertical:'middle',horizontal:col===1?'center':'left'};
    cell.border={bottom:{style:'medium',color:{argb:'FFF04030'}}};
  });

  const sampleSite=sites[0]?.code||'KRW';
  const sampleSiteObj=sites.find(s=>s.code===sampleSite);
  const samplePackage=(packages.find(p=>p.site_id===null||Number(p.site_id)===Number(sampleSiteObj?.id))||packages[0])?.name||'20 Mbps';
  const sampleCluster=clusters.find(c=>c.site_code===sampleSite)?.name||'';
  const sampleRouter=routers.find(r=>r.site_code===sampleSite)?.name||'';
  ws.getRow(13).values=['#','CONTOH PELANGGAN',sampleSite,samplePackage,'Alamat pelanggan','contoh@pelanggan.id','081234567890',new Date().toISOString().slice(0,10),15,'contoh001',sampleRouter,sampleCluster,sales[0]?.employee_code||'',2,'active','YA','BARIS CONTOH - otomatis diabaikan karena kolom A berisi #'];
  ws.getRow(13).font={italic:true,color:{argb:'FF667085'}};

  // Hidden same-sheet helper lists keep Excel dropdown validation compatible across desktop/web Excel.
  const helpers={site:'AA',pkg:'AB',cluster:'AC',router:'AD',sales:'AE',status:'AF',prorata:'AG'};
  sites.forEach((x,i)=>ws.getCell(`${helpers.site}${i+2}`).value=x.code);
  packages.forEach((x,i)=>ws.getCell(`${helpers.pkg}${i+2}`).value=x.name);
  clusters.forEach((x,i)=>ws.getCell(`${helpers.cluster}${i+2}`).value=x.name);
  routers.forEach((x,i)=>ws.getCell(`${helpers.router}${i+2}`).value=x.name);
  sales.forEach((x,i)=>ws.getCell(`${helpers.sales}${i+2}`).value=x.employee_code);
  ['active','suspended','terminated'].forEach((x,i)=>ws.getCell(`${helpers.status}${i+2}`).value=x);
  ['YA','TIDAK'].forEach((x,i)=>ws.getCell(`${helpers.prorata}${i+2}`).value=x);
  Object.values(helpers).forEach(col=>ws.getColumn(col).hidden=true);

  const validationRange=(col,count)=>`$${col}$2:$${col}$${Math.max(2,count+1)}`;
  for(let row=14;row<=2013;row++){
    if(sites.length)ws.getCell(`C${row}`).dataValidation={type:'list',allowBlank:false,formulae:[validationRange(helpers.site,sites.length)],showErrorMessage:true,errorTitle:'Site tidak valid',error:'Pilih Site dari daftar.'};
    if(packages.length)ws.getCell(`D${row}`).dataValidation={type:'list',allowBlank:false,formulae:[validationRange(helpers.pkg,packages.length)],showErrorMessage:true,errorTitle:'Paket tidak valid',error:'Pilih Paket dari daftar. Pastikan Site + Paket sesuai sheet REFERENSI.'};
    ws.getCell(`H${row}`).numFmt='dd/mm/yyyy';
    ws.getCell(`I${row}`).dataValidation={type:'whole',operator:'between',allowBlank:false,formulae:[1,28],showErrorMessage:true,errorTitle:'Jatuh tempo',error:'Isi angka 1 sampai 28.'};
    if(routers.length)ws.getCell(`K${row}`).dataValidation={type:'list',allowBlank:true,formulae:[validationRange(helpers.router,routers.length)]};
    if(clusters.length)ws.getCell(`L${row}`).dataValidation={type:'list',allowBlank:true,formulae:[validationRange(helpers.cluster,clusters.length)]};
    if(sales.length)ws.getCell(`M${row}`).dataValidation={type:'list',allowBlank:true,formulae:[validationRange(helpers.sales,sales.length)]};
    ws.getCell(`N${row}`).dataValidation={type:'whole',operator:'between',allowBlank:true,formulae:[0,30]};
    ws.getCell(`O${row}`).dataValidation={type:'list',allowBlank:true,formulae:[validationRange(helpers.status,3)]};
    ws.getCell(`P${row}`).dataValidation={type:'list',allowBlank:true,formulae:[validationRange(helpers.prorata,2)]};
    ws.getCell(`G${row}`).numFmt='@';ws.getCell(`J${row}`).numFmt='@';
  }
  ws.autoFilter={from:'B12',to:'Q12'};

  const ref=wb.addWorksheet('REFERENSI');
  ref.columns=[{header:'SITE_CODE',key:'site',width:14},{header:'SITE_NAME',key:'site_name',width:28},{header:'SITE_PAKET',key:'pkg_site',width:14},{header:'PACKAGE_NAME',key:'pkg',width:28},{header:'CLUSTER_SITE',key:'cl_site',width:14},{header:'CLUSTER_NAME',key:'cluster',width:28},{header:'ROUTER_SITE',key:'router_site',width:14},{header:'ROUTER_NAME',key:'router',width:28},{header:'SALES_CODE',key:'sales_code',width:18},{header:'SALES_NAME',key:'sales_name',width:28}];
  const max=Math.max(sites.length,packages.length,clusters.length,routers.length,sales.length);
  for(let i=0;i<max;i++)ref.addRow({
    site:sites[i]?.code||'',site_name:sites[i]?.name||'',
    pkg_site:packages[i]?.site_code||'GLOBAL',pkg:packages[i]?.name||'',
    cl_site:clusters[i]?.site_code||'',cluster:clusters[i]?.name||'',
    router_site:routers[i]?.site_code||'',router:routers[i]?.name||'',
    sales_code:sales[i]?.employee_code||'',sales_name:sales[i]?.name||''
  });
  styleWorkbook(ref);
  ref.getCell('L1').value='PENTING';ref.getCell('L2').value='Site + Paket harus cocok. Paket site-specific hanya boleh dipakai pada site tersebut.';
  ref.getCell('L1').font={bold:true,color:{argb:'FFF04030'}};ref.getCell('L2').alignment={wrapText:true};ref.getColumn('L').width=55;

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
  const headerRow=findImportHeaderRow(ws);if(!headerRow)throw new Error('Header pelanggan tidak ditemukan. Gunakan template terbaru dari menu Download Format Import.');
  const headers=mapImportHeaders(ws.getRow(headerRow));
  const required=['name','site_code','package_name','address','phone','activation_date','due_day'];const missing=required.filter(h=>!headers[h]);if(missing.length)throw new Error(`Kolom wajib tidak ada: ${missing.join(', ')}. Download template terbaru dan jangan ubah nama kolom wajib.`);
  const [sites]=await db.query(`SELECT s.id,s.code,s.name,COALESCE(s.default_due_day,st.default_due_day,15) default_due_day FROM sites s LEFT JOIN settings st ON st.id=1 WHERE s.is_active=1`);
  const siteMap=new Map();for(const x of sites){siteMap.set(String(x.code).trim().toUpperCase(),x);siteMap.set(String(x.name||'').trim().toUpperCase(),x);}
  const [packages]=await db.query(`SELECT id,name,site_id FROM packages WHERE is_active=1`);
  const [routers]=await db.query(`SELECT id,name,site_id FROM routers WHERE is_active=1`);const [clusters]=await db.query(`SELECT id,name,site_id FROM clusters WHERE status!='inactive'`);const [sales]=await db.query(`SELECT e.id,e.employee_code,e.name FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.is_active=1 AND p.category='sales'`);
  const value=(row,key)=>headers[key]?plainCell(row.getCell(headers[key])):'';
  const data=[],errors=[];
  for(let n=headerRow+1;n<=ws.rowCount;n++){
    const row=ws.getRow(n);const marker=String(plainCell(row.getCell(1))||'').trim();if(marker==='#')continue;const name=String(value(row,'name')||'').trim();
    if(!name)continue;
    const siteInput=String(value(row,'site_code')||'').trim(), packageName=String(value(row,'package_name')||'').trim();
    const siteObj=siteMap.get(siteInput.toUpperCase());const siteId=siteObj?.id;const siteCode=siteObj?.code||siteInput.toUpperCase();
    const packageKey=packageName.toLowerCase();
    const packageObj=packages.find(x=>x.name.trim().toLowerCase()===packageKey && Number(x.site_id)===Number(siteId)) || packages.find(x=>x.name.trim().toLowerCase()===packageKey && x.site_id===null);
    const packageId=packageObj?.id;
    const address=String(value(row,'address')||'').trim();const phone=phoneString(value(row,'phone'));
    if(!name)errors.push(`Baris ${n}: Nama wajib diisi`);if(!siteId)errors.push(`Baris ${n}: Site '${siteCode}' tidak ditemukan. Gunakan Site yang sudah dibuat di aplikasi.`);if(!packageId)errors.push(`Baris ${n}: Paket Internet '${packageName}' tidak ditemukan / tidak tersedia untuk Site ${siteCode}. Gunakan kombinasi Site + Paket dari sheet REFERENSI.`);if(!address)errors.push(`Baris ${n}: Alamat wajib diisi`);if(!phone)errors.push(`Baris ${n}: Whatsapp wajib diisi`);
    const status=String(value(row,'customer_status')||'active').trim().toLowerCase();if(!['active','suspended','terminated'].includes(status))errors.push(`Baris ${n}: customer_status tidak valid`);
    const dueRaw=value(row,'due_day'), graceRaw=value(row,'grace_days');const due=dueRaw===''?null:Number(dueRaw), grace=graceRaw===''?null:Number(graceRaw);
    if(due!==null&&(!Number.isInteger(due)||due<1||due>28))errors.push(`Baris ${n}: due_day harus 1-28`);if(grace!==null&&(!Number.isInteger(grace)||grace<0||grace>30))errors.push(`Baris ${n}: grace_days harus 0-30`);
    const routerName=String(value(row,'router_name')||'').trim(), clusterName=String(value(row,'cluster_name')||'').trim();
    const routerObj=routerName?routers.find(r=>r.site_id===siteId&&r.name.toLowerCase()===routerName.toLowerCase()):null;const clusterObj=clusterName?clusters.find(c=>c.site_id===siteId&&c.name.toLowerCase()===clusterName.toLowerCase()):null;
    if(routerName&&!routerObj)errors.push(`Baris ${n}: router '${routerName}' tidak ditemukan di site ${siteCode}`);if(clusterName&&!clusterObj)errors.push(`Baris ${n}: cluster '${clusterName}' tidak ditemukan di site ${siteCode}`);
    const activationRaw=value(row,'activation_date'), activation=activationRaw?dateString(activationRaw):null;if(!activationRaw)errors.push(`Baris ${n}: Tanggal Instalasi wajib diisi`);else if(!activation)errors.push(`Baris ${n}: Tanggal Instalasi tidak valid`);if(due===null)errors.push(`Baris ${n}: Tanggal Jatuh Tempo wajib diisi (1-28)`);
    const salesCode=String(value(row,'sales_employee_code')||'').trim().toUpperCase();const salesObj=salesCode?sales.find(x=>String(x.employee_code).toUpperCase()===salesCode):null;if(salesCode&&!salesObj)errors.push(`Baris ${n}: sales_employee_code '${salesCode}' tidak ditemukan / bukan posisi Sales`);
    data.push({row:n,name,phone,email:String(value(row,'email')||'').trim()||null,address,sales_id:salesObj?.id||null,site_id:siteId,site_code:siteCode,site_default_due_day:Number(siteObj?.default_due_day||15),package_id:packageId,router_id:routerObj?.id||null,cluster_id:clusterObj?.id||null,pppoe_username:String(value(row,'pppoe_username')||'').trim()||null,activation_date:activation,due_day:due,grace_days:grace,customer_status:status,prorata_enabled:boolValue(value(row,'prorata_enabled'),true)?1:0,notes:String(value(row,'notes')||'').trim()||null});
  }
  if(!data.length)throw new Error('Tidak ada data pelanggan pada file.');
  if(errors.length){req.session.flash={type:'danger',message:`Import dibatalkan. ${errors.slice(0,8).join(' | ')}${errors.length>8?` | +${errors.length-8} error lain`:''}`};return res.redirect('/customers');}
  const conn=await db.getConnection();let inserted=0;let lockHeld=false;
  try{
    const [[lockRow]]=await conn.query(`SELECT GET_LOCK('inkamnet_customer_import_code',10) locked`);
    if(Number(lockRow?.locked)!==1)throw new Error('Import sedang diproses oleh sesi lain. Coba lagi beberapa detik.');
    lockHeld=true;
    await conn.beginTransaction();
    const sequenceCache=new Map();
    for(const d of data){
      const dueDay=d.due_day||d.site_default_due_day||15;
      const customerCode=await nextImportedCustomerCode(conn,d.site_code,dueDay,sequenceCache);
      const email=d.email||null;
      await conn.execute(`INSERT INTO customers(customer_code,name,phone,email,address,sales_id,site_id,router_id,cluster_id,package_id,pppoe_username,activation_date,due_day,grace_days,customer_status,billing_status,network_status,prorata_enabled,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'unpaid','offline',?,?)`,[customerCode,d.name,d.phone,email,d.address,d.sales_id,d.site_id,d.router_id,d.cluster_id,d.package_id,d.pppoe_username,d.activation_date,dueDay,d.grace_days,d.customer_status,d.prorata_enabled,d.notes]);
      inserted++;
    }
    await conn.commit();
  }catch(e){try{await conn.rollback();}catch(_){}throw e;}finally{if(lockHeld){try{await conn.query(`DO RELEASE_LOCK('inkamnet_customer_import_code')`);}catch(_){}}conn.release();}
  await audit({userId:req.session.user.id,action:'import',entityType:'customer',entityId:null,description:`Excel import: ${inserted} pelanggan baru dengan Customer ID otomatis`,ip:req.ip});
  req.session.flash={type:'success',message:`Import Excel selesai: ${inserted} pelanggan baru. Customer ID dibuat otomatis berdasarkan Site + jatuh tempo + nomor urut.`};return res.redirect('/customers');
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
router.post('/:id/delete',requireAdmin,async(req,res)=>{
  const [rows]=await db.execute(`SELECT id,customer_code,name,customer_status FROM customers WHERE id=? LIMIT 1`,[req.params.id]);
  if(!rows.length){req.session.flash={type:'warning',message:'Pelanggan tidak ditemukan.'};return res.redirect('/customers');}
  const c=rows[0];
  await db.execute(`UPDATE customers SET customer_status='terminated',network_status='offline' WHERE id=?`,[c.id]);
  await audit({userId:req.session.user.id,action:'archive',entityType:'customer',entityId:c.id,description:`Arsip pelanggan ${c.customer_code} - ${c.name}`,ip:req.ip});
  req.session.flash={type:'success',message:`Pelanggan ${c.name} diarsipkan. Riwayat tagihan dan pembayaran tetap aman.`};
  res.redirect('/customers');
});
router.get('/:id',async(req,res)=>{const [rows]=await db.execute(`SELECT c.*,s.code site_code,s.name site_name,p.name package_name,p.price package_price,r.name router_name,cl.name cluster_name,se.name sales_name FROM customers c JOIN sites s ON s.id=c.site_id JOIN packages p ON p.id=c.package_id LEFT JOIN routers r ON r.id=c.router_id LEFT JOIN clusters cl ON cl.id=c.cluster_id LEFT JOIN employees se ON se.id=c.sales_id WHERE c.id=?`,[req.params.id]);if(!rows.length)return res.status(404).send('Pelanggan tidak ditemukan');const [invoices]=await db.execute(`SELECT * FROM invoices WHERE customer_id=? ORDER BY period_year DESC,period_month DESC`,[req.params.id]);res.render('customers/detail',{title:rows[0].name,customer:rows[0],invoices});});
module.exports=router;
