const express=require('express');
const db=require('../config/db');
const { audit }=require('../services/auditService');
const router=express.Router();

router.get('/',async(req,res)=>{
  const site=req.query.site||'';
  let sql=`SELECT cl.*,s.code site_code,s.name site_name,COUNT(c.id) customers
           FROM clusters cl JOIN sites s ON s.id=cl.site_id
           LEFT JOIN customers c ON c.cluster_id=cl.id AND c.customer_status='active'
           WHERE 1=1`;
  const params=[];
  if(site){sql+=` AND s.code=?`;params.push(site);}
  sql+=` GROUP BY cl.id ORDER BY s.code,cl.name`;
  const [clusters]=await db.execute(sql,params);
  const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  res.render('clusters/index',{title:'Clustering / ODP',clusters,sites,site});
});

router.post('/',async(req,res)=>{
  const b=req.body;
  const [r]=await db.execute(`INSERT INTO clusters(site_id,name,type,capacity_ports,used_ports,latitude,longitude,address,status) VALUES(?,?,?,?,?,?,?,?,?)`,[
    b.site_id,b.name,b.type||'FTTH',b.capacity_ports||null,b.used_ports||0,b.latitude||null,b.longitude||null,b.address||null,b.status||'active'
  ]);
  await audit({userId:req.session.user.id,action:'create',entityType:'cluster',entityId:r.insertId,description:`Tambah cluster ${b.name}`,ip:req.ip});
  req.session.flash={type:'success',message:'Cluster/ODP berhasil ditambahkan.'};
  res.redirect('/clusters');
});

router.post('/:id/delete',async(req,res)=>{
  await db.execute(`DELETE FROM clusters WHERE id=?`,[req.params.id]);
  req.session.flash={type:'success',message:'Cluster dihapus.'};
  res.redirect('/clusters');
});
module.exports=router;
