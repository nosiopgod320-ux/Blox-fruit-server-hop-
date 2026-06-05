import { Router, type IRouter } from "express";
import { db, serversTable } from "@workspace/db";
import { computeEventTimers } from "../lib/calculator.js";
import { isWarmingUp, getUptimeSeconds } from "../lib/poller.js";

const router: IRouter = Router();

router.get("/", async (req, res) => {
  try {
    const rows = await db.select().from(serversTable);
    const now = Date.now();

    const seaCounts = { first: 0, second: 0, third: 0 };
    for (const s of rows) {
      if (s.sea === 1) seaCounts.first++;
      else if (s.sea === 2) seaCounts.second++;
      else if (s.sea === 3) seaCounts.third++;
    }

    const servers = rows
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
          placeId: s.placeId,
          sea: s.sea,
          playerCount: s.playerCount,
          maxPlayers: s.maxPlayers,
          ageSeconds: Math.floor((now - Number(s.firstSeen)) / 1000),
          nextEventSeconds: nextEvent,
          events: timers,
        };
      })
      .sort((a, b) => a.nextEventSeconds - b.nextEventSeconds)
      .slice(0, 200);

    const stats = {
      total: rows.length,
      seaCounts,
      uptimeSeconds: getUptimeSeconds(),
      warmingUp: isWarmingUp(),
    };

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(buildHtml(servers, stats));
  } catch (err) {
    req.log.error({ err }, "Dashboard render error");
    res.status(500).send("<h1>Server error — try refreshing</h1>");
  }
});

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtAge(s: number): string {
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

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
  placeId: string;
  sea: number;
  playerCount: number;
  maxPlayers: number;
  ageSeconds: number;
  nextEventSeconds: number;
  events: EventTimer[];
}

interface Stats {
  total: number;
  seaCounts: { first: number; second: number; third: number };
  uptimeSeconds: number;
  warmingUp: boolean;
}

const SEA_NAMES: Record<number, string> = { 1: "First Sea", 2: "Second Sea", 3: "Third Sea" };

function serverCard(s: ServerData): string {
  const seaName = SEA_NAMES[s.sea] ?? "Unknown";
  const events = s.events.filter((e) => e.timeUntilSeconds !== null || e.isActive);
  const eventsHtml = events
    .map((e) => {
      const cls = e.isActive ? "active" : e.isAlert ? "alert" : "";
      const timeStr = e.isActive ? "⚡ ACTIVE" : (e.timeUntilFormatted ?? "—");
      return `<div class="event-row ${cls}"><span class="event-name">${e.name}</span><span class="event-time">${timeStr}</span></div>`;
    })
    .join("");
  const joinUrl = `roblox://experiences/start?placeId=${s.placeId}&gameInstanceId=${encodeURIComponent(s.jobId)}`;
  return `<div class="card">
    <div class="card-header">
      <span class="card-sea sea-${s.sea}">${seaName}</span>
      <span class="card-age">Age: ${fmtAge(s.ageSeconds)}</span>
    </div>
    <div class="card-players">👥 ${s.playerCount} / ${s.maxPlayers} players</div>
    <div class="events">${eventsHtml || '<div class="event-row"><span class="event-name" style="color:var(--muted)">No events tracked</span></div>'}</div>
    <button class="join-btn" onclick="window.open('${joinUrl}','_self')">⚓ Join Server</button>
  </div>`;
}

