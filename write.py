
import json, os, subprocess, sys, time, urllib.request, urllib.error

files = {}

# ---------------------------------------------------------------- index.html
files["index.html"] = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="description" content="Ledger — a minimal personal finance tracker. No dependencies, data in one JSON file.">
<title>Ledger · Personal Finance Tracker</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%230f766e'/%3E%3Ccircle cx='11.5' cy='4.5' r='2' fill='%23f5f4f0'/%3E%3C/svg%3E">
<link rel="stylesheet" href="styles.css">
</head>
<body>

<header class="shell top">
  <div class="brand"><span class="mark"></span>ledger<span class="tag">· personal finance</span></div>
  <nav class="month" aria-label="Month navigation">
    <button id="prevBtn" class="iconbtn nav" aria-label="Previous month">‹</button>
    <strong id="monthLabel">—</strong>
    <button id="nextBtn" class="iconbtn nav" aria-label="Next month">›</button>
    <button id="todayBtn" class="todaybtn" hidden>Today</button>
  </nav>
  <div class="actions">
    <button id="exportBtn" class="btn ghost" title="Download your ledger as data.json">Export</button>
    <button id="importBtn" class="btn ghost" title="Load a ledger from a data.json file">Import</button>
    <input type="file" id="fileInput" accept=".json,application/json" hidden>
  </div>
</header>

<main class="shell">
  <noscript><p class="noscript">This app needs JavaScript enabled.</p></noscript>

  <!-- ============ transaction form ============ -->
  <section class="card pad formcard" aria-labelledby="formTitle">
    <h2 id="formTitle">Add transaction</h2>
    <form id="txForm" novalidate>
      <div class="seg" role="group" aria-label="Transaction type">
        <button type="button" id="segExpense" class="segbtn active" data-type="expense" aria-pressed="true"><i class="tdot neg"></i>Expense</button>
        <button type="button" id="segIncome" class="segbtn" data-type="income" aria-pressed="false"><i class="tdot pos"></i>Income</button>
      </div>
      <div class="formgrid">
        <div class="field" id="fAmount">
          <label for="amount">Amount</label>
          <input id="amount" inputmode="decimal" autocomplete="off" placeholder="0.00">
          <small class="err"></small>
        </div>
        <div class="field" id="fCategory">
          <label for="catSelect">Category</label>
          <select id="catSelect"></select>
          <small class="err"></small>
        </div>
        <div class="field hidden" id="fNewCat">
          <label for="newCat">New category</label>
          <input id="newCat" maxlength="24" autocomplete="off" placeholder="e.g. Pets">
          <small class="err"></small>
        </div>
        <div class="field" id="fDate">
          <label for="date">Date</label>
          <input type="date" id="date">
          <small class="err"></small>
        </div>
        <div class="field grow" id="fNote">
          <label for="note">Note <span class="opt">(optional)</span></label>
          <input id="note" maxlength="60" autocomplete="off" placeholder="e.g. Groceries at the corner store">
          <small class="err"></small>
        </div>
        <div class="fieldbtn">
          <button type="submit" class="btn primary" id="submitBtn">Add</button>
          <button type="button" class="btn ghost" id="cancelEdit" hidden>Cancel</button>
        </div>
      </div>
    </form>
  </section>

  <!-- ============ monthly summary ============ -->
  <section aria-label="Monthly summary">
    <div class="cards">
      <div class="card stat"><span class="lbl">Income</span><div class="val" id="sumIncome">$0.00</div><div class="delta" id="dIncome"></div></div>
      <div class="card stat"><span class="lbl">Expenses</span><div class="val" id="sumExpenses">$0.00</div><div class="delta" id="dExpenses"></div></div>
      <div class="card stat"><span class="lbl">Net</span><div class="val" id="sumNet">$0.00</div><div class="delta"><span class="flat" id="netSub"></span></div></div>
      <div class="card stat"><span class="lbl">Savings rate</span><div class="val" id="sumRate">—</div><div class="delta"><span class="flat">of income kept</span></div></div>
    </div>
  </section>

  <!-- ============ charts ============ -->
  <section class="charts" aria-label="Charts">
    <div class="card pad chartcard">
      <h3>Spending by category</h3>
      <p class="subline" id="donutSub">—</p>
      <div class="donutwrap">
        <div class="donutbox"><canvas id="donutCanvas"></canvas></div>
        <ul class="legend" id="legend"></ul>
      </div>
    </div>
    <div class="card pad chartcard">
      <h3>Income vs expenses</h3>
      <p class="subline">last 6 months</p>
      <div class="trendlegend"><span><i style="background:#0f766e"></i>Income</span><span><i style="background:#dc2626"></i>Expenses</span></div>
      <canvas id="trendCanvas"></canvas>
    </div>
  </section>

  <!-- ============ transactions list ============ -->
  <section class="card pad listcard" aria-label="Transactions">
    <div class="listhead">
      <h3>Transactions</h3>
      <div class="toolbar">
        <div class="search">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          <input id="q" placeholder="Search note, category, amount…" aria-label="Search transactions">
        </div>
        <select id="fType" aria-label="Filter by type">
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expenses</option>
        </select>
        <select id="fCat" aria-label="Filter by category"></select>
        <select id="fScope" aria-label="Date scope">
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
        <select id="fSort" aria-label="Sort order">
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="amount-desc">Highest amount</option>
          <option value="amount-asc">Lowest amount</option>
        </select>
      </div>
    </div>
    <div id="rowList" class="rowlist"></div>
    <div class="listfoot">
      <span id="countLabel"></span>
      <div class="pager" id="pager">
        <button id="pagePrev" class="iconbtn" aria-label="Previous page">‹</button>
        <span id="pageInfo"></span>
        <button id="pageNext" class="iconbtn" aria-label="Next page">›</button>
      </div>
    </div>
  </section>
