const express=require('express');
const bcrypt=require('bcryptjs');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const db=require('../config/db');
const { requireAdmin, PERMISSIONS, normalizePermissions }=require('../middleware/auth');
const { audit }=require('../services/auditService');
const router=express.Router();
router.use(requireAdmin);

const tabs=new Set(['company','invoice','application','employees','departments','positions','banks','gateways','roles']);
const clean=(v)=>String(v||'').trim();
const nullable=(v)=>clean(v)||null;
const invoiceLogoDir=path.join(__dirname,'..','storage','invoice-branding');
const permissionLabels={dashboard:'Dashboard',customers:'Pelanggan & Paket',billing:'Tagihan & Pembayaran',warehouse:'Gudang',support:'Dukungan',network:'Jaringan',finance:'Keuangan',reports:'Laporan',logs:'Log Aktivitas',settings:'Pengaturan'};
fs.mkdirSync(invoiceLogoDir,{recursive:true});

function logoSignatureMatches(file){
  if(!file)return true;
  const b=file.buffer;
  if(file.mimetype==='image/jpeg')return b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;
  if(file.mimetype==='image/png')return b.length>=8&&b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  return false;
}
async function removeInvoiceLogo(filename){
  if(!filename)return;
  try{await fs.promises.unlink(path.join(invoiceLogoDir,path.basename(filename)));}catch(e){if(e.code!=='ENOENT')console.error('Gagal menghapus logo invoice lama:',e.message);}
}

router.get('/',async(req,res)=>{
  const tab=tabs.has(req.query.tab)?req.query.tab:'company';
  const [[settings]]=await db.query(`SELECT * FROM settings WHERE id=1`);
  const [sites]=await db.query(`SELECT * FROM sites ORDER BY code`);
  const [users]=await db.query(`SELECT id,name,username,role,profile_photo,is_active,created_at FROM users ORDER BY is_active DESC,name`);
  const [departments]=await db.query(`SELECT * FROM departments ORDER BY is_active DESC,name`);
  const [positions]=await db.query(`SELECT p.*,d.name department_name FROM positions p LEFT JOIN departments d ON d.id=p.department_id ORDER BY p.is_active DESC,d.name,p.name`);
  const [employees]=await db.query(`SELECT e.*,d.name department_name,p.name position_name,p.category position_category,u.username FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN positions p ON p.id=e.position_id LEFT JOIN users u ON u.id=e.user_id ORDER BY e.is_active DESC,e.name`);
  const [banks]=await db.query(`SELECT * FROM banks ORDER BY is_active DESC,bank_name`);
  const [gateways]=await db.query(`SELECT * FROM payment_gateways ORDER BY FIELD(status,'active','testing','inactive'),name`);
  const [roles]=await db.query(`SELECT * FROM role_permissions ORDER BY role_key`);
  res.render('settings/index',{title:'Pengaturan',settings,sites,users,departments,positions,employees,banks,gateways,roles,tab,permissionCatalog:PERMISSIONS.map(key=>({key,label:permissionLabels[key]||key}))});
});

