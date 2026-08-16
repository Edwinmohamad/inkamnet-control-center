const express=require('express');
const db=require('../config/db');
const router=express.Router();
router.get('/',async(req,res)=>{const [sites]=await db.query(`SELECT s.*,COUNT(DISTINCT c.id) customers,COUNT(DISTINCT r.id) routers FROM sites s LEFT JOIN customers c ON c.site_id=s.id LEFT JOIN routers r ON r.site_id=s.id GROUP BY s.id ORDER BY s.code`);res.render('sites/index',{title:'Lokasi Server / POP',sites});});
router.post('/',async(req,res)=>{const b=req.body;await db.execute(`INSERT INTO sites(code,name,address,default_due_day,default_grace_days,invoice_generate_days,is_active) VALUES(?,?,?,?,?,?,1)`,[b.code.toUpperCase(),b.name,b.address||null,b.default_due_day||null,b.default_grace_days||null,b.invoice_generate_days||null]);req.session.flash={type:'success',message:'Lokasi server ditambahkan.'};res.redirect('/sites');});
module.exports=router;