</main>

<footer class="shell foot">
  <span class="mode" id="modeWrap"><i id="modeDot"></i><span id="modeText">…</span></span>
  <span class="sep">•</span>
  <button id="sampleBtn" class="linkbtn hidden">Load sample data</button>
  <span id="clearWrap" class="hidden"><span class="sep">•</span><button id="clearBtn" class="linkbtn danger">Clear all</button></span>
</footer>

<div id="toasts" aria-live="polite"></div>
<script src="app.js"></script>
</body>
</html>
'''

# ---------------------------------------------------------------- styles.css
files["styles.css"] = r'''/* Ledger — minimal, light, no dependencies */
:root{
  --bg:#f5f4f0;
  --card:#ffffff;
  --line:#e7e4dc;
  --ink:#211f1a;
  --sub:#77746a;
  --accent:#0f766e;
  --accent-dark:#0c5f58;
  --accent-soft:#e9f2ef;
  --danger:#b91c1c;
  --font:-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--font);-webkit-font-smoothing:antialiased}
::selection{background:#d7e6e2}
.shell{max-width:1060px;margin:0 auto;padding:0 20px}
[hidden]{display:none!important}
.hidden{display:none!important}
h2,h3,p{margin:0}
button{font-family:inherit}
input,select{font-family:inherit}

/* ---------- header ---------- */
.top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding-top:22px;padding-bottom:10px}
.brand{display:flex;align-items:baseline;gap:9px;font-size:19px;font-weight:700;letter-spacing:-.02em}
.mark{width:15px;height:15px;border-radius:4px;background:var(--accent);position:relative;top:2px}
.mark::after{content:"";position:absolute;right:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:var(--ink)}
.tag{font-size:12.5px;font-weight:500;color:var(--sub);letter-spacing:0}
.month{display:flex;align-items:center;gap:4px;background:var(--card);border:1px solid var(--line);padding:3px 5px;border-radius:999px;margin-left:auto}
.month strong{min-width:122px;text-align:center;font-size:14px;font-variant-numeric:tabular-nums}
.todaybtn{border:0;background:none;color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;padding:5px 9px;border-radius:999px}
.todaybtn:hover{background:var(--accent-soft)}
.actions{display:flex;gap:8px}

