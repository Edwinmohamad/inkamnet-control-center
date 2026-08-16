const express=require('express');
const db=require('../config/db');
const { audit }=require('../services/auditService');
const router=express.Router();

function normalizeSiteId(value){
  const id=Number(value||0);
  return Number.isInteger(id)&&id>0?id:null;
}

async function validateSite(siteId){
  if(!siteId) return null;
  const [rows]=await db.execute(`SELECT id,code,name FROM sites WHERE id=? AND is_active=1 LIMIT 1`,[siteId]);
  return rows[0]||null;
}

router.get('/', async(req,res)=>{
  const selectedSite=normalizeSiteId(req.query.site);
  const params=[];
  let where='1=1';
  if(selectedSite){where+=' AND p.site_id=?';params.push(selectedSite);}
  const [packages]=await db.execute(`SELECT p.*,s.code site_code,s.name site_name,
      (SELECT COUNT(*) FROM customers c WHERE c.package_id=p.id AND c.customer_status='active') customer_count
    FROM packages p
    LEFT JOIN sites s ON s.id=p.site_id
    WHERE ${where}
    ORDER BY COALESCE(s.code,'ZZZ'),p.price,p.name`,params);
  const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  res.render('packages/index',{title:'Paket Internet',packages,sites,selectedSite:selectedSite||''});
});

router.post('/', async(req,res)=>{
  const b=req.body;
  const name=String(b.name||'').trim();
  const siteId=normalizeSiteId(b.site_id);
  const price=Number(b.price||0);
  if(!name){req.session.flash={type:'danger',message:'Nama paket wajib diisi.'};return res.redirect('/packages');}
  if(!siteId){req.session.flash={type:'danger',message:'Pilih Site / POP untuk paket baru.'};return res.redirect('/packages');}
  const site=await validateSite(siteId);
  if(!site){req.session.flash={type:'danger',message:'Site paket tidak valid atau sudah nonaktif.'};return res.redirect('/packages');}
  if(!Number.isFinite(price)||price<0){req.session.flash={type:'danger',message:'Harga paket tidak valid.'};return res.redirect('/packages');}
  const [dups]=await db.execute(`SELECT id FROM packages WHERE site_id=? AND LOWER(name)=LOWER(?) LIMIT 1`,[siteId,name]);
  if(dups.length){req.session.flash={type:'danger',message:`Paket ${name} sudah ada di site ${site.code}.`};return res.redirect(`/packages?site=${siteId}`);}
  const [r]=await db.execute(`INSERT INTO packages (site_id,name,speed_label,price,mikrotik_profile,is_active) VALUES (?,?,?,?,?,1)`,[siteId,name,String(b.speed_label||'').trim()||null,price,String(b.mikrotik_profile||'').trim()||null]);
  await audit({userId:req.session.user.id,action:'create',entityType:'package',entityId:r.insertId,description:`Tambah paket ${name} site ${site.code}`,ip:req.ip});
  req.session.flash={type:'success',message:`Paket ${name} untuk site ${site.code} berhasil ditambahkan.`};
  res.redirect(`/packages?site=${siteId}`);
});

router.post('/:id/edit', async(req,res)=>{
  const id=Number(req.params.id);
  const b=req.body;
  const name=String(b.name||'').trim();
  const siteId=normalizeSiteId(b.site_id);
  const price=Number(b.price||0);
  if(!name){req.session.flash={type:'danger',message:'Nama paket wajib diisi.'};return res.redirect('/packages');}
  if(!siteId){req.session.flash={type:'danger',message:'Pilih Site / POP paket.'};return res.redirect('/packages');}
  const site=await validateSite(siteId);
  if(!site){req.session.flash={type:'danger',message:'Site paket tidak valid atau sudah nonaktif.'};return res.redirect('/packages');}
  if(!Number.isFinite(price)||price<0){req.session.flash={type:'danger',message:'Harga paket tidak valid.'};return res.redirect('/packages');}
  const [dups]=await db.execute(`SELECT id FROM packages WHERE site_id=? AND LOWER(name)=LOWER(?) AND id<>? LIMIT 1`,[siteId,name,id]);
  if(dups.length){req.session.flash={type:'danger',message:`Paket ${name} sudah ada di site ${site.code}.`};return res.redirect(`/packages?site=${siteId}`);}
  const [[usage]]=await db.execute(`SELECT COUNT(*) total,COUNT(DISTINCT site_id) site_count,MIN(site_id) first_site FROM customers WHERE package_id=?`,[id]);
  if(Number(usage.total)>0 && Number(usage.site_count)>1){
    req.session.flash={type:'danger',message:'Paket lama ini masih dipakai pelanggan di lebih dari satu site. Pisahkan paket per site terlebih dahulu sebelum mengubah Site paket.'};
    return res.redirect('/packages');
  }
  if(Number(usage.total)>0 && usage.first_site && Number(usage.first_site)!==siteId){
    req.session.flash={type:'danger',message:'Site paket tidak boleh berbeda dengan site pelanggan yang masih memakai paket ini.'};
    return res.redirect('/packages');
  }
  const [result]=await db.execute(`UPDATE packages SET site_id=?,name=?,speed_label=?,price=?,mikrotik_profile=? WHERE id=?`,[siteId,name,String(b.speed_label||'').trim()||null,price,String(b.mikrotik_profile||'').trim()||null,id]);
  if(!result.affectedRows){req.session.flash={type:'danger',message:'Paket tidak ditemukan.'};return res.redirect('/packages');}
  await audit({userId:req.session.user.id,action:'update',entityType:'package',entityId:id,description:`Update paket ${name} site ${site.code}`,ip:req.ip});
  req.session.flash={type:'success',message:`Paket ${name} berhasil diperbarui.`};
  res.redirect(`/packages?site=${siteId}`);
});

router.post('/:id/toggle', async(req,res)=>{
  await db.execute(`UPDATE packages SET is_active=IF(is_active=1,0,1) WHERE id=?`,[req.params.id]);
  res.redirect('/packages');
});
module.exports=router;
