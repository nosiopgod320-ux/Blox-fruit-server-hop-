import { Router, type IRouter } from "express";
import { db, serversTable } from "@workspace/db";
import { gte } from "drizzle-orm";
import { computeEventTimers } from "../lib/calculator.js";
import { isWarmingUp, getUptimeSeconds } from "../lib/poller.js";

const router: IRouter = Router();

interface EventTimer {
  key: string;
  name: string;
  timeUntilSeconds: number | null;
  timeUntilFormatted: string | null;
  isAlert: boolean;
  isActive: boolean;
}

interface ServerData {
  jobId: string;
  placeId: number;
  sea: number;
  playerCount: number;
  maxPlayers: number;
  ageSeconds: number;
  nextEventSeconds: number;
  events: EventTimer[];
}

router.get("/", async (req, res) => {
  try {
    const allRows = await db.select().from(serversTable);
    const confirmedRows = await db
      .select()
      .from(serversTable)
      .where(gte(serversTable.scanCount, 2));

    const seaCounts = { first: 0, second: 0, third: 0 };
    for (const s of allRows) {
      if (s.sea === 1) seaCounts.first++;
      else if (s.sea === 2) seaCounts.second++;
      else if (s.sea === 3) seaCounts.third++;
    }

    const now = Date.now();
    const servers: ServerData[] = confirmedRows
      .map((s) => {
        const timers = computeEventTimers(s);
        const nextEvent = Math.min(
          ...timers
            .filter((t) => t.timeUntilSeconds !== null && !t.isActive)
            .map((t) => t.timeUntilSeconds as number),
          9999999,
        );
        return {
          jobId: s.jobId,
          placeId: Number(s.placeId),
          sea: s.sea,
          playerCount: s.playerCount,
          maxPlayers: s.maxPlayers,
          ageSeconds: Math.floor((now - Number(s.firstSeen)) / 1000),
          nextEventSeconds: nextEvent,
          events: timers,
        };
      })
      .sort((a, b) => a.nextEventSeconds - b.nextEventSeconds)
      .slice(0, 300);

    const stats = {
      total: allRows.length,
      confirmed: confirmedRows.length,
      seaCounts,
      uptimeSeconds: getUptimeSeconds(),
      warmingUp: isWarmingUp() || confirmedRows.length === 0,
    };

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(buildHtml(servers, stats));
  } catch (err) {
    req.log.error({ err }, "Dashboard render error");
    res.status(500).send("<h1>Server error — try refreshing</h1>");
  }
});

