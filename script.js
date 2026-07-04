// =========================
// LocalStorage keys
// =========================
const LS_USERS   = "prop_users_v1";
const LS_SESSION = "prop_session_v1";
const LS_STATE   = "prop_state_v3";
const LS_GEOJSON = "prop_geojson_helsingborg_v1";
const LS_MAP_MODE= "prop_map_mode_v1";

// =========================
// Helpers
// =========================
function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function safeJsonParse(value, fallback = null) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function loadUsers()        { return safeJsonParse(localStorage.getItem(LS_USERS), {}) || {}; }
function saveUsers(u)       { localStorage.setItem(LS_USERS, JSON.stringify(u)); }
function loadSession()      { return safeJsonParse(localStorage.getItem(LS_SESSION), null); }
function saveSession(s)     { localStorage.setItem(LS_SESSION, JSON.stringify(s)); }
function clearSession()     { localStorage.removeItem(LS_SESSION); }

function getCurrentUser() {
  const s = loadSession();
  if (!s?.email) return null;
  return loadUsers()[s.email] || null;
}

function saveCurrentUser(u) {
  const s = loadSession();
  if (!s?.email) return;
  const users = loadUsers();
  users[s.email] = u;
  saveUsers(users);
}

function getHomeProfile(user) {
  return user.homeProfile || { title: "", description: "", images: [] };
}

function createDefaultState() {
  return { ownerParcelId: null, likes: {}, interests: {}, myLikes: {}, myInterests: {}, parcelNames: {} };
}

function loadState()     { return safeJsonParse(localStorage.getItem(LS_STATE), createDefaultState()) || createDefaultState(); }
function saveState(s)    { localStorage.setItem(LS_STATE, JSON.stringify(s)); }
function loadSavedMapMode() { return localStorage.getItem(LS_MAP_MODE) || "visitor"; }
function saveMapMode(m)  { localStorage.setItem(LS_MAP_MODE, m); }

// =========================
// App globals
// =========================
const app = document.getElementById("app");
let currentView = "welcome";
let map = null;
let parcelsLayer = null;
let lastGeoJson = null;
let baseLayers = {};
let currentBase = "map";
let locateMarker = null;

// =========================
// Router
// =========================
function navigate(view) { currentView = view; render(); }

// =========================
// Geo helpers
// =========================
function getParcelId(feature) {
  const p = feature?.properties || {};
  const keys = ["fastighetsbeteckning","FASTIGHET","fastighet","beteckning","objektid","OBJECTID","id","ID","uuid","UUID"];
  for (const k of keys) if (p[k]) return String(p[k]);
  try { return "anon-" + JSON.stringify(feature?.geometry?.coordinates).slice(0, 40); }
  catch { return "anon-" + Math.random().toString(16).slice(2); }
}

function prettyName(feature) {
  const p = feature?.properties || {};
  return p.fastighetsbeteckning || p.FASTIGHET || p.fastighet || p.beteckning || "Vald fastighet";
}

function getPropertyValue(obj, keys) {
  for (const k of keys) { const v = obj?.[k]; if (v !== undefined && v !== null && v !== "") return v; }
  return null;
}

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "number") return new Intl.NumberFormat("sv-SE").format(v);
  return String(v);
}

function getParcelMeta(feature) {
  const p = feature?.properties || {};
  return {
    beteckning: prettyName(feature),
    area: getPropertyValue(p, ["area","AREA","areal","AREAL","shape_area","SHAPE_Area"]) || null,
    typ:  getPropertyValue(p, ["typ","TYPE","fastighetstyp","FASTIGHETSTYP","markslag","MARKSLAG"]) || null,
    objektid: getPropertyValue(p, ["objektid","OBJECTID","id","ID","uuid","UUID"]) || null,
  };
}

function rememberParcelName(parcelId, name) {
  const state = loadState();
  state.parcelNames = state.parcelNames || {};
  state.parcelNames[parcelId] = name;
  saveState(state);
}

// =========================
// Reprojection
// =========================
proj4.defs("EPSG:3006","+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");

function looksLikeSweref(c) {
  if (!Array.isArray(c) || c.length < 2) return false;
  const [x, y] = c;
  return typeof x === "number" && typeof y === "number" && x > 100000 && x < 1000000 && y > 5000000 && y < 8000000;
}

function findFirstPoint(coords) {
  if (!Array.isArray(coords)) return null;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") return coords;
  for (const item of coords) { const f = findFirstPoint(item); if (f) return f; }
  return null;
}

function reprojectCoords(coords) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    if (looksLikeSweref(coords)) { const [lon, lat] = proj4("EPSG:3006","WGS84",coords); return [lon, lat]; }
    return coords;
  }
  return coords.map(reprojectCoords);
}

function reprojectGeoJsonIfNeeded(geojson) {
  let sample = null;
  for (const f of geojson.features || []) { const c = f.geometry?.coordinates; if (c) { sample = findFirstPoint(c); break; } }
  if (!sample || !looksLikeSweref(sample)) return geojson;
  toast("Konverterar SWEREF → WGS84…");
  const cloned = JSON.parse(JSON.stringify(geojson));
  for (const f of cloned.features || []) { if (f.geometry?.coordinates) f.geometry.coordinates = reprojectCoords(f.geometry.coordinates); }
  return cloned;
}

// =========================
// Map
// =========================
function ensureMapMounted() {
  if (map) return;
  map = L.map("map", { zoomControl: true }).setView([56.0465, 12.6945], 13);
  baseLayers.map = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
  baseLayers.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" });
  baseLayers.map.addTo(map);
}

function clearLayer() { if (parcelsLayer) { parcelsLayer.remove(); parcelsLayer = null; } lastGeoJson = null; }
function redrawLayer() { if (lastGeoJson) addGeoJsonToMap(lastGeoJson, { keepView: true, silent: true }); }

