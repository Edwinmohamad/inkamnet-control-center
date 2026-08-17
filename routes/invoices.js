const express=require('express');
const fs=require('fs');
const path=require('path');
const db=require('../config/db');
const { generateMonthlyInvoices }=require('../services/invoiceService');
const { requireAdmin }=require('../middleware/auth');
const { createCorporateInvoicePdf }=require('../services/reportPdf');
const { audit }=require('../services/auditService');
const router=express.Router();
const invoiceLogoDir=path.join(__dirname,'..','storage','invoice-branding');

const MONTH_NAMES=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function intInRange(value,min,max,fallback){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
function localReturn(value,fallback='/invoices'){const v=String(value||'').trim();return v.startsWith('/')&&!v.startsWith('//')?v:fallback;}
function periodDate(year,month){
  const now=new Date();
  const day=(now.getFullYear()===year && now.getMonth()+1===month)?now.getDate():1;
  return new Date(year,month-1,day);
}
function periodQuery(filters){
  const p=new URLSearchParams();
  p.set('month',filters.month);p.set('year',filters.year);
  if(filters.status) p.set('status',filters.status);
  if(filters.site) p.set('site',filters.site);
  if(filters.cluster) p.set('cluster',filters.cluster);
  if(filters.customer) p.set('customer',filters.customer);
  if(filters.q) p.set('q',filters.q);
  return p.toString();
}
async function loadInvoiceBranding(){
  const [[s]]=await db.query(`SELECT company_name,company_address,company_phone,company_email,company_website,company_tagline,invoice_company_name,invoice_address,invoice_phone,invoice_email,invoice_website,invoice_tax_id,invoice_footer,invoice_logo_path FROM settings WHERE id=1`);
  const configuredCompany=String(s?.invoice_company_name||s?.company_name||'PT INKAMNET NEXERA TECHNOLOGY').trim();
  const branding={
    companyName:/^PT(?:\.|\s)/i.test(configuredCompany)?configuredCompany:`PT ${configuredCompany}`,
    address:s?.invoice_address||s?.company_address||'',phone:s?.invoice_phone||s?.company_phone||'',email:s?.invoice_email||s?.company_email||'',website:s?.invoice_website||s?.company_website||'',
    taxId:s?.invoice_tax_id||'',footer:s?.invoice_footer||'Dokumen digital resmi. Tidak memerlukan tanda tangan basah.',tagline:s?.company_tagline||'From the Village, Online Everywhere',logoPath:s?.invoice_logo_path||null
  };
  branding.logoFilePath=branding.logoPath?path.join(invoiceLogoDir,path.basename(branding.logoPath)):null;
  if(branding.logoFilePath&&!fs.existsSync(branding.logoFilePath)){branding.logoFilePath=null;branding.logoPath=null;}
  return branding;
}

router.get('/',async(req,res)=>{
  await db.query(`UPDATE invoices SET status='overdue' WHERE status IN ('unpaid','partial') AND due_date < CURDATE()`);
  const now=new Date();
  const month=intInRange(req.query.month,1,12,now.getMonth()+1);
  const year=intInRange(req.query.year,2020,2100,now.getFullYear());
  const status=['open','unpaid','partial','paid','overdue','cancelled','refunded'].includes(req.query.status)?req.query.status:'';
  const site=String(req.query.site||'').trim();
  const cluster=String(req.query.cluster||'').trim();
  const customer=String(req.query.customer||'').trim();
  const q=String(req.query.q||'').trim();

  const commonWhere=['i.period_year=?','i.period_month=?'];
  const commonParams=[year,month];
  if(site){commonWhere.push('s.code=?');commonParams.push(site);}
  if(cluster){commonWhere.push('c.cluster_id=?');commonParams.push(Number(cluster));}
  if(customer){commonWhere.push('c.id=?');commonParams.push(Number(customer));}

  const listWhere=[...commonWhere];
  const listParams=[...commonParams];
  if(status==='open') listWhere.push("i.status IN ('unpaid','partial','overdue')");
  else if(status){listWhere.push('i.status=?');listParams.push(status);}
  if(q){listWhere.push('(c.name LIKE ? OR c.customer_code LIKE ? OR i.invoice_number LIKE ? OR s.code LIKE ? OR cl.name LIKE ?)');const like=`%${q}%`;listParams.push(like,like,like,like,like);}

  const [invoices]=await db.execute(`SELECT i.*,DATE_FORMAT(i.invoice_date,'%Y-%m-%d') invoice_date_key,DATE_FORMAT(i.due_date,'%Y-%m-%d') due_date_key,GREATEST(DATEDIFF(CURDATE(),i.due_date),0) days_overdue,c.customer_code,c.name customer_name,c.phone,c.whatsapp_status,c.due_day,p.name package_name,s.code site_code,cl.name cluster_name,
      (SELECT COUNT(*) FROM payments px WHERE px.invoice_id=i.id) payment_count,
      (SELECT COUNT(*) FROM payments pa WHERE pa.invoice_id=i.id AND pa.status IN ('confirmed','pending')) active_payment_count
    FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN packages p ON p.id=c.package_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id
    WHERE ${listWhere.join(' AND ')} ORDER BY i.due_date ASC,c.name ASC`,listParams);

  const [[invoiceSummary]]=await db.execute(`SELECT
      COUNT(*) total_invoices,
      SUM(i.status='paid') paid_count,
      SUM(i.status IN ('unpaid','partial','overdue')) unpaid_count,
      COALESCE(SUM(i.paid_amount),0) paid_amount,
      COALESCE(SUM(i.outstanding),0) outstanding_amount
    FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id
    WHERE ${commonWhere.join(' AND ')}`,commonParams);

  const customerWhere=[`c.customer_status='active'`];
  const customerParams=[];
  if(site){customerWhere.push('s.code=?');customerParams.push(site);}
  if(cluster){customerWhere.push('c.cluster_id=?');customerParams.push(Number(cluster));}
  if(customer){customerWhere.push('c.id=?');customerParams.push(Number(customer));}
  const [[activeSummary]]=await db.execute(`SELECT COUNT(*) active_customers FROM customers c JOIN sites s ON s.id=c.site_id WHERE ${customerWhere.join(' AND ')}`,customerParams);

  const [customers]=await db.query(`SELECT c.id,c.customer_code,c.name,s.code site_code,cl.name cluster_name FROM customers c JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE c.customer_status='active' ORDER BY s.code,cl.name,c.name`);
  const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  const [clusters]=await db.query(`SELECT cl.id,cl.name,s.code site_code FROM clusters cl JOIN sites s ON s.id=cl.site_id WHERE cl.status!='inactive' ORDER BY s.code,cl.name`);
  const issued=Number(invoiceSummary.total_invoices||0);
  const active=Number(activeSummary.active_customers||0);
  const summary={
    active,
    total:issued,
    issued,
    notIssued:Math.max(0,active-issued),
    paidCount:Number(invoiceSummary.paid_count||0),
    unpaidCount:Number(invoiceSummary.unpaid_count||0),
    paidAmount:Number(invoiceSummary.paid_amount||0),
    outstanding:Number(invoiceSummary.outstanding_amount||0)
  };
  const [openInvoices]=await db.query(`SELECT i.id,i.invoice_number,i.outstanding,c.customer_code,c.name customer_name,s.code site_code,cl.name cluster_name
    FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id
    WHERE i.status IN ('unpaid','partial','overdue') AND i.outstanding>0 AND NOT EXISTS (SELECT 1 FROM payments pp WHERE pp.invoice_id=i.id AND pp.status='pending') ORDER BY s.code,cl.name,c.name,i.due_date`);
  const [staff]=await db.query(`SELECT id,name,role FROM users WHERE is_active=1 ORDER BY name`);
  const [banks]=await db.query(`SELECT id,bank_name,account_name,account_number,type FROM banks WHERE is_active=1 AND type IN ('bank_transfer','virtual_account','other') ORDER BY bank_name,account_number`);
  const filters={month,year,status,site,cluster,customer,q};
  res.render('invoices/index',{title:'Tagihan',invoices,summary,customers,sites,clusters,openInvoices,staff,banks,filters,monthNames:MONTH_NAMES,periodQueryString:periodQuery(filters)});
});

router.post('/generate',async(req,res)=>{
  const now=new Date();
  const month=intInRange(req.body.month,1,12,now.getMonth()+1);
  const year=intInRange(req.body.year,2020,2100,now.getFullYear());
  const customerId=req.body.customer_id?Number(req.body.customer_id):null;
  const siteCode=String(req.body.site||'').trim()||null;
  const clusterId=req.body.cluster_id?Number(req.body.cluster_id):null;
  const result=await generateMonthlyInvoices(periodDate(year,month),true,req.session.user.id,{customerId,siteCode,clusterId});
  const target=customerId?'pelanggan terpilih':clusterId?`cluster terpilih`:siteCode?`site ${siteCode}`:'seluruh pelanggan aktif';
  req.session.flash={type:'success',message:`Refresh tagihan ${MONTH_NAMES[month-1]} ${year} untuk ${target}: ${result.created} tagihan baru dibuat. ${result.existingPaid||0} tagihan lunas dipertahankan, ${result.existingOpen||0} tagihan existing dipertahankan, total ${result.skipped} dilewati. Tidak ada tagihan existing yang di-reset.`};
  res.redirect(`/invoices?month=${month}&year=${year}${siteCode?`&site=${encodeURIComponent(siteCode)}`:''}${clusterId?`&cluster=${clusterId}`:''}${customerId?`&customer=${customerId}`:''}`);
});


router.get('/branding/logo/:filename',(req,res)=>{
  const safe=path.basename(req.params.filename||'');
  const file=path.join(invoiceLogoDir,safe);
  if(!safe||!fs.existsSync(file))return res.status(404).end();
  res.setHeader('Cache-Control','private, max-age=3600');
  res.sendFile(file);
});

router.get('/:id/pdf',async(req,res)=>{
  const [rows]=await db.execute(`SELECT i.*,c.customer_code,c.name customer_name,c.phone,c.address,p.name package_name,s.code site_code,s.name site_name,cl.name cluster_name FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN packages p ON p.id=c.package_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE i.id=? LIMIT 1`,[req.params.id]);
  if(!rows.length)return res.status(404).send('Tagihan tidak ditemukan.');const x=rows[0];
  const [bankRows]=await db.query(`SELECT bank_name,account_name,account_number FROM banks WHERE is_active=1 ORDER BY id LIMIT 1`);
  const [payments]=await db.execute(`SELECT amount,method,reference,status,paid_at FROM payments WHERE invoice_id=? ORDER BY paid_at`,[req.params.id]);
  const branding=await loadInvoiceBranding();
  createCorporateInvoicePdf(res,{invoice:x,bank:bankRows[0]||null,payments,branding,filename:`invoice-${x.invoice_number.replace(/[^A-Za-z0-9_-]/g,'-')}.pdf`,disposition:req.query.download==='1'?'attachment':'inline'});
});

router.get('/:id/print',async(req,res)=>{
  const [rows]=await db.execute(`SELECT i.*,c.customer_code,c.name customer_name,c.phone,c.address,p.name package_name,p.price package_price,s.code site_code,s.name site_name,cl.name cluster_name
    FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN packages p ON p.id=c.package_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE i.id=? LIMIT 1`,[req.params.id]);
  if(!rows.length) return res.status(404).send('Tagihan tidak ditemukan.');
  const [payments]=await db.execute(`SELECT amount,method,reference,status,paid_at FROM payments WHERE invoice_id=? ORDER BY paid_at`,[req.params.id]);
  const [bankRows]=await db.query(`SELECT bank_name,account_name,account_number,type FROM banks WHERE is_active=1 ORDER BY id LIMIT 1`);
  const branding=await loadInvoiceBranding();
  res.render('invoices/print',{title:`Faktur ${rows[0].invoice_number}`,invoice:rows[0],payments,bank:bankRows[0]||null,branding});
});


router.post('/:id/update-meta',async(req,res)=>{
  const invoiceDate=String(req.body.invoice_date||'').trim();
  const dueDate=String(req.body.due_date||'').trim();
  const isProrata=req.body.is_prorata==='1'?1:0;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)){
    req.session.flash={type:'danger',message:'Tanggal faktur dan jatuh tempo wajib valid.'};
    return res.redirect(localReturn(req.body.return_to,'/invoices'));
  }
  if(new Date(`${dueDate}T00:00:00`)<new Date(`${invoiceDate}T00:00:00`)){
    req.session.flash={type:'danger',message:'Jatuh tempo tidak boleh sebelum tanggal faktur.'};
    return res.redirect(localReturn(req.body.return_to,'/invoices'));
  }
  const [rows]=await db.execute(`SELECT id,invoice_number,period_month,period_year,total,paid_amount,status FROM invoices WHERE id=? LIMIT 1`,[req.params.id]);
  if(!rows.length){req.session.flash={type:'danger',message:'Tagihan tidak ditemukan.'};return res.redirect('/invoices');}
  await db.execute(`UPDATE invoices SET invoice_date=?,due_date=?,is_prorata=?,status=CASE WHEN status='overdue' AND ?>=CURDATE() THEN 'unpaid' WHEN status='unpaid' AND ?<CURDATE() THEN 'overdue' ELSE status END WHERE id=?`,[invoiceDate,dueDate,isProrata,dueDate,dueDate,req.params.id]);
  await audit({userId:req.session.user.id,action:'update',entityType:'invoice',entityId:req.params.id,description:`Edit metadata tagihan ${rows[0].invoice_number}: tanggal ${invoiceDate}, jatuh tempo ${dueDate}, tipe ${isProrata?'prorata':'bulanan'}; nominal tidak diubah`,ip:req.ip});
  req.session.flash={type:'success',message:'Metadata tagihan berhasil diperbarui. Nominal, pembayaran, dan saldo tagihan tidak diubah.'};
  res.redirect(localReturn(req.body.return_to,`/invoices?month=${rows[0].period_month}&year=${rows[0].period_year}`));
});


