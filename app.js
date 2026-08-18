/* ============================================================
   Ledger — personal finance tracker (vanilla JS, no dependencies)
   Storage priority:
     1. server mode  – single data.json served by the bundled server.py
     2. fs mode      – File System Access API writing a real data.json on disk
     3. local mode   – localStorage (+ manual Export / Import of data.json)
   ============================================================ */
'use strict';

/* ---------------- constants & tiny helpers ---------------- */
const DATA_FILE = 'data.json';
const LS_KEY    = 'ledger.data.v1';
const PAGE_SIZE = 12;
const NEW_CAT   = '__new__';

const DEFAULT_CATEGORIES = {
  expense: ['Housing','Groceries','Dining','Transport','Utilities','Health','Entertainment','Shopping','Education','Other'],
  income:  ['Salary','Freelance','Investments','Gifts','Refunds','Other']
};
const CATEGORY_COLORS = [
  '#0f766e','#dc2626','#d97706','#059669','#7c3aed',
  '#db2777','#0891b2','#ca8a04','#65a30d','#9333ea',
  '#e11d48','#2563eb'
];

const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function pad2(n){ return String(n).padStart(2,'0'); }
function todayStr(){ const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate()); }
function currentMonthKey(){ return todayStr().slice(0,7); }
function monthAdd(key, delta){ const [y,m] = key.split('-').map(Number); const d = new Date(y, m-1+delta, 1); return d.getFullYear() + '-' + pad2(d.getMonth()+1); }
function monthLabel(key){ const [y,m] = key.split('-').map(Number); return new Intl.DateTimeFormat(undefined,{month:'long',year:'numeric'}).format(new Date(y, m-1, 1)); }
function shortMonthKey(key){ const [y,m] = key.split('-').map(Number); return new Intl.DateTimeFormat(undefined,{month:'short'}).format(new Date(y, m-1, 1)) + ' ’' + String(y).slice(2); }
function fmtDate(iso){ const [y,m,d] = iso.split('-').map(Number); return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric'}).format(new Date(y, m-1, d)); }
function money(n){ const s = Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); return (n < 0 ? '−' : '') + '$' + s; }

async function copyText(t){ try{ await navigator.clipboard.writeText(t); }catch(e){} }
function toast(msg, opts){
  const o = Object.assign({ type:'ok', actionLabel:null, onAction:null }, opts || {});
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (o.type !== 'ok' ? ' ' + o.type : '');
  el.innerHTML = '<span></span>' + (o.actionLabel ? '<button type="button"></button>' : '');
  el.firstChild.textContent = msg;
  const kill = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  if (o.actionLabel){
    const b = $('button', el);
    b.textContent = o.actionLabel;
    b.onclick = () => { o.onAction && o.onAction(); kill(); };
  }
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(kill, o.actionLabel ? 7000 : 3800);
}

/* ---------------- data helpers ---------------- */
let seqCounter = (function(){ let s = Date.now(); return () => String(++s).slice(-12) + Math.floor(Math.random()*90+10); })();
const uid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + seqCounter());

function newTx(type, category, amount, dateStr, note){
  return { id: uid(), type, category, amount: Math.round(amount * 100), date: dateStr, note: (note || '').trim(), createdAt: Date.now() };
}

function normalize(raw){
  const d = (raw && typeof raw === 'object') ? raw : {};
  const txs = Array.isArray(d.transactions) ? d.transactions.filter(t => t && typeof t === 'object' && t.type).map(t => ({
    id: String(t.id || uid()), type: t.type === 'income' ? 'income' : 'expense',
    category: String(t.category || 'Other').slice(0,24), amount: Math.abs(Math.round(Number(t.amount))) || 0, // stored as integer cents; keep as-is
    date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : todayStr(),
    note: String(t.note || '').slice(0,60), createdAt: Number(t.createdAt) || Date.now()
  })) : [];
  const budgets = (d.budgets && typeof d.budgets === 'object') ? Object.fromEntries(Object.entries(d.budgets).map(([k,v]) => [String(k).slice(0,24), Math.abs(Math.round(Number(v))) || 0])) : {};
  let cats;
  try{
    cats = { expense: [...DEFAULT_CATEGORIES.expense], income: [...DEFAULT_CATEGORIES.income] };
    for (const t of txs){ if (!cats[t.type].includes(t.category)) cats[t.type].push(t.category); }
    if (Array.isArray(d.categories) && d.categories) cats = Object.assign(cats, JSON.parse(JSON.stringify(d.categories)));
  }catch(e){}
  return { version: 1, transactions: txs, budgets, categories: cats };
}

function emptyState(){ return normalize(null); }

/* ---------------- storage modes ---------------- */
let mode = 'connecting';                 // 'server' | 'fs' | 'local' | 'connecting' | 'error'
let fsHandle = null;
const LS_HANDLE = 'ledger.fshandle';

