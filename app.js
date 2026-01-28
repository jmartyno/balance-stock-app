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

/* ===================== HELPERS CSV ===================== */
function unq(s){
  s = String(s ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}
function pick(obj, keys){
  for (const k of keys){
    if (obj && obj[k] != null && String(obj[k]).trim() !== '') return obj[k];
  }
  return '';
}
function normHeader(h){
  return String(h||'')
    .replace(/^\uFEFF/, '')                      // BOM
    .replace(/[\u00A0\u200B-\u200D\u2060]/g,' ') // NBSP + zero-width
    .trim()
    .toLowerCase();
}

/* ===================== UTIL ===================== */
function toast(t, s=""){
  $('toastT').textContent = t;
  $('toastS').textContent = s;
  const el = $('toast');
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>el.classList.remove('show'), 1400);
}

function beep(times = 1){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try{ ctx.resume && ctx.resume(); }catch(e){}
    let t0 = ctx.currentTime;

    for(let i=0;i<times;i++){
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.value = 0.06;
      o.connect(g);
      g.connect(ctx.destination);

      const startAt = t0 + (i * 0.12);
      o.start(startAt);
      o.stop(startAt + 0.08);
    }

    setTimeout(()=>{ try{ ctx.close(); }catch(e){} }, times * 220);
  }catch(e){}
}

function beepError(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    try{ ctx.resume && ctx.resume(); }catch(e){}

    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 220;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);

    o.start();
    setTimeout(()=>{
      try{ o.stop(); }catch(e){}
      try{ ctx.close(); }catch(e){}
    }, 220);
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
  CATALOGO = [];
  byEan = new Map();
  byItemKey = new Map();
  itemsForSearch = [];

  const res = await fetch('catalogo.csv', {cache:'no-store'});
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);

  if(!lines.length){
    $('buildPill').textContent = `Catálogo: 0 filas`;
    return;
  }

  const headersRaw  = lines[0].split(';').map(h=>unq(h));
  const headersNorm = headersRaw.map(normHeader);

  for(let i=1;i<lines.length;i++){
    const p = lines[i].split(';');

    const rawN = {};
    headersNorm.forEach((hn,j)=> rawN[hn] = unq(p[j] || ''));

    // Tu catálogo: codigo;familia;descripcion;talla;ean
    const codigo = pick(rawN, ['codigo']); // <-- aquí está el 100
    const r = {
      // “concepto” lo vamos a exportar, y viene de codigo
      concepto: codigo,
      codigo: codigo,
      familia: pick(rawN, ['familia']),
      descripcion: pick(rawN, ['descripcion']),
      talla: pick(rawN, ['talla']),
      ean: pick(rawN, ['ean'])
    };

    Object.assign(r, rawN);

    CATALOGO.push(r);

    const eanKey = String(r.ean || '').trim();
    if(eanKey) byEan.set(eanKey, r);

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
    toast('Falta sesión','Pulsa Iniciar sesión o Cargar sesión');
    return false;
  }
  return true;
}

/* ===================== CONTADOR ===================== */
function addOneByEan(ean){
  if(!ensureSesion()) return;
  ean = String(ean||'').trim();

  const it = byEan.get(ean);
  if(!it){
    beepError();
    vibrate();
    toast('EAN no encontrado', ean);
    return;
  }

  const n = (state.counts.get(ean)||0)+1;
  state.counts.set(ean,n);
  state.undo.push(ean);
  state.lastEan = ean;

  beep();
  vibrate();
  updateStats();

  const nEl = document.getElementById('u_'+ean);
  if(nEl) nEl.textContent = String(n);
}

function undo(){
  const ean = state.undo.pop();
  if(!ean) return;
  const next = Math.max(0,(state.counts.get(ean)||0)-1);
  state.counts.set(ean, next);
  updateStats();
  const nEl = document.getElementById('u_'+ean);
  if(nEl) nEl.textContent = String(next);
}

function updateStats(){
  let l=0,u=0;
  for(const v of state.counts.values()){
    if(v>0){ l++; u+=v; }
  }
  $('statLineas').textContent=l;
  $('statUnidades').textContent=u;
  $('btnUndo').disabled = state.undo.length===0;

  const last = state.lastEan ? byEan.get(state.lastEan) : null;
  if($('statUltimo')) $('statUltimo').textContent = last ? String(last.talla||'—') : '—';

  updateActionLocks();
  saveSession();
}