function addGeoJsonToMap(geojson, opts = {}) {
  ensureMapMounted();
  if (parcelsLayer) { parcelsLayer.remove(); parcelsLayer = null; }
  lastGeoJson = geojson;
  if (!map.getPane("parcelsPane")) { map.createPane("parcelsPane"); map.getPane("parcelsPane").style.zIndex = 450; }

  function baseStyle(feature) {
    const state = loadState();
    const pid = getParcelId(feature);
    if (state.ownerParcelId === pid)    return { color: "#16a34a", weight: 3, fillColor: "#22c55e", fillOpacity: 0.12 };
    if (state.myInterests?.[pid])       return { color: "#7c3aed", weight: 2.8, fillColor: "#8b5cf6", fillOpacity: 0.10 };
    if (state.myLikes?.[pid])           return { color: "#2563eb", weight: 2.4, fillColor: "#60a5fa", fillOpacity: 0.08 };
    return { color: "#C2622A", weight: 1.6, fillColor: "#C2622A", fillOpacity: 0.03 };
  }

  parcelsLayer = L.geoJSON(geojson, {
    pane: "parcelsPane",
    style: baseStyle,
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 6, weight: 2, fillOpacity: 0.6 }),
    onEachFeature: (feature, layer) => {
      layer.on("mouseover", () => { map.getContainer().style.cursor = "pointer"; if (layer.setStyle) layer.setStyle({ weight: 2.8, fillOpacity: 0.07 }); if (layer.bringToFront) layer.bringToFront(); });
      layer.on("mouseout",  () => { map.getContainer().style.cursor = ""; if (layer.setStyle) layer.setStyle(baseStyle(feature)); });
      layer.on("click",     () => renderParcelPanel(feature));
    },
  }).addTo(map);

  try { const b = parcelsLayer.getBounds(); if (b?.isValid() && !opts.keepView) map.fitBounds(b, { padding: [20, 20] }); } catch {}
  try { localStorage.setItem(LS_GEOJSON, JSON.stringify(geojson)); } catch {}
  if (!opts.silent) toast("Fastighetslager inläst — klicka på en fastighet.");
}

function zoomToParcel(parcelId) {
  if (!parcelsLayer) { toast("Ladda fastighetslagret först."); return; }
  let found = null;
  parcelsLayer.eachLayer((layer) => { if (layer.feature && getParcelId(layer.feature) === parcelId) found = layer; });
  if (!found) { toast("Hittar inte fastigheten i nuvarande lager."); return; }
  try { const b = found.getBounds?.(); if (b?.isValid()) map.fitBounds(b, { padding: [30, 30] }); } catch {}
  renderParcelPanel(found.feature);
}

// =========================
// Panel
// =========================
function openPanel(html) {
  const panel = document.getElementById("panel");
  if (!panel) return;
  panel.innerHTML = html;
  panel.classList.remove("hidden");
}

function closePanel() {
  const panel = document.getElementById("panel");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.innerHTML = "";
}

function renderParcelPanel(feature) {
  const state = loadState();
  const pid = getParcelId(feature);
  const name = prettyName(feature);
  const mode = document.getElementById("modeSelect")?.value || loadSavedMapMode();
  const meta = getParcelMeta(feature);
  const likes = state.likes?.[pid] || 0;
  const interests = state.interests?.[pid] || 0;
  const isOwner = state.ownerParcelId === pid;
  const iLiked = !!state.myLikes?.[pid];
  const iInterested = !!state.myInterests?.[pid];

  rememberParcelName(pid, name);

  const metaRows = `
    <div class="panel-meta-row"><span>Beteckning</span><strong>${formatValue(meta.beteckning)}</strong></div>
    <div class="panel-meta-row"><span>Typ</span><strong>${formatValue(meta.typ)}</strong></div>
    <div class="panel-meta-row"><span>Area</span><strong>${formatValue(meta.area)}</strong></div>
  `;

  const statsHtml = `
    <div class="panel-stats">
      <div class="panel-stat"><div class="panel-stat-value">${likes}</div><div class="panel-stat-label">Gillar</div></div>
      <div class="panel-stat"><div class="panel-stat-value">${interests}</div><div class="panel-stat-label">Intresserade</div></div>
    </div>
  `;

  if (mode === "owner") {
    openPanel(`
      <button class="panel-close" id="closePanelBtn">✕</button>
      <div class="panel-eyebrow">Ägarläge</div>
      <div class="panel-name">${name}</div>
      <div class="panel-mode">Markera fastigheten som din.</div>
      <div class="panel-meta">${metaRows}</div>
      <div class="panel-actions">
        <button id="setMineBtn" class="panel-btn ${isOwner ? "active-owner" : ""}">${isOwner ? "✓ Min fastighet" : "Detta är min fastighet"}</button>
      </div>
      ${statsHtml}
    `);
    document.getElementById("setMineBtn").onclick = () => {
      const s = loadState(); s.ownerParcelId = pid; s.parcelNames = s.parcelNames || {}; s.parcelNames[pid] = name;
      saveState(s); toast("Fastigheten kopplad till ditt konto."); redrawLayer(); renderParcelPanel(feature);
    };
    document.getElementById("closePanelBtn").onclick = closePanel;
    return;
  }

  openPanel(`
    <button class="panel-close" id="closePanelBtn">✕</button>
    <div class="panel-eyebrow">Besökarläge</div>
    <div class="panel-name">${name}</div>
    <div class="panel-mode">Spara intresse och följ objektet.</div>
    <div class="panel-meta">${metaRows}</div>
    <div class="panel-actions">
      <button id="likeBtn"     class="panel-btn ${iLiked      ? "active-like"     : ""}"><i class="ti ti-thumb-up"></i> ${iLiked ? "Gillad" : "Gilla"}</button>
      <button id="interestBtn" class="panel-btn ${iInterested ? "active-interest" : ""}"><i class="ti ti-star"></i> ${iInterested ? "Intresserad" : "Markera intresse"}</button>
    </div>
    ${statsHtml}
  `);

  document.getElementById("likeBtn").onclick = () => {
    const s = loadState(); const already = !!s.myLikes?.[pid];
    s.myLikes = s.myLikes || {}; s.parcelNames = s.parcelNames || {}; s.parcelNames[pid] = name;
    if (already) { delete s.myLikes[pid]; s.likes[pid] = Math.max(0, (s.likes[pid] || 1) - 1); toast("Gillning borttagen."); }
    else { s.likes[pid] = (s.likes[pid] || 0) + 1; s.myLikes[pid] = true; toast("Fastigheten är gillad."); }
    saveState(s); redrawLayer(); renderParcelPanel(feature);
  };

  document.getElementById("interestBtn").onclick = () => {
    const s = loadState(); const already = !!s.myInterests?.[pid];
    s.myInterests = s.myInterests || {}; s.parcelNames = s.parcelNames || {}; s.parcelNames[pid] = name;
    if (already) { delete s.myInterests[pid]; s.interests[pid] = Math.max(0, (s.interests[pid] || 1) - 1); toast("Intressemarkering borttagen."); }
    else { s.interests[pid] = (s.interests[pid] || 0) + 1; s.myInterests[pid] = true; toast("Intresse markerat."); }
    saveState(s); redrawLayer(); renderParcelPanel(feature);
  };

  document.getElementById("closePanelBtn").onclick = closePanel;
}

