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