function updateActionLocks(){
  const hasTienda = !!(state.tienda && state.tienda.trim());
  const hasSesion  = !!state.sesionId;

  let total = 0;
  for (const v of state.counts.values()) total += (Number(v) || 0);
  const hasUnits = total > 0;

  const canSend = hasTienda && hasSesion && hasUnits;

  if ($('btnCompartir')) $('btnCompartir').disabled = !canSend;
  if ($('btnExport')) $('btnExport').disabled = !canSend;

  const hints = [];
  if (!hasTienda) hints.push('elige tienda');
  if (!hasSesion) hints.push('inicia/carga sesión');
  if (!hasUnits) hints.push('añade unidades');

  if (!canSend) $('csvPreview').placeholder = `Para compartir: ${hints.join(' + ')}.`;
  else $('csvPreview').placeholder = '';
}

/* ===================== BUSQUEDA ===================== */
function tokenize(q){
  return (q||'')
    .toLowerCase()
    .replace(/[\u00A0]/g,' ')
    .replace(/[^\p{L}\p{N} ]+/gu,' ')
    .split(/\s+/)
    .filter(Boolean);
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
    const eanKey = String(v.ean||'').trim();
    const n = state.counts.get(eanKey)||0;
    const d=document.createElement('div');
    d.className='item';
    d.innerHTML=`
      <div>Talla ${v.talla}</div>
      <div class="qty">
        <button type="button" data-ean="${eanKey}" data-a="-">-</button>
        <span id="u_${eanKey}">${n}</span>
        <button type="button" data-ean="${eanKey}" data-a="+">+</button>
      </div>`;
    box.appendChild(d);
  }
}

function manualClick(e){
  const b=e.target.closest('button[data-ean]');
  if(!b) return;
  if(!ensureSesion()) return;

  const ean=String(b.dataset.ean||'').trim();
  const n=(state.counts.get(ean)||0)+(b.dataset.a==='+'?1:-1);
  const next = Math.max(0,n);

  state.counts.set(ean,next);
  if(b.dataset.a==='+'){ state.undo.push(ean); state.lastEan = ean; beep(); vibrate(); }

  $('u_'+ean).textContent=next;
  updateStats();
}

