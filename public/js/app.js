(() => {
  const html = document.documentElement;
  const body = document.body;
  const loader = document.getElementById('appLoader');
  const progress = document.getElementById('pageProgress');

  const updateClock = () => {
    const formatter = new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
    });
    const value = `${formatter.format(new Date()).replaceAll('.', ':')} WIB`;
    document.querySelectorAll('[data-live-clock]').forEach(el => el.textContent = value);
  };
  updateClock();
  setInterval(updateClock, 1000);

  let loaderHidden = false;
  const hideLoader = () => {
    if (!loader || loaderHidden) return;
    loaderHidden = true;
    loader.classList.add('is-hidden');
    // Remove the splash from the DOM after the fade so it can never remain over the application.
    setTimeout(() => loader.remove(), 420);
  };
  if (document.readyState === 'complete') hideLoader();
  else window.addEventListener('load', hideLoader, { once:true });
  document.addEventListener('DOMContentLoaded', () => setTimeout(hideLoader, 700), { once:true });
  // Hard fallback for slow/blocked third-party assets.
  setTimeout(hideLoader, 1600);

  document.querySelectorAll('[data-sidebar-open]').forEach(btn => btn.addEventListener('click', () => body.classList.add('sidebar-open')));
  document.querySelectorAll('[data-sidebar-close]').forEach(btn => btn.addEventListener('click', () => body.classList.remove('sidebar-open')));

  const applyTheme = theme => {
    html.dataset.theme = theme;
    localStorage.setItem('inkamnet-theme', theme);
    document.querySelectorAll('[data-theme-toggle] i').forEach(i => i.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill');
    window.dispatchEvent(new CustomEvent('inkamnet:theme', { detail:{ theme } }));
  };
  applyTheme(localStorage.getItem('inkamnet-theme') || html.dataset.theme || 'dark');
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => btn.addEventListener('click', () => applyTheme(html.dataset.theme === 'dark' ? 'light' : 'dark')));

  document.querySelectorAll('.metric-card,.data-card,.filter-card,.ink-kpi,.ink-panel').forEach((el,index)=>{
    el.style.setProperty('--enter-delay', `${Math.min(index*38,280)}ms`); el.classList.add('reveal-item');
  });


  // Subtle cursor spotlight for a modern NOC feel (desktop only).
  if (window.matchMedia('(pointer:fine)').matches) {
    document.querySelectorAll('.metric-card,.data-card,.ink-kpi,.ink-panel,.collector-card,.timeline-card,.plan-card,.growth-insight-card').forEach(card => {
      card.classList.add('interactive-spotlight');
      card.addEventListener('pointermove', e => {
        const r=card.getBoundingClientRect();
        card.style.setProperty('--spot-x', `${e.clientX-r.left}px`);
        card.style.setProperty('--spot-y', `${e.clientY-r.top}px`);
        card.classList.add('spotlight-on');
      });
      card.addEventListener('pointerleave',()=>card.classList.remove('spotlight-on'));
    });
  }

  document.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => {
    const button = event.submitter;
    if (!button || button.dataset.noLoading === 'true') return;
    button.classList.add('is-loading');
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    setTimeout(() => { if (button.classList.contains('is-loading')) button.innerHTML = `<span class="spinner-border spinner-border-sm"></span><span>${html.lang==='en'?'Processing...':'Memproses...'}</span>`; }, 100);
  }));

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download') || link.href.startsWith('javascript:') || link.getAttribute('href').startsWith('#')) return;
    if (link.origin !== location.origin) return;
    progress.style.opacity='1';progress.style.width='18%';
    requestAnimationFrame(()=>{progress.style.width='72%'});
  });
  window.addEventListener('pageshow',()=>{progress.style.width='100%';setTimeout(()=>{progress.style.opacity='0';progress.style.width='0'},180)});


  // Bootstrap modals are moved to <body> to avoid stacking-context bugs caused by animated page containers.
  document.querySelectorAll('.page-enter .modal').forEach(modal => document.body.appendChild(modal));
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('shown.bs.modal', () => modal.querySelector('input:not([type="hidden"]),select,textarea,button')?.focus());
  });

  // Friendly filename preview for XLSX/payment upload dropzones.
  document.querySelectorAll('input[type="file"]').forEach(input => input.addEventListener('change', () => {
    const label=input.closest('label')?.querySelector('[data-file-label]');
    if(label) label.textContent=input.files?.[0]?.name || 'Belum ada file dipilih';
  }));

  // Open the browser calendar whenever a date field is clicked.
  // This keeps all date-driven modules consistent without adding another UI dependency.
  document.querySelectorAll('input[type="date"],input[type="datetime-local"]').forEach(input => {
    input.classList.add('ink-date-picker');
    input.setAttribute('autocomplete','off');
    input.addEventListener('click', () => {
      if (input.disabled || input.readOnly || typeof input.showPicker !== 'function') return;
      try { input.showPicker(); } catch (_) {}
    });
  });

  const palette=document.getElementById('commandPalette');
  const input=document.getElementById('commandInput');
  const openPalette=()=>{if(!palette)return;palette.classList.add('open');palette.setAttribute('aria-hidden','false');setTimeout(()=>input?.focus(),50)};
  const closePalette=()=>{palette?.classList.remove('open');palette?.setAttribute('aria-hidden','true');if(input)input.value='';document.querySelectorAll('#commandList a').forEach(a=>a.classList.remove('hidden'))};
  document.querySelectorAll('[data-command-open]').forEach(b=>b.addEventListener('click',openPalette));
  document.querySelectorAll('[data-command-close]').forEach(b=>b.addEventListener('click',closePalette));
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette()}if(e.key==='Escape')closePalette()});
  input?.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();document.querySelectorAll('#commandList a').forEach(a=>a.classList.toggle('hidden',q && !(`${a.textContent} ${a.dataset.keywords||''}`).toLowerCase().includes(q))) });

  // Lightweight bilingual layer for legacy screens that still contain hard-coded labels.
  // The Billing/Invoices module is intentionally kept in Indonesian per business requirement.
  if (html.lang === 'en' && !location.pathname.startsWith('/invoices')) {
    const UI_EN = new Map(Object.entries({
      'Tambah Pelanggan':'Add Customer','Edit Pelanggan':'Edit Customer','Manajemen Pelanggan':'Customer Management','Pelanggan Aktif':'Active Customers','Total Pelanggan':'Total Customers','Semua Pelanggan':'All Customers','Semua Status':'All Status','Semua Site':'All Sites','Terapkan Filter':'Apply Filter','Pencarian':'Search','CARI':'SEARCH','Cari':'Search','Batal':'Cancel','Simpan':'Save','Simpan Pelanggan':'Save Customer','Kembali':'Back','Alamat':'Address','No. WhatsApp':'WhatsApp Number','Jatuh Tempo':'Due Date','Aktif Sejak':'Active Since','Catatan':'Notes','Status Pelanggan':'Customer Status','Data pelanggan tidak ditemukan':'Customer data not found','Database Pelanggan':'Customer Database','Tambah Paket':'Add Package','Nama Paket':'Package Name','Harga / Bulan':'Monthly Price','Tambah Ticket':'Add Ticket','Buat Ticket':'Create Ticket','Pelanggan':'Customer','Prioritas':'Priority','Deskripsi / Checklist':'Description / Checklist','Belum ditugaskan':'Unassigned','Simpan PIC':'Save PIC','Progress Harian':'Daily Progress','Catatan Progress':'Progress Note','Jadwal Teknisi':'Technician Schedule','Tambah Jadwal Teknisi':'Add Technician Schedule','Tanggal':'Date','Jam':'Time','Teknisi':'Technician','Pekerjaan':'Job','Jadwal Piket Server':'Server Duty Schedule','Tambah Piket':'Add Duty','Generate Rotasi':'Generate Rotation','Minggu Lalu':'Previous Week','Minggu Depan':'Next Week','Nama Manual':'Manual Name','Laporan':'Reports','Laporan Pelanggan':'Customer Report','Laporan Tagihan':'Billing Report','Laporan Arus Kas':'Cash Flow Report','Generate Report':'Generate Report','Arus Kas':'Cash Flow','Pendapatan':'Income','Pengeluaran':'Expense','Saldo':'Balance','Data Kas':'Cash Data','Kategori Kas':'Cash Categories','Tambah Data Kas':'Add Cash Entry','Pengaturan':'Settings','Perusahaan':'Company','Aplikasi':'Application','Karyawan':'Employees','Departemen':'Departments','Posisi':'Positions','Bank':'Bank','Payment Gateway':'Payment Gateway','Tambah Karyawan':'Add Employee','Tambah Departemen':'Add Department','Tambah Posisi':'Add Position','Tambah Bank':'Add Bank','Nama':'Name','Telepon':'Phone','Bahasa Default':'Default Language','Tema Default':'Default Theme','Simpan Aplikasi':'Save Application','Simpan Perusahaan':'Save Company','Aktif':'Active','Nonaktif':'Inactive','Belum dipilih':'Not selected','Tanpa akun login':'No login account','Tanggal Bergabung':'Join Date','Profil Saya':'My Profile','Keamanan Akun':'Account Security','Password Saat Ini':'Current Password','Password Baru':'New Password','Ganti Password':'Change Password','Simpan Profil':'Save Profile','Keluar':'Logout','Riwayat Pembayaran':'Payment History','Pembayaran':'Payments','Diskon':'Discounts','Biaya Tambahan':'Additional Charges','Rekonsiliasi':'Reconciliation','Stok Barang':'Inventory','Pergerakan Stok':'Stock Movements','Pemakaian Material':'Material Usage','Log Aktivitas':'Activity Log'
    }));
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(node){const p=node.parentElement;if(!p||['SCRIPT','STYLE','TEXTAREA'].includes(p.tagName))return NodeFilter.FILTER_REJECT;return node.nodeValue.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;}});
    const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(node=>{const raw=node.nodeValue,trim=raw.trim(),translated=UI_EN.get(trim);if(translated)node.nodeValue=raw.replace(trim,translated);});
    document.querySelectorAll('[placeholder]').forEach(el=>{const v=el.getAttribute('placeholder');if(UI_EN.has(v))el.setAttribute('placeholder',UI_EN.get(v));});
    document.querySelectorAll('[title]').forEach(el=>{const v=el.getAttribute('title');if(UI_EN.has(v))el.setAttribute('title',UI_EN.get(v));});
  }


  // v1.11 compact professional row-action popovers.
  // Menus are portaled to <body> and positioned with fixed coordinates so table overflow cannot clip them.
  let activeActionPopover=null;
  const closeActionPopover=()=>{
    if(!activeActionPopover)return;
    activeActionPopover.menu.hidden=true;
    activeActionPopover.button.setAttribute('aria-expanded','false');
    activeActionPopover.button.classList.remove('show');
    activeActionPopover=null;
  };
  const positionActionPopover=(button,menu)=>{
    const r=button.getBoundingClientRect();
    const gap=7;
    menu.hidden=false;
    menu.style.visibility='hidden';
    menu.style.left='0px';menu.style.top='0px';
    const m=menu.getBoundingClientRect();
    const vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight;
    let left=Math.min(vw-m.width-8,Math.max(8,r.right-m.width));
    let top=r.bottom+gap;
    if(top+m.height>vh-8 && r.top-m.height-gap>=8)top=r.top-m.height-gap;
    else top=Math.min(vh-m.height-8,Math.max(8,top));
    menu.style.left=`${Math.round(left)}px`;menu.style.top=`${Math.round(top)}px`;menu.style.visibility='visible';
  };
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action-popover-target]');
    if(button){
      event.preventDefault();event.stopPropagation();
      const id=button.dataset.actionPopoverTarget,menu=id?document.getElementById(id):null;
      if(!menu)return;
      if(activeActionPopover?.menu===menu){closeActionPopover();return;}
      closeActionPopover();
      if(menu.parentElement!==document.body)document.body.appendChild(menu);
      positionActionPopover(button,menu);
      button.setAttribute('aria-expanded','true');button.classList.add('show');
      activeActionPopover={button,menu};
      return;
    }
    if(activeActionPopover && event.target.closest('.ink-action-popover')!==activeActionPopover.menu)closeActionPopover();
  });
  document.addEventListener('click',event=>{if(event.target.closest('[data-action-close],.ink-action-popover a'))closeActionPopover();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeActionPopover();});
  window.addEventListener('resize',closeActionPopover);
  document.addEventListener('scroll',closeActionPopover,true);

  // Progressive reveal for dense admin screens without adding a heavy animation library.
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add('ink-viewport-visible');observer.unobserve(entry.target)}
    }),{threshold:.08,rootMargin:'0px 0px -24px 0px'});
    document.querySelectorAll('.command-panel,.command-kpi,.command-pulse,.plan-card,.data-card,.filter-card').forEach(el=>observer.observe(el));
  }

})();

