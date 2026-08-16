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
    setTimeout(() => { if (button.classList.contains('is-loading')) button.innerHTML = '<span class="spinner-border spinner-border-sm"></span><span>Memproses...</span>'; }, 100);
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

  const palette=document.getElementById('commandPalette');
  const input=document.getElementById('commandInput');
  const openPalette=()=>{if(!palette)return;palette.classList.add('open');palette.setAttribute('aria-hidden','false');setTimeout(()=>input?.focus(),50)};
  const closePalette=()=>{palette?.classList.remove('open');palette?.setAttribute('aria-hidden','true');if(input)input.value='';document.querySelectorAll('#commandList a').forEach(a=>a.classList.remove('hidden'))};
  document.querySelectorAll('[data-command-open]').forEach(b=>b.addEventListener('click',openPalette));
  document.querySelectorAll('[data-command-close]').forEach(b=>b.addEventListener('click',closePalette));
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette()}if(e.key==='Escape')closePalette()});
  input?.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();document.querySelectorAll('#commandList a').forEach(a=>a.classList.toggle('hidden',q && !(`${a.textContent} ${a.dataset.keywords||''}`).toLowerCase().includes(q))) });
})();