/* ---------- buttons ---------- */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 15px;border-radius:9px;border:1px solid transparent;font-size:14px;font-weight:600;cursor:pointer;background:none;color:var(--ink);transition:background .12s,border-color .12s}
.btn.primary{background:var(--accent);color:#fff}
.btn.primary:hover{background:var(--accent-dark)}
.btn.ghost{border-color:var(--line);background:var(--card)}
.btn.ghost:hover{background:#f4f2ec}
.iconbtn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:0;background:none;border-radius:8px;color:var(--sub);cursor:pointer;padding:0;transition:background .12s,color .12s}
.iconbtn:hover{background:#f1efe8;color:var(--ink)}
.iconbtn:disabled{opacity:.35;cursor:default}
.iconbtn.danger:hover{background:#fdecec;color:var(--danger)}
.iconbtn.armed{width:auto;padding:0 10px;background:var(--danger);color:#fff;font-size:12px;font-weight:600}
.linkbtn{border:0;background:none;color:var(--accent);font-size:12.5px;font-weight:600;cursor:pointer;padding:3px 6px;border-radius:7px}
.linkbtn:hover{text-decoration:underline}
.linkbtn.danger{color:var(--danger)}
.linkbtn.armed{background:#fdecec;text-decoration:none}

/* ---------- cards ---------- */
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 2px rgba(30,26,15,.03)}
.pad{padding:18px}
h2{font-size:15.5px;font-weight:650?}
h2{font-size:15.5px;font-weight:600}
h3{font-size:14.5px;font-weight:600}

/* ---------- form ---------- */
.seg{display:flex;gap:4px;background:#efece4;padding:4px;border-radius:11px;margin:12px 0 14px;max-width:380px}
.segbtn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;height:34px;border:1px solid transparent;background:none;border-radius:8px;font-size:14px;font-weight:600;color:var(--sub);cursor:pointer}
.segbtn.active{background:var(--card);border-color:var(--line);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.06)}
.tdot{width:8px;height:8px;border-radius:50%;flex:none}
.tdot.neg{background:#dc2626}
.tdot.pos{background:var(--accent)}
.formgrid{display:grid;grid-template-columns:minmax(120px,1.1fr) minmax(150px,1.35fr) 148px minmax(150px,1.7fr) auto;gap:12px;align-items:start}
.field{display:flex;flex-direction:column;gap:5px;min-width:0}
.field label{font-size:12px;font-weight:600;color:var(--sub);letter-spacing:.02em}
.opt{color:#b3b0a5;font-weight:500}
input,select{height:38px;border:1px solid var(--line);border-radius:9px;padding:0 11px;font-size:14px;background:#fff;color:var(--ink);width:100%;min-width:0;transition:border-color .12s,box-shadow .12s}
input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(15,118,110,.14)}
.field.invalid input,.field.invalid select{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,.10)}
.err{font-size:12px;color:var(--danger);line-height:1.3}
.err:empty{display:none}
.fieldbtn{display:flex;gap:8px}
.fieldbtn .btn{height:38px}

/* ---------- summary cards ---------- */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin:4px 0 14px}
.stat{padding:14px 16px}
.stat .lbl{font-size:12.5px;color:var(--sub);font-weight:600}
.stat .val{font-size:23px;font-weight:700;letter-spacing:-.01em;margin-top:3px;font-variant-numeric:tabular-nums;white-space:nowrap}
.val.pos{color:var(--accent)}
.val.neg{color:var(--danger)}
.delta{font-size:12.5px;margin-top:4px;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.delta .good{color:var(--accent);font-weight:600}
.delta .bad{color:var(--danger);font-weight:600}
.flat{color:var(--sub)}

/* ---------- charts ---------- */
.charts{display:grid;grid-template-columns:1.05fr 1fr;gap:14px;margin-bottom:14px}
.subline{color:var(--sub);font-size:12.5px;margin-top:2px}
.donutwrap{display:flex;gap:18px;align-items:center;margin-top:10px}
.donutbox{flex:0 0 198px;height:198px}
.donutbox canvas{width:100%;height:100%;display:block}
.legend{list-style:none;margin:0;padding:0;flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;font-size:13.5px}
.legend li{display:grid;grid-template-columns:12px minmax(0,1fr) auto 38px;gap:9px;align-items:center}
.legend i{width:10px;height:10px;border-radius:3px}
.lname{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lval{font-variant-numeric:tabular-nums}
.lpc{color:var(--sub);text-align:right}
.legend .lempty{grid-template-columns:12px minmax(0,1fr) auto 38px;color:var(--sub)}
.trendlegend{display:flex;gap:16px;font-size:12.5px;color:var(--sub);margin-top:9px}
.trendlegend i{width:9px;height:9px;border-radius:3px;display:inline-block;margin-right:6px}
#trendCanvas{width:100%;height:208px;display:block}

/* ---------- transactions list ---------- */
.listcard{padding:16px 14px 12px}
.listhead{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px;padding:0 4px}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;align-items:center}
.toolbar select{height:34px;width:auto;font-size:13.5px;padding:0 9px;background:#fff}
.search{position:relative;flex:1 1 210px;max-width:320px}
.search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#a5a297;pointer-events:none}
.search input{height:34px;font-size:13.5px;padding-left:32px}
.rowlist{display:flex;flex-direction:column}
.row{display:grid;grid-template-columns:86px minmax(0,1fr) auto 76px;grid-template-areas:"date main amt act";gap:4px 12px;align-items:center;padding:10px 8px;border-radius:10px}
.row + .row{border-top:1px solid #f0eee7}
.row:hover{background:#faf9f5}
.row.editing{background:var(--accent-soft)}
.rdate{grid-area:date;color:var(--sub);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
.rmain{grid-area:main;display:flex;align-items:center;gap:9px;min-width:0}
.rnote{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.muted{color:#b3b0a5;font-weight:500}
.chip{flex:none;font-size:11.5px;font-weight:600;padding:2.5px 9px;border-radius:999px;letter-spacing:.01em;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip.income{background:#e7f1ee;color:#0d5f56}
.chip.expense{background:#f8efec;color:#a04b32}
.ramt{grid-area:amt;font-weight:600;font-variant-numeric:tabular-nums;font-size:14.5px;white-space:nowrap;text-align:right}
.ramt.pos{color:var(--accent)}
.ramt.neg{color:var(--danger)}
.ract{grid-area:act;display:flex;gap:2px;justify-content:flex-end}
.ract .iconbtn{opacity:0}
.row:hover .ract .iconbtn,.ract .iconbtn:focus-visible,.row.editing .ract .iconbtn{opacity:1}
@media (hover:none){.ract .iconbtn{opacity:1}}
.listfoot{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:0 4px;color:var(--sub);font-size:13px;gap:10px}
.pager{display:flex;align-items:center;gap:6px}
#pageInfo{font-size:12.5px;font-variant-numeric:tabular-nums}

/* ---------- empty states ---------- */
.empty{padding:48px 20px;text-align:center}
.empty.small{padding:34px 20px}
.emptymark{font-size:36px;color:#d8d5cb;line-height:1;margin-bottom:10px}
.empty p + p{margin-top:4px}
.empty .btn{margin-top:16px}
.empty .subline,.empty p.sub{color:var(--sub);font-size:13.5px}

/* ---------- footer ---------- */
.foot{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding-top:20px;padding-bottom:30px;color:var(--sub);font-size:12.5px}
.mode{display:inline-flex;align-items:center;gap:7px;font-weight:500}
.mode i{width:7px;height:7px;border-radius:50%;background:#c9c5b8;display:inline-block}
.mode.on i{background:var(--accent)}
.sep{color:#cfccc3}

/* ---------- toasts ---------- */
#toasts{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:50;width:min(92vw,460px)}
.toast{display:flex;align-items:center;gap:10px;background:#26241e;color:#f7f6f2;padding:10px 14px;border-radius:11px;font-size:13.5px;box-shadow:0 8px 24px rgba(0,0,0,.20);opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s}
.toast.show{opacity:1;transform:none}
.toast.warn{background:#7c3a1d}
.toast.error{background:#991b1b}
.toast button{margin-left:auto;background:rgba(255,255,255,.14);color:#fff;border:0;border-radius:7px;padding:4px 11px;font-weight:600;font-size:12.5px;cursor:pointer;flex:none}
.toast button:hover{background:rgba(255,255,255,.24)}

.noscript{background:#fdecec;color:var(--danger);padding:14px;border-radius:10px;margin:16px 0}

:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
input:focus-visible,select:focus-visible{outline:none}

/* ---------- responsive ---------- */
@media (max-width:900px){
  .charts{grid-template-columns:1fr}
  .formgrid{grid-template-columns:1fr 1fr}
  #fNote,#fieldbtn,.fieldbtn{grid-column:span 2}
  #fDate{order:5}
  .month{margin-left:0}
}
@media (max-width:620px){
  .brand .tag{display:none}
  .actions{width:100%;justify-content:flex-end}
  .search{flex-basis:100%;max-width:none;order:-1}
}
@media (max-width:560px){
  body{font-size:14.5px}
  .shell{padding:0 14px}
  .formgrid{grid-template-columns:1fr}
  #fNote,.fieldbtn{grid-column:auto}
  .seg{max-width:none}
  .row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"main amt" "meta act";row-gap:5px;padding:12px 6px}
  .rdate{grid-area:meta}
  .ract{grid-area:act;align-self:end}
  .stat .val{font-size:20px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media print{.actions,.toolbar,.ract,.pager,.foot,#toasts,.seg,.formgrid{display:none}.card{box-shadow:none}}
'''

print("wrote drafts of index.html and styles.css, lengths:", len(files["index.html"]), len(files["styles.css"]))
