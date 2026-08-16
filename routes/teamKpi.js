const express = require('express');
const db = require('../config/db');
const router = express.Router();

const MONTH_NAMES=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function bounded(v,min,max,fallback){const n=Number(v);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
function pct(a,b,neutralWhenZero=false){if(!Number(b||0))return neutralWhenZero?100:0;return Math.max(0,Math.min(100,Math.round(Number(a||0)/Number(b)*100)));}
function weightedScore(items){const active=items.filter(x=>x.available);const weights=active.reduce((a,x)=>a+x.weight,0);if(!weights)return 0;return Math.round(active.reduce((a,x)=>a+x.value*x.weight,0)/weights);}
function scoreRow(row,teamMaxPsb){
  const category=String(row.position_category||'other');
  const ticketClose=pct(row.closed_tickets,row.assigned_tickets,false);
  const updateDiscipline=pct(row.ticket_updates,row.assigned_tickets,false);
  const jobDone=pct(row.done_jobs,row.assigned_jobs,false);
  const dutyAttendance=pct(row.present_duties,row.assigned_duties,false);
  const psbActivity=teamMaxPsb>0?Math.min(100,Math.round(Number(row.psb_count||0)/teamMaxPsb*100)):0;
  let score=0,formula='';
  const hasTicket=Number(row.assigned_tickets||0)>0,hasJob=Number(row.assigned_jobs||0)>0,hasDuty=Number(row.assigned_duties||0)>0,hasPsb=teamMaxPsb>0;
  if(category==='technical'){
    score=weightedScore([{value:ticketClose,weight:.40,available:hasTicket},{value:updateDiscipline,weight:.20,available:hasTicket},{value:jobDone,weight:.20,available:hasJob},{value:dutyAttendance,weight:.20,available:hasDuty}]);
    formula='40% tiket selesai · 20% update tiket · 20% pekerjaan teknisi · 20% piket';
  }else if(category==='sales'){
    score=weightedScore([{value:psbActivity,weight:.70,available:hasPsb},{value:dutyAttendance,weight:.30,available:hasDuty}]);
    formula='70% kontribusi PSB tim · 30% piket';
  }else if(['admin','finance'].includes(category)){
    score=weightedScore([{value:ticketClose,weight:.30,available:hasTicket},{value:updateDiscipline,weight:.20,available:hasTicket},{value:dutyAttendance,weight:.50,available:hasDuty}]);
    formula='30% dukungan tiket · 20% update tiket · 50% piket';
  }else if(category==='management'){
    score=weightedScore([{value:ticketClose,weight:.35,available:hasTicket},{value:updateDiscipline,weight:.25,available:hasTicket},{value:dutyAttendance,weight:.40,available:hasDuty}]);
    formula='35% penyelesaian tiket · 25% update · 40% piket';
  }else{
    score=weightedScore([{value:ticketClose,weight:.35,available:hasTicket},{value:jobDone,weight:.25,available:hasJob},{value:dutyAttendance,weight:.40,available:hasDuty}]);
    formula='35% tiket · 25% pekerjaan · 40% piket';
  }
  return {...row,ticket_close_rate:ticketClose,update_rate:updateDiscipline,job_done_rate:jobDone,duty_rate:dutyAttendance,psb_activity:psbActivity,score,formula};
}

router.get('/', async(req,res)=>{
  const now=new Date();
  const month=bounded(req.query.month,1,12,now.getMonth()+1);
  const year=bounded(req.query.year,2020,2100,now.getFullYear());
  const start=`${year}-${String(month).padStart(2,'0')}-01`;
  const endDate=new Date(year,month,0); const end=`${year}-${String(month).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
  const [rows]=await db.execute(`
    SELECT e.id,e.employee_code,e.name,e.user_id,
      COALESCE(p.name,'Belum diatur') position_name,COALESCE(p.category,'other') position_category,
      COALESCE(d.name,'Tanpa departemen') department_name,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_employee_id=e.id AND DATE(t.opened_at) BETWEEN ? AND ?) assigned_tickets,
      (SELECT COUNT(*) FROM tickets t WHERE t.assigned_employee_id=e.id AND t.status='closed' AND DATE(COALESCE(t.closed_at,t.updated_at)) BETWEEN ? AND ?) closed_tickets,
      (SELECT COUNT(*) FROM ticket_updates tu JOIN tickets t ON t.id=tu.ticket_id WHERE t.assigned_employee_id=e.id AND tu.progress_date BETWEEN ? AND ?) ticket_updates,
      (SELECT COUNT(*) FROM technician_schedules ts WHERE (ts.technician_employee_id=e.id OR (ts.technician_employee_id IS NULL AND e.user_id IS NOT NULL AND ts.technician_id=e.user_id)) AND ts.schedule_date BETWEEN ? AND ?) assigned_jobs,
      (SELECT COUNT(*) FROM technician_schedules ts WHERE (ts.technician_employee_id=e.id OR (ts.technician_employee_id IS NULL AND e.user_id IS NOT NULL AND ts.technician_id=e.user_id)) AND ts.status='done' AND ts.schedule_date BETWEEN ? AND ?) done_jobs,
      (SELECT COUNT(*) FROM server_duty_schedules sd WHERE sd.duty_date BETWEEN ? AND ? AND ((e.user_id IS NOT NULL AND sd.user_id=e.user_id) OR LOWER(TRIM(sd.staff_name))=LOWER(TRIM(e.name)))) assigned_duties,
      (SELECT COUNT(*) FROM server_duty_schedules sd WHERE sd.duty_date BETWEEN ? AND ? AND sd.status='present' AND ((e.user_id IS NOT NULL AND sd.user_id=e.user_id) OR LOWER(TRIM(sd.staff_name))=LOWER(TRIM(e.name)))) present_duties,
      (SELECT COUNT(*) FROM customers c WHERE c.sales_id=e.id AND COALESCE(c.activation_date,DATE(c.created_at)) BETWEEN ? AND ?) psb_count
    FROM employees e
    LEFT JOIN positions p ON p.id=e.position_id
    LEFT JOIN departments d ON d.id=e.department_id
    WHERE e.is_active=1
    ORDER BY FIELD(COALESCE(p.category,'other'),'technical','admin','finance','sales','management','other'),e.name
  `,[start,end,start,end,start,end,start,end,start,end,start,end,start,end,start,end]);
  const maxPsb=Math.max(0,...rows.map(r=>Number(r.psb_count||0)));
  const team=rows.map(r=>scoreRow(r,maxPsb)).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
  const summary={
    people:team.length,
    avgScore:team.length?Math.round(team.reduce((a,x)=>a+x.score,0)/team.length):0,
    closed:team.reduce((a,x)=>a+Number(x.closed_tickets||0),0),
    dutyPresent:team.reduce((a,x)=>a+Number(x.present_duties||0),0),
    psb:team.reduce((a,x)=>a+Number(x.psb_count||0),0),
    jobsDone:team.reduce((a,x)=>a+Number(x.done_jobs||0),0)
  };
  res.render('team-kpi/index',{title:'KPI Tim',team,summary,month,year,monthNames:MONTH_NAMES,start,end});
});

module.exports=router;
