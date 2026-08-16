const express=require('express');
const {checkCustomer,isolateCustomer,unisolateCustomer}=require('../services/networkService');
const {audit}=require('../services/auditService');
const router=express.Router();


router.get('/monitor',async(req,res)=>{
  const db=require('../config/db');
  const [routers]=await db.query(`SELECT r.*,s.code site_code,s.name site_name,
    (SELECT COUNT(*) FROM customers c WHERE c.router_id=r.id AND c.customer_status='active') customers,
    (SELECT COUNT(*) FROM customers c WHERE c.router_id=r.id AND c.customer_status='active' AND c.network_status='online') online_customers,
    (SELECT COUNT(*) FROM customers c WHERE c.router_id=r.id AND c.customer_status='active' AND c.network_status='isolated') isolated_customers
    FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.is_active=1 ORDER BY s.code,r.name`);
  const [sites]=await db.query(`SELECT s.code,s.name,COUNT(c.id) customers,
    SUM(c.network_status='online') online_count,SUM(c.network_status='offline') offline_count,SUM(c.network_status='isolated') isolated_count,SUM(c.network_status='router_unreachable') unreachable_count
    FROM sites s LEFT JOIN customers c ON c.site_id=s.id AND c.customer_status='active' WHERE s.is_active=1 GROUP BY s.id ORDER BY s.code`);
  const [[summary]]=await db.query(`SELECT
    (SELECT COUNT(*) FROM routers WHERE is_active=1) routers_total,
    (SELECT COUNT(*) FROM routers WHERE is_active=1 AND last_status='online') routers_online,
    (SELECT COUNT(*) FROM customers WHERE customer_status='active' AND network_status='online') customers_online,
    (SELECT COUNT(*) FROM customers WHERE customer_status='active' AND network_status='isolated') customers_isolated`);
  res.render('network/monitor',{title:'Network Monitor',routers,sites,summary:summary||{}});
});
router.post('/:customerId/check',async(req,res)=>{
  try{const r=await checkCustomer(req.params.customerId);req.session.flash={type:'success',message:`PPPoE: ${r.status}. Profile: ${r.secret?.profile||'-'}${r.active?` · IP ${r.active.address||'-'} · uptime ${r.active.uptime||'-'}`:''}`};}
  catch(e){req.session.flash={type:'danger',message:`Cek PPPoE gagal: ${e.message}`};}
  res.redirect(`/customers/${req.params.customerId}`);
});
router.post('/:customerId/isolate',async(req,res)=>{
  try{await isolateCustomer(req.params.customerId,'manual');await audit({userId:req.session.user.id,action:'isolate',entityType:'customer',entityId:req.params.customerId,description:'Manual isolate PPPoE',ip:req.ip});req.session.flash={type:'success',message:'Pelanggan berhasil diisolir dan sesi aktif diputus.'};}
  catch(e){req.session.flash={type:'danger',message:`Isolir gagal: ${e.message}`};}
  res.redirect(`/customers/${req.params.customerId}`);
});
router.post('/:customerId/unisolate',async(req,res)=>{
  try{await unisolateCustomer(req.params.customerId,false);await audit({userId:req.session.user.id,action:'unisolate',entityType:'customer',entityId:req.params.customerId,description:'Manual unisolate PPPoE',ip:req.ip});req.session.flash={type:'success',message:'Isolir dibuka. PPPoE secret sudah aktif.'};}
  catch(e){req.session.flash={type:'danger',message:`Buka isolir gagal: ${e.message}`};}
  res.redirect(`/customers/${req.params.customerId}`);
});
module.exports=router;
