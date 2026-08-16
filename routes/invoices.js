const express=require('express');
const db=require('../config/db');
const { generateMonthlyInvoices }=require('../services/invoiceService');
const router=express.Router();

router.get('/',async(req,res)=>{
  await db.query(`UPDATE invoices SET status='overdue' WHERE status IN ('unpaid','partial') AND due_date < CURDATE()`);
  const status=req.query.status||'';
  let sql=`SELECT i.*,c.customer_code,c.name customer_name,s.code site_code FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id WHERE 1=1`;
  const params=[]; if(status){sql+=` AND i.status=?`;params.push(status);} sql+=` ORDER BY i.id DESC`;
  const [invoices]=await db.execute(sql,params);
  res.render('invoices/index',{title:'Tagihan',invoices,status});
});
router.post('/generate',async(req,res)=>{
  const result=await generateMonthlyInvoices(new Date(),true,req.session.user.id);
  req.session.flash={type:'success',message:`Generate selesai: ${result.created} invoice dibuat, ${result.skipped} dilewati.`};
  res.redirect('/invoices');
});
module.exports=router;
