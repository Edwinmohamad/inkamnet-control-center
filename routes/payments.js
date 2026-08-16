const express=require('express');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const db=require('../config/db');
const { refreshInvoiceStatus }=require('../services/invoiceService');
const { audit }=require('../services/auditService');
const { unisolateCustomer }=require('../services/networkService');
const { assignCashTransactionCode }=require('../services/cashService');
const { requireAdmin }=require('../middleware/auth');
const router=express.Router();

const PROOF_DIR=path.join(__dirname,'..','storage','payment-proofs');
fs.mkdirSync(PROOF_DIR,{recursive:true});

function proofExtension(mime){
  return ({'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf'})[mime]||'';
}
function proofSignatureMatches(file){
  const b=file?.buffer;if(!b||b.length<12)return false;
  if(file.mimetype==='image/jpeg')return b[0]===0xff&&b[1]===0xd8&&b[2]===0xff;
  if(file.mimetype==='image/png')return b.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if(file.mimetype==='image/webp')return b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
  if(file.mimetype==='application/pdf')return b.subarray(0,5).toString()==='%PDF-';
  return false;
}
async function saveProofFile(file){
  if(!file)return null;
  const ext=proofExtension(file.mimetype);
  if(!ext||!proofSignatureMatches(file))throw new Error('Isi file bukti tidak sesuai format JPG, PNG, WEBP, atau PDF yang diizinkan.');
  const filename=`proof-${Date.now()}-${crypto.randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(PROOF_DIR,filename),file.buffer,{flag:'wx'});
  return {filename,originalName:file.originalname,mime:file.mimetype,size:file.size};
}
async function removeProofFile(filename){
  if(!filename)return;
  try{await fs.promises.unlink(path.join(PROOF_DIR,path.basename(filename)));}catch(e){if(e.code!=='ENOENT')console.error('Gagal hapus bukti lama:',e.message);}
}
function localReturn(value,fallback='/payments'){
  const v=String(value||'');
  return v.startsWith('/')&&!v.startsWith('//')?v:fallback;
}
function selectedInvoiceIds(body){
  const raw=body.invoice_ids??body.invoice_id;
  const list=Array.isArray(raw)?raw:[raw];
  return [...new Set(list.map(Number).filter(Number.isInteger).filter(x=>x>0))];
}
function paymentReference(paymentId, date=new Date()){
  const d=new Date(date);
  const stamp=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `PAY-${stamp}-${String(paymentId).padStart(6,'0')}`;
}

async function paymentCashMeta(conn,invoiceId){
  const [rows]=await conn.execute(`SELECT c.site_id,c.name customer_name,c.customer_code,i.invoice_number FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`,[invoiceId]);
  return rows[0]||null;
}
async function billingCategory(conn,name='Pendapatan Billing'){
  const [rows]=await conn.execute(`SELECT id FROM cash_categories WHERE name=? AND type='income' LIMIT 1`,[name]);
  return rows[0]?.id||null;
}
async function postCashTransaction(conn,{paymentId,invoiceId,amount,reference,categoryName='Pendapatan Billing',prefix='Pembayaran',actorUserId=null}){
  const meta=await paymentCashMeta(conn,invoiceId);if(!meta)return;
  const catId=await billingCategory(conn,categoryName);if(!catId)return;
  const [exists]=await conn.execute(`SELECT id FROM cash_transactions WHERE source_type='payment' AND source_id=? LIMIT 1`,[paymentId]);
  if(exists.length)return;
  const [r]=await conn.execute(`INSERT INTO cash_transactions(transaction_date,name,category_id,site_id,amount,notes,source_type,source_id,created_by) VALUES(CURDATE(),?,?,?,?,?,'payment',?,?)`,[
    `${prefix} ${meta.customer_name}`,catId,meta.site_id,amount,`Faktur ${meta.invoice_number}${reference?` · ${reference}`:''}`,paymentId,actorUserId
  ]);
  await assignCashTransactionCode(conn,r.insertId,catId,new Date());
}
async function maybeAutoUnisolate(invoiceId){
  const [paidRows]=await db.execute(`SELECT i.status,c.id customer_id,c.network_status,c.isolation_reason FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`,[invoiceId]);
  if(paidRows[0]?.status==='paid'&&paidRows[0]?.network_status==='isolated'&&paidRows[0]?.isolation_reason==='billing'){
    try{await unisolateCustomer(paidRows[0].customer_id,true);}
    catch(netErr){await db.execute(`INSERT INTO automation_logs(job_name,status,message) VALUES('auto_unisolate','failed',?)`,[netErr.message.slice(0,1000)]);}
  }
}

async function openInvoiceOptions(){
  const [rows]=await db.query(`SELECT i.id,i.invoice_number,i.outstanding,c.customer_code,c.name customer_name,s.code site_code,cl.name cluster_name
    FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id
    WHERE i.status IN ('unpaid','partial','overdue') AND i.outstanding>0 ORDER BY s.code,cl.name,c.name,i.due_date`);
  return rows;
}
async function staffOptions(){
  const [rows]=await db.query(`SELECT id,name,role FROM users WHERE is_active=1 ORDER BY name`);return rows;
}

router.get('/',async(req,res)=>{
  const q=String(req.query.q||'').trim();
  const site=String(req.query.site||'').trim();
  const cluster=String(req.query.cluster||'').trim();
  let sql=`SELECT p.*,i.invoice_number,c.customer_code,c.name customer_name,s.code site_code,cl.name cluster_name,u.name collector_name,v.name verifier_name,pu.name proof_uploader_name
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id
    LEFT JOIN users u ON u.id=COALESCE(p.collector_user_id,p.received_by) LEFT JOIN users v ON v.id=p.verified_by LEFT JOIN users pu ON pu.id=p.proof_uploaded_by WHERE 1=1`;
  const params=[];
  if(site){sql+=` AND s.code=?`;params.push(site);}
  if(cluster){sql+=` AND c.cluster_id=?`;params.push(Number(cluster));}
  if(q){const like=`%${q}%`;sql+=` AND (c.name LIKE ? OR c.customer_code LIKE ? OR i.invoice_number LIKE ? OR p.reference LIKE ? OR s.code LIKE ? OR cl.name LIKE ?)`;params.push(like,like,like,like,like,like);}
  sql+=` ORDER BY p.id DESC LIMIT 500`;
  const [payments]=await db.execute(sql,params);
  const openInvoices=await openInvoiceOptions();
  const staff=await staffOptions();
  const [sites]=await db.query(`SELECT code,name FROM sites WHERE is_active=1 ORDER BY code`);
  const [clusters]=await db.query(`SELECT cl.id,cl.name,s.code site_code FROM clusters cl JOIN sites s ON s.id=cl.site_id WHERE cl.status!='inactive' ORDER BY s.code,cl.name`);
  const [[summary]]=await db.query(`SELECT
    COALESCE(SUM(CASE WHEN status='confirmed' THEN amount ELSE 0 END),0) confirmed_total,
    COALESCE(SUM(CASE WHEN method='cash' AND status='confirmed' AND settlement_status='held_by_staff' THEN amount ELSE 0 END),0) cash_held,
    COALESCE(SUM(CASE WHEN method='transfer' AND status='pending' THEN amount ELSE 0 END),0) transfer_pending,
    SUM(status='confirmed') confirmed_count
    FROM payments WHERE paid_at>=DATE_FORMAT(CURDATE(),'%Y-%m-01')`);
  const preselectedInvoiceId=Number(req.query.invoice_id||0)||null;
  res.render('payments/index',{title:'Pembayaran',payments,openInvoices,staff,sites,clusters,summary:summary||{},preselectedInvoiceId,filters:{q,site,cluster}});
});

router.post('/',async(req,res)=>{
  const ids=selectedInvoiceIds(req.body);
  if(!ids.length)throw new Error('Pilih minimal satu faktur yang akan dibayar.');
  const {method,notes,collector_user_id,bank_name,payment_status}=req.body;
  const normalizedMethod=method||'transfer';
  const isAdmin=req.session.user.role==='admin';
  const requestedConfirmed=payment_status==='confirmed';
  const status=normalizedMethod==='cash'?'confirmed':(normalizedMethod==='transfer'?(isAdmin&&requestedConfirmed&&req.file?'confirmed':'pending'):(payment_status==='pending'?'pending':'confirmed'));
  const settlement=normalizedMethod==='cash'?'held_by_staff':'not_applicable';
  const collector=normalizedMethod==='cash'?(isAdmin?(collector_user_id||req.session.user.id):req.session.user.id):req.session.user.id;
  const conn=await db.getConnection();
  const created=[];const savedFiles=[];const confirmedInvoices=[];
  try{
    await conn.beginTransaction();
    for(const invoiceId of ids){
      const [invoiceRows]=await conn.execute(`SELECT id,outstanding,status FROM invoices WHERE id=? FOR UPDATE`,[invoiceId]);
      if(!invoiceRows.length)throw new Error(`Faktur #${invoiceId} tidak ditemukan.`);
      const invoice=invoiceRows[0];
      if(['paid','cancelled','refunded'].includes(invoice.status)||Number(invoice.outstanding)<=0)throw new Error(`Faktur #${invoiceId} sudah tidak memiliki sisa tagihan.`);
      const requestedAmount=req.body[`amount_${invoiceId}`]??(ids.length===1?req.body.amount:null);
      const numericAmount=requestedAmount==null||requestedAmount===''?Number(invoice.outstanding):Number(requestedAmount);
      if(!Number.isFinite(numericAmount)||numericAmount<=0)throw new Error(`Nominal faktur #${invoiceId} harus lebih dari 0.`);
      if(numericAmount>Number(invoice.outstanding))throw new Error(`Nominal faktur #${invoiceId} melebihi sisa tagihan (${Number(invoice.outstanding).toLocaleString('id-ID')}).`);
      let savedProof=null;
      if(req.file){savedProof=await saveProofFile(req.file);savedFiles.push(savedProof.filename);}
      const [r]=await conn.execute(`INSERT INTO payments (invoice_id,amount,method,reference,notes,status,settlement_status,bank_name,proof_reference,proof_path,proof_original_name,proof_mime,proof_size,proof_uploaded_by,proof_uploaded_at,paid_at,received_by,collector_user_id,verified_by,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,?,?,?)`,[
        invoiceId,numericAmount,normalizedMethod,null,notes||null,status,settlement,bank_name||null,savedProof?.originalName||null,savedProof?.filename||null,savedProof?.originalName||null,savedProof?.mime||null,savedProof?.size||null,savedProof?req.session.user.id:null,savedProof?new Date():null,req.session.user.id,collector,status==='confirmed'?req.session.user.id:null,status==='confirmed'?new Date():null
      ]);
      const autoReference=paymentReference(r.insertId);
      await conn.execute(`UPDATE payments SET reference=? WHERE id=?`,[autoReference,r.insertId]);
      created.push({paymentId:r.insertId,invoiceId,amount:numericAmount,reference:autoReference});
      await refreshInvoiceStatus(conn,invoiceId);
      if(status==='confirmed'&&normalizedMethod!=='cash')await postCashTransaction(conn,{paymentId:r.insertId,invoiceId,amount:numericAmount,reference:autoReference,actorUserId:req.session.user.id});
      if(status==='confirmed')confirmedInvoices.push(invoiceId);
    }
    await conn.commit();
    await audit({userId:req.session.user.id,action:'create',entityType:'payment_batch',entityId:created[0]?.paymentId||null,description:`Pembayaran ${normalizedMethod} ${created.length} faktur · total Rp${created.reduce((a,x)=>a+x.amount,0)}${req.file?' · bukti terupload':' · tanpa bukti'}`,ip:req.ip});
    for(const invoiceId of confirmedInvoices)await maybeAutoUnisolate(invoiceId);
    const total=created.reduce((a,x)=>a+x.amount,0);
    let message=`${created.length} pembayaran berhasil dicatat dengan total Rp${total.toLocaleString('id-ID')}.`;
    if(normalizedMethod==='cash')message+=' Dana berstatus Cash di Staff sampai disetor.';
    else if(normalizedMethod==='transfer'&&!req.file)message+=' Bukti transfer belum ada; status tetap menunggu verifikasi.';
    else if(status==='pending')message+=' Menunggu verifikasi admin.';
    req.session.flash={type:'success',message};
  }catch(e){await conn.rollback();for(const f of savedFiles)await removeProofFile(f);throw e;}finally{conn.release();}
  res.redirect(localReturn(req.body.return_to,'/payments'));
});

