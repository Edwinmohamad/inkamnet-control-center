const express=require('express');
const db=require('../config/db');
const router=express.Router();
function invNo(){const d=new Date();return `CINV/${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(Date.now()).slice(-6)}`;}
router.get('/',async(req,res)=>{const [rows]=await db.query(`SELECT ci.*,c.customer_code FROM custom_invoices ci LEFT JOIN customers c ON c.id=ci.customer_id ORDER BY ci.id DESC`);const [customers]=await db.query(`SELECT id,customer_code,name FROM customers WHERE customer_status!='terminated' ORDER BY name`);res.render('custom-invoices/index',{title:'Faktur Custom',invoices:rows,customers});});
router.post('/',async(req,res)=>{const b=req.body;let customerName=b.customer_name||'';if(b.customer_id){const [c]=await db.execute(`SELECT name FROM customers WHERE id=?`,[b.customer_id]);if(c[0])customerName=c[0].name;}await db.execute(`INSERT INTO custom_invoices(invoice_number,customer_id,customer_name,invoice_date,due_date,description,total,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)`,[invNo(),b.customer_id||null,customerName,b.invoice_date||new Date().toISOString().slice(0,10),b.due_date||null,b.description||null,b.total||0,b.status||'draft',req.session.user.id]);req.session.flash={type:'success',message:'Faktur custom dibuat.'};res.redirect('/custom-invoices');});
module.exports=router;
