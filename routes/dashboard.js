const express = require('express');
const db = require('../config/db');
const router = express.Router();

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

router.get('/', async (req, res) => {
  const now = new Date();
  const selectedMonth = safeInt(req.query.month, now.getMonth() + 1, 1, 12);
  const selectedYear = safeInt(req.query.year, now.getFullYear(), 2020, 2100);
  const selectedSiteCode = String(req.query.site || '').trim().toUpperCase();

  const [siteOptions] = await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  const selectedSite = selectedSiteCode ? siteOptions.find(s => s.code === selectedSiteCode) : null;
  const siteId = selectedSite?.id || null;
  const customerScope = siteId ? ` AND c.site_id=?` : '';
  const customerParams = siteId ? [siteId] : [];

  const [[customer]] = await db.execute(`SELECT COUNT(*) total FROM customers c WHERE c.customer_status='active'${customerScope}`,customerParams);
  const [[revenue]] = await db.execute(`SELECT COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.status='confirmed' AND YEAR(p.paid_at)=? AND MONTH(p.paid_at)=?${customerScope}`,[selectedYear,selectedMonth,...customerParams]);
  const [[billed]] = await db.execute(`SELECT COUNT(*) count,COALESCE(SUM(i.total),0) total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.period_year=? AND i.period_month=? AND i.status NOT IN ('cancelled','refunded')${customerScope}`,[selectedYear,selectedMonth,...customerParams]);
  const [[unpaid]] = await db.execute(`SELECT COUNT(*) count,COALESCE(SUM(i.outstanding),0) total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.period_year=? AND i.period_month=? AND i.status IN ('unpaid','partial','overdue') AND i.outstanding>0${customerScope}`,[selectedYear,selectedMonth,...customerParams]);
  const [[newCustomers]] = await db.execute(`SELECT COUNT(*) total FROM customers c WHERE YEAR(COALESCE(c.activation_date,DATE(c.created_at)))=? AND MONTH(COALESCE(c.activation_date,DATE(c.created_at)))=?${customerScope}`,[selectedYear,selectedMonth,...customerParams]);
  const [[network]] = await db.execute(`SELECT SUM(c.network_status='online') online,SUM(c.network_status='offline') offline,SUM(c.network_status='isolated') isolated,SUM(c.network_status='router_unreachable') unreachable FROM customers c WHERE c.customer_status='active'${customerScope}`,customerParams);

  const [[routerNoc]] = await db.execute(`SELECT COUNT(*) routers_total,SUM(last_status='online') routers_online FROM routers WHERE is_active=1${siteId?' AND site_id=?':''}`,customerParams);
  const [[ticketNoc]] = await db.execute(`SELECT COUNT(*) tickets_open FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id WHERE t.status IN ('open','progress','pending')${siteId?' AND c.site_id=?':''}`,customerParams);
  const [[cashHeldNoc]] = await db.execute(`SELECT COALESCE(SUM(p.amount),0) cash_held FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.method='cash' AND p.status='confirmed' AND p.settlement_status='held_by_staff'${customerScope}`,customerParams);
  const [[overdueNoc]] = await db.execute(`SELECT COUNT(DISTINCT i.customer_id) overdue_customers FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='overdue' AND i.outstanding>0${customerScope}`,customerParams);
  const noc={...routerNoc,...ticketNoc,...cashHeldNoc,...overdueNoc};

  const [monthlyInvoiceRows]=await db.execute(`SELECT i.period_month month_no,COALESCE(SUM(i.total),0) total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.period_year=? AND i.status NOT IN ('cancelled','refunded')${customerScope} GROUP BY i.period_month ORDER BY i.period_month`,[selectedYear,...customerParams]);
  const [monthlyPaymentRows]=await db.execute(`SELECT MONTH(p.paid_at) month_no,COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.status='confirmed' AND YEAR(p.paid_at)=?${customerScope} GROUP BY MONTH(p.paid_at) ORDER BY MONTH(p.paid_at)`,[selectedYear,...customerParams]);
  const [recent]=await db.execute(`SELECT i.id,i.invoice_number,i.total,i.outstanding,i.status,c.name customer_name,s.code site_code,cl.name cluster_name FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE 1=1${customerScope} ORDER BY i.id DESC LIMIT 6`,customerParams);

  const monthLabels=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const monthlyInvoices=Array(12).fill(0),monthlyPayments=Array(12).fill(0);
  monthlyInvoiceRows.forEach(r=>{monthlyInvoices[Number(r.month_no)-1]=Number(r.total||0)});
  monthlyPaymentRows.forEach(r=>{monthlyPayments[Number(r.month_no)-1]=Number(r.total||0)});
  const collectionRate=Number(billed.total)>0?Math.min(100,Math.round((Number(revenue.total)/Number(billed.total))*100)):0;
  const routerRate=Number(noc.routers_total)>0?Math.round(Number(noc.routers_online||0)/Number(noc.routers_total)*100):100;
  const years=Array.from({length:5},(_,i)=>now.getFullYear()-2+i);if(!years.includes(selectedYear))years.push(selectedYear);years.sort((a,b)=>a-b);

  res.render('dashboard/index',{
    title:'Dashboard',customer,revenue,billed,unpaid,newCustomers,network,noc,recent,siteOptions,
    selectedSiteCode:selectedSite?.code||'',selectedSiteName:selectedSite?.name||'Semua Site',collectionRate,routerRate,
    selectedMonth,selectedYear,years,monthly:{labels:monthLabels,invoices:monthlyInvoices,payments:monthlyPayments}
  });
});
module.exports=router;