// =========================
// WELCOME VIEW
// =========================
function renderWelcome() {
  app.innerHTML = `
    <div class="welcome-page">
      <nav class="welcome-nav">
        <div class="logo">
          <svg width="20" height="25" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
          <span class="logo-text">i<em>found</em></span>
        </div>
        <div class="nav-badge">BETA · Helsingborg</div>
      </nav>
      <div class="welcome-body">
        <div class="welcome-left">
          <div class="welcome-eyebrow">Fastigheter på ett nytt sätt</div>
          <h1 class="welcome-headline">Hitta hem.<br><em>Eller låt<br>hemmet<br>hitta dig.</em></h1>
          <p class="welcome-sub">Utforska fastigheter, visa intresse anonymt och koppla ihop ägare med de som letar — utan aktiv försäljning.</p>
          <div class="feat-pills">
            <div class="feat-pill"><i class="ti ti-map-pin"></i> Utforska på karta</div>
            <div class="feat-pill"><i class="ti ti-heart"></i> Spara favoriter</div>
            <div class="feat-pill"><i class="ti ti-home"></i> Visa upp ditt hem</div>
            <div class="feat-pill"><i class="ti ti-bell"></i> Notiser om intresse</div>
          </div>
        </div>
        <div class="welcome-right">
          <div class="auth-tabs">
            <button class="auth-tab active" id="tabLogin">Logga in</button>
            <button class="auth-tab" id="tabReg">Skapa konto</button>
          </div>
          <div class="auth-form visible" id="loginForm">
            <h2>Välkommen tillbaka</h2>
            <p>Ange dina uppgifter för att fortsätta.</p>
            <div class="field-group"><label class="label">E-post</label><input id="loginEmail" class="input" type="email" placeholder="din@epost.se" /></div>
            <div class="field-group"><label class="label">Lösenord</label><input id="loginPass" class="input" type="password" placeholder="••••••••" /></div>
            <button id="loginBtn" class="btn-primary" style="width:100%;justify-content:center;">Logga in</button>
            <p style="font-size:11px;color:#9CA3AF;text-align:center;">Demo: registrera ett konto och logga in.</p>
          </div>
          <div class="auth-form" id="regForm">
            <h2>Skapa konto</h2>
            <p>Kom igång på ett par sekunder.</p>
            <div class="field-group"><label class="label">Namn</label><input id="regName" class="input" placeholder="Ditt namn" /></div>
            <div class="field-group"><label class="label">E-post</label><input id="regEmail" class="input" type="email" placeholder="din@epost.se" /></div>
            <div class="field-group"><label class="label">Lösenord</label><input id="regPass" class="input" type="password" placeholder="Min 4 tecken" /></div>
            <button id="regBtn" class="btn-primary" style="width:100%;justify-content:center;">Skapa konto</button>
            <p style="font-size:11px;color:#9CA3AF;text-align:center;">Riktig version: BankID-verifiering.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("tabLogin").onclick = () => {
    document.getElementById("tabLogin").classList.add("active");
    document.getElementById("tabReg").classList.remove("active");
    document.getElementById("loginForm").classList.add("visible");
    document.getElementById("regForm").classList.remove("visible");
  };
  document.getElementById("tabReg").onclick = () => {
    document.getElementById("tabReg").classList.add("active");
    document.getElementById("tabLogin").classList.remove("active");
    document.getElementById("regForm").classList.add("visible");
    document.getElementById("loginForm").classList.remove("visible");
  };

  document.getElementById("loginBtn").onclick = () => {
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("loginPass").value;
    const users = loadUsers();
    const user  = users[email];
    if (!user || user.password !== pass) { toast("Fel e-post eller lösenord."); return; }
    saveSession({ email }); toast("Inloggad!"); navigate("dashboard");
  };

  document.getElementById("regBtn").onclick = () => {
    const name  = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("regPass").value;
    if (!name || !email.includes("@") || pass.length < 4) { toast("Fyll i alla fält korrekt."); return; }
    const users = loadUsers();
    if (users[email]) { toast("Det finns redan ett konto på den e-posten."); return; }
    users[email] = { name, email, password: pass };
    saveUsers(users); saveSession({ email }); toast("Konto skapat — välkommen!"); navigate("dashboard");
  };
}

// =========================
// DASHBOARD VIEW
// =========================
function readImageAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}


// =========================
// FEED VIEW (Pinterest)
// =========================
function renderFeed() {
  const session = loadSession();
  if (!session?.email) return navigate("welcome");

  const houseSvgs = [
    `<svg viewBox="0 0 180 220" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="220" fill="#1a2533"/><rect y="145" width="180" height="75" fill="#2a1a08"/><circle cx="150" cy="35" r="20" fill="#f5e6c8" opacity=".14"/><polygon points="8,147 60,80 112,147" fill="#0d1a0d"/><polygon points="68,147 128,72 188,147" fill="#101f10"/><rect x="20" y="152" width="140" height="68" rx="2" fill="#2C1A0E"/><polygon points="4,154 90,78 176,154" fill="#1a0f06"/><rect x="38" y="160" width="26" height="20" rx="2" fill="#C2622A" opacity=".38"/><rect x="78" y="160" width="26" height="20" rx="2" fill="#e8a060" opacity=".3"/><rect x="118" y="160" width="26" height="20" rx="2" fill="#C2622A" opacity=".2"/><rect x="72" y="178" width="20" height="42" rx="1" fill="#3a2510"/></svg>`,
    `<svg viewBox="0 0 180 160" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="160" fill="#1e3a2f"/><rect y="100" width="180" height="60" fill="#1a2e1a"/><polygon points="10,102 55,48 100,102" fill="#0d1f0d"/><polygon points="80,102 130,40 180,102" fill="#102010"/><rect x="22" y="106" width="136" height="54" rx="1" fill="#2C1A0E"/><polygon points="6,108 90,52 174,108" fill="#1a0f06"/><rect x="40" y="114" width="24" height="18" rx="1" fill="#C2622A" opacity=".35"/><rect x="80" y="114" width="24" height="18" rx="1" fill="#e8a060" opacity=".28"/><rect x="120" y="114" width="24" height="18" rx="1" fill="#C2622A" opacity=".2"/><rect x="76" y="130" width="20" height="30" rx="1" fill="#3a2510"/></svg>`,
    `<svg viewBox="0 0 180 190" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="190" fill="#2a1a08"/><rect y="120" width="180" height="70" fill="#1f1205"/><polygon points="8,122 52,52 96,122" fill="#1a0d04"/><polygon points="84,122 136,44 188,122" fill="#1c0e05"/><rect x="20" y="126" width="140" height="64" rx="1" fill="#3a1e08"/><polygon points="6,128 90,52 174,128" fill="#2a1406"/><rect x="38" y="134" width="26" height="20" rx="1" fill="#f97316" opacity=".3"/><rect x="80" y="134" width="26" height="20" rx="1" fill="#fb923c" opacity=".25"/><rect x="122" y="134" width="26" height="20" rx="1" fill="#f97316" opacity=".2"/><rect x="80" y="152" width="22" height="38" rx="1" fill="#2a1406"/></svg>`,
    `<svg viewBox="0 0 180 175" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="175" fill="#1a2038"/><rect y="110" width="180" height="65" fill="#141830"/><polygon points="12,112 54,48 96,112" fill="#0e1428"/><polygon points="84,112 136,38 188,112" fill="#0f1530"/><rect x="24" y="116" width="132" height="59" rx="1" fill="#1e2645"/><polygon points="8,118 90,50 172,118" fill="#161c38"/><rect x="42" y="124" width="26" height="20" rx="1" fill="#60a5fa" opacity=".32"/><rect x="84" y="124" width="26" height="20" rx="1" fill="#93c5fd" opacity=".25"/><rect x="126" y="124" width="26" height="20" rx="1" fill="#60a5fa" opacity=".2"/><rect x="80" y="142" width="22" height="33" rx="1" fill="#161c38"/></svg>`,
    `<svg viewBox="0 0 180 200" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="200" fill="#1e2a1a"/><rect y="126" width="180" height="74" fill="#1a2810"/><polygon points="8,128 55,60 102,128" fill="#0f1e0a"/><polygon points="78,128 132,50 186,128" fill="#0d1c08"/><rect x="20" y="132" width="140" height="68" rx="1" fill="#1e3012"/><polygon points="4,134 90,58 176,134" fill="#162408"/><rect x="38" y="140" width="24" height="20" rx="1" fill="#86efac" opacity=".3"/><rect x="78" y="140" width="24" height="20" rx="1" fill="#86efac" opacity=".22"/><rect x="118" y="140" width="24" height="20" rx="1" fill="#86efac" opacity=".18"/><rect x="76" y="158" width="22" height="42" rx="1" fill="#162408"/></svg>`,
    `<svg viewBox="0 0 180 250" xmlns="http://www.w3.org/2000/svg"><rect width="180" height="250" fill="#1a2533"/><rect y="165" width="180" height="85" fill="#2a1a08"/><polygon points="6,167 55,95 104,167" fill="#0d1a0d"/><polygon points="76,167 130,88 184,167" fill="#101f10"/><rect x="16" y="172" width="148" height="78" rx="2" fill="#2C1A0E"/><polygon points="2,174 90,92 178,174" fill="#1a0f06"/><rect x="34" y="180" width="28" height="22" rx="2" fill="#C2622A" opacity=".38"/><rect x="76" y="180" width="28" height="22" rx="2" fill="#e8a060" opacity=".3"/><rect x="118" y="180" width="28" height="22" rx="2" fill="#C2622A" opacity=".2"/><rect x="72" y="200" width="22" height="50" rx="1" fill="#3a2510"/></svg>`
  ];

  const pins = [
    { id:0, name:"Laröd 3:19",        meta:"Gård · 5 200 kvm",         badge:"pb-hot",   badgeText:"41 gillar", likes:41, interested:9,  svg: houseSvgs[0] },
    { id:1, name:"Raus Plantage 7:2",  meta:"Gård · 4 800 kvm",         badge:"pb-new",   badgeText:"Ny claim",  likes:6,  interested:2,  svg: houseSvgs[1] },
    { id:2, name:"Kulla 1:4",          meta:"Tomt · 2 400 kvm",         badge:"pb-hot",   badgeText:"Populär",   likes:24, interested:7,  svg: houseSvgs[2] },
    { id:3, name:"Pålsjö 4:7",         meta:"Villa · 240 kvm",          badge:"pb-quiet", badgeText:"Passiv",    likes:18, interested:4,  svg: houseSvgs[3] },
    { id:4, name:"Fredriksdal 6:1",    meta:"Villa · 5,75 mkr",         badge:"pb-sale",  badgeText:"Till salu", likes:19, interested:6,  svg: houseSvgs[4] },
    { id:5, name:"Söder 8:22",         meta:"Lägenhet · 9 800 kr/mån",  badge:"pb-rent",  badgeText:"Uthyrning", likes:14, interested:0,  svg: houseSvgs[5] },
  ];

  const state = loadState();
  const myLikes = state.myLikes || {};

  app.innerHTML = `
    <div class="feed-page">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo">
            <svg width="18" height="23" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
        </div>
        <div class="nav-center">
          <button class="nav-tab" onclick="navigate('dashboard')">Min sida</button>
          <button class="nav-tab active">Utforska</button>
          <button class="nav-tab" onclick="navigate('map')">Karta</button>
        </div>
        <div class="nav-right">
          <button class="btn-ghost" style="font-size:12px;padding:7px 13px;" id="logoutBtn">Logga ut</button>
        </div>
      </nav>

      <!-- Search bar -->
      <div style="padding:10px 12px;background:#fff;border-bottom:0.5px solid rgba(17,24,39,.08);display:flex;gap:8px;">
        <div style="flex:1;display:flex;align-items:center;gap:8px;background:#F9F6F1;border-radius:999px;padding:8px 14px;border:0.5px solid rgba(17,24,39,.10);position:relative;">
          <i class="ti ti-search" style="font-size:16px;color:#9CA3AF;flex-shrink:0;"></i>
          <input id="feedSearch" placeholder="Sök område eller gata..." style="flex:1;border:none;background:transparent;font-size:13px;font-family:'Inter',sans-serif;color:#111827;outline:none;" />
          <div id="searchDropdown" style="display:none;position:absolute;top:calc(100% + 8px);left:0;right:0;background:#fff;border:0.5px solid rgba(17,24,39,.10);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.10);z-index:100;overflow:hidden;"></div>
        </div>
        <button id="nearMeBtn" style="display:flex;align-items:center;gap:6px;background:#111827;color:#fff;border:none;border-radius:999px;padding:8px 16px;font-size:12px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;white-space:nowrap;flex-shrink:0;">
          <i class="ti ti-current-location" style="font-size:15px;"></i> Nära mig
        </button>
      </div>

      <!-- Area chips -->
      <div class="area-bar">
        <button class="area-chip active" onclick="feedChip(this)">Alla</button>
        <button class="area-chip" onclick="feedChip(this)">Pålsjö</button>
        <button class="area-chip" onclick="feedChip(this)">Raus</button>
        <button class="area-chip" onclick="feedChip(this)">Laröd</button>
        <button class="area-chip" onclick="feedChip(this)">Söder</button>
        <button class="area-chip" onclick="feedChip(this)">Höganäs</button>
      </div>

      <!-- Claim nudge -->
      <div class="claim-nudge" onclick="navigate('dashboard')">
        <div class="claim-nudge-icon"><i class="ti ti-home-check" style="font-size:20px;color:#C2622A;"></i></div>
        <div style="flex:1;">
          <div class="claim-nudge-title">18 gillar ditt hem</div>
          <div class="claim-nudge-sub">Pålsjö 4:7 — claima för att se vem som är intresserad</div>
        </div>
        <i class="ti ti-chevron-right" style="color:#9CA3AF;"></i>
      </div>

      <!-- Location status -->
      <div id="locationStatus" style="display:none;padding:10px 12px;background:#F0FDF4;border-bottom:0.5px solid rgba(22,163,74,.15);">
        <div style="font-size:12px;color:#16a34a;font-weight:500;display:flex;align-items:center;gap:6px;">
          <i class="ti ti-map-pin" style="font-size:14px;"></i>
          <span id="locationText">Visar fastigheter nära dig</span>
        </div>
      </div>

      <!-- Masonry grid -->
      <div class="masonry-grid" id="masonryGrid">
        ${pins.map(p => `
          <div class="pin-card" onclick="toast('Öppnar ${p.name}...')">
            <div class="pin-img-wrap">
              ${p.svg}
              <div class="pin-top">
                <div class="pin-badge ${p.badge}">${p.badgeText}</div>
                <button class="pin-like-btn ${myLikes[p.id] ? 'liked' : ''}"
                  onclick="event.stopPropagation();feedToggleLike(this,${p.id})"
                  aria-label="Gilla">
                  <i class="ti ti-heart"></i>
                </button>
              </div>
            </div>
            <div class="pin-body">
              <div class="pin-name">${p.name}</div>
              <div class="pin-meta">${p.meta}</div>
              <div class="pin-footer">
                <div class="pin-likes"><i class="ti ti-heart" style="font-size:12px;"></i><strong>${p.likes}</strong></div>
                ${p.interested ? `<div class="pin-interest-badge">${p.interested} intresserade</div>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById("logoutBtn").onclick = () => {
    clearSession(); toast("Utloggad."); navigate("welcome");
  };

  // Search with Nominatim autocomplete
  const searchInput = document.getElementById("feedSearch");
  const dropdown = document.getElementById("searchDropdown");
  let searchTimer = null;
  let abortController = null;

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 3) { dropdown.style.display = "none"; return; }
    searchTimer = setTimeout(() => feedSearch(q), 300);
  });

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Escape") { dropdown.style.display = "none"; searchInput.blur(); }
  });

  document.addEventListener("click", e => {
    if (!dropdown.contains(e.target) && e.target !== searchInput) {
      dropdown.style.display = "none";
    }
  }, { once: false });

  // Near me button
  document.getElementById("nearMeBtn").onclick = () => {
    const btn = document.getElementById("nearMeBtn");
    if (!navigator.geolocation) { toast("Din webbläsare stödjer inte platsfunktion."); return; }
    btn.innerHTML = '<i class="ti ti-loader" style="font-size:15px;"></i> Söker...';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;

      // Reverse geocode to get area name
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=sv`)
        .then(r => r.json())
        .then(data => {
          const area = data.address?.suburb || data.address?.quarter || data.address?.city || "din position";
          const status = document.getElementById("locationStatus");
          const locText = document.getElementById("locationText");
          if (status && locText) {
            locText.textContent = `Visar fastigheter nära ${area}`;
            status.style.display = "block";
          }
          toast(`Visar fastigheter nära ${area}`);
          btn.innerHTML = '<i class="ti ti-current-location" style="font-size:15px;"></i> Nära mig';
          btn.disabled = false;

          // Filter chips to show local area
          const chips = document.querySelectorAll('.area-chip');
          chips.forEach(c => c.classList.remove('active'));
          if (chips[0]) chips[0].classList.add('active');
        })
        .catch(() => {
          toast("Kunde inte hämta platsinfo.");
          btn.innerHTML = '<i class="ti ti-current-location" style="font-size:15px;"></i> Nära mig';
          btn.disabled = false;
        });
    }, () => {
      toast("Kunde inte hämta din position.");
      btn.innerHTML = '<i class="ti ti-current-location" style="font-size:15px;"></i> Nära mig';
      btn.disabled = false;
    }, { enableHighAccuracy: true, timeout: 8000 });
  };
}

async function feedSearch(query) {
  const dropdown = document.getElementById("searchDropdown");
  if (!dropdown) return;

  dropdown.style.display = "block";
  dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;">Söker...</div>';

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&countrycodes=se&accept-language=sv`;
    const res = await fetch(url);
    const results = await res.json();

    if (!results.length) {
      dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;">Inga resultat hittades</div>';
      return;
    }

    dropdown.innerHTML = results.map(r => {
      const name = r.display_name.split(",").slice(0, 2).join(", ");
      return `<div onclick="feedSelectLocation('${r.display_name.replace(/'/g,"\'")}', ${r.lat}, ${r.lon})"
        style="padding:11px 16px;font-size:13px;color:#111827;cursor:pointer;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;gap:10px;"
        onmouseover="this.style.background='#F9F6F1'" onmouseout="this.style.background=''"
      >
        <i class="ti ti-map-pin" style="font-size:14px;color:#C2622A;flex-shrink:0;"></i>
        <span>${name}</span>
      </div>`;
    }).join('');
  } catch {
    dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;">Sökning misslyckades</div>';
  }
}