function setMode(m){ mode = m; updateModeBadge(); }
function updateModeBadge(){
  const wrap = $('#modeWrap'), txt = $('#modeText');
  wrap.classList.remove('on','warn');
  const labels = { server:'data.json · saved in this folder', fs:'saving to ' + DATA_FILE, local: DATA_FILE + ' kept in this browser', connecting:'connecting…', error:'storage unavailable' };
  txt.textContent = labels[mode] || mode;
  wrap.classList.add(mode === 'error' ? 'warn' : 'on');
}

function saveToLocal(d){ try{ localStorage.setItem(LS_KEY, JSON.stringify(d)); }catch(e){ toast('Could not write to this browser’s storage — try Export before leaving.', {type:'error'}); } }
function loadFromLocal(){ try{ const s = localStorage.getItem(LS_KEY); return s ? normalize(JSON.parse(s)) : null; }catch(e){ return null; } }

async function serverPut(d){
  try{
    const res = await fetch(DATA_FILE, { method:'PUT', body: JSON.stringify(d) });
    if (!res.ok) throw new Error(res.status);
    setMode('server'); return true;
  }catch(e){ return false; }
}

async function fsSave(d){
  try{
    const h = fsHandle || (await window.showSaveFilePicker({ suggestedName: DATA_FILE, types:[{description:'JSON', accept:{'application/json':['.json']}}] }));
    fsHandle = h; try{ localStorage.setItem(LS_HANDLE, '1'); }catch(e){}
    const w = await h.createWritable(); await w.write(JSON.stringify(d, null, 2)); await w.close();
    setMode('fs'); return true;
  }catch(err){ if (err && err.name === 'AbortError') return false; throw err; }
}

async function fsRestore(){
  try{
    const h = await window.showOpenFilePicker({ types:[{description:'JSON', accept:{'application/json':['.json']}}], multiple:false });
    const f = await (await h[0].getFile());
    return JSON.parse(await f.text());
  }catch(err){ if (err && err.name === 'AbortError') throw new Error('cancel'); throw err; }
}

/* ---------------- state & DOM refs ---------------- */
let data = emptyState();
let viewMonth = currentMonthKey();
let uiType = 'expense';
let editId = null, filterChipCat = null;
let page = 1, armedClear = null;
const els = {};

function grabEls(){
  ['prevBtn','nextBtn','todayBtn','monthLabel','exportBtn','importBtn','fileInput',
   'txForm','segExpense','segIncome','amount','catSelect','fNewCat','newCat','date','note',
   'fAmount','fCategory','fDate','fNote','submitBtn','cancelEdit',
   'sumIncome','sumExpenses','sumNet','sumRate','dIncome','dExpenses','netSub',
   'budgetList','budgetSub','donutCanvas','legend','donutSub','trendCanvas',
   'q','fType','fCat','fScope','fSort','rowList','countLabel','pager','pagePrev','pageNext','pageInfo',
   'modeWrap','sampleBtn','clearBtn','clearWrap'].forEach(id => els[id] = document.getElementById(id));
}

/* ---------------- persistence ---------------- */
function persist(){
  if (mode === 'fs'){
    fsSave(data).then(ok => {
      if (!ok){ saveToLocal(data); toast('Lost access to ' + DATA_FILE + ' — kept a browser copy. Use Export to re-link.', {type:'warn'}); }
    }).catch(err => { setMode('error'); saveToLocal(data); toast('Could not save: ' + err.message, {type:'error'}); });
    return;
  }
  if (mode === 'server'){
    serverPut(data).then(ok => {
      if (!ok){ saveToLocal(data); toast('Server write failed — keeping a browser copy. Use Export to be safe.', {type:'warn'}); }
    });
    return;
  }
  saveToLocal(data);
}

function setData(next){
  data = normalize(next);
  persist();
  rebuildCategorySelects();
  renderAll();
}

