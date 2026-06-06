import { Router, type IRouter } from "express";
import { db, serversTable, expiredServersTable } from "@workspace/db";
import { desc, eq, gte } from "drizzle-orm";
import { computeEventTimers } from "../lib/calculator.js";
import { isWarmingUp, getUptimeSeconds } from "../lib/poller.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const [allRows, confirmedRows, newRows, expiredRows] = await Promise.all([
      db.select().from(serversTable),
      db.select().from(serversTable).where(gte(serversTable.scanCount, 2)),
      db.select().from(serversTable).where(eq(serversTable.scanCount, 1)),
      db.select().from(expiredServersTable).orderBy(desc(expiredServersTable.expiredAt)).limit(60),
    ]);

    const seaCounts = { first: 0, second: 0, third: 0 };
    for (const s of allRows) {
      if (s.sea === 1) seaCounts.first++;
      else if (s.sea === 2) seaCounts.second++;
      else if (s.sea === 3) seaCounts.third++;
    }

    const now = Date.now();

    type ServerRow = {
      jobId: string;
      placeId: string;
      sea: number;
      playerCount: number;
      maxPlayers: number;
      ageSeconds: number;
      nextEventSeconds: number;
      events: ReturnType<typeof computeEventTimers>;
    };

    const servers: ServerRow[] = confirmedRows
      .map((s) => {
        const events = computeEventTimers(s);
        const upcomingTimes = events
          .filter((t) => t.timeUntilSeconds !== null && !t.isActive)
          .map((t) => t.timeUntilSeconds as number);
        const nextEventSeconds =
          upcomingTimes.length > 0 ? Math.min(...upcomingTimes) : 9999999;
        return {
          jobId: s.jobId,
          placeId: String(s.placeId),
          sea: s.sea,
          playerCount: s.playerCount,
          maxPlayers: s.maxPlayers,
          ageSeconds: Math.floor((now - Number(s.firstSeen)) / 1000),
          nextEventSeconds,
          events,
        };
      })
      .sort((a, b) => a.nextEventSeconds - b.nextEventSeconds)
      .slice(0, 100);

    const stats = {
      total: allRows.length,
      confirmed: confirmedRows.length,
      seaCounts,
      uptimeSeconds: getUptimeSeconds(),
      warmingUp: isWarmingUp() || confirmedRows.length === 0,
    };

    const newServerCards = newRows.map((s) => {
      const ageSec = Math.floor((now - Number(s.firstSeen)) / 1000);
      const seaName = SEA_NAMES[s.sea] ?? "Unknown";
      const seaClass = `sea-${s.sea}`;
      const safeJob = escAttr(String(s.jobId));
      const safePlace = escAttr(String(s.placeId));
      const minsUntilConfirm = Math.max(0, Math.ceil((10 * 60 - ageSec) / 60));
      return `<div class="card new-card" data-sea="${s.sea}">
  <div class="card-header">
    <span class="sea-badge ${seaClass}">${seaName}</span>
    <span class="card-age">Found ${fmtAge(ageSec)} ago</span>
  </div>
  <div class="card-players">👥 ${s.playerCount} / ${s.maxPlayers} players</div>
  <div class="events">
    <div class="ev"><span class="ev-name muted">⏳ Confirming — appears on dashboard in ~${minsUntilConfirm}m</span></div>
    <div class="ev"><span class="ev-name muted">Age starts at 0 — event timers begin after confirmation</span></div>
  </div>
  <button class="join-btn" data-place="${safePlace}" data-job="${safeJob}">⚓ Join Server</button>
</div>`;
    });

    const expiredCards = expiredRows.map((s) => {
      const livedSec = Math.floor((Number(s.lastSeen) - Number(s.firstSeen)) / 1000);
      const agoSec = Math.floor((now - Number(s.expiredAt)) / 1000);
      const seaName = SEA_NAMES[s.sea] ?? "Unknown";
      const seaClass = `sea-${s.sea}`;
      return `<div class="card expired-card" data-sea="${s.sea}">
  <div class="card-header">
    <span class="sea-badge ${seaClass}">${seaName}</span>
    <span class="card-age" style="color:var(--del)">Expired ${fmtAge(agoSec)} ago</span>
  </div>
  <div class="card-players">👥 ${s.playerCount} / ${s.maxPlayers} players at expiry</div>
  <div class="events">
    <div class="ev"><span class="ev-name">⏱️ Lived</span><span class="ev-time">${fmtAge(livedSec)}</span></div>
    <div class="ev"><span class="ev-name">🔍 Scans</span><span class="ev-time">${s.scanCount}</span></div>
  </div>
  <button class="join-btn" style="background:var(--del);cursor:not-allowed;opacity:.6" disabled>❌ Expired</button>
</div>`;
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(buildHtml(servers, newServerCards, expiredCards, stats));
  } catch (err) {
    req.log.error({ err }, "Dashboard render error");
    res.status(500).send("<h1>Server error — try refreshing</h1>");
  }
});

