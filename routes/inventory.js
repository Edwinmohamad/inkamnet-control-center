const express=require('express');
const db=require('../config/db');
const { audit }=require('../services/auditService');
const router=express.Router();

router.get('/',async(req,res)=>{
  const site=req.query.site||'';let sql=`SELECT i.*,s.code site_code,sp.name supplier_name FROM inventory_items i LEFT JOIN sites s ON s.id=i.site_id LEFT JOIN suppliers sp ON sp.id=i.supplier_id WHERE i.is_active=1`;const params=[];
  if(site){sql+=` AND s.code=?`;params.push(site);} sql+=` ORDER BY (i.qty<=i.min_stock) DESC,i.name`;
  const [items]=await db.execute(sql,params);const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);const [suppliers]=await db.query(`SELECT id,name FROM suppliers WHERE is_active=1 ORDER BY name`);
  const [[summary]]=await db.execute(`SELECT COUNT(*) items,COALESCE(SUM(i.qty*i.purchase_price),0) stock_value,SUM(i.qty<=i.min_stock) low_stock,COALESCE(SUM(i.qty),0) total_qty FROM inventory_items i LEFT JOIN sites s ON s.id=i.site_id WHERE i.is_active=1${site?` AND s.code=?`:''}`,site?[site]:[]);
  res.render('inventory/index',{title:'Stock Barang',items,sites,suppliers,summary:summary||{},site});
});
router.post('/',async(req,res)=>{const b=req.body;const [r]=await db.execute(`INSERT INTO inventory_items(item_code,name,category,site_id,supplier_id,qty,unit,min_stock,purchase_price,location,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,[b.item_code||null,b.name,b.category||null,b.site_id||null,b.supplier_id||null,b.qty||0,b.unit||'pcs',b.min_stock||0,b.purchase_price||0,b.location||null,b.notes||null]);await audit({userId:req.session.user.id,action:'create',entityType:'inventory',entityId:r.insertId,description:`Tambah stock ${b.name}`,ip:req.ip});req.session.flash={type:'success',message:'Item gudang ditambahkan.'};res.redirect('/inventory');});
router.post('/:id/adjust',async(req,res)=>{const qty=Number(req.body.qty||0);const type=req.body.movement_type||'adjustment';const signed=type==='out'?-Math.abs(qty):Math.abs(qty);const conn=await db.getConnection();try{await conn.beginTransaction();await conn.execute(`UPDATE inventory_items SET qty=GREATEST(0,qty+?) WHERE id=?`,[signed,req.params.id]);await conn.execute(`INSERT INTO inventory_movements(item_id,movement_type,qty,reference,notes,user_id) VALUES(?,?,?,?,?,?)`,[req.params.id,type,Math.abs(qty),req.body.reference||null,req.body.notes||null,req.session.user.id]);await conn.commit();req.session.flash={type:'success',message:'Stock berhasil diperbarui.'};}catch(e){await conn.rollback();throw e;}finally{conn.release();}res.redirect('/inventory');});

router.get('/movements',async(req,res)=>{
  const [movements]=await db.query(`SELECT m.*,i.name item_name,i.item_code,i.unit,u.name user_name FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id LEFT JOIN users u ON u.id=m.user_id ORDER BY m.id DESC LIMIT 300`);
  const [[today]]=await db.query(`SELECT COALESCE(SUM(CASE WHEN movement_type='in' THEN qty ELSE 0 END),0) stock_in,COALESCE(SUM(CASE WHEN movement_type='out' THEN qty ELSE 0 END),0) stock_out,COUNT(*) movements FROM inventory_movements WHERE DATE(created_at)=CURDATE()`);
  res.render('inventory/movements',{title:'Pergerakan Stock',movements,today:today||{}});
});

router.get('/usage',async(req,res)=>{
  const [usages]=await db.query(`SELECT mu.*,i.name item_name,i.unit,c.name customer_name,t.ticket_code,s.code site_code,u.name used_by_name FROM material_usages mu JOIN inventory_items i ON i.id=mu.item_id LEFT JOIN customers c ON c.id=mu.customer_id LEFT JOIN tickets t ON t.id=mu.ticket_id LEFT JOIN sites s ON s.id=mu.site_id LEFT JOIN users u ON u.id=mu.used_by ORDER BY mu.id DESC LIMIT 250`);
  const [items]=await db.query(`SELECT id,name,qty,unit FROM inventory_items WHERE is_active=1 ORDER BY name`);
  const [customers]=await db.query(`SELECT id,customer_code,name FROM customers WHERE customer_status='active' ORDER BY name LIMIT 1000`);
  const [tickets]=await db.query(`SELECT id,ticket_code,subject FROM tickets WHERE status IN ('open','progress','pending') ORDER BY id DESC LIMIT 300`);
  const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  res.render('inventory/usage',{title:'Pemakaian Material',usages,items,customers,tickets,sites});
});
router.post('/usage',async(req,res)=>{
  const b=req.body, qty=Math.abs(Number(b.qty||0)); if(!qty) throw new Error('Qty harus lebih dari 0');
  const conn=await db.getConnection();
  try{await conn.beginTransaction();const [rows]=await conn.execute(`SELECT qty,name FROM inventory_items WHERE id=? FOR UPDATE`,[b.item_id]);if(!rows.length)throw new Error('Item tidak ditemukan');if(Number(rows[0].qty)<qty)throw new Error(`Stock ${rows[0].name} tidak cukup`);
    const [r]=await conn.execute(`INSERT INTO material_usages(item_id,customer_id,ticket_id,site_id,qty,purpose,reference,notes,used_by,used_at) VALUES(?,?,?,?,?,?,?,?,?,NOW())`,[b.item_id,b.customer_id||null,b.ticket_id||null,b.site_id||null,qty,b.purpose||'operasional',b.reference||null,b.notes||null,req.session.user.id]);
    await conn.execute(`UPDATE inventory_items SET qty=qty-? WHERE id=?`,[qty,b.item_id]);
    await conn.execute(`INSERT INTO inventory_movements(item_id,movement_type,qty,reference,notes,user_id) VALUES(?,'out',?,?,?,?)`,[b.item_id,qty,b.reference||`USAGE-${r.insertId}`,b.notes||b.purpose||'Pemakaian material',req.session.user.id]);
    await conn.commit();await audit({userId:req.session.user.id,action:'use',entityType:'inventory',entityId:b.item_id,description:`Pemakaian material qty ${qty}`,ip:req.ip});req.session.flash={type:'success',message:'Pemakaian material dicatat dan stock otomatis berkurang.'};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  res.redirect('/inventory/usage');
});

router.get('/suppliers',async(req,res)=>{const [suppliers]=await db.query(`SELECT sp.*,COUNT(i.id) item_count FROM suppliers sp LEFT JOIN inventory_items i ON i.supplier_id=sp.id AND i.is_active=1 GROUP BY sp.id ORDER BY sp.is_active DESC,sp.name`);res.render('inventory/suppliers',{title:'Supplier',suppliers});});
router.post('/suppliers',async(req,res)=>{const b=req.body;await db.execute(`INSERT INTO suppliers(name,phone,email,address,notes,is_active) VALUES(?,?,?,?,?,1)`,[b.name,b.phone||null,b.email||null,b.address||null,b.notes||null]);req.session.flash={type:'success',message:'Supplier ditambahkan.'};res.redirect('/inventory/suppliers');});

module.exports=router;