async function initStorage(){
  const probe = fetch(DATA_FILE, { method:'GET' }).then(async r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  let restored = null;
  try{ if (window.showSaveFilePicker && localStorage.getItem(LS_HANDLE) === '1') restored = await fsRestore(); }catch(e){ /* cancelled, denied, or no file */ }
  let fromServer = false, serverRaw = null;
  try{ serverRaw = await probe; fromServer = true; }catch(e){}

  if (restored && !fromServer){                       // fs mode: user reconnected their data.json
    const cur = loadFromLocal();
    setData(mergeData(cur, restored));
    toast('Connected to ' + DATA_FILE + ' on your computer.');
    return;
  }
  if (fromServer){                                    // server.py is serving data.json next to the app
    setMode('server');
    const cur = loadFromLocal();
    setData(mergeData(cur, serverRaw));
    if (cur) toast('Merged browser copy into ' + DATA_FILE + '.');
    return;
  }
  // static / plain http: keep a browser copy; Export can link the real file
  setMode('local');
  const local = loadFromLocal();
  if (local){ data = local; rebuildCategorySelects(); renderAll(); }   // show the saved browser copy (fresh visit keeps the rendered empty state)
}

function mergeData(a, b){                             // union by id; keep newest per id (by createdAt)
  const m = new Map();
  for (const d of [a, b]){ if (!d) continue;
    for (const t of d.transactions) if (t && t.id){
      const ex = m.get(t.id);
      if (!ex || (Number(t.createdAt) || 0) >= (Number(ex.createdAt) || 0)) m.set(t.id, t);
    }
  }
  return { version:1, transactions:[...m.values()], budgets:Object.assign({}, a && a.budgets, b && b.budgets), categories:(b || a || emptyState()).categories };
}

/* ---------------- category selects & chips ---------------- */
function fillCatSelect(sel, type){
  const cats = data.categories[type] || [];
  const cur = sel.value;
  sel.innerHTML = '';
  for (const c of cats) sel.add(new Option(c, c));
  if (sel === els.catSelect) sel.add(new Option('＋ New category…', NEW_CAT));
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function rebuildCategorySelects(){
  fillCatSelect(els.catSelect, uiType);
  const f = els.fCat, keep = f.value;
  f.innerHTML = '<option value="all">All categories</option>';
  for (const c of data.categories.expense) if (data.transactions.some(t => t.type === 'expense' && t.category === c)) f.add(new Option(c, c));
  for (const c of data.categories.income)  if (data.transactions.some(t => t.type === 'income'  && t.category === c)) f.add(new Option(c, c));
  if ([...f.options].some(o => o.value === keep)) f.value = keep;
}

function setFilterChip(cat){                          // toggling a chip filters + syncs the select
  filterChipCat = (filterChipCat === cat) ? null : cat;
  els.fCat.value = filterChipCat || 'all';
  page = 1; renderList(); renderCharts();
}

/* ---------------- summary / budgets ---------------- */
function sumMonth(key){
  let inc = 0, exp = 0;
  for (const t of data.transactions) if (t.date.slice(0,7) === key){ if (t.type === 'income') inc += t.amount; else exp += t.amount; }
  return { inc, exp };
}

function renderSummary(){
  const now = sumMonth(viewMonth), prev = sumMonth(monthAdd(viewMonth,-1));
  els.sumIncome.textContent   = money(now.inc/100);
  els.sumExpenses.textContent = money(now.exp/100);
  const net = now.inc - now.exp;
  els.sumNet.textContent = money(net/100);
  els.sumNet.className = 'val' + (net > 0 ? ' pos' : net < 0 ? ' neg' : '');
  els.sumRate.textContent = now.inc > 0 ? Math.max(0, Math.round((net / now.inc) * 100)) + '%' : '—';

  const dInc = (prev.inc > 0) ? Math.round((now.inc - prev.inc) / prev.inc * 100) : null;
  const dExp = (prev.exp > 0) ? Math.round((now.exp - prev.exp) / prev.exp * 100) : null;
  els.dIncome.innerHTML   = dInc === null ? '' : (dInc >= 0 ? '<span class="good">▲</span>' : '<span class="bad">▼</span>') + Math.abs(dInc) + '% vs last month';
  els.dExpenses.innerHTML = dExp === null ? '' : (dExp <= 0 ? '<span class="good">▼</span>' : '<span class="bad">▲</span>') + Math.abs(dExp) + '% vs last month';
  const n = data.transactions.filter(t => t.date.slice(0,7) === viewMonth).length;
  els.netSub.textContent = n + (n === 1 ? ' transaction' : ' transactions');
}

function renderBudgets() {
  const spent = {};
  // 1. Calculate actual spending for each category this month
  for (const t of data.transactions) {
    if (t.type === 'expense' && t.date.slice(0, 7) === viewMonth) {
      spent[t.category] = (spent[t.category] || 0) + t.amount;
    }
  }

  // 2. Identify all categories that should appear in the list:
  // - Any category with spending this month
  // - OR any category that already has a budget cap set
  const usedCats = Object.keys(spent);
  const budgetCats = Object.keys(data.budgets);
  const allRelevantCats = Array.from(new Set([...usedCats, ...budgetCats])).sort((a, b) => a.localeCompare(b));

  els.budgetSub.textContent = 'Monthly spending caps for ' + monthLabel(viewMonth).toLowerCase() + ' · click a number to set or change';

  if (allRelevantCats.length === 0) {
    els.budgetList.innerHTML = `<li class="lempty" style="padding:10px 0;color:var(--sub)">No expense spending in this month yet. Add budgets after your first expenses.</li>`;
    return;
  }

  // 3. Generate the HTML for each category row
  const rows = allRelevantCats.map(cat => {
    const hasBudget = Object.prototype.hasOwnProperty.call(data.budgets, cat);
    const amtCents = data.budgets[cat] || 0; // The limit set by user
    const spentCents = spent[cat] || 0;      // Actual spending this month

    if (!hasBudget) {
      // CASE: Category has spending but NO budget cap is set yet
      return `<li class="brow" data-cat="${esc(cat)}">
        <div class="btop"><span class="bname">${esc(cat)}</span><button type="button" class="bin" title="Set budget">—</button></div>
        <div class="bbottom"><span> spent</span><span class="bstatus">no cap</span></div>
      </li>`;
    }

    // CASE: Category has a defined budget limit set
    const pct = amtCents > 0 ? spentCents / amtCents : (spentCents > 0 ? 1.3 : 0);
    const cls = pct >= 1 ? 'bad' : pct >= .8 ? '' : 'good';
    let statusWord;

    if (amtCents === 0) {
      statusWord = spentCents > 0 ? "over limit" : "no cap";
    } else {
      const diffPct = Math.round((1 - pct) * 100);
      if (pct >= 1) {
        statusWord = Math.round((pct - 1) * 100) + '% over';
      } else if (spentCents > 0 && diffPct < 2) {
        statusWord = 'on track';
      } else {
        statusWord = diffPct + '% left';
      }
    }

    return `<li class="brow" data-cat="${esc(cat)}">
      <div class="btop"><span class="bname">${esc(cat)}</span><button type="button" class="bin" title="Edit budget">${money(amtCents/100)}</button></div>
      <div class="bbar"><i style="width:${Math.min(pct,1)*100}%; background:${pct >= 1 ? '#dc2626' : pct >= .8 ? '#d97706' : '#0f766e'}"></i></div>
      <div class="bbottom"><span>${money(spentCents/100)} of ${money(amtCents/100)}</span><span class="bstatus ${cls}"></span></div>
    </li>`;
  }).join('');

  els.budgetList.innerHTML = rows;

  // 4. Re-attach click events to the new buttons
  $$('.bin', els.budgetList).forEach(btn => {
    btn.onclick = () => setBudget(btn.closest('.brow').dataset.cat);
  });
}

function setBudget(cat){
  const cur = data.budgets[cat];
  const v = prompt('Monthly budget for “' + cat + '” (blank or 0 to remove)', cur ? (cur / 100).toFixed(2) : '');
  if (v === null) return;
  const n = Math.round(Number(v.replace(/[,$\s]/g,'')) * 100);
  if (!n || Number.isNaN(n)){ delete data.budgets[cat]; }
  else { data.budgets[cat] = n; toast('Budget set: ' + cat + ' — ' + money(n/100) + '/mo'); }
  persist(); renderBudgets();
}

/* ---------------- charts (hand-rolled canvas) ---------------- */
function prepCanvas(cv){
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  if (r.width === 0) return null;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
  return { ctx, w: r.width, h: r.height };
}

function colorFor(i){ return CATEGORY_COLORS[i % CATEGORY_COLORS.length]; }

function renderDonut(){
  const rows = data.transactions.filter(t => t.type === 'expense' && t.date.slice(0,7) === viewMonth);
  const totals = new Map();
  for (const t of rows) totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
  const sorted = [...totals.entries()].sort((a,b) => b[1] - a[1]).slice(0, 7);
  let otherSum = 0; const rest = [...totals.entries()].sort((a,b) => b[1]-a[1]).slice(7);
  for (const [,v] of rest) otherSum += v;
  if (otherSum > 0){ const oi = sorted.findIndex(([c]) => c === 'Other'); if (oi >= 0) sorted[oi][1] += otherSum; else sorted.push(['Other', otherSum]); }
  const total = sorted.reduce((s,[,v]) => s + v, 0);

  els.donutSub.textContent = total ? monthLabel(viewMonth) + ' · ' + money(total/100) + ' spent' : monthLabel(viewMonth) + ' · no expenses yet';

  // legend
  if (!sorted.length){
    els.legend.innerHTML = '<li class="lempty">Nothing to chart for this month.</li>';
  } else {
    els.legend.innerHTML = sorted.map(([c,v], i) =>
      `<li><i style="background:${colorFor(i)}"></i><span class="lname">${esc(c)}</span><span class="lval">${money(v/100)}</span><span class="lpc">${Math.round(v/total*100)}%</span></li>`).join('');
    $$('.lname', els.legend).forEach((el, i) => { el.style.cursor = 'pointer'; el.title = 'Filter this category'; el.onclick = () => setFilterChip(sorted[i][0]); });
  }

  // canvas
  const c = prepCanvas(els.donutCanvas); if (!c) return;
  const { ctx, w, h } = c; ctx.clearRect(0,0,w,h);
  const cx = w/2, cy = h/2, rOut = Math.min(w,h)/2 - 4, thick = rOut * .34, rIn = rOut - thick;
  if (!sorted.length){
    ctx.beginPath(); ctx.arc(cx,cy,rOut - thick/2,0,Math.PI*2); ctx.strokeStyle = '#eceae2'; ctx.lineWidth = thick; ctx.stroke();
    ctx.fillStyle = '#b3b0a5'; ctx.font = '600 13px ' + getComputedStyle(document.body).fontFamily; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('no spending', cx, cy); return;
  }
  let a = -Math.PI/2; const gap = sorted.length > 1 ? .03 : 0;
  for (let i = 0; i < sorted.length; i++){
    const frac = sorted[i][1] / total, sweep = Math.max(frac * Math.PI*2 - gap, .015);
    ctx.beginPath(); ctx.arc(cx,cy,rOut - thick/2, a + gap/2, a + gap/2 + sweep);
    ctx.strokeStyle = colorFor(i); ctx.lineWidth = thick; ctx.lineCap = 'butt'; ctx.stroke();
    a += frac * Math.PI*2;
  }
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle = '#211f1a'; ctx.font = '700 20px ' + getComputedStyle(document.body).fontFamily;
  ctx.fillText(money(total/100), cx, cy - 8);
  ctx.fillStyle = '#77746a'; ctx.font = '500 11.5px ' + getComputedStyle(document.body).fontFamily;
  ctx.fillText(sorted.length ? sorted[0][0] : '', cx, cy + 13);
}

function renderTrend(){
  const c = prepCanvas(els.trendCanvas); if (!c) return;
  const { ctx, w, h } = c; ctx.clearRect(0,0,w,h);
  const months = []; let key = monthAdd(viewMonth,-5);
  for (let i = 0; i < 6; i++){ months.push(key); key = monthAdd(key,1); }
  const sums = months.map(k => sumMonth(k));
  const maxV = Math.max(1, ...sums.flatMap(s => [s.inc, s.exp]));

  const L = 52, R = w - 8, T = 10, B = h - 26;
  const fmtTick = v => { const d = v / 100; return d >= 1e6 ? '$'+(d/1e6).toFixed(1)+'m' : d >= 1e3 ? '$'+Math.round(d/1e3)+'k' : '$'+Math.round(d); };
  ctx.font = '500 11px ' + getComputedStyle(document.body).fontFamily;
  for (let i = 0; i <= 3; i++){
    const v = maxV * i / 3, y = B - (B - T) * i / 3;
    ctx.strokeStyle = '#f0eee7'; ctx.beginPath(); ctx.moveTo(L,y); ctx.lineTo(R,y); ctx.stroke();
    ctx.fillStyle = '#a5a297'; ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.fillText(fmtTick(v), L - 8, y);
  }
  const slot = (R - L) / 6;
  months.forEach((k,i) => {
    if (k === viewMonth){ ctx.fillStyle = '#f3f1ea'; ctx.fillRect(L + slot*i + 2, T, slot - 4, B - T); }
    const x = L + slot*i + slot/2;
    const bw = Math.min(15, slot * .28), bhInc = (sums[i].inc / maxV) * (B - T), bhExp = (sums[i].exp / maxV) * (B - T);
    ctx.fillStyle = '#0f766e'; roundBar(ctx, x - bw - 1.5, B - bhInc, bw, Math.max(bhInc,1));
    ctx.fillStyle = '#dc2626'; roundBar(ctx, x + 1.5, B - bhExp, bw, Math.max(bhExp,1));
    ctx.fillStyle = k === viewMonth ? '#211f1a' : '#77746a';
    ctx.textAlign='center'; ctx.textBaseline='top'; ctx.font = (k===viewMonth?'700 ':'500 ') + '11px ' + getComputedStyle(document.body).fontFamily;
    ctx.fillText(shortMonthKey(k), x, B + 8);
  });
}

function roundBar(ctx,x,y,w,h){ const r = Math.min(3, w/2, h); if (h <= 0) return; ctx.beginPath(); ctx.moveTo(x,y+h); ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+w,y,r); ctx.lineTo(x+w,y); ctx.arcTo(x+w,y+h,x+w,y+h,0); ctx.closePath(); ctx.fill(); }

/* ---------------- transaction list ---------------- */
function applyFilters(){
  let rows = data.transactions.slice();
  const q = els.q.value.trim().toLowerCase();
  const ft = els.fType.value, fc = els.fCat.value, fs = els.fScope.value;
  if (fs === 'month') rows = rows.filter(t => t.date.slice(0,7) === viewMonth);
  if (ft !== 'all')   rows = rows.filter(t => t.type === ft);
  if (fc !== 'all')   rows = rows.filter(t => t.category === fc);
  if (q){
    const has = r => {
      const amtStr = String(r.amount/100);
      return (r.note && r.note.toLowerCase().includes(q)) || r.category.toLowerCase().includes(q) || amtStr.includes(q);
    };
    rows = rows.filter(has);
  }
  const sort = els.fSort.value;
  rows.sort((a,b) => {
    if (sort === 'date-desc') return b.date.localeCompare(a.date) || b.createdAt - a.createdAt;
    if (sort === 'date-asc')  return a.date.localeCompare(b.date) || b.createdAt - a.createdAt;
    if (sort === 'amount-desc') return b.amount - a.amount || b.date.localeCompare(a.date);
    return a.amount - b.amount || a.date.localeCompare(b.date);
  });
  return rows;
}

function renderList(){
  if (els.sampleBtn) els.sampleBtn.classList.toggle('hidden', data.transactions.length !== 0);
  if (els.clearWrap) els.clearWrap.classList.toggle('hidden', data.transactions.length === 0);
  if (data.transactions.length === 0){
    els.rowList.innerHTML = `<div class="empty"><div class="emptymark">—</div><p>All caught up. Your ledger is empty.</p><p class="sub">Add your first transaction above, or load a sample to explore.</p></div>`;
    els.countLabel.textContent = '';
    togglePager(false); return;
  }
  const rows = applyFilters();
  if (!rows.length){
    els.rowList.innerHTML = `<div class="empty small"><div class="emptymark">∅</div><p>Nothing matches your filters.</p><button type="button" class="btn ghost" id="resetFilters">Clear filters</button></div>`;
    const rb = $('#resetFilters'); if (rb) rb.onclick = resetFilters;
    els.countLabel.textContent = '0 of ' + data.transactions.length;
    togglePager(false); return;
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(page, pages);
  const start = (page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  els.rowList.innerHTML = slice.map(t => {
    const isInc = t.type === 'income';
    return `<div class="row ${editId === t.id ? 'editing' : ''}" data-id="${esc(t.id)}">
      <span class="rdate">${fmtDate(t.date)}</span>
      <span class="rmain"><button type="button" class="chip ${t.type}" title="Filter: ${esc(t.category)}">${esc(t.category)}</button><span class="rnote ${t.note ? '' : 'muted'}">${t.note ? esc(t.note) : '<no note>'}</span></span>
      <span class="ramt ${isInc ? 'pos' : 'neg'}">${isInc ? '+' : '−'}${money(t.amount/100).slice(1)}</span>
      <span class="ract"><button type="button" class="iconbtn act-edit" title="Edit" aria-label="Edit">✎</button><button type="button" class="iconbtn act-del danger" title="Delete" aria-label="Delete">×</button></span>
    </div>`;
  }).join('');

  $$('.row', els.rowList).forEach(rowEl => {
    const id = rowEl.dataset.id;
    $('.chip', rowEl).onclick = () => setFilterChip($('.chip', rowEl).textContent);
    $('.act-edit', rowEl).onclick = () => startEdit(id);
    $('.act-del',  rowEl).onclick = (e) => armDelete(e.currentTarget, id);
  });

  const a = start + 1, b = Math.min(rows.length, start + PAGE_SIZE);
  const filtering = els.q.value.trim() || els.fType.value !== 'all' || els.fCat.value !== 'all';
  els.countLabel.textContent = `${a}–${b} of ${rows.length}` + (filtering ? ' (filtered)' : '');
  togglePager(pages > 1);
  els.pageInfo.textContent = page + '/' + pages;
  els.pagePrev.disabled = page <= 1;
  els.pageNext.disabled = page >= pages;
}

function togglePager(on){ els.pager.style.visibility = on ? 'visible' : 'hidden'; }

function resetFilters(){
  els.q.value = ''; els.fType.value = 'all'; els.fScope.value = 'month'; filterChipCat = null;
  els.fCat.value = 'all'; page = 1; renderList(); renderCharts();
}

function armDelete(btn, id){
  const tx = data.transactions.find(t => t.id === id); if (!tx) return;
  if (editId === id) stopEdit();
  if (armedClear && armedClear.el === btn){                    // second click: confirm the delete
    disarm();
    data.transactions = data.transactions.filter(t => t.id !== id);
    persist(); renderAll();
    const undo = () => { data.transactions.push(tx); persist(); renderAll(); };
    toast(`Deleted ${money(tx.amount/100)} · ${tx.category}`, { actionLabel:'Undo', onAction:undo });
  } else {                                                     // first click: arm ("Sure?"), auto-disarms in 2.6s
    disarm();
    armedClear = { el: btn };
    btn.classList.add('armed'); btn.textContent = 'Sure?';
    clearTimeout(btn._t);
    btn._t = setTimeout(disarm, 2600);
  }
}

function disarm(){ if (armedClear){ clearTimeout(armedClear.el._t); armedClear.el.classList.remove('armed'); armedClear.el.textContent = '×'; armedClear = null; } }

/* ---------------- editing ---------------- */
function startEdit(id){
  const t = data.transactions.find(x => x.id === id); if (!t) return;
  editId = id;
  setFormType(t.type);
  if (!data.categories[t.type].includes(t.category)){ data.categories[t.type].push(t.category); fillCatSelect(els.catSelect, t.type); }
  els.amount.value = (t.amount/100).toFixed(2);
  els.catSelect.value = t.category;
  hideNewCatField();
  els.date.value = t.date;
  els.note.value = t.note;
  els.submitBtn.textContent = 'Save';
  els.cancelEdit.hidden = false;
  $$('.field', els.txForm).forEach(f => clearErr(f));
  renderList();
  window.scrollTo({ top: 0, behavior:'smooth' });
  els.amount.focus();
}

function stopEdit(){
  editId = null; els.submitBtn.textContent = 'Add'; els.cancelEdit.hidden = true;
  hideNewCatField(); clearErrors();
  els.amount.value = ''; els.note.value = ''; els.newCat.value = ''; els.date.value = todayStr();
  renderList();
}

/* ---------------- validation & submit ---------------- */
function setErr(field, msg){ field.classList.add('invalid'); $('.err', field).textContent = msg || ''; }
function clearErr(field){ field.classList.remove('invalid'); const e = $('.err', field); if (e) e.textContent = ''; }
function clearErrors(){ $$('.field', els.txForm).forEach(clearErr); }

function validate(type){
  clearErrors(); let first = null;
  const amtRaw = els.amount.value.trim();
  const amt = Number(amtRaw.replace(/[$,\s]/g,''));
  if (amtRaw === '' || Number.isNaN(amt)) setErr(els.fAmount, 'Enter a number');
  else if (amt <= 0)                       setErr(els.fAmount, 'Must be greater than 0');
  else if (amt > 1e9)                     setErr(els.fAmount, 'That looks too large');

  let cat = '';
  if (els.catSelect.value === NEW_CAT){
    const v = els.newCat.value.trim();
    if (!v) setErr(els.fNewCat, 'Name the new category');
    else {
      cat = v;   // resolveCat() merges case-insensitively with an existing category on save
    }
  } else cat = els.catSelect.value || '';
  if (!cat) setErr(els.fCategory, 'Pick a category');

  const d = els.date.value;
  if (!d) setErr(els.fDate, 'Pick a date');
  else {
    const [y,m,dd] = d.split('-').map(Number), tmax = new Date().getTime();
    const dt = new Date(y, m-1, dd).getTime();
    if (Number.isNaN(dt)) setErr(els.fDate, 'Invalid date');
    else if (dt > tmax + 86400e3) setErr(els.fDate, 'No future dates');
  }

  const note = els.note.value.trim();
  if (note.length > 60) setErr(els.fNote, 'Keep it under 60 characters');

  for (const f of [els.fAmount, els.fNewCat, els.fCategory, els.fDate, els.fNote]){
    if (!first && f.classList.contains('invalid')) first = f;
  }
  return { ok: !first, amt, cat, date: d };
}

function resolveCat(type, name){
  const list = data.categories[type];
  const hit = list.find(c => c.toLowerCase() === name.toLowerCase());
  if (hit) return hit;
  list.push(name);
  return name;
}

function onSubmit(e){
  e.preventDefault();
  const v = validate(uiType);
  if (!v.ok){ const f = $('.field.invalid', els.txForm); if (f){ const i = $('input,select', f); i && i.focus(); } return; }

  let cat = resolveCat(uiType, v.cat);
  if (editId){
    const t = data.transactions.find(x => x.id === editId);
    Object.assign(t, { type: uiType, category: cat, amount: Math.round(v.amt*100), date: v.date, note: els.note.value.trim(), createdAt: Date.now() });
    persist(); stopEdit();
    toast('Updated ' + money(v.amt) + ' · ' + cat);
  } else {
    const t = newTx(uiType, cat, v.amt, v.date, els.note.value);
    data.transactions.push(t); persist();
    toast(`Added ${money(v.amt)} to ${cat}`, { actionLabel:'Copy id', onAction: () => copyText(t.id) });
  }
  // quick-entry: keep type + category, clear amount & note (stopEdit already did this after an edit save)
  els.amount.value = ''; els.note.value = ''; els.newCat.value = '';
  rebuildCategorySelects();
  els.catSelect.value = data.categories[uiType].includes(cat) ? cat : NEW_CAT;
  hideNewCatField();
  const dkey = v.date.slice(0,7);
  if (dkey !== viewMonth) setMonth(dkey);          // keep the viewed month in sync with what was just entered
  else { renderList(); renderSummary(); renderBudgets(); renderCharts(); }
  els.amount.focus();
}

function hideNewCatField(){ els.fNewCat.classList.add('hidden'); }

function setFormType(type){
  uiType = type;
  els.segExpense.classList.toggle('active', type === 'expense');
  els.segIncome.classList.toggle('active', type === 'income');
  els.segExpense.setAttribute('aria-pressed', String(type === 'expense'));
  els.segIncome.setAttribute('aria-pressed', String(type === 'income'));
  fillCatSelect(els.catSelect, type);
  hideNewCatField();
}

/* ---------------- month navigation ---------------- */
function setMonth(key){
  viewMonth = key;
  els.monthLabel.textContent = monthLabel(key);
  els.todayBtn.hidden = (key === currentMonthKey());
  page = 1;
  renderAll();
}

/* ---------------- import / export / clear / sample ---------------- */
function doExport(){
  if (window.showSaveFilePicker && mode === 'local'){
    fsSave(data).then(ok => { if (ok) toast('Linked — saving to ' + DATA_FILE + ' from now on.'); });
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = DATA_FILE;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Exported ' + DATA_FILE);
}

function parseImportText(text){
  let j; try{ j = JSON.parse(text); }catch(e){ throw new Error('not valid JSON'); }
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.transactions) ? j.transactions : null);
  if (!arr) throw new Error('no transactions found in file');
  return normalize({ transactions: arr, budgets: j.budgets, categories: j.categories });
}

function doImport(file){
  const read = new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('read failed')); r.readAsText(file); });
  read.then(text => {
    let nd; try{ nd = parseImportText(text); }catch(e){ toast('Import failed: ' + e.message, {type:'error'}); return; }
    if (!nd.transactions.length){ toast('File has no transactions.', {type:'warn'}); return; }
    const merged = mergeData(data, nd);      // never wipe the current ledger — merge by id, newest wins
    setData(merged);
    toast(`Imported ${nd.transactions.length} transactions — merged with your ledger`);
  }).catch(() => toast('Could not read that file.', {type:'error'}));
}