function buildHtml(servers: ServerData[], stats: Stats): string {
  const cardsHtml = servers.length
    ? servers.map(serverCard).join("")
    : '<div class="empty">No servers tracked yet — scan in progress…</div>';

  const warningBanner = stats.warmingUp
    ? '<div class="warming-banner">⏳ Warming up — first scan in progress. More data loading shortly.</div>'
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>BloxHop — Blox Fruits Server Hop</title>
<style>
  :root{--bg:#0e0e12;--surface:#17171f;--surface2:#1f1f2a;--border:#2a2a38;--accent:#7c3aed;--accent2:#a855f7;--text:#e2e2f0;--muted:#7a7a9a;--alert:#f59e0b;--active:#22c55e;--danger:#ef4444;--sea1:#3b82f6;--sea2:#10b981;--sea3:#f59e0b}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}
  header{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
  .logo{font-size:1.4rem;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
  .stats-bar{display:flex;gap:20px;flex-wrap:wrap}
  .stat{text-align:center}
  .stat-val{font-size:1.3rem;font-weight:700;color:var(--accent2)}
  .stat-lbl{font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .warming-banner{background:linear-gradient(90deg,#78350f,#92400e);border:1px solid #b45309;color:#fcd34d;padding:10px 24px;font-size:.85rem;text-align:center}
  .controls{padding:16px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .btn{padding:7px 16px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:.85rem;transition:all .15s}
  .btn:hover{border-color:var(--accent);color:var(--accent2)}
  .btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .sea1.active{background:var(--sea1);border-color:var(--sea1)}
  .sea2.active{background:var(--sea2);border-color:var(--sea2)}
  .sea3.active{background:var(--sea3);border-color:var(--sea3)}
  .tab-bar{padding:0 24px;display:flex;gap:0;border-bottom:1px solid var(--border)}
  .tab{padding:10px 20px;cursor:pointer;color:var(--muted);border-bottom:2px solid transparent;font-size:.9rem;transition:all .15s}
  .tab.active{color:var(--accent2);border-bottom-color:var(--accent2)}
  .best-controls{padding:16px 24px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  select,input{padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:.85rem}
  select:focus,input:focus{outline:none;border-color:var(--accent)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;padding:20px 24px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;transition:border-color .15s}
  .card:hover{border-color:var(--accent)}
  .card-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:8px}
  .card-sea{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:3px 8px;border-radius:5px}
  .sea-1{background:#1e3a5f;color:var(--sea1)}
  .sea-2{background:#064e3b;color:var(--sea2)}
  .sea-3{background:#451a03;color:var(--sea3)}
  .card-age{font-size:.75rem;color:var(--muted)}
  .card-players{font-size:.8rem;color:var(--muted);margin-bottom:10px}
  .events{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
  .event-row{display:flex;justify-content:space-between;align-items:center;padding:5px 8px;border-radius:6px;background:var(--surface2);font-size:.8rem}
  .event-row.alert{background:#451a03;color:var(--alert)}
  .event-row.active{background:#052e16;color:var(--active);font-weight:700}
  .event-name{color:var(--muted)}
  .event-row.alert .event-name{color:var(--alert)}
  .event-row.active .event-name{color:var(--active)}
  .event-time{font-weight:600;font-variant-numeric:tabular-nums}
  .join-btn{width:100%;padding:8px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-weight:700;cursor:pointer;font-size:.85rem;transition:background .15s}
  .join-btn:hover{background:var(--accent2)}
  .empty{padding:60px 24px;text-align:center;color:var(--muted)}
  .sort-lbl{font-size:.85rem;color:var(--muted)}
  .refresh-bar{padding:6px 24px;font-size:.75rem;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
  @media(max-width:600px){.stats-bar{gap:12px}header{padding:12px 16px}.grid{padding:12px 16px;gap:10px}.controls{padding:12px 16px}}
</style>
</head>
<body>
<header>
  <div class="logo">🏴‍☠️ BloxHop</div>
  <div class="stats-bar">
    <div class="stat"><div class="stat-val" id="stat-total">${stats.total}</div><div class="stat-lbl">Tracked</div></div>
    <div class="stat"><div class="stat-val" id="stat-s1" style="color:var(--sea1)">${stats.seaCounts.first}</div><div class="stat-lbl">Sea 1</div></div>
    <div class="stat"><div class="stat-val" id="stat-s2" style="color:var(--sea2)">${stats.seaCounts.second}</div><div class="stat-lbl">Sea 2</div></div>
    <div class="stat"><div class="stat-val" id="stat-s3" style="color:var(--sea3)">${stats.seaCounts.third}</div><div class="stat-lbl">Sea 3</div></div>
    <div class="stat"><div class="stat-val" id="stat-uptime">${fmtUptime(stats.uptimeSeconds)}</div><div class="stat-lbl">Uptime</div></div>
  </div>
</header>
${warningBanner}
<div class="refresh-bar">
  <span id="refresh-status">✅ Loaded ${servers.length} servers</span>
  <span style="margin-left:auto;cursor:pointer;color:var(--accent2)" onclick="hardRefresh()">↻ Refresh now</span>
</div>
<div class="tab-bar">
  <div class="tab active" id="tab-all" onclick="switchTab('all')">All Servers</div>
  <div class="tab" id="tab-best" onclick="switchTab('best')">Best Servers</div>
</div>

<div id="pane-all">
  <div class="controls">
    <button class="btn active" id="f-all" onclick="setSeaFilter(0)">All Seas</button>
    <button class="btn sea1" id="f-1" onclick="setSeaFilter(1)">First Sea</button>
    <button class="btn sea2" id="f-2" onclick="setSeaFilter(2)">Second Sea</button>
    <button class="btn sea3" id="f-3" onclick="setSeaFilter(3)">Third Sea</button>
    <span class="sort-lbl" style="margin-left:12px">Sort:</span>
    <select id="sort-select" onchange="render()">
      <option value="event">Next Event</option>
      <option value="age">Server Age</option>
      <option value="players">Players</option>
    </select>
  </div>
  <div id="grid-all" class="grid">${cardsHtml}</div>
</div>

<div id="pane-best" style="display:none">
  <div class="best-controls">
    <label for="best-event" style="font-size:.85rem;color:var(--muted)">Event:</label>
    <select id="best-event" onchange="loadBest()">
      <option value="fruit">Fruit Spawn</option>
      <option value="castle">Castle Raid</option>
      <option value="factory">Factory Raid</option>
      <option value="fist">Fist of Darkness</option>
      <option value="chalice">God's Chalice</option>
      <option value="sword">Sword Dealer</option>
    </select>
    <label for="best-within" style="font-size:.85rem;color:var(--muted)">Within:</label>
    <select id="best-within" onchange="loadBest()">
      <option value="120">2 min</option>
      <option value="300" selected>5 min</option>
      <option value="600">10 min</option>
      <option value="900">15 min</option>
    </select>
  </div>
  <div id="grid-best" class="grid"><div class="empty">Select an event above to find the best servers.</div></div>
</div>

<script>
const SEA_NAMES = {1:'First Sea',2:'Second Sea',3:'Third Sea'};
let allServers = ${JSON.stringify(servers)};
let seaFilter = 0;
let currentTab = 'all';
let refreshTimer = null;

function fmtAge(s){const m=Math.floor(s/60);if(m<60)return m+'m';return Math.floor(m/60)+'h '+(m%60)+'m';}

function serverCard(s){
  const seaName=SEA_NAMES[s.sea]||'Unknown';
  const events=(s.events||[]).filter(e=>e.timeUntilSeconds!==null||e.isActive);
  const eventsHtml=events.map(e=>{
    const cls=e.isActive?'active':e.isAlert?'alert':'';
    const t=e.isActive?'⚡ ACTIVE':(e.timeUntilFormatted||'—');
    return '<div class="event-row '+cls+'"><span class="event-name">'+e.name+'</span><span class="event-time">'+t+'</span></div>';
  }).join('');
  const joinUrl='roblox://experiences/start?placeId='+s.placeId+'&gameInstanceId='+encodeURIComponent(s.jobId);
  return '<div class="card"><div class="card-header"><span class="card-sea sea-'+s.sea+'">'+seaName+'</span><span class="card-age">Age: '+fmtAge(s.ageSeconds)+'</span></div><div class="card-players">👥 '+s.playerCount+' / '+s.maxPlayers+' players</div><div class="events">'+(eventsHtml||'<div class="event-row"><span class="event-name" style="color:var(--muted)">No events</span></div>')+'</div><button class="join-btn" onclick="window.open(\''+joinUrl+'\',\'_self\')">⚓ Join Server</button></div>';
}

function setSeaFilter(sea){
  seaFilter=sea;
  ['all','1','2','3'].forEach(id=>document.getElementById('f-'+id)?.classList.remove('active'));
  document.getElementById('f-'+(sea||'all'))?.classList.add('active');
  render();
}

function render(){
  const sortBy=document.getElementById('sort-select')?.value||'event';
  let list=seaFilter?allServers.filter(s=>s.sea===seaFilter):[...allServers];
  if(sortBy==='age')list.sort((a,b)=>b.ageSeconds-a.ageSeconds);
  else if(sortBy==='players')list.sort((a,b)=>b.playerCount-a.playerCount);
  else list.sort((a,b)=>(a.nextEventSeconds||9999999)-(b.nextEventSeconds||9999999));
  const grid=document.getElementById('grid-all');
  if(!list.length){grid.innerHTML='<div class="empty">No servers found.</div>';return;}
  grid.innerHTML=list.map(serverCard).join('');
}

function hardRefresh(){
  document.getElementById('refresh-status').textContent='↻ Refreshing…';
  window.location.reload();
}

async function loadBest(){
  const event=document.getElementById('best-event').value;
  const within=document.getElementById('best-within').value;
  const grid=document.getElementById('grid-best');
  grid.innerHTML='<div class="empty">Loading…</div>';
  try{
    const r=await fetch('/api/best-servers?event='+event+'&within='+within,{signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const list=await r.json();
    if(!list.length){grid.innerHTML='<div class="empty">No servers found for this event within the time window.</div>';return;}
    grid.innerHTML=list.map(s=>{
      const seaName=SEA_NAMES[s.sea]||'Unknown';
      const joinUrl='roblox://experiences/start?placeId='+s.placeId+'&gameInstanceId='+encodeURIComponent(s.jobId);
      const cls=s.event.isActive?'active':s.event.isAlert?'alert':'';
      const t=s.event.isActive?'⚡ ACTIVE':(s.event.timeUntilFormatted||'—');
      return '<div class="card"><div class="card-header"><span class="card-sea sea-'+s.sea+'">'+seaName+'</span><span class="card-age">Age: '+fmtAge(s.ageSeconds)+'</span></div><div class="card-players">👥 '+s.playerCount+' / '+s.maxPlayers+' players</div><div class="events"><div class="event-row '+cls+'"><span class="event-name">'+s.event.name+'</span><span class="event-time">'+t+'</span></div></div><button class="join-btn" onclick="window.open(\''+joinUrl+'\',\'_self\')">⚓ Join Server</button></div>';
    }).join('');
  }catch(e){
    grid.innerHTML='<div class="empty">Could not load — try refreshing the page.</div>';
  }
}

function switchTab(tab){
  currentTab=tab;
  document.getElementById('pane-all').style.display=tab==='all'?'':'none';
  document.getElementById('pane-best').style.display=tab==='best'?'':'none';
  document.getElementById('tab-all').classList.toggle('active',tab==='all');
  document.getElementById('tab-best').classList.toggle('active',tab==='best');
  if(tab==='best')loadBest();
}

// Auto-reload page every 30s for fresh data
setTimeout(()=>{
  document.getElementById('refresh-status').textContent='↻ Auto-refreshing…';
  window.location.reload();
}, 30000);
</script>
</body>
</html>`;
}

export default router;
