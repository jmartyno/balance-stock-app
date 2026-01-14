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
function updateActionLocks(){
  const hasTienda = !!(state.tienda && state.tienda.trim());
  const hasSesion  = !!state.sesionId;

  let total = 0;
  for (const v of state.counts.values()) total += (Number(v) || 0);
  const hasUnits = total > 0;

  const canSend = hasTienda && hasSesion && hasUnits;

  // Botones de enviar/exportar
  if ($('btnCompartir')) $('btnCompartir').disabled = !canSend;
  if ($('btnExport')) $('btnExport').disabled = !canSend;

  // Mensaje útil
  const hints = [];
  if (!hasTienda) hints.push('elige tienda');
  if (!hasSesion) hints.push('inicia sesión');
  if (!hasUnits) hints.push('añade unidades');

  if (!canSend) $('csvPreview').placeholder = `Para compartir: ${hints.join(' + ')}.`;
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
// ===== Cámara (BarcodeDetector) =====
let stream = null;
let scanning = false;
let barcodeDetector = null;
let rafId = null;
let lastSeen = { value: null, at: 0 };

async function initBarcodeDetector(){
  if ('BarcodeDetector' in window) {
    try {
      barcodeDetector = new BarcodeDetector({
        formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code']
      });
      return true;
    } catch (e) {}
  }
  barcodeDetector = null;
  return false;
}
async function startCamera(){
  // 1) exige sesión (si quieres que abra aunque no haya sesión, quita este if)
  if(!ensureSesion()) return;

  // 2) abre cámara SIEMPRE
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'environment', width:{ideal:1280}, height:{ideal:720} },
      audio: false
    });

    $('video').srcObject = stream;
    await $('video').play();

    if ($('cameraWrap')) $('cameraWrap').style.display = '';
    if ($('btnStartCam')) $('btnStartCam').disabled = true;
    if ($('btnStopCam')) $('btnStopCam').disabled = false;

  } catch (e){
    toast('Sin cámara', 'Permite acceso a cámara');
    return;
  }

  // 3) intenta activar el detector (si no hay, al menos ya ves la cámara)
  const ok = await initBarcodeDetector();
  if(!ok){
    toast('Cámara abierta', 'Este móvil/navegador no soporta escaneo automático');
    return;
  }

  scanning = true;
  loopScan();
  toast('Cámara lista', 'Escaneando…');
}

function stopCamera(){
  scanning = false;

  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (stream){
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }

  if ($('cameraWrap')) $('cameraWrap').style.display = 'none';
  if ($('btnStartCam')) $('btnStartCam').disabled = false;
  if ($('btnStopCam')) $('btnStopCam').disabled = true;

  toast('Cámara cerrada');
}

async function loopScan(){
  if(!scanning || !barcodeDetector) return;

  try{
    const codes = await barcodeDetector.detect($('video'));
    if (codes && codes.length){
      const raw = String(codes[0].rawValue || '').trim();
      const now = Date.now();
      if (raw && (lastSeen.value !== raw || (now - lastSeen.at) > 700)){
        lastSeen = { value: raw, at: now };
        addOneByEan(raw);
      }
    }
  } catch(e){}

  rafId = requestAnimationFrame(loopScan);
}
function saveSession(){
  const payload = {
    v: 1,
    sesionId: state.sesionId,
    tienda: state.tienda,
    uso: state.uso,
    counts: Array.from(state.counts.entries()), // [ [ean, unidades], ... ]
    undo: state.undo,
    lastEan: state.lastEan,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem('balance_stock_session', JSON.stringify(payload));
}

function loadSession(){
  const raw = localStorage.getItem('balance_stock_session');
  if(!raw) { toast('No hay sesión guardada'); return; }
  const p = JSON.parse(raw);

  state.sesionId = p.sesionId || null;
  state.tienda = p.tienda || '';
  state.uso = p.uso || 'NUEVO';
  state.counts = new Map(p.counts || []);
  state.undo = p.undo || [];
  state.lastEan = p.lastEan || null;

  // refrescar UI
  if ($('sesionHint')) $('sesionHint').textContent = state.sesionId ? `Sesión: ${state.sesionId}` : 'Sin sesión';
  if ($('tienda')) $('tienda').value = state.tienda;
  if ($('uso')) $('uso').value = state.uso;

  updateStats();
  updateActionLocks();
  toast('Sesión cargada');
}

window.addEventListener('DOMContentLoaded', async ()=>{
  await loadCatalogo();

  $('tabScan').onclick = ()=>setTab('tabScan');
  $('tabManual').onclick = ()=>setTab('tabManual');
  $('tabResumen').onclick = ()=>setTab('tabResumen');

  if ($('btnStartCam')) $('btnStartCam').onclick = startCamera;
  if ($('btnStopCam')) $('btnStopCam').onclick = stopCamera;

  $('btnNuevaSesion').onclick = nuevaSesion;
  $('tienda').onchange = e => { state.tienda = e.target.value; updateActionLocks(); };
  $('uso').onchange = e => { state.uso = e.target.value; };

  $('buscar').oninput = e => fillResultados(e.target.value);
  $('resultado').onchange = e => renderManualItem(e.target.value);
  $('manualBox').onclick = manualClick;

  $('btnUndo').onclick = undo;
  $('btnGrabarLinea').onclick = ()=>toast('Línea grabada');

  $('btnExport').onclick = compartirCSV;
  $('btnCompartir').onclick = compartirCSV;

  updateStats();
  saveSession();
  updateActionLocks();
});