/* ===================== CSV ===================== */
function buildCSV(){
  const rows=[[
    'fecha','sesion','tienda','uso',
    'concepto',
    'descripcion','talla','unidades','ean'
  ].join(';')];

  const f=new Date().toISOString().slice(0,10);

  for(const [ean,u] of state.counts){
    if(u<=0) continue;

    const it=byEan.get(String(ean).trim());
    if(!it) continue;

    // ✅ concepto = codigo (tu CSV)
    const concepto = unq(it.codigo || '');

    rows.push([
      f,
      state.sesionId,
      state.tienda,
      state.uso,
      concepto,
      unq(it.descripcion || ''),
      unq(it.talla || ''),
      u,
      String(ean).trim()
    ].join(';'));
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
  const agg = new Map();
  let totalAlbaran = 0;

  for (const [ean, u] of state.counts.entries()){
    const units = Number(u) || 0;
    if (units <= 0) continue;

    const it = byEan.get(String(ean).trim());
    if (!it) continue;

    const desc = (it.descripcion || '').trim();
    const talla = String(it.talla || '').trim();

    if (!agg.has(desc)) agg.set(desc, new Map());
    const tmap = agg.get(desc);

    tmap.set(talla, (tmap.get(talla) || 0) + units);
    totalAlbaran += units;
  }

  const descs = Array.from(agg.keys()).sort((a,b)=>
    a.localeCompare(b, 'es', { sensitivity:'base' })
  );

  const lines = [];
  for (const desc of descs){
    const tmap = agg.get(desc);
    const tallas = Array.from(tmap.entries()).sort((a,b)=>
      String(a[0]).localeCompare(String(b[0]), 'es', { numeric:true })
    );

    let totalDesc = 0;
    const chunk = tallas.map(([t, n])=>{
      totalDesc += n;
      return `${t}/${n}`;
    }).join(' ');

    lines.push(`${desc}: ${chunk} TOTAL ${totalDesc}`);
  }

  lines.push(`TOTAL ALBARAN ${totalAlbaran}`);
  $('csvPreview').value = lines.join('\n');
}

/* ===================== CAMARA (BarcodeDetector) + TORCH + BEST-EFFORT CONSTRAINTS ===================== */
let stream = null;
let scanning = false;
let barcodeDetector = null;
let rafId = null;

let torchOn = false;
let videoTrack = null;

let lastSeen = { value:null, stableCount:0, locked:false };

// ✅ COOLDOWN REAL (evita sensibilidad / duplicados)
let lastScanAt = 0;
const SCAN_COOLDOWN_MS = 2000;

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

async function applyBestEffortConstraints(track){
  if(!track) return;
  try{
    const caps = track.getCapabilities ? track.getCapabilities() : null;
    const adv = [];

    if (caps?.focusMode?.includes('continuous')) adv.push({ focusMode: 'continuous' });
    if (caps?.exposureMode?.includes('continuous')) adv.push({ exposureMode: 'continuous' });

    if (caps && 'zoom' in caps){
      const maxZ = Number(caps.zoom?.max || 1);
      const z = Math.min(maxZ, 1.5);
      if (z > 1) adv.push({ zoom: z });
    }

    if (adv.length) await track.applyConstraints({ advanced: adv });
  }catch(e){}
}

async function toggleTorch(){
  if(!videoTrack) return;
  try{
    const caps = videoTrack.getCapabilities ? videoTrack.getCapabilities() : null;
    if(!(caps && 'torch' in caps)){
      toast('Sin linterna', 'Este móvil no la soporta');
      return;
    }
    torchOn = !torchOn;
    await videoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
    if ($('btnTorch')) $('btnTorch').textContent = torchOn ? 'Linterna: ON' : 'Linterna';
    saveSession();
  }catch(e){
    toast('No se pudo activar', 'No soportado o sin permisos');
  }
}

async function startCamera(){
  if(!ensureSesion()) return;

  try{
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'environment', width:{ideal:1280}, height:{ideal:720} },
      audio: false
    });

    videoTrack = stream.getVideoTracks()[0] || null;
    torchOn = false;

    await applyBestEffortConstraints(videoTrack);

    if ($('btnTorch')) {
      const caps = videoTrack?.getCapabilities ? videoTrack.getCapabilities() : null;
      $('btnTorch').disabled = !(caps && 'torch' in caps);
      $('btnTorch').textContent = 'Linterna';
    }

    const v = $('video');
    if (v){
      // ✅ iOS helpers (no rompen Android)
      v.setAttribute('playsinline','');
      v.muted = true;
      v.autoplay = true;
      v.srcObject = stream;
      await v.play();
    }

    if ($('cameraWrap')) $('cameraWrap').style.display = '';
    if ($('btnStartCam')) $('btnStartCam').disabled = true;
    if ($('btnStopCam')) $('btnStopCam').disabled = false;

  } catch (e){
    toast('Sin cámara', 'Permite acceso a cámara');
    return;
  }

  const ok = await initBarcodeDetector();
  if(!ok){
    toast('Cámara abierta', 'Este móvil/navegador no soporta escaneo automático');
    return;
  }

  lastSeen = { value:null, stableCount:0, locked:false };
  lastScanAt = 0;

  scanning = true;
  loopScan();
  toast('Cámara lista', 'Escaneando…');
}

