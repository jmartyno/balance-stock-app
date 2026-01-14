let CATALOGO = [];
let byEan = new Map();
let byItemKey = new Map();
let itemsForSearch = [];

const state = {
  sesionId: null,
  tienda: "",
  uso: "NUEVO",
  counts: new Map(),
  undo: [],
  lastEan: null,
  currentItemKey: null
};

function $(id){ return document.getElementById(id); }

/* ===================== UTIL ===================== */
function toast(t, s=""){
  $('toastT').textContent = t;
  $('toastS').textContent = s;
  const el = $('toast');
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>el.classList.remove('show'), 1400);
}

function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type='sine'; o.frequency.value=880;
    g.gain.value=0.06;
    o.connect(g); g.connect(ctx.destination);
    o.start();
    setTimeout(()=>{o.stop(); ctx.close();}, 80);
  }catch(e){}
}
function vibrate(){ if(navigator.vibrate) navigator.vibrate(30); }

function nowId(){
  const d = new Date();
  const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/* ===================== TABS ===================== */
function setTab(tabId){
  const tabs = [['tabScan','panelScan'],['tabManual','panelManual'],['tabResumen','panelResumen']];
  for(const [t,p] of tabs){
    const on = (t===tabId);
    $(t).classList.toggle('active', on);
    $(p).style.display = on ? '' : 'none';
  }
  if(tabId==='tabResumen') rebuildResumen();
}

/* ===================== CATALOGO ===================== */
async function loadCatalogo(){
  const res = await fetch('catalogo.csv', {cache:'no-store'});
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(';').map(h=>h.trim());

  for(let i=1;i<lines.length;i++){
    const p = lines[i].split(';');
    const r = {};
    headers.forEach((h,j)=> r[h]=(p[j]||'').trim());
    CATALOGO.push(r);
    if(r.ean) byEan.set(r.ean, r);
    const key = `${r.codigo}|${r.descripcion}|${r.familia}`;
    if(!byItemKey.has(key)) byItemKey.set(key, []);
    byItemKey.get(key).push(r);
  }

  itemsForSearch = Array.from(byItemKey.entries()).map(([key, arr])=>{
    const f = arr[0];
    return { key, codigo:f.codigo, familia:f.familia, descripcion:f.descripcion };
  });

  $('buildPill').textContent = `Catálogo: ${CATALOGO.length} filas`;
  fillResultados('');
}

/* ===================== SESION ===================== */
function nuevaSesion(){
  state.sesionId = nowId();
  state.counts = new Map();
  state.undo = [];
  state.lastEan = null;
  $('sesionHint').textContent = `Sesión: ${state.sesionId}`;
  updateStats();
  toast('Sesión iniciada');
}

function ensureSesion(){
  if(!state.sesionId){
    toast('Falta sesión','Pulsa Iniciar sesión');
    return false;
  }
  return true;
}

/* ===================== CONTADOR ===================== */
function addOneByEan(ean){
  if(!ensureSesion()) return;
  const it = byEan.get(ean);
  if(!it){ toast('EAN no encontrado', ean); return; }
  const n = (state.counts.get(ean)||0)+1;
  state.counts.set(ean,n);
  state.undo.push(ean);
  state.lastEan = ean;
  beep(); vibrate();
  updateStats();
}

function undo(){
  const ean = state.undo.pop();
  if(!ean) return;
  state.counts.set(ean, Math.max(0,(state.counts.get(ean)||0)-1));
  updateStats();
}

function updateStats(){
  let l=0,u=0;
  for(const v of state.counts.values()){
    if(v>0){ l++; u+=v; }
  }
  $('statLineas').textContent=l;
  $('statUnidades').textContent=u;
  $('btnUndo').disabled = state.undo.length===0;
}

/* ===================== BUSQUEDA ===================== */
function tokenize(q){
  return q.toLowerCase().replace(/[^\w ]+/g,' ').split(/\s+/).filter(Boolean);
}
function matchTokens(h,t){ return t.every(x=>h.includes(x)); }

function fillResultados(q){
  const sel=$('resultado'); sel.innerHTML='';
  const tok=tokenize(q||'');
  if(!tok.length) return;
  for(const it of itemsForSearch){
    const hay=`${it.descripcion} ${it.codigo} ${it.familia}`.toLowerCase();
    if(matchTokens(hay,tok)){
      const o=document.createElement('option');
      o.value=it.key;
      o.textContent=`${it.descripcion} · ${it.codigo}`;
      sel.appendChild(o);
    }
  }
}

function renderManualItem(key){
  const box=$('manualBox'); box.innerHTML='';
  if(!byItemKey.has(key)) return;
  $('btnGrabarLinea').disabled=false;
  for(const v of byItemKey.get(key)){
    const n=state.counts.get(v.ean)||0;
    const d=document.createElement('div');
    d.className='item';
    d.innerHTML=`
      <div>Talla ${v.talla}</div>
      <div class="qty">
        <button data-ean="${v.ean}" data-a="-">-</button>
        <span id="u_${v.ean}">${n}</span>
        <button data-ean="${v.ean}" data-a="+">+</button>
      </div>`;
    box.appendChild(d);
  }
}

function manualClick(e){
  const b=e.target.closest('button[data-ean]');
  if(!b) return;
  if(!ensureSesion()) return;
  const ean=b.dataset.ean;
  const n=(state.counts.get(ean)||0)+(b.dataset.a==='+'?1:-1);
  state.counts.set(ean,Math.max(0,n));
  if(b.dataset.a==='+'){ state.undo.push(ean); beep(); vibrate(); }
  $('u_'+ean).textContent=state.counts.get(ean);
  updateStats();
}

/* ===================== CSV ===================== */
function buildCSV(){
  const rows=[['fecha','sesion','tienda','uso','descripcion','talla','unidades','ean'].join(';')];
  const f=new Date().toISOString().slice(0,10);
  for(const [ean,u] of state.counts){
    if(u<=0) continue;
    const it=byEan.get(ean);
    rows.push([f,state.sesionId,state.tienda,state.uso,it.descripcion,it.talla,u,ean].join(';'));
  }
  return rows.join('\n');
}

/* ===================== COMPARTIR ===================== */
async function compartirCSV(){
  const csv=buildCSV();
  const name=`balance_${state.sesionId||'sin_sesion'}.csv`;
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});

  if(navigator.share){
    try{
      const file=new File([blob],name,{type:'text/csv'});
      await navigator.share({files:[file],title:name});
      toast('Compartido');
      return;
    }catch(e){}
  }

  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('Descargado');
}

