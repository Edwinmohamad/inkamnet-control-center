function normalizeCategoryCode(value, fallback='TX'){
  const code=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
  return code||fallback;
}
function yyyymm(value){
  const d=value instanceof Date?value:new Date(value||Date.now());
  if(Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,7).replace('-','');
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
}
function normalizeApprovalReason(value){return String(value||'').trim().replace(/\s+/g,' ').slice(0,500);}
async function assignCashTransactionCode(conn, transactionId, categoryId, transactionDate){
  const [rows]=await conn.execute(`SELECT code,name,type FROM cash_categories WHERE id=? LIMIT 1`,[categoryId]);
  const c=rows[0]||{};
  const fallback=c.type==='income'?'INC':'EXP';
  const prefix=normalizeCategoryCode(c.code,fallback);
  const code=`${prefix}-${yyyymm(transactionDate)}-${String(transactionId).padStart(6,'0')}`;
  await conn.execute(`UPDATE cash_transactions SET transaction_code=? WHERE id=?`,[code,transactionId]);
  return code;
}
async function approveCashTransaction(conn,transactionId,reviewerId){
  const [rows]=await conn.execute(`SELECT ct.id,ct.transaction_code,ct.name,ct.amount,ct.source_type,ct.approval_status,cc.type category_type FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id WHERE ct.id=? FOR UPDATE`,[transactionId]);
  const tx=rows[0];
  if(!tx)throw new Error('Transaksi kas tidak ditemukan.');
  if(tx.source_type&&tx.source_type!=='manual')throw new Error('Transaksi otomatis tidak membutuhkan approval kas manual.');
  if(tx.approval_status!=='PENDING_APPROVAL')throw new Error('Hanya transaksi PENDING_APPROVAL yang dapat disetujui.');
  await conn.execute(`UPDATE cash_transactions SET approval_status='APPROVED',approval_reason=NULL,reviewed_by=?,reviewed_at=NOW() WHERE id=?`,[reviewerId,transactionId]);
  return tx;
}
async function rejectCashTransaction(conn,transactionId,reviewerId,reason){
  const clean=normalizeApprovalReason(reason);
  if(clean.length<3)throw new Error('Alasan penolakan wajib diisi minimal 3 karakter.');
  const [rows]=await conn.execute(`SELECT ct.id,ct.transaction_code,ct.name,ct.amount,ct.source_type,ct.approval_status,cc.type category_type FROM cash_transactions ct JOIN cash_categories cc ON cc.id=ct.category_id WHERE ct.id=? FOR UPDATE`,[transactionId]);
  const tx=rows[0];
  if(!tx)throw new Error('Transaksi kas tidak ditemukan.');
  if(tx.source_type&&tx.source_type!=='manual')throw new Error('Transaksi otomatis tidak membutuhkan approval kas manual.');
  if(tx.approval_status!=='PENDING_APPROVAL')throw new Error('Hanya transaksi PENDING_APPROVAL yang dapat ditolak.');
  await conn.execute(`UPDATE cash_transactions SET approval_status='REJECTED',approval_reason=?,reviewed_by=?,reviewed_at=NOW() WHERE id=?`,[clean,reviewerId,transactionId]);
  return {...tx,approval_reason:clean};
}
module.exports={assignCashTransactionCode,normalizeCategoryCode,normalizeApprovalReason,approveCashTransaction,rejectCashTransaction};