async function stopCamera(){
  scanning = false;

  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  try{
    if (videoTrack && torchOn){
      await videoTrack.applyConstraints({ advanced: [{ torch: false }] });
    }
  }catch(e){}

  torchOn = false;
  if ($('btnTorch')) { $('btnTorch').disabled = true; $('btnTorch').textContent = 'Linterna'; }

  if (stream){
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  videoTrack = null;

  if ($('cameraWrap')) $('cameraWrap').style.display = 'none';
  if ($('btnStartCam')) $('btnStartCam').disabled = false;
  if ($('btnStopCam')) $('btnStopCam').disabled = true;

  lastSeen = { value:null, stableCount:0, locked:false };
  lastScanAt = 0;
}

async function loopScan(){
  if(!scanning || !barcodeDetector) return;

  try{
    const codes = await barcodeDetector.detect($('video'));

    if(!codes || !codes.length){
      lastSeen.locked = false;
      lastSeen.value = null;
      lastSeen.stableCount = 0;
      rafId = requestAnimationFrame(loopScan);
      return;
    }

    const raw = String(codes[0].rawValue || '').trim();
    if(!raw){
      rafId = requestAnimationFrame(loopScan);
      return;
    }

    if(lastSeen.locked && lastSeen.value !== raw){
      lastSeen.value = raw;
      lastSeen.stableCount = 1;
      lastSeen.locked = false;
      rafId = requestAnimationFrame(loopScan);
      return;
    }

    if(lastSeen.locked && lastSeen.value === raw){
      rafId = requestAnimationFrame(loopScan);
      return;
    }

    if(lastSeen.value === raw) lastSeen.stableCount++;
    else {
      lastSeen.value = raw;
      lastSeen.stableCount = 1;
      lastSeen.locked = false;
    }

    // ✅ Cuenta UNA vez cuando está estable + cooldown real
    const now = Date.now();
    if(!lastSeen.locked && lastSeen.stableCount >= 2 && (now - lastScanAt) >= SCAN_COOLDOWN_MS){
      lastScanAt = now;
      addOneByEan(raw);
      lastSeen.locked = true;
    }

  } catch(e){}

  rafId = requestAnimationFrame(loopScan);
}

/* ===================== PERSISTENCIA ===================== */
function saveSession(){
  const payload = {
    v: 1,
    sesionId: state.sesionId,
    tienda: state.tienda,
    uso: state.uso,
    counts: Array.from(state.counts.entries()),
    undo: state.undo,
    lastEan: state.lastEan,
    savedAt: new Date().toISOString()
  };
  localStorage.setItem('balance_stock_session', JSON.stringify(payload));
}

function loadSession(showToast=true){
  const raw = localStorage.getItem('balance_stock_session');
  if(!raw){
    if(showToast) toast('No hay sesión guardada');
    return false;
  }
  const p = JSON.parse(raw);

  state.sesionId = p.sesionId || null;
  state.tienda = p.tienda || '';
  state.uso = p.uso || 'NUEVO';
  state.counts = new Map(p.counts || []);
  state.undo = p.undo || [];
  state.lastEan = p.lastEan || null;

  if ($('sesionHint')) $('sesionHint').textContent = state.sesionId ? `Sesión: ${state.sesionId}` : 'Sin sesión';
  if ($('tienda')) $('tienda').value = state.tienda;
  if ($('uso')) $('uso').value = state.uso;

  updateStats();
  if(showToast) toast('Sesión cargada');
  return true;
}

/* ===================== INIT ===================== */
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadCatalogo();

  // ✅ añade "Central" a tiendas si existe el select
  const tiendaEl = $('tienda');
  if (tiendaEl && tiendaEl.tagName === 'SELECT'){
    const hasCentral = Array.from(tiendaEl.options).some(o => (o.value||'') === 'Central' || (o.text||'') === 'Central');
    if(!hasCentral){
      const opt = document.createElement('option');
      opt.value = 'Central';
      opt.textContent = 'Central';
      tiendaEl.appendChild(opt);
    }
  }

  loadSession(false);

  $('tabScan').onclick = ()=>setTab('tabScan');
  $('tabManual').onclick = ()=>setTab('tabManual');
  $('tabResumen').onclick = ()=>setTab('tabResumen');

  if ($('btnStartCam')) $('btnStartCam').onclick = startCamera;
  if ($('btnStopCam')) $('btnStopCam').onclick = stopCamera;
  if ($('btnTorch')) $('btnTorch').onclick = toggleTorch;

  $('btnNuevaSesion').onclick = nuevaSesion;
  $('btnCargarSesion').onclick = ()=>loadSession(true);

  if (tiendaEl) tiendaEl.onchange = e => { state.tienda = e.target.value; updateStats(); };
  const usoEl = $('uso');
  if (usoEl) usoEl.onchange = e => { state.uso = e.target.value; updateStats(); };

  if ($('buscar')) $('buscar').oninput = e => fillResultados(e.target.value);
  if ($('resultado')) $('resultado').onchange = e => renderManualItem(e.target.value);
  if ($('manualBox')) $('manualBox').onclick = manualClick;

  if ($('btnUndo')) $('btnUndo').onclick = undo;

  if ($('btnAddByEan')) $('btnAddByEan').onclick = ()=>{
    if(!ensureSesion()) return;
    const ean = prompt('EAN a sumar (+1):');
    if(ean) addOneByEan(ean);
  };

  if ($('btnExport')) $('btnExport').onclick = compartirCSV;
  if ($('btnCompartir')) $('btnCompartir').onclick = compartirCSV;

  if ($('btnLimpiar')) $('btnLimpiar').onclick = ()=>{
    if(!confirm('¿Poner todas las unidades a 0?')) return;
    stopCamera();
    state.counts = new Map();
    state.undo = [];
    state.lastEan = null;
    updateStats();
    toast('Todo a 0');
  };

  updateStats();
});