router.post('/:id/reset-unpaid',requireAdmin,async(req,res)=>{
  const conn=await db.getConnection();
  let invoice=null,reversedTotal=0,reversedCount=0;
  try{
    await conn.beginTransaction();
    const [invoiceRows]=await conn.execute(`SELECT id,invoice_number,period_year,period_month,total,paid_amount,outstanding,status,due_date FROM invoices WHERE id=? FOR UPDATE`,[req.params.id]);
    invoice=invoiceRows[0];
    if(!invoice)throw new Error('Tagihan tidak ditemukan.');
    const [payments]=await conn.execute(`SELECT id,amount,status,method,reference,notes FROM payments WHERE invoice_id=? AND status IN ('confirmed','pending') FOR UPDATE`,[invoice.id]);
    const ids=payments.map(x=>Number(x.id));
    reversedTotal=payments.filter(x=>x.status==='confirmed').reduce((a,x)=>a+Number(x.amount||0),0);
    reversedCount=payments.length;
    if(ids.length){
      const marks=ids.map(()=>'?').join(',');
      await conn.execute(`DELETE FROM cash_transactions WHERE source_type='payment' AND source_id IN (${marks})`,ids);
      const correction=`[KOREKSI ADMIN ${new Date().toISOString().slice(0,19).replace('T',' ')}] Pembayaran dibatalkan agar tagihan kembali belum lunas.`;
      await conn.execute(`UPDATE payments SET status='failed',settlement_status='not_applicable',notes=CONCAT_WS('\\n',NULLIF(notes,''),?) WHERE id IN (${marks})`,[correction,...ids]);
    }
    await conn.execute(`UPDATE invoices SET paid_amount=0,outstanding=total,status=CASE WHEN due_date<CURDATE() THEN 'overdue' ELSE 'unpaid' END WHERE id=?`,[invoice.id]);
    await conn.commit();
    await audit({userId:req.session.user.id,action:'financial_correction',entityType:'invoice',entityId:invoice.id,description:`Koreksi tagihan ${invoice.invoice_number} menjadi belum lunas. ${reversedCount} transaksi pembayaran dibatalkan, pendapatan terkonfirmasi dikurangi Rp${reversedTotal}. Nominal tagihan tetap Rp${Number(invoice.total||0)}.`,ip:req.ip});
    req.session.flash={type:'success',message:`Tagihan ${invoice.invoice_number} dikoreksi menjadi belum lunas. ${reversedCount} transaksi pembayaran terkait dibatalkan dan pendapatan otomatis dikurangi Rp${reversedTotal.toLocaleString('id-ID')}.`};
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  res.redirect(localReturn(req.body.return_to,invoice?`/invoices?month=${invoice.period_month}&year=${invoice.period_year}`:'/invoices'));
});

router.post('/:id/cancel',requireAdmin,async(req,res)=>{
  const [rows]=await db.execute(`SELECT id,invoice_number,period_year,period_month,status,paid_amount,outstanding FROM invoices WHERE id=? LIMIT 1`,[req.params.id]);
  if(!rows.length){req.session.flash={type:'danger',message:'Tagihan tidak ditemukan.'};return res.redirect('/invoices');}
  const invoice=rows[0];
  const [[active]]=await db.execute(`SELECT COUNT(*) total FROM payments WHERE invoice_id=? AND status IN ('confirmed','pending')`,[invoice.id]);
  if(Number(active.total)>0 || Number(invoice.paid_amount)>0){
    req.session.flash={type:'warning',message:'Tagihan masih memiliki pembayaran aktif. Gunakan “Jadikan Belum Lunas” terlebih dahulu agar pembayaran dan pendapatan dikoreksi secara aman.'};
    return res.redirect(localReturn(req.body.return_to,`/invoices?month=${invoice.period_month}&year=${invoice.period_year}`));
  }
  await db.execute(`UPDATE invoices SET status='cancelled',paid_amount=0,outstanding=0 WHERE id=?`,[invoice.id]);
  await audit({userId:req.session.user.id,action:'cancel',entityType:'invoice',entityId:invoice.id,description:`Tagihan ${invoice.invoice_number} dibatalkan. Histori pembayaran lama dipertahankan untuk audit; tagihan tidak lagi dihitung sebagai outstanding.`,ip:req.ip});
  req.session.flash={type:'success',message:`Tagihan ${invoice.invoice_number} dibatalkan. Histori transaksi tetap disimpan untuk audit.`};
  res.redirect(localReturn(req.body.return_to,`/invoices?month=${invoice.period_month}&year=${invoice.period_year}`));
});

router.post('/:id/delete',requireAdmin,async(req,res)=>{
  const [rows]=await db.execute(`SELECT id,period_year,period_month,paid_amount FROM invoices WHERE id=? LIMIT 1`,[req.params.id]);
  if(!rows.length){req.session.flash={type:'danger',message:'Tagihan tidak ditemukan.'};return res.redirect('/invoices');}
  const invoice=rows[0];
  const [[pay]]=await db.execute(`SELECT COUNT(*) total FROM payments WHERE invoice_id=?`,[invoice.id]);
  if(Number(invoice.paid_amount)>0 || Number(pay.total)>0){req.session.flash={type:'danger',message:'Tagihan yang sudah memiliki pembayaran tidak boleh dihapus.'};return res.redirect(`/invoices?month=${invoice.period_month}&year=${invoice.period_year}`);}
  await db.execute(`DELETE FROM invoices WHERE id=?`,[invoice.id]);
  await audit({userId:req.session.user.id,action:'delete',entityType:'invoice',entityId:invoice.id,description:`Tagihan tanpa histori pembayaran dihapus permanen. Periode ${invoice.period_month}/${invoice.period_year}.`,ip:req.ip});
  req.session.flash={type:'success',message:'Tagihan yang belum pernah memiliki pembayaran berhasil dihapus permanen.'};
  res.redirect(localReturn(req.body.return_to,`/invoices?month=${invoice.period_month}&year=${invoice.period_year}`));
});

module.exports=router;
