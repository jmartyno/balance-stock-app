
let CATALOGO = [];
let byEan = new Map();
let byItemKey = new Map(); // itemKey -> variants (tallas)
let itemsForSearch = [];   // unique items

const state = {
  sesionId: null,
  tienda: "",
  uso: "NUEVO",
  counts: new Map(),   // ean -> units
  undo: [],
  lastEan: null,
  currentItemKey: null
};

function $(id){ return document.getElementById(id); }

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
function vibrate(){ try{ if(navigator.vibrate) navigator.vibrate(30); }catch(e){} }

function nowId(){
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function setTab(tabId){
  const tabs = [['tabScan','panelScan'],['tabManual','panelManual'],['tabResumen','panelResumen']];
  for(const [t,p] of tabs){
    const on = (t===tabId);
    $(t).classList.toggle('active', on);
    $(p).style.display = on ? '' : 'none';
  }
  if(tabId==='tabResumen') rebuildResumen();
}

async function loadCatalogo(){
  const res = await fetch('catalogo.csv', {cache:'no-store'});
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(';').map(h=>h.trim());

  for(let i=1;i<lines.length;i++){
    const p = lines[i].split(';');
    const r = {};
    headers.forEach((h,j)=> r[h]= (p[j]||'').trim());
    CATALOGO.push(r);
    if(r.ean) byEan.set(r.ean, r);
    const itemKey = `${r.codigo}|${r.descripcion}|${r.familia}`;
    if(!byItemKey.has(itemKey)) byItemKey.set(itemKey, []);
    byItemKey.get(itemKey).push(r);
  }

  // unique items for search
  itemsForSearch = Array.from(byItemKey.entries()).map(([key, arr])=>{
    arr.sort((a,b)=>String(a.talla).localeCompare(String(b.talla), 'es', {numeric:true}));
    const first = arr[0];
    return { key, codigo:first.codigo, familia:first.familia, descripcion:first.descripcion };
  }).sort((a,b)=>a.descripcion.localeCompare(b.descripcion,'es',{sensitivity:'base'}));

  $('buildPill').textContent = `Catálogo: ${CATALOGO.length.toLocaleString('es-ES')} filas`;
  fillResultados('');
}

function nuevaSesion(){
  state.sesionId = nowId();
  state.counts = new Map();
  state.undo = [];
  state.lastEan = null;
  state.currentItemKey = null;
  $('sesionHint').textContent = `Sesión: ${state.sesionId}`;
  updateStats();
  toast('Sesión iniciada', state.sesionId);
}

function ensureSesion(){
  if(!state.sesionId){
    toast('Falta sesión', 'Pulsa “Iniciar sesión”');
    return false;
  }
  return true;
}

function addOneByEan(ean){
  if(!ensureSesion()) return false;
  ean = String(ean||'').trim();
  const it = byEan.get(ean);
  if(!it){ toast('EAN no encontrado', ean); return false; }
  const prev = Number(state.counts.get(ean)||0);
  const next = prev + 1;
  state.counts.set(ean, next);
  state.undo.push(ean);
  state.lastEan = ean;
  beep(); vibrate();
  toast('+1', `${it.descripcion} · Talla ${it.talla} (Total: ${next})`);
  updateStats();
  // if manual view is on same item, update its number
  const nEl = document.getElementById('u_'+ean);
  if(nEl) nEl.textContent = String(next);
  return true;
}

function undo(){
  const ean = state.undo.pop();
  if(!ean) return;
  const prev = Number(state.counts.get(ean)||0);
  const next = Math.max(0, prev-1);
  state.counts.set(ean, next);
  toast('Deshecho', `Talla → ${next}`);
  updateStats();
  const nEl = document.getElementById('u_'+ean);
  if(nEl) nEl.textContent = String(next);
}

function updateStats(){
  let lineas=0, unidades=0;
  for(const [ean,u] of state.counts.entries()){
    const n = Number(u)||0;
    if(n>0) lineas++;
    unidades += n;
  }
  $('statLineas').textContent = String(lineas);
  $('statUnidades').textContent = String(unidades);
  const last = state.lastEan ? byEan.get(state.lastEan) : null;
  $('statUltimo').textContent = last ? (`${last.talla}`) : '—';
  $('btnUndo').disabled = state.undo.length===0;
}

function tokenize(q){
  return (q||'')
    .toLowerCase()
    .replace(/[\u00A0]/g,' ')
    .replace(/[^\p{L}\p{N} ]+/gu,' ')
    .split(/\s+/)
    .filter(Boolean);
}

// “ternaria”: AND de tokens, en cualquier orden
function matchTokens(haystack, tokens){
  for(const t of tokens){
    if(!haystack.includes(t)) return false;
  }
  return true;
}

function fillResultados(query){
  const sel = $('resultado');
  sel.innerHTML = '';
  const tokens = tokenize(query);
  if(tokens.length===0){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Escribe para buscar…';
    sel.appendChild(opt);
    return;
  }
  const hits = [];
  for(const it of itemsForSearch){
    const hay = `${it.descripcion} ${it.codigo} ${it.familia}`.toLowerCase();
    if(matchTokens(hay, tokens)) hits.push(it);
    if(hits.length>=200) break;
  }
  if(hits.length===0){
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin resultados';
    sel.appendChild(opt);
    return;
  }
  for(const it of hits){
    const opt = document.createElement('option');
    opt.value = it.key;
    opt.textContent = `${it.descripcion} · ${it.familia} · ${it.codigo}`;
    sel.appendChild(opt);
  }
}

function renderManualItem(itemKey){
  const header = $('manualHeader');
  const box = $('manualBox');
  box.innerHTML = '';
  state.currentItemKey = itemKey || null;
  $('btnGrabarLinea').disabled = !itemKey;

  if(!itemKey || !byItemKey.has(itemKey)){
    header.textContent = 'Selecciona un artículo para ver sus tallas.';
    return;
  }
  const variants = byItemKey.get(itemKey).slice().sort((a,b)=>String(a.talla).localeCompare(String(b.talla), 'es', {numeric:true}));
  const first = variants[0];
  header.innerHTML = `<b>${first.descripcion}</b><br><span class="hint small">${first.familia} · Código ${first.codigo}</span>`;

  for(const v of variants){
    const ean = v.ean;
    const units = Number(state.counts.get(ean)||0);
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="meta">
        <div class="top">Talla ${v.talla}</div>
        <div class="bot">${units>0 ? 'Con unidades' : '—'}</div>
      </div>
      <div class="qty">
        <button data-act="minus" data-ean="${ean}">-</button>
        <div class="n" id="u_${ean}">${units}</div>
        <button data-act="plus" data-ean="${ean}">+</button>
      </div>
    `;
    box.appendChild(el);
  }
}

function manualClick(ev){
  const btn = ev.target.closest('button[data-act]');
  if(!btn) return;
  if(!ensureSesion()) return;
  const ean = btn.dataset.ean;
  const act = btn.dataset.act;
  const prev = Number(state.counts.get(ean)||0);
  const next = act==='plus' ? prev+1 : Math.max(0, prev-1);
  state.counts.set(ean, next);
  if(act==='plus'){ state.undo.push(ean); state.lastEan = ean; beep(); vibrate(); }
  const nEl = document.getElementById('u_'+ean);
  if(nEl) nEl.textContent = String(next);
  updateStats();
}

function limpiarManual(){
  $('buscar').value = '';
  $('resultado').innerHTML = '';
  $('manualBox').innerHTML = '';
  $('manualHeader').textContent = 'Selecciona un artículo para ver sus tallas.';
  state.currentItemKey = null;
  $('btnGrabarLinea').disabled = true;
  fillResultados('');
}

function grabarLinea(){
  // No “crea” nada extra: las unidades ya están acumuladas en state.counts.
  // Sirve para confirmar y pasar al siguiente artículo sin tocar la selección anterior.
  toast('Línea grabada', 'Puedes buscar el siguiente artículo');
  $('buscar').focus();
  // opcional: limpiar selección pero mantener texto de búsqueda
  $('resultado').selectedIndex = -1;
  $('manualBox').innerHTML = '';
  $('manualHeader').textContent = 'Busca el siguiente artículo…';
  state.currentItemKey = null;
  $('btnGrabarLinea').disabled = true;
}

function buildCSV(){
  const header = ['fecha','sesion','tienda','uso','codigo','familia','descripcion','talla','unidades','ean'];
  const rows = [header.join(';')];
  const fecha = new Date().toISOString().slice(0,10);

  const items = [];
  for(const [ean,u] of state.counts.entries()){
    const units = Number(u)||0;
    if(units<=0) continue;
    const it = byEan.get(ean);
    if(!it) continue;
    items.push({...it, unidades: units});
  }
  items.sort((a,b)=>{
    const da = (a.descripcion||'').localeCompare(b.descripcion||'', 'es', {sensitivity:'base'});
    if(da!==0) return da;
    return String(a.talla).localeCompare(String(b.talla), 'es', {numeric:true});
  });

  for(const it of items){
    const line = [
      fecha,
      state.sesionId || '',
      state.tienda || '',
      state.uso || '',
      it.codigo || '',
      it.familia || '',
      (it.descripcion||'').replace(/\s+/g,' ').trim(),
      it.talla || '',
      String(it.unidades),
      it.ean || ''
    ].map(x=>String(x).replace(/\n/g,' ').replace(/\r/g,' ').replace(/;/g,','));
    rows.push(line.join(';'));
  }
  return rows.join('\n');
}
function rebuildResumen(){
  // Agrupa por descripcion y suma unidades (todas las tallas)
  const agg = new Map(); // descripcion -> unidades

  for (const [ean, u] of state.counts.entries()){
    const units = Number(u) || 0;
    if (units <= 0) continue;
    const it = byEan.get(ean);
    if (!it) continue;

    const desc = (it.descripcion || '').trim();
    agg.set(desc, (agg.get(desc) || 0) + units);
  }

  // Orden alfabético por descripción
  const rows = Array.from(agg.entries()).sort((a,b)=>
    a[0].localeCompare(b[0], 'es', { sensitivity:'base' })
  );

  let total = 0;
  const lines = rows.map(([desc, units])=>{
    total += units;
    return `${desc}: ${units}`;
  });

  lines.push(`TOTAL ALBARAN ${total}`);
  $('csvPreview').value = lines.join('\n');
}

async function copiarCSV(){
  try{
    await navigator.clipboard.writeText(buildCSV());
    toast('Copiado');
  }catch(e){
    toast('No se pudo copiar');
  }
}

// ===== Cámara (BarcodeDetector) =====
let stream = null;
let scanning = false;
let barcodeDetector = null;
let rafId = null;
let lastSeen = {value:null, at:0};

async function initBarcodeDetector(){
  if('BarcodeDetector' in window){
    try{
      barcodeDetector = new BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code']});
      return true;
    }catch(e){}
  }
  barcodeDetector = null;
  return false;
}

async function startCamera(){
  if(!ensureSesion()) return;
  const ok = await initBarcodeDetector();
  if(!ok){
    toast('No compatible', 'Prueba Chrome Android o usa teclado');
    return;
  }
  try{
    stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment', width:{ideal:1280}, height:{ideal:720}}, audio:false});
    $('video').srcObject = stream;
    await $('video').play();
    $('cameraWrap').style.display = '';
    $('btnStartCam').disabled = true;
    $('btnStopCam').disabled = false;
    scanning = true;
    loopScan();
    toast('Cámara lista');
  }catch(e){
    toast('Sin cámara', 'Permite acceso');
  }
}

function stopCamera(){
  scanning = false;
  $('btnStartCam').disabled = false;
  $('btnStopCam').disabled = true;
  $('cameraWrap').style.display = 'none';
  if(rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if(stream){
    for(const t of stream.getTracks()) t.stop();
    stream = null;
  }
}

async function loopScan(){
  if(!scanning || !barcodeDetector) return;
  try{
    const codes = await barcodeDetector.detect($('video'));
    if(codes && codes.length){
      const raw = (codes[0].rawValue||'').trim();
      const now = Date.now();
      if(raw && (lastSeen.value!==raw || (now-lastSeen.at)>700)){
        lastSeen = {value:raw, at:now};
        addOneByEan(raw);
      }
    }
  }catch(e){}
  rafId = requestAnimationFrame(loopScan);
}

// ===== eventos =====
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadCatalogo();

  $('tabScan').onclick = ()=>setTab('tabScan');
  $('tabManual').onclick = ()=>setTab('tabManual');
  $('tabResumen').onclick = ()=>setTab('tabResumen');

  $('btnNuevaSesion').onclick = nuevaSesion;

  $('tienda').addEventListener('input', e=> state.tienda = e.target.value);
  $('uso').addEventListener('change', e=> state.uso = e.target.value);

  $('buscar').addEventListener('input', e=> fillResultados(e.target.value));
  $('resultado').addEventListener('change', e=> renderManualItem(e.target.value));
  $('manualBox').addEventListener('click', manualClick);

  $('btnLimpiarManual').onclick = limpiarManual;
  $('btnGrabarLinea').onclick = grabarLinea;

  $('btnAddByEan').onclick = ()=>{
    const ean = prompt('EAN a sumar (+1):');
    if(ean) addOneByEan(ean);
  };
  $('btnUndo').onclick = undo;
  $('btnLimpiar').onclick = ()=>{
    if(!confirm('¿Poner todas las unidades a 0?')) return;
    state.counts = new Map();
    state.undo = [];
    state.lastEan = null;
    updateStats();
    toast('Todo a 0');
  };

  $('btnStartCam').onclick = startCamera;
  $('btnStopCam').onclick = stopCamera;

  $('btnExport').onclick = ()=>{
    const csv = buildCSV();
    const file = `balance_${state.sesionId || 'sin_sesion'}.csv`;
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    toast('Exportado', file);
  };

  $('btnCopiar').onclick = copiarCSV;

  updateStats();
});
