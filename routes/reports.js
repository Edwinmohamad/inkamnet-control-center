const express=require('express');
const db=require('../config/db');
const { createReportPdf, rupiah, date, COLORS }=require('../services/reportPdf');
const router=express.Router();
const MONTHS=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function n(v,f){const x=Number(v);return Number.isFinite(x)?x:f;}
function iso(v,f){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?String(v):f;}
function common(req){
  const now=new Date();
  const month=Math.max(1,Math.min(12,n(req.query.month,now.getMonth()+1)));
  const year=Math.max(2020,Math.min(2100,n(req.query.year,now.getFullYear())));
  return {
    view:['customers','billing','cash','invoice'].includes(req.query.view)?req.query.view:'customers',
    month,year,site:req.query.site||'',status:req.query.status||'',package:req.query.package||'',customer:req.query.customer||'',
    category:req.query.category||'',flow_type:req.query.flow_type||'',method:req.query.method||'',q:String(req.query.q||'').trim(),
    from:iso(req.query.from,new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10)),
    to:iso(req.query.to,now.toISOString().slice(0,10))
  };
}

async function baseOptions(){
  const [sites]=await db.query(`SELECT code,name FROM sites WHERE is_active=1 ORDER BY code`);
  const [packages]=await db.query(`SELECT p.id,p.name,p.site_id,s.code site_code FROM packages p LEFT JOIN sites s ON s.id=p.site_id WHERE p.is_active=1 ORDER BY COALESCE(s.code,'ZZZ'),p.price,p.name`);
  const [customers]=await db.query(`SELECT c.id,c.customer_code,c.name,s.code site_code,cl.name cluster_name FROM customers c JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE c.customer_status!='terminated' ORDER BY s.code,cl.name,c.name`);
  const [categories]=await db.query(`SELECT id,name,type FROM cash_categories WHERE is_active=1 AND COALESCE(is_system,0)=0 ORDER BY type,name`);
  return{sites,packages,customers,categories};
}

async function customerReport(f){
  const where=['1=1'],p=[];
  if(f.site){where.push('s.code=?');p.push(f.site);}
  if(f.package){where.push('p.id=?');p.push(f.package);}
  if(f.status){where.push('c.customer_status=?');p.push(f.status);}
  if(f.q){const like=`%${f.q}%`;where.push('(c.name LIKE ? OR c.customer_code LIKE ? OR s.code LIKE ? OR cl.name LIKE ?)');p.push(like,like,like,like);}
  const [rows]=await db.execute(`SELECT c.customer_code,c.name,c.phone,c.email,c.address,s.code site_code,cl.name cluster_name,p.name package_name,p.price,c.customer_status,c.billing_status,c.activation_date FROM customers c JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id JOIN packages p ON p.id=c.package_id WHERE ${where.join(' AND ')} ORDER BY s.code,cl.name,c.name`,p);
  return rows;
}

async function billingReport(f){
  const where=['i.period_month=?','i.period_year=?'],p=[f.month,f.year];
  if(f.site){where.push('s.code=?');p.push(f.site);}
  if(f.package){where.push('pk.id=?');p.push(f.package);}
  if(f.status){where.push('i.status=?');p.push(f.status);}
  if(f.customer){where.push('c.id=?');p.push(f.customer);}
  if(f.q){const like=`%${f.q}%`;where.push('(c.name LIKE ? OR c.customer_code LIKE ? OR i.invoice_number LIKE ? OR s.code LIKE ? OR cl.name LIKE ?)');p.push(like,like,like,like,like);}
  const [rows]=await db.execute(`SELECT i.id,i.invoice_number,c.customer_code,c.name customer_name,s.code site_code,cl.name cluster_name,pk.name package_name,i.due_date,i.total,i.paid_amount,i.outstanding,i.status FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id JOIN packages pk ON pk.id=c.package_id WHERE ${where.join(' AND ')} ORDER BY s.code,cl.name,c.name`,p);
  return rows;
}

async function cashReport(f){
  const where=['ct.transaction_date BETWEEN ? AND ?'],p=[f.from,f.to];
  if(f.site){where.push('s.code=?');p.push(f.site);}
  if(f.category){where.push('cc.id=?');p.push(f.category);}
  if(f.flow_type){where.push('cc.type=?');p.push(f.flow_type);}
  if(f.method){where.push('p.method=?');p.push(f.method);}
  const [rows]=await db.execute(`SELECT ct.transaction_date,ct.name,cc.name category,cc.type,s.code site_code,ct.amount,ct.notes,ct.source_type,p.method FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id LEFT JOIN sites s ON s.id=ct.site_id LEFT JOIN payments p ON ct.source_type='payment' AND p.id=ct.source_id WHERE ${where.join(' AND ')} ORDER BY ct.transaction_date DESC,ct.id DESC`,p);
  return rows;
}

router.get('/',async(req,res)=>{
  const filters=common(req),opts=await baseOptions();
  const customerRows=await customerReport(filters),billingRows=await billingReport(filters),cashRows=await cashReport(filters);
  const invoiceRows=billingRows;
  const summary={
    customers:customerRows.length,
    active:customerRows.filter(x=>x.customer_status==='active').length,
    billed:billingRows.reduce((a,x)=>a+Number(x.total||0),0),
    paid:billingRows.reduce((a,x)=>a+Number(x.paid_amount||0),0),
    outstanding:billingRows.reduce((a,x)=>a+Number(x.outstanding||0),0),
    income:cashRows.filter(x=>x.type==='income').reduce((a,x)=>a+Number(x.amount||0),0),
    expense:cashRows.filter(x=>x.type==='expense').reduce((a,x)=>a+Number(x.amount||0),0)
  };
  summary.balance=summary.income-summary.expense;
  res.render('reports/index',{title:'Laporan',filters,...opts,customerRows,billingRows,cashRows,invoiceRows,summary,monthNames:MONTHS});
});

