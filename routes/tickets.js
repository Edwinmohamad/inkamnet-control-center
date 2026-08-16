const express=require('express');
const db=require('../config/db');
const { audit }=require('../services/auditService');
const router=express.Router();

function ticketCode(){const d=new Date();const p=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('');return `TT-${p}-${String(Date.now()).slice(-6)}`;}

router.get('/',async(req,res)=>{
  const status=req.query.status||'';
  const priority=req.query.priority||'';
  let sql=`SELECT t.*,c.customer_code,c.name customer_name,u.name assigned_name
           FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN users u ON u.id=t.assigned_to WHERE 1=1`;
  const params=[];
  if(status){sql+=` AND t.status=?`;params.push(status);}
  if(priority){sql+=` AND t.priority=?`;params.push(priority);}
  sql+=` ORDER BY FIELD(t.status,'open','progress','pending','closed'), FIELD(t.priority,'critical','high','medium','low'), t.id DESC`;
  const [tickets]=await db.execute(sql,params);
  const [customers]=await db.query(`SELECT id,customer_code,name FROM customers WHERE customer_status!='terminated' ORDER BY name`);
  const [users]=await db.query(`SELECT id,name FROM users WHERE is_active=1 ORDER BY name`);
  const [[stats]]=await db.query(`SELECT SUM(status='open') open_count,SUM(status='progress') progress_count,SUM(status='pending') pending_count,SUM(status='closed') closed_count FROM tickets`);
  res.render('tickets/index',{title:'Ticketing',tickets,customers,users,stats:stats||{},filters:{status,priority}});
});

router.post('/',async(req,res)=>{
  const b=req.body; const code=ticketCode();
  const [r]=await db.execute(`INSERT INTO tickets(ticket_code,customer_id,subject,type,priority,status,description,assigned_to,opened_by,opened_at) VALUES(?,?,?,?,?,'open',?,?,?,NOW())`,[
    code,b.customer_id||null,b.subject,b.type||'Gangguan Internet',b.priority||'medium',b.description||null,b.assigned_to||null,req.session.user.id
  ]);
  await audit({userId:req.session.user.id,action:'create',entityType:'ticket',entityId:r.insertId,description:`Buat tiket ${code}`,ip:req.ip});
  req.session.flash={type:'success',message:`Tiket ${code} berhasil dibuat.`}; res.redirect('/tickets');
});

router.post('/:id/status',async(req,res)=>{
  const status=req.body.status;
  await db.execute(`UPDATE tickets SET status=?,closed_at=IF(?='closed',NOW(),NULL) WHERE id=?`,[status,status,req.params.id]);
  req.session.flash={type:'success',message:'Status tiket diperbarui.'};res.redirect('/tickets');
});
module.exports=router;
