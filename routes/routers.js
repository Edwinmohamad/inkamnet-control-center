const express=require('express');
const db=require('../config/db');
const { encrypt }=require('../services/cryptoService');
const { testConnection }=require('../services/mikrotikRest');
const router=express.Router();

router.get('/',async(req,res)=>{
  const [routers]=await db.query(`SELECT r.id,r.name,r.base_url,r.username,r.verify_tls,r.is_active,r.last_status,r.last_error,r.last_seen_at,s.code site_code FROM routers r JOIN sites s ON s.id=r.site_id ORDER BY s.code,r.name`);
  const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  res.render('routers/index',{title:'Router MikroTik',routers,sites});
});

router.post('/',async(req,res)=>{
  const b=req.body;
  const passwordEnc=encrypt(b.password);
  await db.execute(`INSERT INTO routers(site_id,name,base_url,username,password_enc,verify_tls,is_active) VALUES(?,?,?,?,?,?,1)`,[b.site_id,b.name,b.base_url.replace(/\/$/,''),b.username,passwordEnc,b.verify_tls?1:0]);
  req.session.flash={type:'success',message:'Router tersimpan. Jalankan Periksa Koneksi.'};
  res.redirect('/routers');
});

router.post('/:id/test',async(req,res)=>{
  const [rows]=await db.execute(`SELECT * FROM routers WHERE id=?`,[req.params.id]);
  if(!rows.length)return res.status(404).send('Router tidak ditemukan');
  try{
    const info=await testConnection(rows[0]);
    await db.execute(`UPDATE routers SET last_status='online',last_error=NULL,last_seen_at=NOW() WHERE id=?`,[req.params.id]);
    req.session.flash={type:'success',message:`Koneksi OK: ${info?.['board-name']||'MikroTik'} · RouterOS ${info?.version||'-'} · uptime ${info?.uptime||'-'}`};
  }catch(e){
    await db.execute(`UPDATE routers SET last_status='offline',last_error=? WHERE id=?`,[e.message.slice(0,500),req.params.id]);
    req.session.flash={type:'danger',message:`Koneksi gagal: ${e.message}`};
  }
  res.redirect('/routers');
});
module.exports=router;
