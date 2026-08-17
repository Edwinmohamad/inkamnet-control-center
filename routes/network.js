const express = require('express');
const db = require('../config/db');
const { requireAdmin } = require('../middleware/auth');
const { checkCustomer, isolateCustomer, unisolateCustomer } = require('../services/networkService');
const { allSnapshots, saveSecret, customersForRouter } = require('../services/nmsService');
const { audit } = require('../services/auditService');
const router = express.Router();

router.get('/monitor', async (req,res) => {
  const [routers] = await db.query(`SELECT r.id,r.name,r.last_status,r.last_seen_at,r.last_error,s.code site_code,s.name site_name FROM routers r JOIN sites s ON s.id=r.site_id WHERE r.is_active=1 ORDER BY s.code,r.name`);
  const [sites] = await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  res.render('network/monitor',{title:'NMS MikroTik',routers,sites});
});

router.get('/api/snapshot', async (req,res) => {
  try { res.set('Cache-Control','no-store').json({ok:true,generatedAt:new Date().toISOString(),snapshots:await allSnapshots()}); }
  catch (error) { res.status(502).json({ok:false,error:error.message}); }
});

router.get('/api/routers/:routerId/customers', requireAdmin, async (req,res) => {
  try { res.json({ok:true,customers:await customersForRouter(req.params.routerId)}); }
  catch (error) { res.status(400).json({ok:false,error:error.message}); }
});

router.post('/secrets', requireAdmin, async (req,res) => {
  try {
    const result = await saveSecret(req.body.router_id,null,req.body,req.body.customer_id||null);
    await audit({userId:req.session.user.id,action:'create',entityType:'pppoe_secret',entityId:null,description:`Tambah PPPoE ${result.payload.name} di ${result.router.name}`,ip:req.ip});
    res.json({ok:true,message:'PPPoE secret berhasil ditambahkan dan integrasi pelanggan diperbarui.'});
  } catch (error) { res.status(400).json({ok:false,error:error.message}); }
});

router.post('/secrets/:secretId', requireAdmin, async (req,res) => {
  try {
    const result = await saveSecret(req.body.router_id,req.params.secretId,req.body,req.body.customer_id||null);
    await audit({userId:req.session.user.id,action:'update',entityType:'pppoe_secret',entityId:req.params.secretId,description:`Ubah PPPoE ${result.payload.name} di ${result.router.name}`,ip:req.ip});
    res.json({ok:true,message:'PPPoE secret berhasil diperbarui.'});
  } catch (error) { res.status(400).json({ok:false,error:error.message}); }
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