const SEA_NAMES: Record<number, string> = {
  1: "First Sea",
  2: "Second Sea",
  3: "Third Sea",
};

function fmtAge(s: number): string {
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderCard(s: {
  jobId: string;
  placeId: string;
  sea: number;
  playerCount: number;
  maxPlayers: number;
  ageSeconds: number;
  nextEventSeconds: number;
  events: ReturnType<typeof computeEventTimers>;
}): string {
  const seaName = SEA_NAMES[s.sea] ?? "Unknown";
  const seaClass = `sea-${s.sea}`;

  let evHtml = "";
  for (const e of s.events) {
    if (e.timeUntilSeconds === null && !e.isActive) continue;
    const cls = e.isActive ? "on" : e.isAlert ? "alert" : "";
    const t = e.isActive ? "⚡ ACTIVE" : (e.timeUntilFormatted ?? "—");
    evHtml += `<div class="ev ${cls}"><span class="ev-name">${e.name}</span><span class="ev-time">${t}</span></div>`;
  }
  if (!evHtml) {
    evHtml = `<div class="ev"><span class="ev-name muted">No events</span></div>`;
  }

  // Compact event data for Best Servers tab — key:seconds pairs, active=-1
  const eventData = s.events
    .map((e) => {
      const t = e.isActive ? -1 : (e.timeUntilSeconds ?? 9999999);
      return `${e.key}:${t}`;
    })
    .join(",");

  const safeJobId = escAttr(String(s.jobId));
  const safePlaceId = escAttr(String(s.placeId));

  return `<div class="card" data-sea="${s.sea}" data-next="${s.nextEventSeconds}" data-age="${s.ageSeconds}" data-players="${s.playerCount}" data-events="${escAttr(eventData)}">
  <div class="card-header">
    <span class="sea-badge ${seaClass}">${seaName}</span>
    <span class="card-age">Age: ${fmtAge(s.ageSeconds)}</span>
  </div>
  <div class="card-players">👥 ${s.playerCount} / ${s.maxPlayers} players</div>
  <div class="events">${evHtml}</div>
  <button class="join-btn" data-place="${safePlaceId}" data-job="${safeJobId}">⚓ Join Server</button>
</div>`;
}

type ServerRow = {
  jobId: string;
  placeId: string;
  sea: number;
  playerCount: number;
  maxPlayers: number;
  ageSeconds: number;
  nextEventSeconds: number;
  events: ReturnType<typeof computeEventTimers>;
};

function buildHtml(
  servers: ServerRow[],
  newServerCards: string[],
  expiredCards: string[],
  stats: {
    total: number;
    confirmed: number;
    seaCounts: { first: number; second: number; third: number };
    uptimeSeconds: number;
    warmingUp: boolean;
  },
): string {
  const uptimeDisplay = (() => {
    const s = stats.uptimeSeconds;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  const warmingHtml = stats.warmingUp
    ? `<div class="warming-banner">
        ⏳ <strong>Collecting data</strong> — BloxHop needs 2 full scans (~10 min) before showing servers.
        Scan 1 done. Next scan at ~10 min mark. This banner disappears automatically.
       </div>`
    : "";

  // Cards pre-sorted by next event server-side
  const cardsHtml = servers.map(renderCard).join("\n");
  const cardCount = servers.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>BloxHop — Blox Fruits Server Hop</title>
<style>
:root{--bg:#0e0e12;--surface:#17171f;--surface2:#1f1f2a;--border:#2a2a38;--accent:#7c3aed;--accent2:#a855f7;--text:#e2e2f0;--muted:#7a7a9a;--alert:#f59e0b;--active:#22c55e;--del:#ef4444;--sea1:#3b82f6;--sea2:#10b981;--sea3:#f59e0b}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}
header{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.logo{font-size:1.4rem;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.stats-bar{display:flex;gap:20px;flex-wrap:wrap}
.stat{text-align:center}
.stat-val{font-size:1.3rem;font-weight:700;color:var(--accent2)}
.stat-lbl{font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.warming-banner{background:linear-gradient(90deg,#78350f,#92400e);border:1px solid #b45309;color:#fcd34d;padding:12px 24px;font-size:.85rem;text-align:center;line-height:1.6}
.topbar{padding:6px 24px;font-size:.75rem;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
.topbar a{color:var(--accent2);cursor:pointer;text-decoration:none;margin-left:auto}
.tab-bar{padding:0 24px;display:flex;border-bottom:1px solid var(--border)}
.tab{padding:10px 20px;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;font-size:.9rem;transition:all .15s}
.tab.active{color:var(--accent2);border-bottom-color:var(--accent2)}
.controls{padding:16px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.btn{padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:.85rem;transition:all .15s}
.btn:hover{border-color:var(--accent);color:var(--accent2)}
.btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
.sea1btn.active{background:var(--sea1);border-color:var(--sea1)}
.sea2btn.active{background:var(--sea2);border-color:var(--sea2)}
.sea3btn.active{background:var(--sea3);border-color:var(--sea3)}
.sort-lbl{font-size:.85rem;color:var(--muted)}
select{padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.85rem}
select:focus{outline:none;border-color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;padding:20px 24px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;transition:border-color .15s}
.card:hover{border-color:var(--accent)}
.card.hidden{display:none}
.card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:8px}
.sea-badge{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:5px}
.sea-1{background:#1e3a5f;color:var(--sea1)}
.sea-2{background:#064e3b;color:var(--sea2)}
.sea-3{background:#451a03;color:var(--sea3)}
.card-age{font-size:.75rem;color:var(--muted)}
.card-players{font-size:.8rem;color:var(--muted);margin-bottom:10px}
.events{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
.ev{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:6px;background:var(--surface2);font-size:.8rem}
.ev.alert{background:#451a03;color:var(--alert)}
.ev.on{background:#052e16;color:var(--active);font-weight:700}
.ev-name{color:var(--muted)}
.ev.alert .ev-name,.ev.on .ev-name{color:inherit}
.muted{color:var(--muted)}
.ev-time{font-weight:600;font-variant-numeric:tabular-nums}
.join-btn{width:100%;padding:8px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-weight:700;cursor:pointer;font-size:.85rem;transition:background .15s}
.join-btn:hover{background:var(--accent2)}
.empty{padding:60px 24px;text-align:center;color:var(--muted)}
.best-controls{padding:16px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
#count-badge{font-size:.8rem;color:var(--muted);margin-left:4px}
#best-grid .card{display:none}
#best-grid .card.match{display:block}
@media(max-width:600px){header{padding:12px 16px}.grid{padding:12px 16px;gap:10px}.controls{padding:12px 16px}.stats-bar{gap:12px}}
</style>
<script>
/* Stubs defined in <head> so onclick= attributes never throw a ReferenceError
   even if the user taps before the full page has finished loading. */
function switchTab(){}
function setFilter(){}
function applySort(){}
function applyBest(){}
function setNewFilter(){}
function setExpiredFilter(){}
</script>
</head>
<body>
<header>
  <div class="logo">🏴‍☠️ BloxHop</div>
  <div class="stats-bar">
    <div class="stat"><div class="stat-val" style="color:var(--accent2)">${stats.total}</div><div class="stat-lbl">Tracked</div></div>
    <div class="stat"><div class="stat-val" style="color:var(--sea1)">${stats.seaCounts.first}</div><div class="stat-lbl">Sea 1</div></div>
    <div class="stat"><div class="stat-val" style="color:var(--sea2)">${stats.seaCounts.second}</div><div class="stat-lbl">Sea 2</div></div>
    <div class="stat"><div class="stat-val" style="color:var(--sea3)">${stats.seaCounts.third}</div><div class="stat-lbl">Sea 3</div></div>
    <div class="stat"><div class="stat-val">${uptimeDisplay}</div><div class="stat-lbl">Uptime</div></div>
  </div>
</header>
${warmingHtml}
<div class="topbar">
  <span>✅ ${stats.confirmed} confirmed servers loaded</span>
  <a href="javascript:location.reload()">↻ Refresh</a>
</div>
<div class="tab-bar">
  <div class="tab active" id="tab-all" onclick="switchTab('all')">All Servers <span id="count-badge">(${cardCount})</span></div>
  <div class="tab" id="tab-new" onclick="switchTab('new')">New Servers <span style="font-size:.75rem;background:#1a3a1a;color:#4ade80;padding:2px 7px;border-radius:10px;margin-left:4px">${newServerCards.length}</span></div>
  <div class="tab" id="tab-best" onclick="switchTab('best')">Best Servers</div>
  <div class="tab" id="tab-expired" onclick="switchTab('expired')">Expired <span style="font-size:.75rem;background:#2a1a1a;color:#f87171;padding:2px 7px;border-radius:10px;margin-left:4px">${expiredCards.length}</span></div>
</div>

<div id="pane-all">
  <div class="controls">
    <button class="btn active" id="btn-0" onclick="setFilter(0)">All Seas</button>
    <button class="btn sea1btn" id="btn-1" onclick="setFilter(1)">First Sea</button>
    <button class="btn sea2btn" id="btn-2" onclick="setFilter(2)">Second Sea</button>
    <button class="btn sea3btn" id="btn-3" onclick="setFilter(3)">Third Sea</button>
    <span class="sort-lbl" style="margin-left:8px">Sort:</span>
    <select id="sort-sel" onchange="applySort()">
      <option value="event" selected>Next Event</option>
      <option value="age">Server Age</option>
      <option value="players">Players</option>
    </select>
  </div>
  <div id="all-grid" class="grid">
${cardsHtml}
  </div>
  <div id="all-empty" class="empty" style="display:none">No servers match this filter.</div>
</div>

<div id="pane-new" style="display:none">
  <div style="padding:12px 24px;font-size:.82rem;color:var(--muted);border-bottom:1px solid var(--border);background:var(--surface)">
    🆕 <strong style="color:var(--text)">Servers found in the latest scan</strong> — these just appeared and will move to <em>All Servers</em> once the next scan confirms them (~10 min). Age starts at <strong style="color:var(--active)">0</strong> when first discovered.
  </div>
  <div style="padding:6px 24px;font-size:.75rem;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
    <span id="new-status">Live · updates every 60s</span>
    <span id="new-spinner" style="display:none">⏳</span>
  </div>
  <div id="new-controls" style="padding:12px 24px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border)">
    <button class="btn active" id="nbtn-0" onclick="setNewFilter(0)">All Seas</button>
    <button class="btn sea1btn" id="nbtn-1" onclick="setNewFilter(1)">First Sea</button>
    <button class="btn sea2btn" id="nbtn-2" onclick="setNewFilter(2)">Second Sea</button>
    <button class="btn sea3btn" id="nbtn-3" onclick="setNewFilter(3)">Third Sea</button>
  </div>
  <div id="new-grid" class="grid">
    ${newServerCards.length > 0 ? newServerCards.join("\n") : '<div class="empty">No new servers right now — scan in progress…</div>'}
  </div>
</div>

<div id="pane-best" style="display:none">
  <div class="best-controls">
    <label style="font-size:.85rem;color:var(--muted)">Event:</label>
    <select id="best-event" onchange="applyBest()">
      <option value="fruit">Fruit Spawn</option>
      <option value="castle">Castle Raid</option>
      <option value="factory">Factory Raid</option>
      <option value="fist">Fist of Darkness</option>
      <option value="chalice">God's Chalice</option>
      <option value="sword">Sword Dealer</option>
    </select>
    <label style="font-size:.85rem;color:var(--muted)">Within:</label>
    <select id="best-within" onchange="applyBest()">
      <option value="120">2 min</option>
      <option value="300" selected>5 min</option>
      <option value="600">10 min</option>
      <option value="900">15 min</option>
      <option value="1800">30 min</option>
    </select>
    <span id="best-count" style="font-size:.8rem;color:var(--muted)"></span>
  </div>
  <div id="best-grid" class="grid">
${cardsHtml}
  </div>
  <div id="best-empty" class="empty" style="display:none">No servers with this event firing in the selected window.</div>
</div>

<div id="pane-expired" style="display:none">
  <div style="padding:12px 24px;font-size:.82rem;color:var(--muted);border-bottom:1px solid var(--border);background:var(--surface)">
    💀 <strong style="color:var(--text)">Recently expired servers</strong> — disappeared during the last scan. Shows how long each server lived and its player count at the time.
  </div>
  <div id="expired-controls" style="padding:12px 24px;display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--border)">
    <button class="btn active" id="ebtn-0" onclick="setExpiredFilter(0)">All Seas</button>
    <button class="btn sea1btn" id="ebtn-1" onclick="setExpiredFilter(1)">First Sea</button>
    <button class="btn sea2btn" id="ebtn-2" onclick="setExpiredFilter(2)">Second Sea</button>
    <button class="btn sea3btn" id="ebtn-3" onclick="setExpiredFilter(3)">Third Sea</button>
  </div>
  <div id="expired-grid" class="grid">
    ${expiredCards.length > 0 ? expiredCards.join("\n") : '<div class="empty">No expired servers yet — check back after the next scan.</div>'}
  </div>
</div>

<script>
var seaFilter = 0;

function setFilter(sea) {
  seaFilter = sea;
  for (var i = 0; i <= 3; i++) {
    var b = document.getElementById('btn-' + i);
    if (b) b.classList.toggle('active', i === sea);
  }
  applyFilter();
}

function applyFilter() {
  var sortBy = document.getElementById('sort-sel').value;
  var grid = document.getElementById('all-grid');
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));

  // Filter
  var visible = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var s = parseInt(c.getAttribute('data-sea'), 10);
    var show = seaFilter === 0 || s === seaFilter;
    c.classList.toggle('hidden', !show);
    if (show) visible.push(c);
  }

  // Sort visible cards
  visible.sort(function(a, b) {
    if (sortBy === 'age') return parseInt(b.getAttribute('data-age'), 10) - parseInt(a.getAttribute('data-age'), 10);
    if (sortBy === 'players') return parseInt(b.getAttribute('data-players'), 10) - parseInt(a.getAttribute('data-players'), 10);
    return parseInt(a.getAttribute('data-next'), 10) - parseInt(b.getAttribute('data-next'), 10);
  });

  // Re-append in sorted order (hidden cards go to end)
  var hidden = cards.filter(function(c) { return c.classList.contains('hidden'); });
  for (var j = 0; j < visible.length; j++) grid.appendChild(visible[j]);
  for (var k = 0; k < hidden.length; k++) grid.appendChild(hidden[k]);

  var badge = document.getElementById('count-badge');
  if (badge) badge.textContent = '(' + visible.length + ')';
  document.getElementById('all-empty').style.display = visible.length === 0 ? '' : 'none';
}

function applySort() { applyFilter(); }

function applyBest() {
  var eventKey = document.getElementById('best-event').value;
  var within = parseInt(document.getElementById('best-within').value, 10);
  var grid = document.getElementById('best-grid');
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
  var matches = [];

  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var raw = c.getAttribute('data-events') || '';
    var pairs = raw.split(',');
    var found = false;
    var eta = 9999999;
    for (var j = 0; j < pairs.length; j++) {
      var parts = pairs[j].split(':');
      if (parts[0] === eventKey) {
        var t = parseInt(parts[1], 10);
        if (t === -1 || (t >= 0 && t <= within)) {
          found = true;
          eta = t === -1 ? 0 : t;
        }
        break;
      }
    }
    c.classList.toggle('match', found);
    if (found) matches.push({ card: c, eta: eta });
  }

  // Sort matches by eta ascending
  matches.sort(function(a, b) { return a.eta - b.eta; });
  for (var m = 0; m < matches.length; m++) grid.appendChild(matches[m].card);

  var countEl = document.getElementById('best-count');
  if (countEl) countEl.textContent = matches.length ? matches.length + ' server' + (matches.length > 1 ? 's' : '') : '';
  document.getElementById('best-empty').style.display = matches.length === 0 ? '' : 'none';
}

var SEA_NAMES_JS = {1:'First Sea',2:'Second Sea',3:'Third Sea'};
var SEA_CLASS_JS = {1:'sea-1',2:'sea-2',3:'sea-3'};

function fmtAgeJs(sec) {
  var m = Math.floor(sec / 60);
  if (m < 60) return m + 'm';
  var h = Math.floor(m / 60), rm = m % 60;
  return rm > 0 ? h + 'h ' + rm + 'm' : h + 'h';
}

function buildNewCard(s) {
  var ageSec = Math.floor((Date.now() - s.firstSeen) / 1000);
  var seaName = SEA_NAMES_JS[s.sea] || 'Unknown';
  var seaClass = SEA_CLASS_JS[s.sea] || '';
  var mins = Math.max(0, Math.ceil((600 - ageSec) / 60));
  var div = document.createElement('div');
  div.className = 'card new-card';
  div.setAttribute('data-sea', String(s.sea));
  div.innerHTML =
    '<div class="card-header">' +
      '<span class="sea-badge ' + seaClass + '">' + seaName + '</span>' +
      '<span class="card-age">Found ' + fmtAgeJs(ageSec) + ' ago</span>' +
    '</div>' +
    '<div class="card-players">👥 ' + s.playerCount + ' / ' + s.maxPlayers + ' players</div>' +
    '<div class="events">' +
      '<div class="ev"><span class="ev-name muted">⏳ Confirming in ~' + mins + 'm</span></div>' +
      '<div class="ev"><span class="ev-name muted">Event timers begin after confirmation</span></div>' +
    '</div>' +
    '<button class="join-btn" data-place="' + s.placeId + '" data-job="' + s.jobId + '">⚓ Join Server</button>';
  return div;
}

var newPollTimer = null;
var newLastRefresh = 0;

function refreshNewServers() {
  var spinner = document.getElementById('new-spinner');
  var status = document.getElementById('new-status');
  if (spinner) spinner.style.display = '';
  fetch('/api/new-servers')
    .then(function(r) { return r.json(); })
    .then(function(servers) {
      if (spinner) spinner.style.display = 'none';
      newLastRefresh = Date.now();
      if (status) status.textContent = 'Updated just now · refreshes every 60s';

      var grid = document.getElementById('new-grid');
      if (!grid) return;
      grid.innerHTML = '';
      if (!servers.length) {
        grid.innerHTML = '<div class="empty">No new servers right now — scan in progress…</div>';
      } else {
        for (var i = 0; i < servers.length; i++) {
          var card = buildNewCard(servers[i]);
          if (newSeaFilter !== 0 && servers[i].sea !== newSeaFilter) {
            card.classList.add('hidden');
          }
          grid.appendChild(card);
        }
      }

      var tabNew = document.getElementById('tab-new');
      if (tabNew) {
        var badge = tabNew.querySelector('span');
        if (badge) badge.textContent = servers.length;
      }
    })
    .catch(function() {
      if (spinner) spinner.style.display = 'none';
      if (status) status.textContent = 'Refresh failed — retrying…';
    });
}

function startNewPoll() {
  if (newPollTimer) return;
  refreshNewServers();
  newPollTimer = setInterval(refreshNewServers, 60000);
}

function stopNewPoll() {
  if (newPollTimer) { clearInterval(newPollTimer); newPollTimer = null; }
}

function switchTab(tab) {
  // Cancel auto-reload so it doesn't undo the tab switch
  if (typeof autoReloadTimer !== 'undefined') { clearTimeout(autoReloadTimer); autoReloadTimer = null; }
  var tabs = ['all','new','best','expired'];
  for (var ti = 0; ti < tabs.length; ti++) {
    var t = tabs[ti];
    var pane = document.getElementById('pane-' + t);
    var btn  = document.getElementById('tab-'  + t);
    if (pane) pane.style.display = t === tab ? '' : 'none';
    if (btn)  btn.classList.toggle('active', t === tab);
  }
  if (tab === 'best') applyBest();
  if (tab === 'new') startNewPoll(); else stopNewPoll();
}

var newSeaFilter = 0;
function setNewFilter(sea) {
  newSeaFilter = sea;
  for (var i = 0; i <= 3; i++) {
    var b = document.getElementById('nbtn-' + i);
    if (b) b.classList.toggle('active', i === sea);
  }
  var cards = document.querySelectorAll('#new-grid .card');
  for (var j = 0; j < cards.length; j++) {
    var s = parseInt(cards[j].getAttribute('data-sea'), 10);
    cards[j].classList.toggle('hidden', sea !== 0 && s !== sea);
  }
}

var expiredSeaFilter = 0;
function setExpiredFilter(sea) {
  expiredSeaFilter = sea;
  for (var i = 0; i <= 3; i++) {
    var b = document.getElementById('ebtn-' + i);
    if (b) b.classList.toggle('active', i === sea);
  }
  var cards = document.querySelectorAll('#expired-grid .card');
  for (var j = 0; j < cards.length; j++) {
    var s = parseInt(cards[j].getAttribute('data-sea'), 10);
    cards[j].classList.toggle('hidden', sea !== 0 && s !== sea);
  }
}

function showToast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1e1e1e;border:1px solid #444;color:#fff;padding:12px 22px;border-radius:10px;font-size:.9rem;z-index:9999;pointer-events:none;box-shadow:0 4px 16px #0008';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 3500);
}

// Everything that touches the DOM runs after the page is fully parsed.
// This guarantees the real function definitions replace the head stubs
// before any user interaction is possible.
document.addEventListener('DOMContentLoaded', function() {

// Detect mobile (Android / iOS)
var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// Show mobile warning banner
if (isMobile) {
  var banner = document.createElement('div');
  banner.style.cssText = 'background:#2a1a00;border-bottom:1px solid #7c5300;color:#fbbf24;padding:10px 20px;font-size:.82rem;text-align:center;line-height:1.5';
  banner.innerHTML = '📱 <strong>Mobile:</strong> Tap any <em>Join Server</em> button to open the game page (joins a random server — mobile limitation).';
  document.body.insertBefore(banner, document.body.firstChild);
}

// Join button via event delegation
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.join-btn');
  if (!btn || btn.disabled) return;
  var placeId = btn.getAttribute('data-place');
  var jobId = btn.getAttribute('data-job');
  if (!placeId || !jobId) return;

  // ── Mobile path: Roblox mobile blocks joining specific instances (Error 524)
  if (isMobile) {
    showToast('📱 Opening game — you\'ll join a random server (mobile limitation)');
    window.open('https://www.roblox.com/games/' + placeId, '_blank');
    return;
  }

  // ── Desktop path: verify server is alive, then deep-link
  var orig = btn.textContent;
  btn.textContent = '⏳ Checking…';
  btn.disabled = true;
  fetch('/api/check?jobId=' + encodeURIComponent(jobId))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.alive) {
        window.location.href = 'roblox://experiences/start?placeId=' + placeId + '&gameInstanceId=' + jobId;
        setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 2500);
      } else {
        showToast('⚠️ Server no longer exists — try a different one');
        btn.textContent = '❌ Expired';
        btn.style.background = 'var(--del)';
        setTimeout(function() { btn.textContent = orig; btn.style.background = ''; btn.disabled = false; }, 3500);
      }
    })
    .catch(function() {
      // Check failed — try direct join anyway
      window.location.href = 'roblox://experiences/start?placeId=' + placeId + '&gameInstanceId=' + jobId;
      btn.textContent = orig; btn.disabled = false;
    });
});

// Auto-refresh every 3 minutes — cancelled the moment the user switches tab
var autoReloadTimer = setTimeout(function() { location.reload(); }, 180000);

}); // end DOMContentLoaded
</script>
</body>
</html>`;
}

export default router;
