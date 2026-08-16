function normalizeCategoryCode(value, fallback='TX'){
  const code=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,10);
  return code||fallback;
}
function yyyymm(value){
  const d=value instanceof Date?value:new Date(value||Date.now());
  if(Number.isNaN(d.getTime())) return new Date().toISOString().slice(0,7).replace('-','');
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
}
async function assignCashTransactionCode(conn, transactionId, categoryId, transactionDate){
  const [rows]=await conn.execute(`SELECT code,name,type FROM cash_categories WHERE id=? LIMIT 1`,[categoryId]);
  const c=rows[0]||{};
  const fallback=c.type==='income'?'INC':'EXP';
  const prefix=normalizeCategoryCode(c.code,fallback);
  const code=`${prefix}-${yyyymm(transactionDate)}-${String(transactionId).padStart(6,'0')}`;
  await conn.execute(`UPDATE cash_transactions SET transaction_code=? WHERE id=?`,[code,transactionId]);
  return code;
}
module.exports={assignCashTransactionCode,normalizeCategoryCode};
