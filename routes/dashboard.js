const express = require('express');
const db = require('../config/db');
const router = express.Router();

function safeInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}
function isoDate(d){
  const x=new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
}
function currentWeekRange(){
  const now=new Date();
  const day=now.getDay()||7;
  const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-day+1);
  const end=new Date(start);end.setDate(end.getDate()+6);
  return {start:isoDate(start),end:isoDate(end)};
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

  const [[customerStats]] = await db.execute(`SELECT
    COUNT(*) total,
    SUM(c.customer_status='active') active,
    SUM(c.customer_status<>'active') inactive,
    SUM(c.network_status='isolated') isolated
    FROM customers c WHERE 1=1${customerScope}`, customerParams);
  const customer={total:Number(customerStats.total||0),active:Number(customerStats.active||0),inactive:Number(customerStats.inactive||0),isolated:Number(customerStats.isolated||0)};

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

  const [siteCustomerRows]=await db.query(`SELECT s.id,s.code,s.name,
    COUNT(c.id) total,
    COALESCE(SUM(c.customer_status='active'),0) active,
    COALESCE(SUM(c.customer_status<>'active'),0) inactive,
    COALESCE(SUM(c.network_status='isolated'),0) isolated
    FROM sites s LEFT JOIN customers c ON c.site_id=s.id
    WHERE s.is_active=1
    GROUP BY s.id,s.code,s.name ORDER BY s.code`);

  const [monthlyPsbRows]=await db.execute(`SELECT MONTH(COALESCE(c.activation_date,DATE(c.created_at))) month_no,COUNT(*) total
    FROM customers c
    WHERE YEAR(COALESCE(c.activation_date,DATE(c.created_at)))=?${customerScope}
    GROUP BY MONTH(COALESCE(c.activation_date,DATE(c.created_at))) ORDER BY month_no`,[selectedYear,...customerParams]);

  const [monthlyInvoiceRows]=await db.execute(`SELECT i.period_month month_no,COALESCE(SUM(i.total),0) total FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.period_year=? AND i.status NOT IN ('cancelled','refunded')${customerScope} GROUP BY i.period_month ORDER BY i.period_month`,[selectedYear,...customerParams]);
  const [monthlyPaymentRows]=await db.execute(`SELECT MONTH(p.paid_at) month_no,COALESCE(SUM(p.amount),0) total FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.status='confirmed' AND YEAR(p.paid_at)=?${customerScope} GROUP BY MONTH(p.paid_at) ORDER BY MONTH(p.paid_at)`,[selectedYear,...customerParams]);
  const [recent]=await db.execute(`SELECT i.id,i.invoice_number,i.total,i.outstanding,i.status,c.name customer_name,s.code site_code,cl.name cluster_name FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id LEFT JOIN clusters cl ON cl.id=c.cluster_id WHERE 1=1${customerScope} ORDER BY i.id DESC LIMIT 6`,customerParams);

  const week=currentWeekRange();
  const [weekDuty]=await db.execute(`SELECT d.id,d.duty_date,DATE_FORMAT(d.duty_date,'%Y-%m-%d') duty_date_key,d.staff_name,d.shift_name,d.status,d.proof_path,s.code site_code
    FROM server_duty_schedules d LEFT JOIN sites s ON s.id=d.site_id
    WHERE d.duty_date BETWEEN ? AND ?
    ORDER BY d.duty_date,COALESCE(d.start_time,'23:59:59'),d.staff_name`,[week.start,week.end]);

  const monthLabels=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const monthlyInvoices=Array(12).fill(0),monthlyPayments=Array(12).fill(0),monthlyPsb=Array(12).fill(0);
  monthlyInvoiceRows.forEach(r=>{monthlyInvoices[Number(r.month_no)-1]=Number(r.total||0)});
  monthlyPaymentRows.forEach(r=>{monthlyPayments[Number(r.month_no)-1]=Number(r.total||0)});
  monthlyPsbRows.forEach(r=>{monthlyPsb[Number(r.month_no)-1]=Number(r.total||0)});
  const collectionRate=Number(billed.total)>0?Math.min(100,Math.round((Number(revenue.total)/Number(billed.total))*100)):0;
  const routerRate=Number(noc.routers_total)>0?Math.round(Number(noc.routers_online||0)/Number(noc.routers_total)*100):100;
  const years=Array.from({length:5},(_,i)=>now.getFullYear()-2+i);if(!years.includes(selectedYear))years.push(selectedYear);years.sort((a,b)=>a-b);

  res.render('dashboard/index',{
    title:'Dashboard',customer,revenue,billed,unpaid,newCustomers,network,noc,recent,siteOptions,siteCustomerRows,weekDuty,week,
    selectedSiteCode:selectedSite?.code||'',selectedSiteName:selectedSite?.name||'Semua Site',collectionRate,routerRate,
    selectedMonth,selectedYear,years,
    monthly:{labels:monthLabels,invoices:monthlyInvoices,payments:monthlyPayments,psb:monthlyPsb}
  });
});
module.exports=router;
