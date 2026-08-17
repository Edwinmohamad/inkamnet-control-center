const dict={
  id:{dashboard:'Dashboard',customers:'Pelanggan',packages:'Paket Internet',network:'Jaringan',sites:'Site / POP',routers:'Router MikroTik',clusters:'Cluster & ODP',monitor:'Monitor Jaringan',support:'Dukungan',tickets:'Ticketing',techSchedule:'Jadwal Teknisi',serverDuty:'Piket Server',warehouse:'Gudang',stock:'Stok Barang',movements:'Pergerakan Stok',material:'Pemakaian Material',supplier:'Supplier',billing:'Tagihan',invoices:'Tagihan',payments:'Pembayaran',customInvoices:'Faktur Kustom',discounts:'Diskon',charges:'Biaya Tambahan',finance:'Keuangan',reconciliation:'Rekonsiliasi',cash:'Arus Kas',cashCategories:'Kategori Kas',cashData:'Data Kas',reports:'Laporan',system:'Sistem',activityLog:'Log Aktivitas',settings:'Pengaturan',profile:'Profil Saya',logout:'Keluar',quickCommand:'Perintah Cepat',signedInAs:'MASUK SEBAGAI',systemLive:'SISTEM AKTIF',language:'Bahasa'},
  en:{dashboard:'Dashboard',customers:'Customers',packages:'Internet Packages',network:'Network',sites:'Sites / POP',routers:'MikroTik Routers',clusters:'Clusters & ODP',monitor:'Network Monitor',support:'Support',tickets:'Tickets',techSchedule:'Technician Schedule',serverDuty:'Server Duty',warehouse:'Warehouse',stock:'Inventory',movements:'Stock Movements',material:'Material Usage',supplier:'Suppliers',billing:'Billing',invoices:'Invoices',payments:'Payments',customInvoices:'Custom Invoices',discounts:'Discounts',charges:'Additional Charges',finance:'Finance',reconciliation:'Reconciliation',cash:'Cash Flow',cashCategories:'Cash Categories',cashData:'Cash Data',reports:'Reports',system:'System',activityLog:'Activity Log',settings:'Settings',profile:'My Profile',logout:'Logout',quickCommand:'Quick Command',signedInAs:'SIGNED IN AS',systemLive:'SYSTEM LIVE',language:'Language'}
};
const { isAdminRole, isMasterAdminRole }=require('./auth');
function commonLocals(req,res,next){
  const language=req.session?.language==='en'?'en':'id';
  res.locals.appName=process.env.APP_NAME||'INKAMNET Billing';
  const sessionUser=req.session?.user||null;
  res.locals.isAdmin=isAdminRole(sessionUser?.role);
  res.locals.isMasterAdmin=isMasterAdminRole(sessionUser?.role);
  res.locals.actualRole=sessionUser?.role||null;
  // View lama yang masih membandingkan role dengan "admin" tetap memberi kontrol penuh kepada Master Admin.
  res.locals.user=sessionUser&&res.locals.isMasterAdmin?{...sessionUser,role:'admin'}:sessionUser;
  res.locals.language=language;
  res.locals.t=(key)=>dict[language]?.[key]||dict.id[key]||key;
  const titleMap={en:{'Pelanggan':'Customers','Tambah Pelanggan':'Add Customer','Edit Pelanggan':'Edit Customer','Paket Internet':'Internet Packages','Tagihan':'Billing','Pembayaran':'Payments','Laporan':'Reports','Pengaturan':'Settings','Jadwal Teknisi':'Technician Schedule','Jadwal Piket Server':'Server Duty Schedule','Ticketing':'Tickets','Arus Kas':'Cash Flow','Network Monitor':'Network Monitor','Profil Saya':'My Profile'}};
  res.locals.translateTitle=(value)=>language==='en'?(titleMap.en[value]||value):value;
  res.locals.currentPath=req.originalUrl?req.originalUrl.split('?')[0]:req.path||'/';
  res.locals.flash=req.session?.flash||null;
  if(req.session?.flash)delete req.session.flash;
  res.locals.formatRupiah=(value)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(value||0));
  res.locals.formatDate=(value)=>{if(!value)return '-';return new Intl.DateTimeFormat(language==='en'?'en-GB':'id-ID',{dateStyle:'medium',timeZone:'Asia/Jakarta'}).format(new Date(value));};
  next();
}
module.exports=commonLocals;
