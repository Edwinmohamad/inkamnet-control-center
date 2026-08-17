const express=require('express');
const { getAnalytics }=require('../services/analyticsService');
const router=express.Router();
router.get('/',async(req,res)=>{
  const data=await getAnalytics({siteCode:String(req.query.site||'').trim().toUpperCase(),month:req.query.month,year:req.query.year});
  res.render('analytics/index',{title:'Analitik Keuangan & PSB',...data});
});
module.exports=router;
