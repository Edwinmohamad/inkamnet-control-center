const db=require('../config/db');
const { normalizeWhatsapp }=require('./whatsappService');

function num(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function monthKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;}
function lastMonths(count=12,now=new Date()){
  const rows=[];
  for(let i=count-1;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);rows.push({key:monthKey(d),label:d.toLocaleDateString('id-ID',{month:'short',year:'2-digit',timeZone:'Asia/Jakarta'})});}
  return rows;
}
function buildFunnel(row={}){
  const values=[num(row.registered),num(row.survey_ready),num(row.provisioned),num(row.activated)];
  return [
    {key:'registered',label:'Registrasi',value:values[0],hint:'Pelanggan dibuat pada periode'},
    {key:'survey',label:'Survei',value:values[1],hint:'Alamat + cluster sudah terisi'},
    {key:'fiber',label:'Penarikan FO',value:values[2],hint:'Router + PPPoE sudah diprovision'},
    {key:'active',label:'Teraktivasi',value:values[3],hint:'Activation date terisi dan aktif'}
  ];
}
function buildAdvisories({odp=[],dueSoon=0,overdue30=0,pppoeUnlinked=0,pendingCash=0}={}){
  const out=[];
  const low=odp.filter(x=>num(x.capacity_ports)>0&&num(x.remaining_ports)<2);
  if(low.length)out.push({tone:'danger',icon:'bi-diagram-3-fill',title:`${low.length} ODP hampir penuh`,detail:`Prioritaskan audit/ekspansi: ${low.slice(0,3).map(x=>`${x.site_code}/${x.name} sisa ${x.remaining_ports}`).join(', ')}.` ,href:'/clusters'});
  if(dueSoon>0)out.push({tone:'warning',icon:'bi-whatsapp',title:`${dueSoon} tagihan mendekati jatuh tempo`,detail:'Rekomendasi: WA Blast H-2 agar collection rate naik sebelum jadwal isolir.',href:'/invoices?status=open'});
  if(overdue30>0)out.push({tone:'danger',icon:'bi-exclamation-octagon-fill',title:`${overdue30} piutang >30 hari`,detail:'Prioritaskan follow-up dan review pelanggan yang siap masuk proses isolir.',href:'/invoices?status=overdue'});
  if(pppoeUnlinked>0)out.push({tone:'info',icon:'bi-router-fill',title:`${pppoeUnlinked} pelanggan belum link PPPoE`,detail:'Buka MikroTik NMS dan jalankan Smart Sync untuk rekonsiliasi billing ↔ PPPoE.',href:'/network/monitor'});
  if(pendingCash>0)out.push({tone:'purple',icon:'bi-shield-check',title:`${pendingCash} kas menunggu approval`,detail:'Saldo real belum berubah sampai Owner / Master Admin memverifikasi transaksi.',href:'/payments#cash-approval'});
  if(!out.length)out.push({tone:'success',icon:'bi-stars',title:'Operasional dalam kondisi baik',detail:'Tidak ada advisory kritis dari kapasitas ODP, aging, PPPoE, atau approval kas saat ini.',href:'/'});
  return out;
}