router.post('/',async(req,res)=>{
  const b=req.body;
  await db.execute(`UPDATE settings SET company_name=?,company_address=?,company_phone=?,company_email=?,company_website=?,company_tagline=? WHERE id=1`,[b.company_name,b.company_address||null,b.company_phone||null,b.company_email||null,b.company_website||null,b.company_tagline||'From the Village, Online Everywhere']);
  req.session.flash={type:'success',message:'Data perusahaan disimpan.'};res.redirect('/settings?tab=company');
});
router.post('/invoice-branding',async(req,res)=>{
  const b=req.body;
  const companyName=clean(b.invoice_company_name);
  if(!companyName){req.session.flash={type:'danger',message:'Nama PT / perusahaan wajib diisi.'};return res.redirect('/settings?tab=invoice');}
  const [[current]]=await db.query(`SELECT invoice_logo_path FROM settings WHERE id=1`);
  if(req.file&&!logoSignatureMatches(req.file)){
    req.session.flash={type:'danger',message:'Isi file logo tidak sesuai format JPG atau PNG.'};
    return res.redirect('/settings?tab=invoice');
  }
  const removeLogo=b.remove_logo==='1';
  const uploadedLogo=req.file?`invoice-logo-${Date.now()}-${crypto.randomUUID()}${req.file.mimetype==='image/png'?'.png':'.jpg'}`:null;
  if(uploadedLogo)await fs.promises.writeFile(path.join(invoiceLogoDir,uploadedLogo),req.file.buffer,{flag:'wx'});
  const nextLogo=removeLogo?null:(uploadedLogo||current?.invoice_logo_path||null);
  try{
    await db.execute(`UPDATE settings SET invoice_company_name=?,invoice_address=?,invoice_phone=?,invoice_email=?,invoice_website=?,invoice_tax_id=?,invoice_footer=?,invoice_logo_path=? WHERE id=1`,[
      companyName,nullable(b.invoice_address),nullable(b.invoice_phone),nullable(b.invoice_email),nullable(b.invoice_website),nullable(b.invoice_tax_id),nullable(b.invoice_footer),nextLogo
    ]);
  }catch(err){if(uploadedLogo)await removeInvoiceLogo(uploadedLogo);throw err;}
  if((req.file||removeLogo)&&current?.invoice_logo_path&&current.invoice_logo_path!==nextLogo)await removeInvoiceLogo(current.invoice_logo_path);
  await audit({userId:req.session.user.id,action:'update',entityType:'invoice_branding',entityId:1,description:`Identitas invoice diperbarui${uploadedLogo?' beserta logo baru':''}${removeLogo?' dan logo dihapus':''}`,ip:req.ip});
  req.session.flash={type:'success',message:'Identitas invoice berhasil disimpan dan langsung dipakai pada invoice cetak/PDF.'};
  res.redirect('/settings?tab=invoice');
});
router.post('/application',async(req,res)=>{
  await db.execute(`UPDATE settings SET default_due_day=?,default_grace_days=?,invoice_generate_days=?,auto_isolate=?,default_theme=?,default_language=? WHERE id=1`,[req.body.default_due_day,req.body.default_grace_days,req.body.invoice_generate_days,req.body.auto_isolate?1:0,req.body.default_theme||'dark',req.body.default_language==='en'?'en':'id']);
  req.session.language=req.body.default_language==='en'?'en':'id';
  req.session.flash={type:'success',message:'Preferensi aplikasi disimpan.'};res.redirect('/settings?tab=application');
});
router.post('/sites/:id',async(req,res)=>{const b=req.body;await db.execute(`UPDATE sites SET name=?,default_due_day=?,default_grace_days=?,invoice_generate_days=? WHERE id=?`,[b.name,b.default_due_day||null,b.default_grace_days||null,b.invoice_generate_days||null,req.params.id]);req.session.flash={type:'success',message:'Default site diperbarui.'};res.redirect('/settings?tab=application');});

router.post('/employees',async(req,res)=>{
  const b=req.body;let code=clean(b.employee_code).toUpperCase();
  if(!code){const [[r]]=await db.query(`SELECT COALESCE(MAX(id),0)+1 seq FROM employees`);code=`EMP-${String(r.seq).padStart(4,'0')}`;}
  await db.execute(`INSERT INTO employees(employee_code,name,email,phone,department_id,position_id,user_id,joined_at,is_active,notes) VALUES(?,?,?,?,?,?,?,?,1,?)`,[code,clean(b.name),nullable(b.email),nullable(b.phone),b.department_id||null,b.position_id||null,b.user_id||null,b.joined_at||null,nullable(b.notes)]);
  req.session.flash={type:'success',message:`Karyawan ${b.name} ditambahkan.`};res.redirect('/settings?tab=employees');
});
router.post('/employees/:id',async(req,res)=>{const b=req.body;await db.execute(`UPDATE employees SET employee_code=?,name=?,email=?,phone=?,department_id=?,position_id=?,user_id=?,joined_at=?,notes=? WHERE id=?`,[clean(b.employee_code).toUpperCase(),clean(b.name),nullable(b.email),nullable(b.phone),b.department_id||null,b.position_id||null,b.user_id||null,b.joined_at||null,nullable(b.notes),req.params.id]);req.session.flash={type:'success',message:'Data karyawan diperbarui.'};res.redirect('/settings?tab=employees');});
router.post('/employees/:id/toggle',async(req,res)=>{await db.execute(`UPDATE employees SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);res.redirect('/settings?tab=employees');});

router.post('/departments',async(req,res)=>{await db.execute(`INSERT INTO departments(code,name,description,is_active) VALUES(?,?,?,1)`,[clean(req.body.code).toUpperCase(),clean(req.body.name),nullable(req.body.description)]);req.session.flash={type:'success',message:'Departemen ditambahkan.'};res.redirect('/settings?tab=departments');});
router.post('/departments/:id/toggle',async(req,res)=>{await db.execute(`UPDATE departments SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);res.redirect('/settings?tab=departments');});

