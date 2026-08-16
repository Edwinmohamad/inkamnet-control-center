const express=require('express');
const bcrypt=require('bcryptjs');
const db=require('../config/db');
const { requireAdmin }=require('../middleware/auth');
const router=express.Router();
router.use(requireAdmin);

const tabs=new Set(['company','application','employees','departments','positions','banks','gateways','roles']);
const clean=(v)=>String(v||'').trim();
const nullable=(v)=>clean(v)||null;

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
  res.render('settings/index',{title:'Pengaturan',settings,sites,users,departments,positions,employees,banks,gateways,roles,tab});
});

router.post('/',async(req,res)=>{
  const b=req.body;
  await db.execute(`UPDATE settings SET company_name=?,company_address=?,company_phone=?,company_email=?,company_website=?,company_tagline=? WHERE id=1`,[b.company_name,b.company_address||null,b.company_phone||null,b.company_email||null,b.company_website||null,b.company_tagline||'From the Village, Online Everywhere']);
  req.session.flash={type:'success',message:'Data perusahaan disimpan.'};res.redirect('/settings?tab=company');
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

router.post('/users',async(req,res)=>{const b=req.body;const hash=await bcrypt.hash(b.password,12);const [result]=await db.execute(`INSERT INTO users(name,username,password_hash,role,is_active) VALUES(?,?,?,?,1)`,[b.name,b.username,hash,b.role||'staff']);await db.execute(`INSERT INTO employees(employee_code,name,user_id,is_active) VALUES(?,?,?,1)`,[`USR-${String(result.insertId).padStart(4,'0')}`,b.name,result.insertId]);req.session.flash={type:'success',message:'Akun staff dibuat dan masuk ke direktori karyawan.'};res.redirect('/settings?tab=employees');});
router.post('/users/:id/toggle',async(req,res)=>{if(Number(req.params.id)===Number(req.session.user.id)){req.session.flash={type:'warning',message:'Akun yang sedang dipakai tidak bisa dinonaktifkan.'};return res.redirect('/settings?tab=employees');}await db.execute(`UPDATE users SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);await db.execute(`UPDATE employees SET is_active=(SELECT is_active FROM users WHERE id=?) WHERE user_id=?`,[req.params.id,req.params.id]);res.redirect('/settings?tab=employees');});
router.post('/users/:id/password',async(req,res)=>{const hash=await bcrypt.hash(req.body.password,12);await db.execute(`UPDATE users SET password_hash=? WHERE id=?`,[hash,req.params.id]);req.session.flash={type:'success',message:'Password berhasil direset.'};res.redirect('/settings?tab=employees');});

module.exports=router;
