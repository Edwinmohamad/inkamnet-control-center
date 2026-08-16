const express = require('express');
const db = require('../config/db');
const { audit } = require('../services/auditService');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

function isoDate(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
}
function mondayOf(input) {
  const d = input ? new Date(`${input}T00:00:00`) : new Date();
  if (Number.isNaN(d.getTime())) return mondayOf();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return isoDate(d);
}

router.get('/', async (req, res) => {
  const weekStart = mondayOf(req.query.week);
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate()+6);
  const weekEnd = isoDate(end);
  const [duties] = await db.execute(`
    SELECT d.*, DATE_FORMAT(d.duty_date,'%Y-%m-%d') duty_date_key, u.name account_name, s.code site_code
    FROM server_duty_schedules d
    LEFT JOIN users u ON u.id=d.user_id
    LEFT JOIN sites s ON s.id=d.site_id
    WHERE d.duty_date BETWEEN ? AND ?
    ORDER BY d.duty_date, COALESCE(d.start_time,'23:59:59'), d.staff_name
  `,[weekStart,weekEnd]);
  const [staff] = await db.query(`SELECT id,name,role FROM users WHERE is_active=1 ORDER BY name`);
  const [sites] = await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  const days = Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return {date:isoDate(d), label:d.toLocaleDateString('id-ID',{weekday:'short',day:'2-digit',month:'short'})};});
  const prev=new Date(start);prev.setDate(prev.getDate()-7); const next=new Date(start);next.setDate(next.getDate()+7);
  res.render('server-duty/index',{title:'Jadwal Piket Server',duties,staff,sites,days,weekStart,weekEnd,prevWeek:isoDate(prev),nextWeek:isoDate(next)});
});

router.post('/', requireAdmin, async (req,res)=>{
  const b=req.body;
  const selectedUser=b.user_id?Number(b.user_id):null;
  let staffName=(b.staff_name||'').trim();
  if(selectedUser){
    const [rows]=await db.execute(`SELECT name FROM users WHERE id=? AND is_active=1`,[selectedUser]);
    if(!rows.length) throw new Error('Akun staff tidak ditemukan.');
    staffName=rows[0].name;
  }
  if(!staffName) throw new Error('Nama petugas piket wajib diisi.');
  const [result]=await db.execute(`INSERT INTO server_duty_schedules(duty_date,shift_name,start_time,end_time,user_id,staff_name,site_id,status,notes,created_by) VALUES(?,?,?,?,?,?,?,'scheduled',?,?)`,[
    b.duty_date,b.shift_name||'Piket Server',b.start_time||null,b.end_time||null,selectedUser,staffName,b.site_id||null,b.notes||null,req.session.user.id
  ]);
  await audit({userId:req.session.user.id,action:'create',entityType:'server_duty',entityId:result.insertId,description:`Piket ${staffName} ${b.duty_date}`,ip:req.ip});
  req.session.flash={type:'success',message:'Jadwal piket server berhasil ditambahkan.'};
  res.redirect(`/server-duty?week=${encodeURIComponent(b.duty_date)}`);
});

router.post('/:id/status', async(req,res)=>{
  const allowed=new Set(['scheduled','present','absent','swapped','cancelled']);
  const status=allowed.has(req.body.status)?req.body.status:'scheduled';
  await db.execute(`UPDATE server_duty_schedules SET status=? WHERE id=?`,[status,req.params.id]);
  await audit({userId:req.session.user.id,action:'update',entityType:'server_duty',entityId:req.params.id,description:`Status piket → ${status}`,ip:req.ip});
  res.redirect(`/server-duty?week=${encodeURIComponent(req.body.week||'')}`);
});

router.post('/:id/delete', requireAdmin, async(req,res)=>{
  await db.execute(`DELETE FROM server_duty_schedules WHERE id=?`,[req.params.id]);
  await audit({userId:req.session.user.id,action:'delete',entityType:'server_duty',entityId:req.params.id,description:'Hapus jadwal piket',ip:req.ip});
  req.session.flash={type:'success',message:'Jadwal piket dihapus.'};
  res.redirect(`/server-duty?week=${encodeURIComponent(req.body.week||'')}`);
});

module.exports=router;
