const express=require('express');
const db=require('../config/db');
const { audit }=require('../services/auditService');
const router=express.Router();

router.get('/', async(req,res)=>{
  const [packages]=await db.query(`SELECT p.*,COUNT(c.id) customer_count FROM packages p LEFT JOIN customers c ON c.package_id=p.id AND c.customer_status='active' GROUP BY p.id ORDER BY p.price`);
  res.render('packages/index',{title:'Paket Internet',packages});
});
router.post('/', async(req,res)=>{
  const b=req.body;
  const [r]=await db.execute(`INSERT INTO packages (name,speed_label,price,mikrotik_profile,is_active) VALUES (?,?,?,?,1)`,[b.name,b.speed_label,b.price,b.mikrotik_profile||null]);
  await audit({userId:req.session.user.id,action:'create',entityType:'package',entityId:r.insertId,description:`Tambah paket ${b.name}`,ip:req.ip});
  req.session.flash={type:'success',message:'Paket berhasil ditambahkan.'}; res.redirect('/packages');
});
router.post('/:id/toggle', async(req,res)=>{
  await db.execute(`UPDATE packages SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);
  res.redirect('/packages');
});
module.exports=router;