function loadSample(){
  const d = buildSample();
  setData(d);
  toast('Sample data loaded — feel free to edit or clear it.');
}

function buildSample(){
  const mk = (y, m) => y + '-' + pad2(m);
  let txs = [], base = new Date(); base.setUTCDate(1);
  for (let i = 3; i >= 0; i--){
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1, key = mk(y,m);
    const push = (type, cat, amt, day, note) => txs.push(newTx(type, cat, amt, key + '-' + pad2(day), note)); // amt in dollars; newTx stores cents
    push('income','Salary', 4650 + i*85, 1, 'Monthly salary');
    if (i % 2 === 0) push('income','Freelance', 340 + i*40, 14, 'Side project');
    push('expense','Housing', 1350, 2, 'Rent');
    push('expense','Utilities', 96.4 + i*7.2, 5, 'Power & internet');
    push('expense','Groceries', 82.15, 6, 'Weekly shop');
    push('expense','Groceries', 64.30, 13, 'Weekly shop');
    push('expense','Dining', 28.5 + i*4, 9, 'Lunch out');
    push('expense','Transport', 42, 12, 'Fuel & transit pass');
    if (i % 2 === 1) push('expense','Entertainment', 36.99, 18, 'Streaming + cinema');
    if (i === 1) push('expense','Shopping', 129.00, 21, 'New running shoes');
  }
  const d = normalize({ transactions: txs });
  d.budgets = { Housing: Math.round(1400*100), Groceries: Math.round(380*100), Dining: Math.round(150*100), Utilities: Math.round(120*100), Transport: Math.round(90*100) };
  return d;
}

