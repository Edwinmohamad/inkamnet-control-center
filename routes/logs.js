const express=require('express');
const db=require('../config/db');
const router=express.Router();
router.get('/',async(req,res)=>{const [audit]=await db.query(`SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 250`);const [automation]=await db.query(`SELECT * FROM automation_logs ORDER BY id DESC LIMIT 250`);res.render('logs/index',{title:'Activity & Automation Log',audit,automation});});
module.exports=router;