function buildHtml(servers: ServerData[], stats: {
  total: number;
  confirmed: number;
  seaCounts: { first: number; second: number; third: number };
  uptimeSeconds: number;
  warmingUp: boolean;
}): string {
  const safeJson = JSON.stringify(servers)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>BloxHop — Blox Fruits Server Hop</title>
<style>
:root{--bg:#0e0e12;--surface:#17171f;--surface2:#1f1f2a;--border:#2a2a38;--accent:#7c3aed;--accent2:#a855f7;--text:#e2e2f0;--muted:#7a7a9a;--alert:#f59e0b;--active:#22c55e;--sea1:#3b82f6;--sea2:#10b981;--sea3:#f59e0b}
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
.ev.alert .ev-name{color:var(--alert)}
.ev.on .ev-name{color:var(--active)}
.ev-time{font-weight:600;font-variant-numeric:tabular-nums}
.join-btn{width:100%;padding:8px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-weight:700;cursor:pointer;font-size:.85rem;transition:background .15s}
.join-btn:hover{background:var(--accent2)}
.empty{padding:60px 24px;text-align:center;color:var(--muted)}
.best-controls{padding:16px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
#count-badge{font-size:.8rem;color:var(--muted);margin-left:4px}
@media(max-width:600px){header{padding:12px 16px}.grid{padding:12px 16px;gap:10px}.controls{padding:12px 16px}.stats-bar{gap:12px}}
</style>
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
  <a onclick="window.location.reload()">↻ Refresh</a>
</div>
<div class="tab-bar">
  <div class="tab active" id="tab-all" onclick="switchTab('all')">All Servers <span id="count-badge"></span></div>
  <div class="tab" id="tab-best" onclick="switchTab('best')">Best Servers</div>
</div>

<div id="pane-all">
  <div class="controls">
    <button class="btn active" id="btn-all" onclick="setFilter(0)">All Seas</button>
    <button class="btn sea1btn" id="btn-1" onclick="setFilter(1)">First Sea</button>
    <button class="btn sea2btn" id="btn-2" onclick="setFilter(2)">Second Sea</button>
    <button class="btn sea3btn" id="btn-3" onclick="setFilter(3)">Third Sea</button>
    <span class="sort-lbl" style="margin-left:8px">Sort:</span>
    <select id="sort-sel" onchange="render()">
      <option value="event" selected>Next Event</option>
      <option value="age">Server Age</option>
      <option value="players">Players</option>
    </select>
  </div>
  <div id="grid-all" class="grid"></div>
</div>

<div id="pane-best" style="display:none">
  <div class="best-controls">
    <label style="font-size:.85rem;color:var(--muted)">Event:</label>
    <select id="best-event" onchange="renderBest()">
      <option value="fruit">Fruit Spawn</option>
      <option value="castle">Castle Raid</option>
      <option value="factory">Factory Raid</option>
      <option value="fist">Fist of Darkness</option>
      <option value="chalice">God's Chalice</option>
      <option value="sword">Sword Dealer</option>
    </select>
    <label style="font-size:.85rem;color:var(--muted)">Within:</label>
    <select id="best-within" onchange="renderBest()">
      <option value="120">2 min</option>
      <option value="300" selected>5 min</option>
      <option value="600">10 min</option>
      <option value="900">15 min</option>
      <option value="1800">30 min</option>
    </select>
  </div>
  <div id="grid-best" class="grid"><div class="empty">Choose an event above to find the best servers.</div></div>
</div>

<script id="bloxhop-data" type="application/json">${safeJson}</script>
<script>
(function(){
  var SEA = {1:'First Sea', 2:'Second Sea', 3:'Third Sea'};
  var allServers = JSON.parse(document.getElementById('bloxhop-data').textContent);
  var seaFilter = 0;

  function fmtAge(s){
    var m=Math.floor(s/60);
    if(m<60) return m+'m';
    return Math.floor(m/60)+'h '+(m%60)+'m';
  }

  function makeCard(s){
    var seaName = SEA[s.sea] || 'Unknown';
    var evHtml = '';
    var events = s.events || [];
    for(var i=0;i<events.length;i++){
      var e=events[i];
      if(e.timeUntilSeconds===null && !e.isActive) continue;
      var cls = e.isActive ? 'on' : (e.isAlert ? 'alert' : '');
      var t = e.isActive ? '⚡ ACTIVE' : (e.timeUntilFormatted || '—');
      evHtml += '<div class="ev '+cls+'"><span class="ev-name">'+e.name+'</span><span class="ev-time">'+t+'</span></div>';
    }
    if(!evHtml) evHtml = '<div class="ev"><span class="ev-name" style="color:var(--muted)">No events</span></div>';
    var joinUrl = 'roblox://experiences/start?placeId='+s.placeId+'&gameInstanceId='+encodeURIComponent(s.jobId);
    return '<div class="card">'
      +'<div class="card-header"><span class="sea-badge sea-'+s.sea+'">'+seaName+'</span><span class="card-age">Age: '+fmtAge(s.ageSeconds)+'</span></div>'
      +'<div class="card-players">👥 '+s.playerCount+' / '+s.maxPlayers+' players</div>'
      +'<div class="events">'+evHtml+'</div>'
      +'<button class="join-btn" onclick="joinServer(\''+s.placeId+'\',\''+s.jobId+'\')">⚓ Join Server</button>'
      +'</div>';
  }

  window.joinServer = function(placeId, jobId){
    window.location.href = 'roblox://experiences/start?placeId='+placeId+'&gameInstanceId='+encodeURIComponent(jobId);
  };

  window.setFilter = function(sea){
    seaFilter = sea;
    var ids = ['all','1','2','3'];
    for(var i=0;i<ids.length;i++){
      var el = document.getElementById('btn-'+ids[i]);
      if(el) el.classList.remove('active');
    }
    var target = sea === 0 ? 'btn-all' : 'btn-'+sea;
    var btn = document.getElementById(target);
    if(btn) btn.classList.add('active');
    render();
  };

  window.render = function(){
    var sortBy = (document.getElementById('sort-sel')||{}).value || 'event';
    var list = seaFilter
      ? allServers.filter(function(s){ return Number(s.sea) === Number(seaFilter); })
      : allServers.slice();

    if(sortBy==='age'){
      list.sort(function(a,b){ return b.ageSeconds - a.ageSeconds; });
    } else if(sortBy==='players'){
      list.sort(function(a,b){ return b.playerCount - a.playerCount; });
    } else {
      list.sort(function(a,b){ return (a.nextEventSeconds||9999999)-(b.nextEventSeconds||9999999); });
    }

    var grid = document.getElementById('grid-all');
    var badge = document.getElementById('count-badge');
    if(!list.length){
      grid.innerHTML = '<div class="empty">No confirmed servers yet — check back after the 2nd scan (~10 min).</div>';
      if(badge) badge.textContent = '';
    } else {
      grid.innerHTML = list.map(makeCard).join('');
      if(badge) badge.textContent = '('+list.length+')';
    }
  };

  window.renderBest = function(){
    var eventKey = (document.getElementById('best-event')||{}).value || 'fruit';
    var within = Number((document.getElementById('best-within')||{}).value || 300);
    var matches = allServers.filter(function(s){
      var evts = s.events || [];
      for(var i=0;i<evts.length;i++){
        var e=evts[i];
        if(e.key===eventKey && e.timeUntilSeconds!==null && e.timeUntilSeconds<=within) return true;
        if(e.key===eventKey && e.isActive) return true;
      }
      return false;
    });
    matches.sort(function(a,b){
      function getTime(s){
        var evts=s.events||[];
        for(var i=0;i<evts.length;i++){
          if(evts[i].key===eventKey) return evts[i].isActive ? -1 : (evts[i].timeUntilSeconds||9999);
        }
        return 9999;
      }
      return getTime(a)-getTime(b);
    });
    var grid = document.getElementById('grid-best');
    if(!matches.length){
      grid.innerHTML = '<div class="empty">No servers with '+eventKey+' firing within '+Math.floor(within/60)+' min.<br>Try a larger time window.</div>';
    } else {
      grid.innerHTML = matches.map(makeCard).join('');
    }
  };

  window.switchTab = function(tab){
    document.getElementById('pane-all').style.display = tab==='all' ? '' : 'none';
    document.getElementById('pane-best').style.display = tab==='best' ? '' : 'none';
    document.getElementById('tab-all').classList.toggle('active', tab==='all');
    document.getElementById('tab-best').classList.toggle('active', tab==='best');
    if(tab==='best') renderBest();
  };

  render();

  setTimeout(function(){ window.location.reload(); }, 30000);
})();
</script>
</body>
</html>`;
}

export default router;