async function fetchAnalytics({siteCode='',month,year}){
  const now=new Date();month=Number(month)||now.getMonth()+1;year=Number(year)||now.getFullYear();
  const [sites]=await db.query(`SELECT id,code,name FROM sites WHERE is_active=1 ORDER BY code`);
  const selected=siteCode?sites.find(s=>String(s.code).toUpperCase()===String(siteCode).toUpperCase()):null;
  const siteId=selected?.id||null, customerScope=siteId?' AND c.site_id=?':'', customerParams=siteId?[siteId]:[];
  const cashScope=siteId?' AND ct.site_id=?':'', cashParams=siteId?[siteId]:[];

  const [[exec]]=await db.execute(`SELECT COUNT(*) active_customers,COALESCE(SUM(p.price),0) mrr FROM customers c JOIN packages p ON p.id=c.package_id WHERE c.customer_status='active'${customerScope}`,customerParams);
  const [[billing]]=await db.execute(`SELECT COALESCE(SUM(i.total),0) billed,COALESCE(SUM(i.paid_amount),0) collected,COALESCE(SUM(i.outstanding),0) outstanding FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.period_month=? AND i.period_year=? AND i.status NOT IN ('cancelled','refunded')${customerScope}`,[month,year,...customerParams]);
  const [[psb]]=await db.execute(`SELECT COUNT(*) total FROM customers c WHERE YEAR(COALESCE(c.activation_date,DATE(c.created_at)))=? AND MONTH(COALESCE(c.activation_date,DATE(c.created_at)))=?${customerScope}`,[year,month,...customerParams]);
  const [[risk]]=await db.execute(`SELECT
    SUM(i.outstanding>0 AND DATEDIFF(i.due_date,CURDATE()) BETWEEN 0 AND 2) due_soon,
    SUM(i.outstanding>0 AND DATEDIFF(CURDATE(),i.due_date)>30) overdue_30
    FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('unpaid','partial','overdue')${customerScope}`,customerParams);
  const [[sync]]=await db.execute(`SELECT COUNT(*) pppoe_unlinked FROM customers c WHERE c.customer_status='active' AND (c.router_id IS NULL OR c.pppoe_username IS NULL OR c.pppoe_username='')${customerScope}`,customerParams);
  const [[cashPending]]=await db.execute(`SELECT COUNT(*) pending_cash FROM cash_transactions ct WHERE ct.approval_status='PENDING_APPROVAL'${cashScope}`,cashParams);

  const [odp]=await db.execute(`SELECT cl.id,cl.name,cl.capacity_ports,cl.used_ports,GREATEST(COALESCE(cl.capacity_ports,0)-COALESCE(cl.used_ports,0),0) remaining_ports,s.code site_code,s.name site_name FROM clusters cl JOIN sites s ON s.id=cl.site_id WHERE cl.status<>'inactive'${siteId?' AND cl.site_id=?':''} ORDER BY s.code,remaining_ports,cl.name`,siteId?[siteId]:[]);

  const [cashRows]=await db.execute(`SELECT DATE_FORMAT(ct.transaction_date,'%Y-%m') month_key,COALESCE(SUM(CASE WHEN cc.type='income' THEN ct.amount ELSE 0 END),0) inflow,COALESCE(SUM(CASE WHEN cc.type='expense' THEN ct.amount ELSE 0 END),0) outflow FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id WHERE COALESCE(ct.approval_status,'APPROVED')='APPROVED' AND ct.transaction_date>=DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'),INTERVAL 11 MONTH)${cashScope} GROUP BY DATE_FORMAT(ct.transaction_date,'%Y-%m') ORDER BY month_key`,cashParams);
  const [mrrRows]=await db.execute(`SELECT CONCAT(i.period_year,'-',LPAD(i.period_month,2,'0')) month_key,COALESCE(SUM(i.total),0) billed FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE STR_TO_DATE(CONCAT(i.period_year,'-',LPAD(i.period_month,2,'0'),'-01'),'%Y-%m-%d')>=DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'),INTERVAL 11 MONTH) AND i.status NOT IN ('cancelled','refunded')${customerScope} GROUP BY i.period_year,i.period_month ORDER BY i.period_year,i.period_month`,customerParams);
  const months=lastMonths(12,now),cashMap=new Map(cashRows.map(x=>[x.month_key,x])),mrrMap=new Map(mrrRows.map(x=>[x.month_key,x]));
  const financeSeries={labels:months.map(x=>x.label),inflow:months.map(x=>num(cashMap.get(x.key)?.inflow)),outflow:months.map(x=>num(cashMap.get(x.key)?.outflow)),mrr:months.map(x=>num(mrrMap.get(x.key)?.billed))};

  const [agingRaw]=await db.execute(`SELECT c.id,c.customer_code,c.name customer_name,c.phone,s.code site_code,MIN(i.due_date) oldest_due,COALESCE(SUM(i.outstanding),0) outstanding,MAX(DATEDIFF(CURDATE(),i.due_date)) days_overdue FROM invoices i JOIN customers c ON c.id=i.customer_id JOIN sites s ON s.id=c.site_id WHERE i.status IN ('unpaid','partial','overdue') AND i.outstanding>0${customerScope} GROUP BY c.id,c.customer_code,c.name,c.phone,s.code ORDER BY days_overdue DESC,outstanding DESC LIMIT 100`,customerParams);
  const aging=agingRaw.map(row=>{const wa=normalizeWhatsapp(row.phone);return {...row,whatsappNumber:wa||null};});
  const agingBuckets={h3:aging.filter(x=>num(x.days_overdue)<=0&&num(x.days_overdue)>=-3),hplus3:aging.filter(x=>num(x.days_overdue)>0&&num(x.days_overdue)<=30),over30:aging.filter(x=>num(x.days_overdue)>30)};

  const [[funnelRow]]=await db.execute(`SELECT COUNT(*) registered,SUM(c.address IS NOT NULL AND c.address<>'' AND c.cluster_id IS NOT NULL) survey_ready,SUM(c.router_id IS NOT NULL AND c.pppoe_username IS NOT NULL AND c.pppoe_username<>'') provisioned,SUM(c.customer_status='active' AND c.activation_date IS NOT NULL) activated FROM customers c WHERE YEAR(c.created_at)=? AND MONTH(c.created_at)=?${customerScope}`,[year,month,...customerParams]);
  const [[sla]]=await db.execute(`SELECT ROUND(AVG(DATEDIFF(c.activation_date,DATE(c.created_at))),1) avg_days,COUNT(*) samples FROM customers c WHERE c.activation_date IS NOT NULL AND YEAR(c.activation_date)=? AND MONTH(c.activation_date)=?${customerScope}`,[year,month,...customerParams]);

  const collectionRate=num(billing.billed)>0?Math.min(100,Math.round(num(billing.collected)/num(billing.billed)*100)):0;
  const kpis={activeCustomers:num(exec.active_customers),mrr:num(exec.mrr),billed:num(billing.billed),collected:num(billing.collected),outstanding:num(billing.outstanding),collectionRate,psb:num(psb.total),pendingCash:num(cashPending.pending_cash)};
  const advisories=buildAdvisories({odp,dueSoon:num(risk.due_soon),overdue30:num(risk.overdue_30),pppoeUnlinked:num(sync.pppoe_unlinked),pendingCash:num(cashPending.pending_cash)});
  return {sites,selectedSiteCode:selected?.code||'',selectedSiteName:selected?.name||'Semua Site',month,year,kpis,advisories,financeSeries,aging,agingBuckets,funnel:buildFunnel(funnelRow),sla:{avgDays:num(sla.avg_days),samples:num(sla.samples)},odp:odp.map(x=>({...x,capacity_ports:num(x.capacity_ports),used_ports:num(x.used_ports),remaining_ports:num(x.remaining_ports),utilization:num(x.capacity_ports)?Math.min(100,Math.round(num(x.used_ports)/num(x.capacity_ports)*100)):0})),isDummy:false};
}