router.get('/pdf',async(req,res)=>{
  const f=common(req);
  const type=['customers','billing','cash','invoice'].includes(req.query.type)?req.query.type:f.view;
  let rows=[],columns=[],summaryItems=[],title='',subtitle='',filename='laporan-INKAMNET.pdf';

  if(type==='customers'){
    rows=await customerReport(f);
    title='LAPORAN PELANGGAN';
    subtitle=`Scope: ${f.site||'Semua Site'} | ${rows.length} pelanggan${f.status?` | Status ${f.status}`:''}`;
    filename=`laporan-pelanggan-INKAMNET-${new Date().toISOString().slice(0,10)}.pdf`;
    summaryItems=[
      {label:'TOTAL PELANGGAN',value:rows.length,color:COLORS.purple},
      {label:'AKTIF',value:rows.filter(x=>x.customer_status==='active').length,color:COLORS.green},
      {label:'SUSPENDED',value:rows.filter(x=>x.customer_status==='suspended').length,color:COLORS.red}
    ];
    columns=[
      {label:'Customer ID',width:1.15,key:'customer_code',bold:true},
      {label:'Nama Pelanggan',width:1.8,key:'name'},
      {label:'Site / Cluster',width:1.15,value:r=>`${r.site_code} / ${r.cluster_name||'-'}`},
      {label:'Paket',width:1.25,key:'package_name'},
      {label:'WhatsApp',width:1.1,key:'phone'},
      {label:'Status',width:.85,value:r=>String(r.customer_status).toUpperCase()}
    ];
  } else if(type==='cash'){
    rows=await cashReport(f);
    const income=rows.filter(x=>x.type==='income').reduce((a,x)=>a+Number(x.amount||0),0);
    const expense=rows.filter(x=>x.type==='expense').reduce((a,x)=>a+Number(x.amount||0),0);
    title='LAPORAN ARUS KAS';
    subtitle=`Periode ${date(f.from)} s/d ${date(f.to)} | ${f.site||'Semua Site'}`;
    filename=`laporan-arus-kas-INKAMNET-${f.from}-sd-${f.to}.pdf`;
    summaryItems=[
      {label:'PENDAPATAN',value:rupiah(income),color:COLORS.green},
      {label:'PENGELUARAN',value:rupiah(expense),color:COLORS.red},
      {label:'SALDO',value:rupiah(income-expense),color:income-expense>=0?COLORS.purple:COLORS.red},
      {label:'TRANSAKSI',value:rows.length,color:COLORS.blue}
    ];
    columns=[
      {label:'Tanggal',width:1,value:r=>date(r.transaction_date)},
      {label:'Nama / Deskripsi',width:1.8,key:'name'},
      {label:'Kategori',width:1.3,key:'category'},
      {label:'Site',width:.7,value:r=>r.site_code||'GLOBAL'},
      {label:'Jenis',width:.8,value:r=>r.type==='income'?'MASUK':'KELUAR'},
      {label:'Nominal',width:1.2,value:r=>rupiah(r.amount),bold:true,align:'right'}
    ];
  } else {
    rows=await billingReport(f);
    const billed=rows.reduce((a,x)=>a+Number(x.total||0),0);
    const paid=rows.reduce((a,x)=>a+Number(x.paid_amount||0),0);
    const out=rows.reduce((a,x)=>a+Number(x.outstanding||0),0);
    title=type==='invoice'?'REGISTER FAKTUR / INVOICE':'LAPORAN TAGIHAN';
    subtitle=`Periode ${MONTHS[f.month-1]} ${f.year} | ${f.site||'Semua Site'}${f.status?` | Status ${f.status}`:''}`;
    filename=`${type==='invoice'?'register-faktur':'laporan-tagihan'}-INKAMNET-${f.year}-${String(f.month).padStart(2,'0')}.pdf`;
    summaryItems=[
      {label:'TOTAL TAGIHAN',value:rupiah(billed),color:COLORS.purple},
      {label:'TERBAYAR',value:rupiah(paid),color:COLORS.green},
      {label:'OUTSTANDING',value:rupiah(out),color:COLORS.red},
      {label:'JUMLAH INVOICE',value:rows.length,color:COLORS.blue}
    ];
    columns=[
      {label:'Invoice',width:1.35,key:'invoice_number',bold:true},
      {label:'Pelanggan',width:1.65,key:'customer_name'},
      {label:'Site / Cluster',width:1,value:r=>`${r.site_code} / ${r.cluster_name||'-'}`},
      {label:'Jatuh Tempo',width:1,value:r=>date(r.due_date)},
      {label:'Tagihan',width:1.05,value:r=>rupiah(r.total),align:'right'},
      {label:'Sisa',width:1.05,value:r=>rupiah(r.outstanding),bold:true,align:'right'},
      {label:'Status',width:.85,value:r=>String(r.status).toUpperCase()}
    ];
  }

  createReportPdf(res,{title,subtitle,filename,summaryItems,columns,rows,layout:'landscape'});
});

module.exports=router;