router.post('/positions',async(req,res)=>{const allowed=new Set(['sales','technical','admin','management','finance','other']);const category=allowed.has(req.body.category)?req.body.category:'other';await db.execute(`INSERT INTO positions(department_id,code,name,category,description,is_active) VALUES(?,?,?,?,?,1)`,[req.body.department_id||null,clean(req.body.code).toUpperCase(),clean(req.body.name),category,nullable(req.body.description)]);req.session.flash={type:'success',message:'Posisi ditambahkan.'};res.redirect('/settings?tab=positions');});
router.post('/positions/:id/toggle',async(req,res)=>{await db.execute(`UPDATE positions SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);res.redirect('/settings?tab=positions');});

router.post('/banks',async(req,res)=>{const allowed=new Set(['bank_transfer','cash','virtual_account','other']);await db.execute(`INSERT INTO banks(bank_name,account_name,account_number,type,is_active,notes) VALUES(?,?,?,?,1,?)`,[clean(req.body.bank_name),clean(req.body.account_name),clean(req.body.account_number),allowed.has(req.body.type)?req.body.type:'bank_transfer',nullable(req.body.notes)]);req.session.flash={type:'success',message:'Rekening bank ditambahkan.'};res.redirect('/settings?tab=banks');});
router.post('/banks/:id/toggle',async(req,res)=>{await db.execute(`UPDATE banks SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);res.redirect('/settings?tab=banks');});

router.post('/gateways',async(req,res)=>{const allowed=new Set(['active','inactive','testing']);await db.execute(`INSERT INTO payment_gateways(name,provider,channel,status,notes) VALUES(?,?,?,?,?)`,[clean(req.body.name),nullable(req.body.provider),nullable(req.body.channel),allowed.has(req.body.status)?req.body.status:'inactive',nullable(req.body.notes)]);req.session.flash={type:'success',message:'Payment gateway ditambahkan.'};res.redirect('/settings?tab=gateways');});
router.post('/gateways/:id/toggle',async(req,res)=>{await db.execute(`UPDATE payment_gateways SET status=IF(status='active','inactive','active') WHERE id=?`,[req.params.id]);res.redirect('/settings?tab=gateways');});

router.post('/roles/:roleKey',async(req,res)=>{
  const roleKey=clean(req.params.roleKey).toLowerCase();
  const [rows]=await db.execute(`SELECT id,role_key FROM role_permissions WHERE role_key=? LIMIT 1`,[roleKey]);
  if(!rows.length){req.session.flash={type:'danger',message:'Role tidak ditemukan.'};return res.redirect('/settings?tab=roles');}
  const requested=Array.isArray(req.body.permissions)?req.body.permissions:[req.body.permissions].filter(Boolean);
  const permissions=normalizePermissions(requested,roleKey);
  const roleName=(clean(req.body.role_name)||roleKey).slice(0,100);
  await db.execute(`UPDATE role_permissions SET role_name=?,permissions_json=? WHERE role_key=?`,[roleName,JSON.stringify(permissions),roleKey]);
  await audit({userId:req.session.user.id,action:'update',entityType:'role_permission',entityId:rows[0].id,description:`Permission role ${roleKey}: ${permissions.join(', ')}`,ip:req.ip});
  req.session.flash={type:'success',message:`Permission role ${roleName} berhasil diperbarui.`};
  res.redirect('/settings?tab=roles');
});

router.post('/users',async(req,res)=>{const b=req.body;const hash=await bcrypt.hash(b.password,12);const [result]=await db.execute(`INSERT INTO users(name,username,password_hash,role,is_active) VALUES(?,?,?,?,1)`,[b.name,b.username,hash,b.role||'staff']);await db.execute(`INSERT INTO employees(employee_code,name,user_id,is_active) VALUES(?,?,?,1)`,[`USR-${String(result.insertId).padStart(4,'0')}`,b.name,result.insertId]);req.session.flash={type:'success',message:'Akun staff dibuat dan masuk ke direktori karyawan.'};res.redirect('/settings?tab=employees');});
router.post('/users/:id/toggle',async(req,res)=>{if(Number(req.params.id)===Number(req.session.user.id)){req.session.flash={type:'warning',message:'Akun yang sedang dipakai tidak bisa dinonaktifkan.'};return res.redirect('/settings?tab=employees');}await db.execute(`UPDATE users SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);await db.execute(`UPDATE employees SET is_active=(SELECT is_active FROM users WHERE id=?) WHERE user_id=?`,[req.params.id,req.params.id]);res.redirect('/settings?tab=employees');});
router.post('/users/:id/password',async(req,res)=>{const hash=await bcrypt.hash(req.body.password,12);await db.execute(`UPDATE users SET password_hash=? WHERE id=?`,[hash,req.params.id]);req.session.flash={type:'success',message:'Password berhasil direset.'};res.redirect('/settings?tab=employees');});

module.exports=router;