function feedSelectLocation(name, lat, lon) {
  const input = document.getElementById("feedSearch");
  const dropdown = document.getElementById("searchDropdown");
  const status = document.getElementById("locationStatus");
  const locText = document.getElementById("locationText");

  if (input) input.value = name.split(",").slice(0, 2).join(", ");
  if (dropdown) dropdown.style.display = "none";

  const shortName = name.split(",")[0];
  if (status && locText) {
    locText.textContent = `Visar fastigheter i ${shortName}`;
    status.style.display = "block";
  }
  toast(`Visar fastigheter i ${shortName}`);
}
function feedChip(el) {
  document.querySelectorAll('.area-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
}

function feedToggleLike(btn, id) {
  btn.classList.toggle('liked');
  const i = btn.querySelector('i');
  i.style.color = btn.classList.contains('liked') ? '#C2622A' : '';
  const s = loadState();
  s.myLikes = s.myLikes || {};
  if (btn.classList.contains('liked')) { s.myLikes[id] = true; toast('Gillad!'); }
  else { delete s.myLikes[id]; toast('Gillning borttagen'); }
  saveState(s);
}

function renderDashboard() {
  const session = loadSession();
  if (!session?.email) return navigate("welcome");
  const users   = loadUsers();
  const user    = users[session.email];
  const state   = loadState();
  const ownerId = state.ownerParcelId;
  const ownerName = ownerId ? state.parcelNames?.[ownerId] || ownerId : null;
  const myLikedIds = Object.keys(state.myLikes || {});
  const ownerLikes = ownerId ? state.likes?.[ownerId] || 0 : 0;
  const ownerInterests = ownerId ? state.interests?.[ownerId] || 0 : 0;
  const homeProfile = getHomeProfile(user);
  const images = homeProfile.images || [];

  const houseSvg = `<svg style="position:absolute;inset:0;width:100%;height:100%;" viewBox="0 0 960 280" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="280" fill="#1a2533"/><rect y="180" width="960" height="100" fill="#2a1a08"/><circle cx="840" cy="50" r="24" fill="#f5e6c8" opacity=".16"/><circle cx="840" cy="50" r="17" fill="#f5e6c8" opacity=".20"/><circle cx="75" cy="35" r="1.1" fill="white" opacity=".55"/><circle cx="200" cy="20" r="1" fill="white" opacity=".5"/><circle cx="360" cy="48" r="1.2" fill="white" opacity=".6"/><circle cx="520" cy="16" r="1" fill="white" opacity=".4"/><circle cx="650" cy="40" r="1.1" fill="white" opacity=".55"/><circle cx="770" cy="26" r="1" fill="white" opacity=".45"/><polygon points="18,182 48,105 78,182" fill="#0d1a0d"/><polygon points="42,182 74,112 106,182" fill="#101f10"/><polygon points="855,182 885,103 915,182" fill="#0d1a0d"/><polygon points="880,182 912,110 944,182" fill="#101f10"/><rect x="345" y="128" width="270" height="148" rx="2" fill="#2C1A0E"/><polygon points="320,133 480,55 640,133" fill="#1a0f06"/><rect x="560" y="64" width="24" height="44" rx="2" fill="#1a0f06"/><rect x="370" y="150" width="50" height="40" rx="3" fill="#3a2510"/><rect x="371" y="151" width="48" height="38" rx="2" fill="#C2622A" opacity=".22"/><line x1="395" y1="151" x2="395" y2="189" stroke="#2a1508" stroke-width="1.5"/><line x1="371" y1="170" x2="419" y2="170" stroke="#2a1508" stroke-width="1.5"/><rect x="437" y="150" width="50" height="40" rx="3" fill="#3a2510"/><rect x="438" y="151" width="48" height="38" rx="2" fill="#e8a060" opacity=".26"/><line x1="462" y1="151" x2="462" y2="189" stroke="#2a1508" stroke-width="1.5"/><line x1="438" y1="170" x2="486" y2="170" stroke="#2a1508" stroke-width="1.5"/><rect x="504" y="150" width="50" height="40" rx="3" fill="#3a2510"/><rect x="505" y="151" width="48" height="38" rx="2" fill="#C2622A" opacity=".16"/><line x1="529" y1="151" x2="529" y2="189" stroke="#2a1508" stroke-width="1.5"/><line x1="505" y1="170" x2="553" y2="170" stroke="#2a1508" stroke-width="1.5"/><rect x="430" y="190" width="40" height="86" rx="2" fill="#1a0f06"/><rect x="431" y="191" width="38" height="84" rx="1.5" fill="#C2622A" opacity=".13"/></svg>`;

  app.innerHTML = `
    <div class="dashboard-page">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo">
            <svg width="18" height="23" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
          <div class="nav-greeting">Hej, ${user?.name || ""}!</div>
        </div>
        <div class="nav-center">
          <button class="nav-tab active" onclick="navigate('dashboard')">Min sida</button>
          <button class="nav-tab" onclick="navigate('feed')">Utforska</button>
          <button class="nav-tab" onclick="navigate('map')">Karta</button>
        </div>
        <div class="nav-right">
          <button class="btn-ghost" style="font-size:12px;padding:7px 13px;" id="logoutBtn">Logga ut</button>
        </div>
      </nav>
      <div class="dashboard-body">
        <div class="page-eyebrow">Din profil</div>
        <div class="page-title">Min bostad</div>
        <div class="page-sub">Visa upp ditt hem, följ intresse och hitta nya möjligheter.</div>

        <div class="hero-section">
          ${images.length ? `<img src="${images[0]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" alt="Bostad" />` : houseSvg}
          <div class="hero-overlay"></div>
          <div class="hero-content">
            <div class="status-row">
              <button class="status-pill active-passive" id="sp-passive" onclick="setStatus('passive')">Passiv</button>
              <button class="status-pill" id="sp-rent" onclick="setStatus('rent')">Till uthyrning</button>
              <button class="status-pill" id="sp-sale" onclick="setStatus('sale')">Till salu</button>
            </div>
            <div class="hero-name">${ownerName || "Ingen fastighet kopplad ännu"}</div>
            <div class="hero-meta" id="hero-meta">Fastigheten visas passivt — besökare kan visa intresse utan aktiv försäljning.</div>
            <div class="hero-actions">
              ${ownerId ? `<button class="hero-btn primary" onclick="navigate('map')"><i class="ti ti-map-pin"></i> Visa i kartan</button>` : `<button class="hero-btn primary" onclick="navigate('map')"><i class="ti ti-map-pin"></i> Koppla fastighet</button>`}
              ${ownerId ? `<button class="hero-btn" id="clearOwnerBtn"><i class="ti ti-switch-horizontal"></i> Byt fastighet</button>` : ""}
            </div>
          </div>
        </div>

        <div class="stats-strip">
          <div class="stat-tile"><div class="stat-icon"><i class="ti ti-thumb-up"></i></div><div><div class="stat-num">${ownerLikes}</div><div class="stat-lbl">Gillar</div></div></div>
          <div class="stat-tile"><div class="stat-icon"><i class="ti ti-star"></i></div><div><div class="stat-num">${ownerInterests}</div><div class="stat-lbl">Intresserade</div></div></div>
          <div class="stat-tile"><div class="stat-icon"><i class="ti ti-heart"></i></div><div><div class="stat-num">${myLikedIds.length}</div><div class="stat-lbl">Sparade objekt</div></div></div>
        </div>

        <div class="two-col">
          <div>
            <div class="card">
              <div class="card-title">Redigera bostadsprofil</div>
              <div class="field-group" style="margin-bottom:12px;"><label class="label">Rubrik</label><input id="homeTitleInput" class="input" placeholder="Ex. Rymlig villa nära skogen" value="${homeProfile.title || ""}" /></div>
              <div class="field-group" style="margin-bottom:12px;"><label class="label">Beskrivning</label><textarea id="homeDescriptionInput" class="input">${homeProfile.description || ""}</textarea></div>
              <div class="field-group" style="margin-bottom:12px;">
                <label class="label">Bilder (max 3)</label>
                <div class="img-grid">
                  ${images.map((src, i) => `<div class="img-filled" style="position:relative;"><img src="${src}" alt="Bild ${i+1}" /><button class="remove-img-btn" data-index="${i}" style="position:absolute;bottom:6px;right:6px;background:rgba(17,24,39,.75);color:#fff;border:none;border-radius:999px;padding:4px 9px;font-size:11px;cursor:pointer;">Ta bort</button></div>`).join("")}
                  ${images.length < 3 ? `<div class="img-slot" onclick="document.getElementById('homeImageInput').click()"><i class="ti ti-plus"></i>Lägg till</div>` : ""}
                  ${images.length < 2 ? `<div class="img-slot" onclick="document.getElementById('homeImageInput').click()"><i class="ti ti-plus"></i>Lägg till</div>` : ""}
                  ${images.length < 1 ? `<div class="img-slot" onclick="document.getElementById('homeImageInput').click()"><i class="ti ti-plus"></i>Lägg till</div>` : ""}
                </div>
                <input id="homeImageInput" type="file" accept="image/*" multiple style="display:none;" />
              </div>
              <div class="extra-form" id="rent-extra">
                <div class="card-title" style="font-size:13px;margin-bottom:10px;">Uthyrningsdetaljer</div>
                <div class="two-fields">
                  <div class="field-group"><label class="label">Hyra/månad</label><input class="input" placeholder="12 000 kr" /></div>
                  <div class="field-group"><label class="label">Tillgänglig från</label><input class="input" type="date" /></div>
                  <div class="field-group"><label class="label">Antal rum</label><input class="input" placeholder="5 rum" /></div>
                  <div class="field-group"><label class="label">Kontraktstyp</label><select class="input"><option>Förstahand</option><option>Andrahand</option><option>Korttid</option></select></div>
                </div>
              </div>
              <div class="extra-form" id="sale-extra">
                <div class="card-title" style="font-size:13px;margin-bottom:10px;">Försäljningsdetaljer</div>
                <div class="two-fields">
                  <div class="field-group"><label class="label">Utgångspris</label><input class="input" placeholder="3 500 000 kr" /></div>
                  <div class="field-group"><label class="label">Visningsdatum</label><input class="input" type="date" /></div>
                </div>
              </div>
              <button class="save-btn" id="saveHomeProfileBtn">Spara profil</button>
            </div>
          </div>
          <div>
            <div class="card" style="margin-bottom:12px;">
              <div class="card-title">Aktivitet</div>
              <div class="act-row"><div class="act-dot"></div>Utforska fastigheter på kartan</div>
              <div class="act-row"><div class="act-dot"></div>Markera intresse på objekt du gillar</div>
              <div class="act-row"><div class="act-dot"></div>Välj ägarläge och koppla din fastighet</div>
              <div class="act-row"><div class="act-dot"></div>Se vem som är intresserad av din bostad</div>
            </div>
            <div class="card">
              <div class="card-title">Snabblänkar</div>
              <button class="quick-btn" onclick="navigate('map')"><i class="ti ti-map-2"></i> Utforska karta</button>
              <button class="quick-btn" onclick="toast('Inställningar kommer snart!')"><i class="ti ti-settings"></i> Kontoinställningar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("logoutBtn").onclick = () => { clearSession(); toast("Utloggad."); navigate("welcome"); };

  const clearBtn = document.getElementById("clearOwnerBtn");
  if (clearBtn) clearBtn.onclick = () => { const s = loadState(); s.ownerParcelId = null; saveState(s); toast("Välj en ny fastighet."); render(); };

  document.getElementById("saveHomeProfileBtn").onclick = () => {
    const u = getCurrentUser(); if (!u) return;
    u.homeProfile = { ...getHomeProfile(u), title: document.getElementById("homeTitleInput").value.trim(), description: document.getElementById("homeDescriptionInput").value.trim() };
    saveCurrentUser(u); toast("Bostadsprofil sparad."); render();
  };

  document.getElementById("homeImageInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3); if (!files.length) return;
    const u = getCurrentUser(); if (!u) return;
    const profile = getHomeProfile(u);
    const newImgs = await Promise.all(files.map(readImageAsDataUrl));
    u.homeProfile = { ...profile, images: [...(profile.images || []), ...newImgs].slice(0, 3) };
    saveCurrentUser(u); toast("Bild uppladdad."); render();
  });

  document.querySelectorAll(".remove-img-btn").forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.index);
      const u = getCurrentUser(); if (!u) return;
      const p = getHomeProfile(u);
      p.images = (p.images || []).filter((_, i) => i !== idx);
      u.homeProfile = p; saveCurrentUser(u); toast("Bild borttagen."); render();
    };
  });

  document.getElementById("sp-passive").onclick = () => setStatus("passive");
  document.getElementById("sp-rent").onclick    = () => setStatus("rent");
  document.getElementById("sp-sale").onclick    = () => setStatus("sale");
}

function setStatus(m) {
  ["passive","rent","sale"].forEach(x => { const b = document.getElementById("sp-"+x); if(b) b.className="status-pill"; });
  const b = document.getElementById("sp-"+m); if(b) b.classList.add("active-"+m);
  const desc = { passive:"Fastigheten visas passivt — besökare kan visa intresse utan aktiv försäljning.", rent:"Fastigheten är listad för uthyrning. Fyll i detaljer nedan.", sale:"Fastigheten är listad till salu. Fyll i detaljer nedan." };
  const hm = document.getElementById("hero-meta"); if(hm) hm.textContent = desc[m];
  const re = document.getElementById("rent-extra"); if(re) re.classList.toggle("show", m==="rent");
  const se = document.getElementById("sale-extra"); if(se) se.classList.toggle("show", m==="sale");
}

// =========================
// MAP VIEW
// =========================
function renderMapView() {
  const session = loadSession();
  if (!session?.email) return navigate("welcome");
  const savedMode = loadSavedMapMode();

  // Save the existing Leaflet container before wiping the DOM
  const existingMapContainer = map ? map.getContainer() : null;

  app.innerHTML = `
    <div class="map-page">
      <div class="map-overlay map-tl">
        <div class="glass-card map-search">
          <input id="addressSearch" class="map-search-input" placeholder="Sök adress eller fastighet…" />
          <button id="searchBtn" class="map-search-btn"><i class="ti ti-search"></i></button>
        </div>
      </div>
      <div class="map-overlay map-tr">
        <div class="glass-card map-toolbar">
          <select id="modeSelect" class="toolbar-select">
            <option value="visitor" ${savedMode==="visitor"?"selected":""}>Besökarläge</option>
            <option value="owner"   ${savedMode==="owner"  ?"selected":""}>Ägarläge</option>
          </select>
          <label class="toolbar-upload"><i class="ti ti-upload"></i> Ladda karta<input id="fileInput" type="file" accept=".geojson,application/geo+json,application/json" /></label>
          <button id="toggleMapStyleBtn" class="toolbar-btn">${currentBase==="map"?"Flygfoto":"Kartvy"}</button>
          <button id="locateBtn"         class="toolbar-btn"><i class="ti ti-current-location"></i> Hitta mig</button>
          <button id="backBtn"           class="toolbar-btn"><i class="ti ti-arrow-left"></i> Min sida</button>
          <button id="clearBtn"          class="toolbar-btn"><i class="ti ti-trash"></i> Rensa</button>
        </div>
      </div>
      <div class="map-overlay map-bl">
        <div class="glass-card map-brand">
          <div class="map-brand-name">i<em>found</em></div>
          <div class="map-brand-sub">Utforska fastigheter</div>
        </div>
      </div>
      <div class="map-wrap"><div id="map"></div></div>
      <div id="panel" class="panel hidden"></div>
    </div>
  `;

  // Re-attach the existing Leaflet container, or initialise fresh
  if (existingMapContainer) {
    const placeholder = document.getElementById("map");
    placeholder.parentNode.replaceChild(existingMapContainer, placeholder);
  } else {
    ensureMapMounted();
  }

  ["map","satellite"].forEach(k => { if (baseLayers[k] && map.hasLayer(baseLayers[k]) && currentBase !== k) map.removeLayer(baseLayers[k]); });
  if (baseLayers[currentBase] && !map.hasLayer(baseLayers[currentBase])) baseLayers[currentBase].addTo(map);

  try {
    const saved = localStorage.getItem(LS_GEOJSON);
    if (saved) { addGeoJsonToMap(JSON.parse(saved), { keepView: true, silent: true }); toast("Kartan laddad."); }
    else toast("Ladda en GeoJSON-fil för att se fastigheter.");
  } catch { toast("Kunde inte läsa sparad karta."); }

  document.getElementById("toggleMapStyleBtn").onclick = () => {
    if (!map) return;
    if (baseLayers[currentBase] && map.hasLayer(baseLayers[currentBase])) map.removeLayer(baseLayers[currentBase]);
    currentBase = currentBase === "map" ? "satellite" : "map";
    baseLayers[currentBase].addTo(map);
    document.getElementById("toggleMapStyleBtn").textContent = currentBase === "map" ? "Flygfoto" : "Kartvy";
  };

  document.getElementById("modeSelect").addEventListener("change", e => { saveMapMode(e.target.value); closePanel(); redrawLayer(); });
  document.getElementById("backBtn").onclick  = () => { closePanel(); navigate("dashboard"); };
  document.getElementById("clearBtn").onclick = () => { localStorage.removeItem(LS_GEOJSON); clearLayer(); closePanel(); toast("Kartlagret rensades."); };
  // Search autocomplete
  let searchDebounce = null;
  let searchAbort = null;

  function removeDropdown() {
    const old = document.getElementById("searchDropdown");
    if (old) old.remove();
  }

  function pickResult(result) {
    removeDropdown();
    document.getElementById("addressSearch").value = result.display_name.split(",").slice(0, 2).join(",").trim();
    map.setView([parseFloat(result.lat), parseFloat(result.lon)], 16);
  }

  function showDropdown(results) {
    removeDropdown();
    const wrap = document.querySelector(".map-search");
    if (!wrap) return;
    const dd = document.createElement("div");
    dd.id = "searchDropdown";
    dd.className = "search-dropdown";
    if (!results.length) {
      dd.innerHTML = `<div class="search-dropdown-empty">Inga resultat hittades</div>`;
    } else {
      results.forEach(r => {
        const parts = r.display_name.split(",");
        const name = parts.slice(0, 2).join(",").trim();
        const meta = parts.slice(2, 4).join(",").trim();
        const item = document.createElement("div");
        item.className = "search-dropdown-item";
        item.innerHTML = `<i class="ti ti-map-pin"></i><div><div class="search-dropdown-name">${name}</div>${meta ? `<div class="search-dropdown-meta">${meta}</div>` : ""}</div>`;
        item.addEventListener("mousedown", e => { e.preventDefault(); pickResult(r); });
        dd.appendChild(item);
      });
    }
    wrap.appendChild(dd);
  }

  async function fetchSuggestions(query) {
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=se&limit=5&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { signal: searchAbort.signal, headers: { "Accept-Language": "sv", "User-Agent": "ifound.se/1.0" } });
      const data = await res.json();
      showDropdown(data);
    } catch (e) {
      if (e.name !== "AbortError") removeDropdown();
    }
  }

  async function doSearch() {
    const query = document.getElementById("addressSearch").value.trim();
    if (!query) return;
    const btn = document.getElementById("searchBtn");
    btn.disabled = true;
    removeDropdown();
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=se&limit=1&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { "Accept-Language": "sv", "User-Agent": "ifound.se/1.0" } });
      const data = await res.json();
      if (!data.length) { toast("Hittade ingen adress — försök med ett mer specifikt sökord."); return; }
      map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
      document.getElementById("addressSearch").value = data[0].display_name.split(",").slice(0, 2).join(",").trim();
    } catch { toast("Sökning misslyckades — kontrollera din internetanslutning."); }
    finally { btn.disabled = false; }
  }

  document.getElementById("addressSearch").addEventListener("input", e => {
    clearTimeout(searchDebounce);
    const q = e.target.value.trim();
    if (q.length < 3) { removeDropdown(); return; }
    searchDebounce = setTimeout(() => fetchSuggestions(q), 300);
  });
  document.getElementById("addressSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(searchDebounce); doSearch(); }
    if (e.key === "Escape") removeDropdown();
  });
  document.getElementById("addressSearch").addEventListener("blur", () => {
    setTimeout(removeDropdown, 150);
  });
  document.getElementById("searchBtn").onclick = doSearch;

  document.getElementById("locateBtn").onclick = () => {
    if (!navigator.geolocation) { toast("Din webbläsare stödjer inte platsfunktion."); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      map.setView([lat, lng], 17);
      if (locateMarker) locateMarker.remove();
      locateMarker = L.circleMarker([lat, lng], { radius: 8, weight: 3, color: "#C2622A", fillColor: "#C2622A", fillOpacity: 0.9 }).addTo(map);
      toast("Visar din position.");
    }, () => toast("Kunde inte hämta din position."), { enableHighAccuracy: true, timeout: 8000 });
  };

  document.getElementById("fileInput").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        let geojson = JSON.parse(evt.target.result);
        if (geojson.type === "Feature") geojson = { type: "FeatureCollection", features: [geojson] };
        if (geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features))
          throw new Error("Inte en giltig FeatureCollection");
        toast(`Läste ${geojson.features.length} objekt.`);
        geojson = reprojectGeoJsonIfNeeded(geojson);
        addGeoJsonToMap(geojson);
        localStorage.setItem(LS_GEOJSON, JSON.stringify(geojson));
      } catch (err) {
        toast("Kunde inte läsa filen — " + (err.message || "ogiltigt format"));
      }
      e.target.value = "";
    };
    reader.onerror = () => { toast("Filläsning misslyckades."); e.target.value = ""; };
    reader.readAsText(file, "UTF-8");
  });

  setTimeout(() => { try { map.invalidateSize(); } catch {} }, 120);
}

// =========================
// Render & boot
// =========================
function render() {
  const session = loadSession();
  if (!session?.email) { renderWelcome(); return; }
  if (currentView === "map") { renderMapView(); return; }
  if (currentView === "feed") { renderFeed(); return; }
  renderDashboard();
}

window.addEventListener("keydown", ev => { if (currentView === "map" && ev.key === "Escape") closePanel(); });

(() => {
  const session = loadSession();
  currentView = session?.email ? "dashboard" : "welcome";
  render();
})();