/* ---------------- keyboard shortcuts ---------------- */
function onKey(e){
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
  if (typing) return;
  if (e.key === '/' ){ e.preventDefault(); els.q.focus(); }
  else if (e.key.toLowerCase() === 'n'){ e.preventDefault(); setFormType('expense'); els.amount.focus(); window.scrollTo({top:0, behavior:'smooth'}); }
}

/* ---------------- boot ---------------- */
function renderAll(){
  renderSummary();
  renderBudgets();
  renderCharts();
  renderList();
}
function renderCharts(){ renderDonut(); renderTrend(); }

document.addEventListener('DOMContentLoaded', () => {
  grabEls();
  updateModeBadge();

  // month nav
  els.prevBtn.onclick = () => setMonth(monthAdd(viewMonth, -1));
  els.nextBtn.onclick = () => setMonth(monthAdd(viewMonth, 1));
  els.todayBtn.onclick = () => setMonth(currentMonthKey());

  // form
  els.segExpense.onclick = () => setFormType('expense');
  els.segIncome.onclick  = () => setFormType('income');
  els.txForm.onsubmit = onSubmit;
  els.cancelEdit.onclick = stopEdit;
  els.amount.addEventListener('input', () => clearErr(els.fAmount));
  els.newCat.addEventListener('input', () => clearErr(els.fNewCat));
  els.catSelect.addEventListener('change', () => { els.fNewCat.classList.toggle('hidden', els.catSelect.value !== NEW_CAT); if (els.catSelect.value === NEW_CAT) els.newCat.focus(); });
  els.date.addEventListener('input', () => clearErr(els.fDate));
  els.note.addEventListener('input', () => clearErr(els.fNote));

  // filters
  [els.q, els.fType, els.fCat, els.fSort].forEach(el => el.addEventListener('input', () => { page = 1; renderList(); }));
  els.fScope.addEventListener('change', () => { page = 1; renderList(); });
  els.q.addEventListener('keydown', e => { if (e.key === 'Escape'){ els.q.value=''; page=1; renderList(); } });
  els.pagePrev.onclick = () => { page--; renderList(); };
  els.pageNext.onclick = () => { page++; renderList(); };

  // data ops
  els.exportBtn.onclick = doExport;
  els.importBtn.onclick = () => els.fileInput.click();
  els.fileInput.onchange = () => { if (els.fileInput.files[0]) doImport(els.fileInput.files[0]); els.fileInput.value=''; };
  els.sampleBtn.onclick = loadSample;

  // clear all (two-step)
  let clearTimer = null;
  els.clearBtn.onclick = () => {
    if (!data.transactions.length) return;
    if (els.clearBtn.classList.contains('armed')){
      data = emptyState(); persist(); renderAll();
      toast('Ledger cleared.');
      disarmClear();
    } else {
      els.clearBtn.classList.add('armed');
      els.clearBtn.textContent = 'Really clear everything?';
      clearTimeout(clearTimer);
      clearTimer = setTimeout(disarmClear, 3200);
    }
  };
  function disarmClear(){ clearTimeout(clearTimer); els.clearBtn.classList.remove('armed'); els.clearBtn.textContent = 'Clear all'; }

  document.addEventListener('keydown', onKey);
  let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(renderCharts, 150); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => renderCharts());

  els.date.value = todayStr();
  setMonth(currentMonthKey());      // sets label + renders with the current (possibly empty) data
  initStorage();                    // storage probe finishes async and re-renders when it lands
});