router.get('/:id/proof',async(req,res)=>{
  const [rows]=await db.execute(`SELECT proof_path,proof_original_name,proof_mime FROM payments WHERE id=? LIMIT 1`,[req.params.id]);
  const p=rows[0];if(!p?.proof_path)return res.status(404).send('Bukti pembayaran tidak ditemukan.');
  const filename=path.basename(p.proof_path);const fullPath=path.join(PROOF_DIR,filename);
  if(!fs.existsSync(fullPath))return res.status(404).send('File bukti pembayaran tidak ditemukan di storage.');
  res.type(p.proof_mime||'application/octet-stream');
  const safeOriginal=(p.proof_original_name||filename).replace(/[\r\n"]/g,'_');
  res.setHeader('Content-Disposition',`inline; filename="${safeOriginal}"`);res.setHeader('Cache-Control','private, max-age=300');res.setHeader('X-Content-Type-Options','nosniff');res.sendFile(fullPath);
});

router.post('/:id/proof',async(req,res)=>{
  if(!req.file)throw new Error('Pilih file bukti transfer terlebih dahulu.');
  const [rows]=await db.execute(`SELECT id,method,proof_path,received_by,collector_user_id FROM payments WHERE id=? LIMIT 1`,[req.params.id]);
  const payment=rows[0];if(!payment)throw new Error('Pembayaran tidak ditemukan.');
  const ownsPayment=Number(payment.received_by)===Number(req.session.user.id)||Number(payment.collector_user_id)===Number(req.session.user.id);
  if(req.session.user.role!=='admin'&&!ownsPayment)throw new Error('Anda hanya dapat mengupload bukti untuk pembayaran yang Anda catat.');
  if(!['transfer','qris','gateway','other'].includes(payment.method))throw new Error('Bukti upload hanya digunakan untuk pembayaran non-cash.');
  let savedProof=null;
  try{
    savedProof=await saveProofFile(req.file);
    await db.execute(`UPDATE payments SET proof_reference=?,proof_path=?,proof_original_name=?,proof_mime=?,proof_size=?,proof_uploaded_by=?,proof_uploaded_at=NOW() WHERE id=?`,[
      savedProof.originalName,savedProof.filename,savedProof.originalName,savedProof.mime,savedProof.size,req.session.user.id,payment.id
    ]);
    await removeProofFile(payment.proof_path);
    await audit({userId:req.session.user.id,action:'upload_proof',entityType:'payment',entityId:payment.id,description:'Upload/ganti bukti pembayaran transfer',ip:req.ip});
    req.session.flash={type:'success',message:'Bukti transfer berhasil diupload.'};
  }catch(e){if(savedProof)await removeProofFile(savedProof.filename);throw e;}
  res.redirect(localReturn(req.body.return_to,'/payments'));
});

router.post('/:id/verify',requireAdmin,async(req,res)=>{
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute(`SELECT * FROM payments WHERE id=? FOR UPDATE`,[req.params.id]);
    const p=rows[0];if(!p)throw new Error('Pembayaran tidak ditemukan');
    if(p.method==='transfer'&&!p.proof_path)throw new Error('Upload bukti transfer sebelum melakukan verifikasi.');
    if(p.status!=='confirmed'){
      const [invoiceRows]=await conn.execute(`SELECT outstanding,status FROM invoices WHERE id=? FOR UPDATE`,[p.invoice_id]);
      if(!invoiceRows.length)throw new Error('Faktur pembayaran tidak ditemukan.');
      if(Number(p.amount)>Number(invoiceRows[0].outstanding))throw new Error('Nominal transfer melebihi sisa tagihan saat ini. Periksa pembayaran lain sebelum verifikasi.');
      await conn.execute(`UPDATE payments SET status='confirmed',verified_by=?,verified_at=NOW() WHERE id=?`,[req.session.user.id,p.id]);
      await refreshInvoiceStatus(conn,p.invoice_id);
      if(p.method!=='cash')await postCashTransaction(conn,{paymentId:p.id,invoiceId:p.invoice_id,amount:p.amount,reference:p.reference,actorUserId:req.session.user.id});
    }
    await conn.commit();
    await audit({userId:req.session.user.id,action:'verify',entityType:'payment',entityId:p.id,description:'Verifikasi pembayaran transfer berdasarkan bukti pembayaran',ip:req.ip});
    await maybeAutoUnisolate(p.invoice_id);
    req.session.flash={type:'success',message:'Pembayaran diverifikasi berdasarkan bukti transfer dan faktur diperbarui.'};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  res.redirect(localReturn(req.body.return_to,'/payments'));
});

router.get('/reconciliation',requireAdmin,async(req,res)=>{
  const q=String(req.query.q||'').trim();const site=String(req.query.site||'').trim();const cluster=String(req.query.cluster||'').trim();
  let heldSql=`SELECT p.*,c.customer_code,c.name customer_name,s.code site_code,cl.name cluster_name,u.name collector_name,i.invoice_number
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id LEFT JOIN users u ON u.id=COALESCE(p.collector_user_id,p.received_by)
    WHERE p.method='cash' AND p.status='confirmed' AND p.settlement_status='held_by_staff'`;
  const heldParams=[];
  if(site){heldSql+=` AND s.code=?`;heldParams.push(site);}
  if(cluster){heldSql+=` AND c.cluster_id=?`;heldParams.push(Number(cluster));}
  if(q){const like=`%${q}%`;heldSql+=` AND (c.name LIKE ? OR c.customer_code LIKE ? OR i.invoice_number LIKE ? OR u.name LIKE ? OR s.code LIKE ? OR cl.name LIKE ?)`;heldParams.push(like,like,like,like,like,like);}
  heldSql+=` ORDER BY u.name,p.paid_at`;
  const [held]=await db.execute(heldSql,heldParams);
  const [staffBalances]=await db.query(`SELECT COALESCE(u.id,0) user_id,COALESCE(u.name,'Tidak diketahui') collector_name,COUNT(*) transactions,COALESCE(SUM(p.amount),0) amount
    FROM payments p LEFT JOIN users u ON u.id=COALESCE(p.collector_user_id,p.received_by)
    WHERE p.method='cash' AND p.status='confirmed' AND p.settlement_status='held_by_staff' GROUP BY u.id,u.name ORDER BY amount DESC`);
  const [[summary]]=await db.query(`SELECT
    COALESCE(SUM(CASE WHEN method='cash' AND status='confirmed' AND settlement_status='held_by_staff' THEN amount ELSE 0 END),0) held_total,
    COALESCE(SUM(CASE WHEN method='cash' AND status='confirmed' AND settlement_status='settled' AND DATE(settled_at)=CURDATE() THEN amount ELSE 0 END),0) settled_today,
    COALESCE(SUM(CASE WHEN method='transfer' AND status='confirmed' AND DATE(paid_at)=CURDATE() THEN amount ELSE 0 END),0) transfer_today
    FROM payments`);
  const [sites]=await db.query(`SELECT code,name FROM sites WHERE is_active=1 ORDER BY code`);const [clusters]=await db.query(`SELECT cl.id,cl.name,s.code site_code FROM clusters cl JOIN sites s ON s.id=cl.site_id WHERE cl.status!='inactive' ORDER BY s.code,cl.name`);
  res.render('payments/reconciliation',{title:'Rekonsiliasi Pembayaran',held,staffBalances,summary:summary||{},q,site,cluster,sites,clusters});
});

router.post('/:id/settle',requireAdmin,async(req,res)=>{
  const conn=await db.getConnection();
  try{
    await conn.beginTransaction();
    const [rows]=await conn.execute(`SELECT * FROM payments WHERE id=? FOR UPDATE`,[req.params.id]);
    const p=rows[0];if(!p)throw new Error('Pembayaran tidak ditemukan');
    if(p.method!=='cash')throw new Error('Hanya pembayaran cash yang perlu disetor');
    if(p.settlement_status!=='settled'){
      await conn.execute(`UPDATE payments SET settlement_status='settled',settled_by=?,settled_at=NOW() WHERE id=?`,[req.session.user.id,p.id]);
      await postCashTransaction(conn,{paymentId:p.id,invoiceId:p.invoice_id,amount:p.amount,reference:p.reference,categoryName:'Setoran Cash Pelanggan',prefix:'Setoran Cash',actorUserId:req.session.user.id});
    }
    await conn.commit();
    await audit({userId:req.session.user.id,action:'settle',entityType:'payment',entityId:p.id,description:'Konfirmasi setoran cash staff ke kas perusahaan',ip:req.ip});
    req.session.flash={type:'success',message:'Setoran cash dikonfirmasi dan masuk ke kas perusahaan.'};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  res.redirect('/payments/reconciliation');
});

module.exports=router;