// MikroTik NMS — isolated page controller. Router credentials never enter this client.
(() => {
  const root=document.getElementById('nmsApp');
  if(!root)return;
  const $=s=>root.querySelector(s), $$=s=>[...root.querySelectorAll(s)];
  const csrf=root.dataset.csrf, isAdmin=root.dataset.admin==='1';
  const modalEl=document.getElementById('nmsSecretModal'), form=document.getElementById('nmsSecretForm');
  const modal=modalEl&&window.bootstrap?bootstrap.Modal.getOrCreateInstance(modalEl):null;
  let snapshots=[], selectedSite='all', trafficPrevious=new Map(), timer=null;
  const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const bytes=n=>{n=Number(n||0);if(!n)return '0 bps';const units=['bps','Kbps','Mbps','Gbps'];let i=0;while(n>=1000&&i<3){n/=1000;i++}return `${n>=10?n.toFixed(0):n.toFixed(1)} ${units[i]}`};
  const money=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0));
  const toast=(message,type='success')=>{const el=$('#nmsToast');el.className=`nms-toast ${type}`;el.innerHTML=`<i class="bi ${type==='danger'?'bi-x-octagon-fill':'bi-check-circle-fill'}"></i>${esc(message)}`;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,4200)};
  const allSecrets=()=>snapshots.flatMap(s=>s.secrets.map(x=>({...x,routerId:s.id,routerName:s.name,siteCode:s.siteCode,profiles:s.profiles})));

  function trafficRows(snapshot){
    const now=Date.now();
    return snapshot.interfaces.filter(x=>x.dynamic!=='true'&&x.disabled!=='true').map(x=>{
      const key=`${snapshot.id}:${x.name}`,old=trafficPrevious.get(key),seconds=old?Math.max((now-old.at)/1000,1):0;
      const rx=old?Math.max((x.rxByte-old.rx)*8/seconds,0):0,tx=old?Math.max((x.txByte-old.tx)*8/seconds,0):0;
      trafficPrevious.set(key,{rx:x.rxByte,tx:x.txByte,at:now});return {...x,rxRate:rx,txRate:tx};
    }).sort((a,b)=>(b.rxRate+b.txRate)-(a.rxRate+a.txRate)).slice(0,3);
  }
  function renderCard(snapshot){
    const card=root.querySelector(`[data-router="${snapshot.id}"]`);if(!card)return;
    card.classList.remove('loading','online','offline');card.classList.add(snapshot.ok?'online':'offline');
    card.querySelector('.nms-health').textContent=snapshot.ok?'ONLINE':'UNREACHABLE';
    if(!snapshot.ok){card.querySelector('.nms-interface-bars').innerHTML=`<div class="nms-router-error"><i class="bi bi-exclamation-triangle-fill"></i><span>${esc(snapshot.error)}</span></div>`;return;}
    const cpu=Math.min(Number(snapshot.resource?.['cpu-load']||0),100),radar=card.querySelector('.nms-radar');radar.style.setProperty('--cpu',cpu);radar.querySelector('b').textContent=`${cpu}%`;
    const specs=card.querySelectorAll('.nms-router-spec b');specs[0].textContent=snapshot.resource?.version||'-';specs[1].textContent=snapshot.resource?.uptime||'-';specs[2].textContent=`${snapshot.latencyMs} ms`;
    ['online','offline','isolated','linked'].forEach((k,i)=>card.querySelectorAll('.nms-router-counts b')[i].textContent=snapshot.counts[k]||0);
    const traffic=trafficRows(snapshot);card.querySelector('.nms-interface-bars').innerHTML=traffic.length?traffic.map(x=>`<div class="nms-iface"><span><b><i class="bi bi-ethernet"></i>${esc(x.name)}</b><small class="${x.running==='true'?'up':''}">${x.running==='true'?'UP':'DOWN'}</small></span><div><em class="down"><i class="bi bi-arrow-down"></i>${bytes(x.rxRate)}</em><em class="up"><i class="bi bi-arrow-up"></i>${bytes(x.txRate)}</em></div></div>`).join(''):'<div class="nms-router-error"><span>Interface belum tersedia</span></div>';
  }
  function renderSummary(){
    const ok=snapshots.filter(x=>x.ok).length,total=snapshots.reduce((a,s)=>{for(const k of ['online','offline','isolated','linked'])a[k]+=Number(s.counts[k]||0);return a},{online:0,offline:0,isolated:0,linked:0});
    $('#nmsRouterCount').textContent=`${ok}/${snapshots.length}`;$('#nmsOnlineCount').textContent=total.online;$('#nmsOfflineCount').textContent=total.offline;$('#nmsIsolatedCount').textContent=total.isolated;$('#nmsLinkedCount').textContent=total.linked;
  }
  function renderTable(){
    const q=$('#nmsSearch').value.trim().toLowerCase(),status=$('#nmsStatusFilter').value;
    const rows=allSecrets().filter(x=>(selectedSite==='all'||x.siteCode===selectedSite)&&(status==='all'||x.status===status)&&(!q||`${x.name} ${x.customer?.name||''} ${x.customer?.customer_code||''} ${x.active?.address||''}`.toLowerCase().includes(q)));
    $('#nmsSecretRows').innerHTML=rows.length?rows.map(x=>`<tr class="nms-secret-row" data-status="${x.status}"><td><span class="nms-secret-status ${x.status}"><i></i>${x.status==='isolated'?'ISOLIR':x.status.toUpperCase()}</span></td><td><span class="cell-main">${esc(x.name)}</span><span class="cell-sub">${esc(x.comment||'Tanpa catatan')}</span></td><td>${x.customer?`<a class="nms-customer-link" href="/customers/${x.customer.id}"><b>${esc(x.customer.name)}</b><small>${esc(x.customer.customer_code)} · ${esc(x.customer.package_name||'-')}</small></a>`:'<span class="nms-unlinked"><i class="bi bi-link-45deg"></i>Belum terhubung</span>'}</td><td><span class="status-badge purple">${esc(x.siteCode)}</span><span class="cell-sub">${esc(x.routerName)}</span></td><td><span class="nms-profile">${esc(x.profile||'default')}</span></td><td>${x.active?`<span class="cell-main">${esc(x.active.address||'-')}</span><span class="cell-sub">${esc(x.active.uptime||'-')} · ${esc(x.active['caller-id']||'-')}</span>`:'<span class="cell-sub">Tidak ada sesi aktif</span>'}</td><td>${x.customer?`<span class="${Number(x.customer.outstanding)>0?'text-danger-soft':'text-success-soft'}">${money(x.customer.outstanding)}</span>`:'-'}</td><td>${isAdmin?`<button class="nms-row-action" data-secret-edit="${esc(x['.id'])}" data-router="${x.routerId}" title="Lihat dan ubah"><i class="bi bi-sliders2"></i></button>`:''}</td></tr>`).join(''):`<tr><td colspan="8"><div class="empty-state"><i class="bi bi-search"></i><strong>Secret tidak ditemukan</strong><small>Ubah site, status, atau kata pencarian.</small></div></td></tr>`;
  }
  function render(){snapshots.forEach(renderCard);renderSummary();renderTable();$$('.nms-router-card').forEach(x=>x.hidden=selectedSite!=='all'&&x.dataset.site!==selectedSite)}
  async function refresh(silent=false){
    const button=$('#nmsRefresh');button?.classList.add('spinning');
    try{const r=await fetch('/network/api/snapshot',{headers:{Accept:'application/json'}}),data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'Telemetry gagal');snapshots=data.snapshots;render();$('#nmsLastSync').textContent=new Date(data.generatedAt).toLocaleTimeString('id-ID');if(!silent)toast('Telemetry tiga site berhasil disinkronkan.');}
    catch(e){toast(e.message,'danger');$('#nmsLastSync').textContent='SYNC ERROR';}
    finally{button?.classList.remove('spinning')}
  }
  async function loadCustomers(routerId,selected=''){
    const select=form.elements.customer_id;select.innerHTML='<option value="">Memuat pelanggan…</option>';
    try{const r=await fetch(`/network/api/routers/${routerId}/customers`),data=await r.json();if(!r.ok)throw new Error(data.error);select.innerHTML='<option value="">Tanpa pelanggan billing</option>'+data.customers.map(c=>`<option value="${c.id}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.customer_code)} · ${esc(c.name)}${c.pppoe_username?` (${esc(c.pppoe_username)})`:''}</option>`).join('');}catch(e){select.innerHTML='<option value="">Gagal memuat pelanggan</option>';toast(e.message,'danger')}
  }
  function setProfiles(routerId,selected='default'){const snapshot=snapshots.find(x=>String(x.id)===String(routerId)),select=form.elements.profile;select.innerHTML=(snapshot?.profiles?.length?snapshot.profiles:[{name:'default'}]).map(p=>`<option value="${esc(p.name)}" ${p.name===selected?'selected':''}>${esc(p.name)}${p['rate-limit']?` · ${esc(p['rate-limit'])}`:''}</option>`).join('')}
  function openForm(secret=null,routerId=''){
    form.reset();form.elements.secret_id.value=secret?.['.id']||'';form.elements.router_id.value=routerId||secret?.routerId||'';form.elements.router_id.disabled=!!secret;
    for(const name of ['name','service','local-address','remote-address','caller-id','comment'])if(form.elements[name])form.elements[name].value=secret?.[name]|| (name==='service'?'pppoe':'');
    form.elements.disabled.checked=secret?.disabled==='true';document.getElementById('nmsModalTitle').textContent=secret?`Kelola ${secret.name}`:'Secret PPPoE Baru';setProfiles(form.elements.router_id.value,secret?.profile||'default');loadCustomers(form.elements.router_id.value,secret?.customer?.id||'');modal?.show();
  }
  $('#nmsRefresh')?.addEventListener('click',()=>refresh());$('#nmsAddSecret')?.addEventListener('click',()=>openForm());
  $('#nmsSearch')?.addEventListener('input',renderTable);$('#nmsStatusFilter')?.addEventListener('change',renderTable);
  $$('.nms-site-tabs button').forEach(btn=>btn.addEventListener('click',()=>{$$('.nms-site-tabs button').forEach(x=>x.classList.remove('active'));btn.classList.add('active');selectedSite=btn.dataset.site;render()}));
  form?.elements.router_id.addEventListener('change',e=>{setProfiles(e.target.value);loadCustomers(e.target.value)});
  form?.querySelector('[data-password-toggle]')?.addEventListener('click',e=>{const input=form.elements.password;input.type=input.type==='password'?'text':'password';e.currentTarget.querySelector('i').className=`bi ${input.type==='password'?'bi-eye':'bi-eye-slash'}`});
  root.addEventListener('click',e=>{const b=e.target.closest('[data-secret-edit]');if(!b)return;const secret=allSecrets().find(x=>String(x['.id'])===b.dataset.secretEdit&&String(x.routerId)===b.dataset.router);if(secret)openForm(secret,b.dataset.router)});
  form?.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('[type="submit"]'),data=Object.fromEntries(new FormData(form));data.router_id=form.elements.router_id.value;data.disabled=form.elements.disabled.checked?'true':'false';const id=data.secret_id;delete data.secret_id;button.disabled=true;try{const r=await fetch(id?`/network/secrets/${encodeURIComponent(id)}`:'/network/secrets',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Accept:'application/json'},body:JSON.stringify(data)}),out=await r.json();if(!r.ok||!out.ok)throw new Error(out.error||'Gagal menyimpan');modal?.hide();toast(out.message);await refresh(true)}catch(err){toast(err.message,'danger')}finally{button.disabled=false}});
  refresh(true);timer=setInterval(()=>refresh(true),15000);window.addEventListener('beforeunload',()=>clearInterval(timer));
})();
