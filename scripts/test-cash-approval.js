const assert=require('assert');
const {approveCashTransaction,rejectCashTransaction}=require('../services/cashService');

function fakeConn(initial){
  let row={...initial};
  const calls=[];
  return {calls,get row(){return row;},async execute(sql,params=[]){calls.push({sql,params});if(sql.startsWith('SELECT ct.id'))return [[{...row,category_type:'expense'}]];if(sql.startsWith("UPDATE cash_transactions SET approval_status='APPROVED'")){row={...row,approval_status:'APPROVED',approval_reason:null,reviewed_by:params[0]};return [{affectedRows:1}];}if(sql.startsWith("UPDATE cash_transactions SET approval_status='REJECTED'")){row={...row,approval_status:'REJECTED',approval_reason:params[0],reviewed_by:params[1]};return [{affectedRows:1}];}throw new Error(`Unexpected SQL: ${sql}`);}};
}

(async()=>{
  const approved=fakeConn({id:7,transaction_code:'EXP-202608-000007',name:'Material FO',amount:150000,source_type:'manual',approval_status:'PENDING_APPROVAL'});
  const approvedTx=await approveCashTransaction(approved,7,1);
  assert.equal(approvedTx.id,7);assert.equal(approved.row.approval_status,'APPROVED');assert.equal(approved.row.reviewed_by,1);

  const rejected=fakeConn({id:8,transaction_code:'EXP-202608-000008',name:'Transport',amount:80000,source_type:'manual',approval_status:'PENDING_APPROVAL'});
  const rejectedTx=await rejectCashTransaction(rejected,8,2,'  Bukti nominal belum sesuai  ');
  assert.equal(rejected.row.approval_status,'REJECTED');assert.equal(rejected.row.approval_reason,'Bukti nominal belum sesuai');assert.equal(rejectedTx.approval_reason,'Bukti nominal belum sesuai');

  const nonPending=fakeConn({id:9,source_type:'manual',approval_status:'APPROVED'});
  await assert.rejects(()=>approveCashTransaction(nonPending,9,1),/PENDING_APPROVAL/);
  const automatic=fakeConn({id:10,source_type:'payment',approval_status:'PENDING_APPROVAL'});
  await assert.rejects(()=>approveCashTransaction(automatic,10,1),/otomatis/);
  const shortReason=fakeConn({id:11,source_type:'manual',approval_status:'PENDING_APPROVAL'});
  await assert.rejects(()=>rejectCashTransaction(shortReason,11,1,'x'),/minimal 3 karakter/);
  console.log('Cash approval validation OK: approve/reject transitions, reason validation, duplicate-state and automatic-transaction guards passed.');
})().catch(err=>{console.error('Cash approval validation FAILED:',err.stack||err);process.exit(1);});