// Realistic placeholder payload so the /analytics page never 500s when a table/column
// referenced above (clusters.capacity_ports, cash_transactions.approval_status, etc.)
// has not been migrated yet on a fresh or older database. Every number here is fictional.
function buildDummyAnalytics({siteCode='',month,year}={}){
  const now=new Date();month=Number(month)||now.getMonth()+1;year=Number(year)||now.getFullYear();
  const months=lastMonths(12,now);
  const wave=(base,amp,phase=0)=>months.map((_,i)=>Math.max(0,Math.round(base+amp*Math.sin((i+phase)/2))));
  const financeSeries={labels:months.map(x=>x.label),inflow:wave(38000000,9000000),outflow:wave(24000000,6000000,1.4),mrr:wave(52000000,5000000,0.6)};
  const dummySites=[{id:0,code:'HQ',name:'Kantor Pusat (contoh)'}];
  const selectedName=siteCode?`${siteCode} (contoh)`:'Semua Site (contoh)';
  const aging=[
    {id:'demo-1',customer_code:'DEMO-0001',customer_name:'Contoh Pelanggan A',phone:null,whatsappNumber:null,site_code:'HQ',oldest_due:new Date(now.getTime()-2*86400000),outstanding:350000,days_overdue:2},
    {id:'demo-2',customer_code:'DEMO-0002',customer_name:'Contoh Pelanggan B',phone:null,whatsappNumber:null,site_code:'HQ',oldest_due:new Date(now.getTime()-15*86400000),outstanding:275000,days_overdue:15},
    {id:'demo-3',customer_code:'DEMO-0003',customer_name:'Contoh Pelanggan C',phone:null,whatsappNumber:null,site_code:'HQ',oldest_due:new Date(now.getTime()-40*86400000),outstanding:520000,days_overdue:40}
  ];
  const agingBuckets={h3:aging.filter(x=>x.days_overdue<=2),hplus3:aging.filter(x=>x.days_overdue>2&&x.days_overdue<=30),over30:aging.filter(x=>x.days_overdue>30)};
  const odp=[{id:'demo-odp-1',name:'ODP Contoh 01',capacity_ports:16,used_ports:14,remaining_ports:2,utilization:88,site_code:'HQ',site_name:'Kantor Pusat (contoh)'}];
  const funnel=buildFunnel({registered:40,survey_ready:34,provisioned:28,activated:22});
  const kpis={activeCustomers:842,mrr:52000000,billed:61000000,collected:53000000,outstanding:8000000,collectionRate:87,psb:22,pendingCash:2};
  const advisories=buildAdvisories({odp,dueSoon:1,overdue30:aging.filter(x=>x.days_overdue>30).length,pppoeUnlinked:3,pendingCash:2});
  return {sites:dummySites,selectedSiteCode:siteCode||'',selectedSiteName:selectedName,month,year,kpis,advisories,financeSeries,aging,agingBuckets,funnel,sla:{avgDays:3.2,samples:22},odp,isDummy:true};
}

async function getAnalytics(params={}){
  try{
    return await fetchAnalytics(params);
  }catch(error){
    console.error('Analytics query gagal, menampilkan data contoh sementara:',error.message);
    return buildDummyAnalytics(params);
  }
}

module.exports={getAnalytics,buildAdvisories,buildFunnel,lastMonths,buildDummyAnalytics};
