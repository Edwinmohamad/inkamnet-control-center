const express=require('express');
const db=require('../config/db');
const { generateMonthlyInvoices }=require('../services/invoiceService');
const { requireAdmin }=require('../middleware/auth');
const { createCorporateInvoicePdf }=require('../services/reportPdf');
const router=express.Router();

const MONTH_NAMES=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function intInRange(value,min,max,fallback){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
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
  if(filters.customer) p.set('customer',filters.customer);
  if(filters.q) p.set('q',filters.q);
  return p.toString();
}

router.get('/',async(req,res)=>{
  await db.query(`UPDATE invoices SET status='overdue' WHERE status IN ('unpaid','partial') AND due_date < CURDATE()`);
  const now=new Date();
  const month=intInRange(req.query.month,1,12,now.getMonth()+1);
  const year=intInRange(req.query.year,2020,2100,now.getFullYear());
  const status=['unpaid','partial','paid','overdue','cancelled','refunded'].includes(req.query.status)?req.query.status:'';
  const site=String(req.query.site||'').trim();
  const customer=String(req.query.customer||'').trim();
  const q=String(req.query.q||'').trim();

  const commonWhere=['i.period_year=?','i.period_month=?'];
  const commonParams=[year,month];
  if(site){commonWhere.push('s.code=?');commonParams.push(site);}
  if(customer){commonWhere.push('c.id=?');commonParams.push(Number(customer));}

  const listWhere=[...commonWhere];
  const listParams=[...commonParams];
  if(status){listWhere.push('i.status=?');listParams.push(status);}
  if(q){listWhere.push('(c.name LIKE ? OR c.customer_code LIKE ? OR i.invoice_number LIKE ? OR s.code LIKE ? OR cl.name LIKE ?)');const like=`%${q}%`;listParams.push(like,like,like,like,like);}

  const [invoices]=await db.execute(`SELECT i.*,c.customer_code,c.name customer_name,c.phone,c.due_day,p.name package_name,s.code site_code,cl.name cluster_name
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
  if(customer){customerWhere.push('c.id=?');customerParams.push(Number(customer));}
  const [[activeSummary]]=await db.execute(`SELECT COUNT(*) active_customers FROM customers c JOIN sites s ON s.id=c.site_id WHERE ${customerWhere.join(' AND ')}`,customerParams);

  const [customers]=await db.query(`SELECT c.id,c.customer_code,c.name,s.code site_code,cl.name cluster_name FROM customers c JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE c.customer_status='active' ORDER BY s.code,cl.name,c.name`);
  const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
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
    WHERE i.status IN ('unpaid','partial','overdue') AND i.outstanding>0 ORDER BY s.code,cl.name,c.name,i.due_date`);
  const [staff]=await db.query(`SELECT id,name,role FROM users WHERE is_active=1 ORDER BY name`);
  const filters={month,year,status,site,customer,q};
  res.render('invoices/index',{title:'Tagihan',invoices,summary,customers,sites,openInvoices,staff,filters,monthNames:MONTH_NAMES,periodQueryString:periodQuery(filters)});
});

router.post('/generate',async(req,res)=>{
  const now=new Date();
  const month=intInRange(req.body.month,1,12,now.getMonth()+1);
  const year=intInRange(req.body.year,2020,2100,now.getFullYear());
  const customerId=req.body.customer_id?Number(req.body.customer_id):null;
  const siteCode=String(req.body.site||'').trim()||null;
  const result=await generateMonthlyInvoices(periodDate(year,month),true,req.session.user.id,{customerId,siteCode});
  const target=customerId?'pelanggan terpilih':siteCode?`site ${siteCode}`:'seluruh pelanggan aktif';
  req.session.flash={type:'success',message:`Refresh tagihan ${MONTH_NAMES[month-1]} ${year} untuk ${target}: ${result.created} tagihan baru dibuat. ${result.existingPaid||0} tagihan lunas dipertahankan, ${result.existingOpen||0} tagihan existing dipertahankan, total ${result.skipped} dilewati. Tidak ada tagihan existing yang di-reset.`};
  res.redirect(`/invoices?month=${month}&year=${year}${siteCode?`&site=${encodeURIComponent(siteCode)}`:''}${customerId?`&customer=${customerId}`:''}`);
});


router.get('/:id/pdf',async(req,res)=>{
  const [rows]=await db.execute(`SELECT i.*,c.customer_code,c.name customer_name,c.phone,c.address,p.name package_name,s.code site_code,s.name site_name,cl.name cluster_name FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN packages p ON p.id=c.package_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE i.id=? LIMIT 1`,[req.params.id]);
  if(!rows.length)return res.status(404).send('Tagihan tidak ditemukan.');const x=rows[0];
  const [bankRows]=await db.query(`SELECT bank_name,account_name,account_number FROM banks WHERE is_active=1 ORDER BY id LIMIT 1`);
  const [payments]=await db.execute(`SELECT amount,method,reference,status,paid_at FROM payments WHERE invoice_id=? ORDER BY paid_at`,[req.params.id]);
  createCorporateInvoicePdf(res,{invoice:x,bank:bankRows[0]||null,payments,filename:`invoice-${x.invoice_number.replace(/[^A-Za-z0-9_-]/g,'-')}.pdf`,disposition:req.query.download==='1'?'attachment':'inline'});
});

router.get('/:id/print',async(req,res)=>{
  const [rows]=await db.execute(`SELECT i.*,c.customer_code,c.name customer_name,c.phone,c.address,p.name package_name,p.price package_price,s.code site_code,s.name site_name,cl.name cluster_name
    FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN packages p ON p.id=c.package_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE i.id=? LIMIT 1`,[req.params.id]);
  if(!rows.length) return res.status(404).send('Tagihan tidak ditemukan.');
  const [payments]=await db.execute(`SELECT amount,method,reference,status,paid_at FROM payments WHERE invoice_id=? ORDER BY paid_at`,[req.params.id]);
  const [bankRows]=await db.query(`SELECT bank_name,account_name,account_number,type FROM banks WHERE is_active=1 ORDER BY id LIMIT 1`);
  res.render('invoices/print',{title:`Faktur ${rows[0].invoice_number}`,invoice:rows[0],payments,bank:bankRows[0]||null});
});

router.post('/:id/delete',requireAdmin,async(req,res)=>{
  const [rows]=await db.execute(`SELECT id,period_year,period_month,paid_amount FROM invoices WHERE id=? LIMIT 1`,[req.params.id]);
  if(!rows.length){req.session.flash={type:'danger',message:'Tagihan tidak ditemukan.'};return res.redirect('/invoices');}
  const invoice=rows[0];
  const [[pay]]=await db.execute(`SELECT COUNT(*) total FROM payments WHERE invoice_id=?`,[invoice.id]);
  if(Number(invoice.paid_amount)>0 || Number(pay.total)>0){req.session.flash={type:'danger',message:'Tagihan yang sudah memiliki pembayaran tidak boleh dihapus.'};return res.redirect(`/invoices?month=${invoice.period_month}&year=${invoice.period_year}`);}
  await db.execute(`DELETE FROM invoices WHERE id=?`,[invoice.id]);
  req.session.flash={type:'success',message:'Tagihan belum dibayar berhasil dihapus.'};
  res.redirect(`/invoices?month=${invoice.period_month}&year=${invoice.period_year}`);
});

module.exports=router;
