const express=require('express');
const db=require('../config/db');
const router=express.Router();

router.get('/',async(req,res)=>{
  const now=new Date();const month=Number(req.query.month||now.getMonth()+1),year=Number(req.query.year||now.getFullYear()),site=req.query.site||'';
  const siteClause=site?` AND s.code=?`:'';const siteParams=site?[site]:[];
  const [[billing]]=await db.execute(`SELECT COUNT(*) invoices,COALESCE(SUM(i.total),0) billed,COALESCE(SUM(i.paid_amount),0) paid,COALESCE(SUM(i.outstanding),0) outstanding FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id WHERE i.period_month=? AND i.period_year=?${siteClause}`,[month,year,...siteParams]);
  const [[cash]]=await db.execute(`SELECT COALESCE(SUM(CASE WHEN cc.type='income' THEN ct.amount ELSE 0 END),0) income,COALESCE(SUM(CASE WHEN cc.type='expense' THEN ct.amount ELSE 0 END),0) expense FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id LEFT JOIN sites s ON s.id=ct.site_id WHERE MONTH(ct.transaction_date)=? AND YEAR(ct.transaction_date)=?${site?` AND s.code=?`:''}`,[month,year,...siteParams]);
  cash.balance=Number(cash.income)-Number(cash.expense);
  const [[collection]]=await db.execute(`SELECT COALESCE(SUM(CASE WHEN p.method='cash' AND p.status='confirmed' AND p.settlement_status='held_by_staff' THEN p.amount ELSE 0 END),0) cash_held,COALESCE(SUM(CASE WHEN p.method='transfer' AND p.status='pending' THEN p.amount ELSE 0 END),0) transfer_pending FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id WHERE MONTH(p.paid_at)=? AND YEAR(p.paid_at)=?${siteClause}`,[month,year,...siteParams]);
  const [aging]=await db.execute(`SELECT s.code site_code,COUNT(*) invoices,SUM(i.outstanding) outstanding FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id WHERE i.status IN ('unpaid','partial','overdue')${siteClause} GROUP BY s.id ORDER BY outstanding DESC`,siteParams);
  const [sites]=await db.query(`SELECT code,name FROM sites WHERE is_active=1 ORDER BY code`);
  const [cashRows]=await db.execute(`SELECT ct.transaction_date,ct.name,cc.name category,cc.type,s.code site_code,ct.amount FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id LEFT JOIN sites s ON s.id=ct.site_id WHERE MONTH(ct.transaction_date)=? AND YEAR(ct.transaction_date)=?${site?` AND s.code=?`:''} ORDER BY ct.transaction_date DESC LIMIT 200`,[month,year,...siteParams]);
  res.render('reports/index',{title:'Laporan',billing,cash,collection,aging,cashRows,sites,filters:{month,year,site}});
});

router.get('/csv',async(req,res)=>{
  const now=new Date();const month=Number(req.query.month||now.getMonth()+1),year=Number(req.query.year||now.getFullYear()),site=req.query.site||'',type=req.query.type||'billing';
  const params=[month,year];let sql='',headers=[],filename=`laporan-${type}-${year}-${String(month).padStart(2,'0')}${site?'-'+site:''}.csv`;
  if(type==='income'||type==='expense'){
    sql=`SELECT ct.transaction_date tanggal,ct.name nama,cc.name kategori,s.code site,ct.amount nominal,ct.notes catatan FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id LEFT JOIN sites s ON s.id=ct.site_id WHERE MONTH(ct.transaction_date)=? AND YEAR(ct.transaction_date)=? AND cc.type=?`;params.push(type);if(site){sql+=` AND s.code=?`;params.push(site);}sql+=` ORDER BY ct.transaction_date,ct.id`;headers=['Tanggal','Nama','Kategori','Site','Nominal','Catatan'];
  }else if(type==='payments'){
    sql=`SELECT p.paid_at tanggal,c.customer_code customer_id,c.name pelanggan,s.code site,i.invoice_number invoice,p.amount nominal,p.method metode,p.status status,p.settlement_status settlement,u.name diterima_oleh FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN users u ON u.id=COALESCE(p.collector_user_id,p.received_by) WHERE MONTH(p.paid_at)=? AND YEAR(p.paid_at)=?`;if(site){sql+=` AND s.code=?`;params.push(site);}sql+=` ORDER BY p.paid_at,p.id`;headers=['Tanggal','Customer ID','Pelanggan','Site','Invoice','Nominal','Metode','Status','Settlement','Diterima Oleh'];
  }else{
    sql=`SELECT i.invoice_number invoice,c.customer_code customer_id,c.name pelanggan,s.code site,i.due_date jatuh_tempo,i.total tagihan,i.paid_amount dibayar,i.outstanding outstanding,i.status status FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id WHERE i.period_month=? AND i.period_year=?`;if(site){sql+=` AND s.code=?`;params.push(site);}sql+=` ORDER BY s.code,c.name`;headers=['Invoice','Customer ID','Pelanggan','Site','Jatuh Tempo','Tagihan','Dibayar','Outstanding','Status'];
  }
  const [rows]=await db.execute(sql,params);const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;const lines=[headers.map(esc).join(',')];rows.forEach(r=>lines.push(Object.values(r).map(esc).join(',')));res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);res.send('\ufeff'+lines.join('\n'));
});
module.exports=router;