/* ===================== RESUMEN ===================== */
function rebuildResumen(){
  const m=new Map();
  let t=0;
  for(const [ean,u] of state.counts){
    if(u<=0) continue;
    const d=byEan.get(ean).descripcion;
    m.set(d,(m.get(d)||0)+u);
    t+=u;
  }
  const out=[...m.entries()].map(([d,u])=>`${d}: ${u}`);
  out.push(`TOTAL ALBARAN ${t}`);
  $('csvPreview').value=out.join('\n');
}

/* ===================== INIT ===================== */
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadCatalogo();

  $('tabScan').onclick=()=>setTab('tabScan');
  $('tabManual').onclick=()=>setTab('tabManual');
  $('tabResumen').onclick=()=>setTab('tabResumen');

  $('btnNuevaSesion').onclick=nuevaSesion;
  $('tienda').onchange=e=>state.tienda=e.target.value;
  $('uso').onchange=e=>state.uso=e.target.value;

  $('buscar').oninput=e=>fillResultados(e.target.value);
  $('resultado').onchange=e=>renderManualItem(e.target.value);
  $('manualBox').onclick=manualClick;

  $('btnUndo').onclick=undo;
  $('btnGrabarLinea').onclick=()=>toast('Línea grabada');
  $('btnExport').onclick=()=>compartirCSV();
  $('btnCompartir').onclick=compartirCSV;

  updateStats();
});
