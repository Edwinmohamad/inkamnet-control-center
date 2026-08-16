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

  const [[customer]] = await db.execute(`
    SELECT COUNT(*) total FROM customers c
    WHERE c.customer_status='active'${customerScope}
  `, customerParams);

  const [[revenue]] = await db.execute(`
    SELECT COALESCE(SUM(p.amount),0) total
    FROM payments p
    JOIN invoices i ON i.id=p.invoice_id
    JOIN customers c ON c.id=i.customer_id
    WHERE p.status='confirmed' AND YEAR(p.paid_at)=? AND MONTH(p.paid_at)=?${customerScope}
  `, [selectedYear, selectedMonth, ...customerParams]);

  const [[billed]] = await db.execute(`
    SELECT COUNT(*) count, COALESCE(SUM(i.total),0) total
    FROM invoices i JOIN customers c ON c.id=i.customer_id
    WHERE i.period_year=? AND i.period_month=? AND i.status NOT IN ('cancelled','refunded')${customerScope}
  `, [selectedYear, selectedMonth, ...customerParams]);

  const [[unpaid]] = await db.execute(`
    SELECT COUNT(*) count, COALESCE(SUM(i.outstanding),0) total
    FROM invoices i JOIN customers c ON c.id=i.customer_id
    WHERE i.period_year=? AND i.period_month=? AND i.status IN ('unpaid','partial','overdue')${customerScope}
  `, [selectedYear, selectedMonth, ...customerParams]);

  const [[newCustomers]] = await db.execute(`
    SELECT COUNT(*) total FROM customers c
    WHERE YEAR(COALESCE(c.activation_date, DATE(c.created_at)))=?
      AND MONTH(COALESCE(c.activation_date, DATE(c.created_at)))=?${customerScope}
  `, [selectedYear, selectedMonth, ...customerParams]);

  const [[network]] = await db.execute(`
    SELECT SUM(c.network_status='online') online, SUM(c.network_status='offline') offline,
      SUM(c.network_status='isolated') isolated, SUM(c.network_status='router_unreachable') unreachable
    FROM customers c WHERE c.customer_status='active'${customerScope}
  `, customerParams);

  const routerScope = siteId ? ' AND site_id=?' : '';
  const [[routerNoc]] = await db.execute(`SELECT COUNT(*) routers_total, SUM(last_status='online') routers_online FROM routers WHERE is_active=1${routerScope}`, customerParams);
  const [[ticketNoc]] = await db.execute(`SELECT COUNT(*) tickets_open FROM tickets t LEFT JOIN customers c ON c.id=t.customer_id WHERE t.status IN ('open','progress','pending')${siteId?' AND c.site_id=?':''}`, customerParams);
  const [[stockNoc]] = await db.execute(`SELECT COUNT(*) low_stock FROM inventory_items WHERE is_active=1 AND qty<=min_stock${siteId?' AND site_id=?':''}`, customerParams);
  const [[cashHeldNoc]] = await db.execute(`SELECT COALESCE(SUM(p.amount),0) cash_held FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id WHERE p.method='cash' AND p.status='confirmed' AND p.settlement_status='held_by_staff'${customerScope}`, customerParams);
  const [[overdueNoc]] = await db.execute(`SELECT COUNT(DISTINCT i.customer_id) overdue_customers FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status='overdue' AND i.outstanding>0${customerScope}`, customerParams);
  const noc = { ...routerNoc, ...ticketNoc, ...stockNoc, ...cashHeldNoc, ...overdueNoc };

  const [[cashflow]] = await db.execute(`
    SELECT COALESCE(SUM(CASE WHEN cc.type='income' THEN ct.amount ELSE 0 END),0) income,
           COALESCE(SUM(CASE WHEN cc.type='expense' THEN ct.amount ELSE 0 END),0) expense
    FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id
    WHERE MONTH(ct.transaction_date)=? AND YEAR(ct.transaction_date)=?${siteId?' AND ct.site_id=?':''}
  `,[selectedMonth,selectedYear,...customerParams]);
  cashflow.balance = Number(cashflow.income||0)-Number(cashflow.expense||0);

  const [recent] = await db.execute(`
    SELECT i.id,i.invoice_number,i.total,i.outstanding,i.status,i.due_date,c.customer_code,c.name customer_name,s.code site_code
    FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id
    WHERE 1=1${customerScope}
    ORDER BY i.id DESC LIMIT 7
  `, customerParams);

  const [sites] = await db.execute(`
    SELECT s.code,s.name,COUNT(c.id) customers
    FROM sites s LEFT JOIN customers c ON c.site_id=s.id AND c.customer_status='active'
    WHERE s.is_active=1${siteId?' AND s.id=?':''}
    GROUP BY s.id ORDER BY customers DESC,s.code
  `, customerParams);

  const [monthlyInvoiceRows] = await db.execute(`
    SELECT i.period_month month_no,COALESCE(SUM(i.total),0) total
    FROM invoices i JOIN customers c ON c.id=i.customer_id
    WHERE i.period_year=? AND i.status NOT IN ('cancelled','refunded')${customerScope}
    GROUP BY i.period_month ORDER BY i.period_month
  `,[selectedYear,...customerParams]);

  const [monthlyPaymentRows] = await db.execute(`
    SELECT MONTH(p.paid_at) month_no,COALESCE(SUM(p.amount),0) total
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id
    WHERE p.status='confirmed' AND YEAR(p.paid_at)=?${customerScope}
    GROUP BY MONTH(p.paid_at) ORDER BY MONTH(p.paid_at)
  `,[selectedYear,...customerParams]);

  const [monthlyPsbRows] = await db.execute(`
    SELECT MONTH(COALESCE(c.activation_date,DATE(c.created_at))) month_no,COUNT(*) total
    FROM customers c
    WHERE YEAR(COALESCE(c.activation_date,DATE(c.created_at)))=?${customerScope}
    GROUP BY MONTH(COALESCE(c.activation_date,DATE(c.created_at)))
    ORDER BY MONTH(COALESCE(c.activation_date,DATE(c.created_at)))
  `,[selectedYear,...customerParams]);

  const [[customerBaseBeforeYear]] = await db.execute(`
    SELECT COUNT(*) total
    FROM customers c
    WHERE COALESCE(c.activation_date,DATE(c.created_at)) < ?${customerScope}
  `,[`${selectedYear}-01-01`,...customerParams]);

  const [dailyInvoiceRows] = await db.execute(`
    SELECT DAY(i.invoice_date) day_no,COALESCE(SUM(i.total),0) total
    FROM invoices i JOIN customers c ON c.id=i.customer_id
    WHERE YEAR(i.invoice_date)=? AND MONTH(i.invoice_date)=? AND i.status NOT IN ('cancelled','refunded')${customerScope}
    GROUP BY DAY(i.invoice_date) ORDER BY DAY(i.invoice_date)
  `,[selectedYear,selectedMonth,...customerParams]);

  const [dailyPaymentRows] = await db.execute(`
    SELECT DAY(p.paid_at) day_no,COALESCE(SUM(p.amount),0) total
    FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=i.customer_id
    WHERE p.status='confirmed' AND YEAR(p.paid_at)=? AND MONTH(p.paid_at)=?${customerScope}
    GROUP BY DAY(p.paid_at) ORDER BY DAY(p.paid_at)
  `,[selectedYear,selectedMonth,...customerParams]);

  const monthLabels=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  const monthlyInvoices=Array(12).fill(0), monthlyPayments=Array(12).fill(0), monthlyPsb=Array(12).fill(0);
  monthlyInvoiceRows.forEach(r=>{monthlyInvoices[Number(r.month_no)-1]=Number(r.total||0)});
  monthlyPaymentRows.forEach(r=>{monthlyPayments[Number(r.month_no)-1]=Number(r.total||0)});
  monthlyPsbRows.forEach(r=>{monthlyPsb[Number(r.month_no)-1]=Number(r.total||0)});
  let runningCustomerBase=Number(customerBaseBeforeYear.total||0);
  const monthlyCustomerBase=monthlyPsb.map(count=>{runningCustomerBase+=Number(count||0);return runningCustomerBase});
  const psbYtd=monthlyPsb.reduce((sum,value)=>sum+Number(value||0),0);
  const elapsedMonths=selectedYear===now.getFullYear()?Math.max(1,Math.min(12,now.getMonth()+1)):12;
  const psbAverage=Math.round(psbYtd/elapsedMonths);
  const psbPeakValue=Math.max(...monthlyPsb);
  const psbPeakIndex=Math.max(0,monthlyPsb.indexOf(psbPeakValue));
  const daysInMonth=new Date(selectedYear,selectedMonth,0).getDate();
  const dayLabels=Array.from({length:daysInMonth},(_,i)=>String(i+1).padStart(2,'0'));
  const dailyInvoices=Array(daysInMonth).fill(0), dailyPayments=Array(daysInMonth).fill(0);
  dailyInvoiceRows.forEach(r=>{dailyInvoices[Number(r.day_no)-1]=Number(r.total||0)});
  dailyPaymentRows.forEach(r=>{dailyPayments[Number(r.day_no)-1]=Number(r.total||0)});

  const collectionRate=Number(billed.total)>0?Math.min(100,Math.round((Number(revenue.total)/Number(billed.total))*100)):0;
  const maxSiteCustomers=Math.max(1,...sites.map(s=>Number(s.customers||0)));
  const years=Array.from({length:5},(_,i)=>now.getFullYear()-2+i);if(!years.includes(selectedYear))years.push(selectedYear);years.sort((a,b)=>a-b);

  res.render('dashboard/index',{
    title:'Dashboard',customer,revenue,billed,unpaid,newCustomers,network,noc,cashflow,recent,sites,siteOptions,
    selectedSiteCode:selectedSite?.code||'',selectedSiteName:selectedSite?.name||'Semua Site',maxSiteCustomers,collectionRate,
    selectedMonth,selectedYear,years,monthLabels,
    monthly:{labels:monthLabels,invoices:monthlyInvoices,payments:monthlyPayments},
    customerGrowth:{labels:monthLabels,psb:monthlyPsb,base:monthlyCustomerBase},
    psbStats:{ytd:psbYtd,average:psbAverage,peakValue:psbPeakValue,peakMonth:monthLabels[psbPeakIndex]},
    daily:{labels:dayLabels,invoices:dailyInvoices,payments:dailyPayments}
  });
});
module.exports=router;
