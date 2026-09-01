// =========================
// LocalStorage keys
// =========================
const LS_USERS   = "prop_users_v1";
const LS_SESSION = "prop_session_v1";
const LS_STATE   = "prop_state_v3";
const LS_GEOJSON = "prop_geojson_helsingborg_v4";
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

// =========================
// MIN SIDA — profil, roll och onboarding
// Rollen formar vad som lyfts fram, men låser aldrig funktioner: en som sökte
// bostad kan ärva ett hus nästa år, och då ska allt finnas kvar.
// =========================
function getProfile() {
  const s = loadState();
  return s.profile || (s.profile = {});
}
function saveProfile(patch) {
  const s = loadState();
  s.profile = Object.assign({}, s.profile, patch);
  saveState(s);
  return s.profile;
}

const ROLES = {
  curious: { label: "Mest nyfiken", icon: "ti-map-search",
             blurb: "Jag tittar på hus, kanske ett jag gått förbi." },
  owner:   { label: "Jag äger ett hus", icon: "ti-home-heart",
             blurb: "Jag vill se vad folk tycker om min fastighet." },
  seeker:  { label: "Jag söker bostad", icon: "ti-search",
             blurb: "Jag letar och vill bevaka hus och områden." },
};

// Vilka steg som visas på Min sida beror på rollen. Alla steg går att skjuta upp.
function onboardingSteps(role) {
  const common = [
    { id: "role", label: "Välj din roll", icon: "ti-user-check",
      done: !!getProfile().role, always: true,
      desc: "Vi anpassar Min sida efter varför du är här. Går att ändra när som helst." },
    { id: "notify", label: "Aviseringar", icon: "ti-bell",
      done: getProfile().notify !== undefined,
      desc: "Få veta när någon gillar din fastighet eller när ett bevakat hus dyker upp." },
  ];
  const owner = [
    { id: "claim", label: "Koppla din fastighet", icon: "ti-home-check",
      done: !!loadState().ownerParcelId,
      desc: "Sök upp din fastighet på kartan och claima den. Då ser du vilka som visat intresse." },
    { id: "wish", label: "Sätt ett önskepris", icon: "ti-tag",
      done: !!(loadState().wishPrices || {})[loadState().ownerParcelId],
      desc: "Ange vad du skulle kunna tänka dig att sälja för — även om huset inte är till salu." },
    { id: "photo", label: "Lägg till en bild", icon: "ti-camera",
      done: !!(getHomeProfile(getCurrentUser())?.images || []).length,
      desc: "Visa upp ditt hem för den som är nyfiken." },
  ];
  const seeker = [
    { id: "area", label: "Bevaka ett område", icon: "ti-map-pin",
      done: !!(getProfile().watchedAreas || []).length,
      desc: "Få en notis när något händer i ett område du är intresserad av." },
    { id: "likes", label: "Gilla ditt första hus", icon: "ti-heart",
      done: Object.keys(loadState().myLikes || {}).length > 0,
      desc: "Spara husen du fastnar för så hittar du tillbaka till dem." },
  ];
  if (role === "owner")  return [...common, ...owner];
  if (role === "seeker") return [...common, ...seeker];
  return [...common, { id: "explore", label: "Utforska kartan", icon: "ti-map-2",
      done: Object.keys(loadState().myLikes || {}).length > 0,
      desc: "Klicka runt bland fastigheterna och gilla det du gillar." }];
}

function setRole(role) {
  saveProfile({ role });
  toast(`Min sida är nu anpassad för dig som ${ROLES[role].label.toLowerCase()}.`);
  closeWelcomeFlow();
  if (currentView === "dashboard" || currentView === "welcomeflow") { currentView = "dashboard"; render(); }
}

function skipWelcome() {
  saveProfile({ welcomeSkipped: true });
  closeWelcomeFlow();
  currentView = "dashboard"; render();
}

function closeWelcomeFlow() {
  const el = document.getElementById("welcome-flow-overlay");
  if (el) el.remove();
}

// Visas första gången en inloggad användare når Min sida utan att ha valt roll.
function maybeShowWelcomeFlow() {
  const p = getProfile();
  if (p.role || p.welcomeSkipped) return;
  if (document.getElementById("welcome-flow-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "welcome-flow-overlay";
  overlay.className = "wf-overlay";
  overlay.innerHTML = `
    <div class="wf-card">
      <div class="wf-eyebrow">Välkommen till ifound</div>
      <h2 class="wf-title">Vad för dig hit?</h2>
      <p class="wf-sub">Vi anpassar din sida efter svaret. Du kan ändra det när som helst — och hoppa över nu om du vill.</p>
      <div class="wf-roles">
        ${Object.entries(ROLES).map(([key, r]) => `
          <button class="wf-role" onclick="setRole('${key}')">
            <span class="wf-role-icon"><i class="ti ${r.icon}"></i></span>
            <span class="wf-role-text">
              <strong>${r.label}</strong>
              <em>${r.blurb}</em>
            </span>
            <i class="ti ti-arrow-right wf-role-arrow"></i>
          </button>
        `).join("")}
      </div>
      <button class="wf-skip" onclick="skipWelcome()">Hoppa över för nu</button>
    </div>`;
  document.body.appendChild(overlay);
}
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
let currentBase = "satellite";
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
  // If map exists but its container is no longer in the DOM, destroy and reinit
  if (map) {
    try {
      const container = map.getContainer();
      if (!document.body.contains(container)) {
        map.remove();
        map = null;
      }
    } catch {
      map = null;
    }
  }
  if (map) return;

  // leaflet-draw 1.0.4 kraschar när rektangel ritas (L.GeometryUtil.readableArea
  // anropar type-fel internt). Wrappa funktionen en gång så den aldrig kastar —
  // annars når CREATED-eventet aldrig fram och intressepanelen öppnas inte.
  if (L.GeometryUtil && L.GeometryUtil.readableArea && !L.GeometryUtil._readableAreaPatched) {
    const _origReadableArea = L.GeometryUtil.readableArea;
    L.GeometryUtil.readableArea = function () {
      try { return _origReadableArea.apply(this, arguments); }
      catch (e) { return ""; }
    };
    L.GeometryUtil._readableAreaPatched = true;
  }

  const svgRenderer = L.svg({ padding: 0.5 });
  map = L.map("map", { zoomControl: true, renderer: svgRenderer }).setView([56.0465, 12.6945], 13);

  // Förklassa byggnadstyper i vyn när kartan stannar (debounce så vi inte spammar Overpass)
  let _prefetchDebounce = null;
  map.on("moveend", () => {
    clearTimeout(_prefetchDebounce);
    _prefetchDebounce = setTimeout(prefetchBuildingTypesInView, 1200);
  });

  baseLayers.map = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });
  baseLayers.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Tiles &copy; Esri" });
  if (currentBase === "satellite") {
    baseLayers.satellite.addTo(map);
  } else {
    baseLayers.map.addTo(map);
  }
}

function clearLayer() {
  if (parcelsLayer) { parcelsLayer.remove(); parcelsLayer = null; }
  lastGeoJson = null;
}
function redrawLayer() { if (lastGeoJson) addGeoJsonToMap(lastGeoJson, { keepView: true, silent: true }); }

function addGeoJsonToMap(geojson, opts = {}) {
  ensureMapMounted();
  if (parcelsLayer) { parcelsLayer.remove(); parcelsLayer = null; }
  lastGeoJson = geojson;
  setTimeout(prefetchBuildingTypesInView, 1000); // förklassa direkt när lagret laddats

  if (!map.getPane("parcelsPane")) {
    map.createPane("parcelsPane");
    map.getPane("parcelsPane").style.zIndex = 450;
  }

  const group = L.layerGroup().addTo(map);

  for (const feature of (geojson.features || [])) {
    const geom = feature?.geometry;
    if (!geom || !['Polygon','MultiPolygon'].includes(geom.type)) continue;

    const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

    for (const poly of polygons) {
      const latlngs = poly[0].map(p => [p[1], p[0]]);
      if (latlngs.length < 3) continue;

      const layer = L.polygon(latlngs, {
        pane: "parcelsPane",
        color: "rgba(255,255,255,0.75)",
        weight: 1,
        fill: true,
        fillColor: "#ffffff",
        fillOpacity: 0.001,
        smoothFactor: 0,
        interactive: true,
      });

      layer.on('add', function() {
        const el = this.getElement();
        if (el) el.style.pointerEvents = 'all';
      });

      layer.on("click", () => {
        // Ignorera tomtklick under ritläge och strax efter att en form skapats —
        // rektangelns mus-släpp träffar annars tomten och skriver över bekräftelsepanelen.
        if (activeDrawFeature) return;
        if (window._lastDrawCreatedAt && Date.now() - window._lastDrawCreatedAt < 600) return;
        layer.setStyle({ color: "#CC2936", weight: 2 });
        setTimeout(() => layer.setStyle({ color: "rgba(255,255,255,0.75)", weight: 1 }), 1000);
        renderParcelPanel(feature);
      });

      layer.on("mouseover", () => {
        map.getContainer().style.cursor = "pointer";
        layer.setStyle({ color: "#CC2936", weight: 2, fillOpacity: 0.06 });
      });

      layer.on("mouseout", () => {
        map.getContainer().style.cursor = "";
        layer.setStyle({ color: "rgba(255,255,255,0.75)", weight: 1, fillOpacity: 0.001 });
      });

      group.addLayer(layer);
    }
  }

  parcelsLayer = group;

  setTimeout(() => {
    const pane = map.getPane("parcelsPane");
    if (pane) {
      pane.querySelectorAll("path").forEach(path => {
        path.style.pointerEvents = "all";
      });
    }
  }, 300);

  try {
    const b = L.geoJSON(geojson).getBounds();
    if (b?.isValid() && !opts.keepView) map.fitBounds(b, { padding: [20,20] });
  } catch {}

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
// INTRESSE-MODAL
// =========================
function openInterestModal(feature, pid, name) {
  const existing = document.getElementById('interest-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'interest-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px;width:100%;max-width:420px;box-shadow:0 24px 64px rgba(0,0,0,.2);font-family:var(--font-body);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
        <div>
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:4px;">Visa intresse</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:-.03em;color:var(--ink);">${name}</div>
        </div>
        <button onclick="closeInterestModal()" style="width:32px;height:32px;border-radius:50%;border:none;background:var(--surface-2);cursor:pointer;font-size:16px;color:var(--ink-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
      </div>

      <div style="background:var(--page-bg);border-radius:12px;padding:14px 16px;margin-bottom:20px;font-size:13px;color:var(--ink-soft);line-height:1.6;">
        ${isParcelClaimed(pid)
          ? `Ägaren finns på ifound och får ditt intresse direkt i appen.`
          : `Ägaren är <strong style="color:var(--ink);">inte med på ifound ännu</strong> och ser det här först om de går med. I nästa steg kan du välja att uppmärksamma dem med ett vykort hem i brevlådan.`}
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:6px;">Meddelande till ägaren <span style="font-weight:400;text-transform:none;letter-spacing:0;">(valfritt)</span></label>
        <textarea id="interestMessage" style="width:100%;border:0.5px solid rgba(17,24,39,.12);border-radius:9px;padding:11px 13px;font-size:13px;font-family:var(--font-body);color:var(--ink);outline:none;min-height:100px;resize:vertical;line-height:1.6;background:#fff;" placeholder="Ex: Jag är intresserad av att köpa denna fastighet om ni någonsin funderar på att sälja. Hör gärna av er!"></textarea>
        <div style="font-size:11px;color:var(--ink-muted);margin-top:5px;">Meddelandet är anonymt tills du väljer att avslöja din identitet.</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;">
        <button id="sendInterestBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
          <i class="ti ti-star" aria-hidden="true"></i> Skicka intresse
        </button>
        <button onclick="sendInterestWithoutMessage('${pid}', '${name}')" style="width:100%;padding:11px;border-radius:11px;border:0.5px solid rgba(17,24,39,.12);background:transparent;color:var(--ink-soft);font-size:13px;font-weight:500;font-family:var(--font-body);cursor:pointer;">
          Bara markera intresse utan meddelande
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeInterestModal(); });

  document.getElementById('sendInterestBtn').onclick = () => {
    const msg = document.getElementById('interestMessage').value.trim();
    // Ett meddelande måste kunna besvaras. Utan konto finns ingen i andra änden,
    // så meddelande kräver inloggning — men enkel intressemarkering gör det inte.
    if (msg && !loadSession()?.email) {
      const s = loadState();
      s.pendingInterest = { pid, name, message: msg };
      saveState(s);
      toast("Skapa ett konto så ägaren kan svara dig.");
      openAuthModal('reg');
      return;
    }
    saveInterest(pid, name, msg);
  };
}

function closeInterestModal() {
  const overlay = document.getElementById('interest-modal-overlay');
  if (overlay) overlay.remove();
}

function sendInterestWithoutMessage(pid, name) {
  saveInterest(pid, name, '');
}

// Egen bild på en fastighet man fastnat för — "så här såg det ut när jag stannade".
// Sparas lokalt per fastighet, bara för användaren själv. Skiljt från ägarens
// officiella bilder; detta är ett minne, inte en presentation.
function getMyPhoto(pid) {
  return (loadState().myPhotos || {})[pid] || null;
}
function saveMyPhoto(pid, dataUrl, name) {
  const s = loadState();
  s.myPhotos = s.myPhotos || {};
  s.parcelNames = s.parcelNames || {};
  if (name) s.parcelNames[pid] = name;
  s.myPhotos[pid] = dataUrl;
  saveState(s);
}
function removeMyPhoto(pid) {
  const s = loadState();
  if (s.myPhotos) { delete s.myPhotos[pid]; saveState(s); }
}
function handleMyPhotoPick(pid, name, input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("Välj en bildfil."); return; }
  const reader = new FileReader();
  reader.onload = () => {
    // Skala ner till max 900px bred så localStorage inte fylls av megabytes
    const img = new Image();
    img.onload = () => {
      const max = 900, scale = Math.min(1, max / img.width);
      const cv = document.createElement("canvas");
      cv.width = img.width * scale; cv.height = img.height * scale;
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      try {
        saveMyPhoto(pid, cv.toDataURL("image/jpeg", 0.72), name);
        toast("Bild sparad. Du hittar den bland dina fastigheter.");
        if (window._currentPanelFeature) renderParcelPanel(window._currentPanelFeature);
      } catch { toast("Kunde inte spara bilden — den kan vara för stor."); }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function saveInterest(pid, name, message) {
  const s = loadState();
  s.myInterests = s.myInterests || {};
  s.parcelNames = s.parcelNames || {};
  s.parcelNames[pid] = name;
  s.interests = s.interests || {};

  if (!s.myInterests[pid]) {
    s.interests[pid] = (s.interests[pid] || 0) + 1;
    s.myInterests[pid] = true;
  }

  // Save message if provided
  if (message) {
    s.interestMessages = s.interestMessages || {};
    s.interestMessages[pid] = s.interestMessages[pid] || [];
    s.interestMessages[pid].push({
      message,
      sentAt: new Date().toISOString(),
      anonymous: true,
    });
  }

  saveState(s);
  closeInterestModal();
  redrawLayer();

  // Re-render panel if still open
  renderParcelPanel({ properties: { fastighet: name }, geometry: null, _pid: pid });

  // Är ägaren inte på ifound är intresset osynligt för dem. Erbjud vykortet
  // direkt här — användaren är som mest engagerad i just detta ögonblick.
  const unclaimed = !isParcelClaimed(pid);
  const pc = getPostcardStatus(pid);
  const loggedIn = !!loadSession()?.email;
  if (unclaimed && !pc.sent && loggedIn) {
    setTimeout(() => openPostcardModal(pid, name, true), 220);
    return;
  }

  toast(message ? "Intresse och meddelande skickat till ägaren!" : "Intresse markerat!");
}

// =========================
// VYKORT — "UPPMÄRKSAMMA FASTIGHETSÄGAREN"
// Kärnproblemet: en intresseanmälan är värdelös om ägaren aldrig får veta.
// Vi bryter igenom med fysisk post till fastighetens registrerade ägare.
// =========================

// Pris per vykort (tryck + porto + registerslagning + marginal). Justeras när
// vi har riktiga kostnader från tryckleverantör och Lantmäteriet-licens.
const POSTCARD_PRICE_SEK = 49;

// Karenstid — samma fastighet får inte spammas. Räknas per fastighet, inte per
// användare, annars kan tio personer trigga tio vykort samma vecka.
const POSTCARD_COOLDOWN_DAYS = 90;

// Är fastigheten redan claimad? Då finns ägaren i appen och behöver inget brev.
function isParcelClaimed(pid) {
  const norm = v => String(v).toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g, '');
  const n = norm(pid);
  const st = loadState();
  if (st.ownerParcelId && norm(st.ownerParcelId) === n) return true;
  return CLAIMED_PROPS.some(p => norm(p.id) === n || norm(p.name) === n);
}

function getPostcardStatus(pid) {
  const s = loadState();
  const rec = (s.postcards || {})[pid];
  if (!rec) return { sent: false };
  const days = (Date.now() - new Date(rec.sentAt).getTime()) / 86400000;
  return {
    sent: true,
    record: rec,
    inCooldown: days < POSTCARD_COOLDOWN_DAYS,
    daysLeft: Math.ceil(POSTCARD_COOLDOWN_DAYS - days),
  };
}

function openPostcardModal(pid, name, afterInterest = false) {
  const session = loadSession();
  if (!session?.email) {
    openAuthModal('reg');
    toast("Skapa ett konto för att skicka vykort — vi behöver kunna nå dig om ägaren hör av sig.");
    return;
  }

  const status = getPostcardStatus(pid);
  if (status.inCooldown) {
    toast(`Ett vykort skickades nyligen till den här fastigheten. Nästa kan skickas om ${status.daysLeft} dagar.`);
    return;
  }

  const existing = document.getElementById('postcard-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'postcard-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;';

  const slug = String(pid).toLowerCase().replace(/[^a-z0-9åäö]+/g, '-').replace(/^-|-$/g, '');

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px;width:100%;max-width:460px;box-shadow:0 24px 64px rgba(0,0,0,.2);font-family:var(--font-body);margin:auto;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px;">
        <div>
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:4px;">Uppmärksamma ägaren</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:-.03em;color:var(--ink);">${name}</div>
        </div>
        <button onclick="closePostcardModal()" style="width:32px;height:32px;border-radius:50%;border:none;background:var(--surface-2);cursor:pointer;font-size:16px;color:var(--ink-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
      </div>

      ${afterInterest ? `
        <div style="display:flex;gap:9px;align-items:flex-start;background:#F0FDF4;border:0.5px solid rgba(22,163,74,.25);border-radius:11px;padding:11px 13px;margin-bottom:16px;">
          <i class="ti ti-check" style="font-size:15px;color:#16a34a;flex-shrink:0;margin-top:1px;" aria-hidden="true"></i>
          <div style="font-size:12px;color:#15803d;font-weight:600;line-height:1.5;">
            Ditt intresse är sparat på fastigheten.
          </div>
        </div>
      ` : ''}

      <div style="font-size:13px;color:var(--ink-soft);line-height:1.65;margin-bottom:18px;">
        ${afterInterest
          ? `Men ägaren är inte med på ifound ännu och ser inte ditt intresse förrän de claimar sin fastighet och skaffar ett konto. Vill du att de får veta redan nu? Vi skickar ett fysiskt vykort hem till fastighetens registrerade ägare.`
          : `Ägaren är inte med på ifound ännu och vet därför inte att du finns. Vi skickar ett fysiskt vykort till fastighetens registrerade ägare och berättar att någon visat intresse.`}
      </div>

      <!-- Förhandsvisning av vykortet -->
      <div class="postcard-preview">
        <div class="postcard-stamp"><i class="ti ti-home-heart" aria-hidden="true"></i></div>
        <div class="postcard-eyebrow">ifound.se</div>
        <div class="postcard-headline">Någon är intresserad av<br><strong>${name}</strong></div>
        <div class="postcard-body">
          En person har via ifound.se visat intresse för din fastighet. Vi vet inte om du någonsin vill sälja — men nu vet du att intresset finns.
        </div>
        <div class="postcard-footer">ifound.se/${slug}</div>
      </div>

      <div style="display:flex;align-items:center;gap:10px;background:var(--page-bg);border-radius:11px;padding:12px 14px;margin:16px 0;">
        <i class="ti ti-mail-fast" style="font-size:20px;color:var(--accent);flex-shrink:0;" aria-hidden="true"></i>
        <div style="font-size:12px;color:var(--ink-soft);line-height:1.55;">
          Skickas som brev inom 2–3 arbetsdagar. Ditt namn står <strong style="color:var(--ink);">inte</strong> på kortet — du är anonym tills du själv väljer annat.
        </div>
      </div>

      <label style="display:flex;gap:9px;align-items:flex-start;font-size:12px;color:var(--ink-soft);line-height:1.55;margin-bottom:16px;cursor:pointer;">
        <input type="checkbox" id="postcardConsent" style="margin-top:2px;flex-shrink:0;width:15px;height:15px;accent-color:var(--accent);" />
        <span>Jag intygar att mitt intresse är seriöst och att vykortet inte skickas för att störa ägaren.</span>
      </label>

      <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-top:0.5px solid rgba(17,24,39,.10);margin-bottom:14px;">
        <span style="font-size:13px;color:var(--ink-soft);">Tryck, porto och hantering</span>
        <span style="font-size:16px;font-weight:700;color:var(--ink);letter-spacing:-.02em;">${POSTCARD_PRICE_SEK} kr</span>
      </div>

      <div style="display:flex;flex-direction:column;gap:9px;">
        <button id="confirmPostcardBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:8px;opacity:.5;" disabled>
          <i class="ti ti-send" aria-hidden="true"></i> Skicka vykortet
        </button>
        <button onclick="closePostcardModal()" style="width:100%;padding:11px;border-radius:11px;border:0.5px solid rgba(17,24,39,.12);background:transparent;color:var(--ink-soft);font-size:13px;font-weight:500;font-family:var(--font-body);cursor:pointer;">
          ${afterInterest ? "Nej tack — jag väntar" : "Inte nu"}
        </button>
        ${afterInterest ? `<div style="font-size:11px;color:var(--ink-muted);text-align:center;line-height:1.5;">Du kan skicka vykortet senare från fastighetens panel.</div>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePostcardModal(); });

  const consent = document.getElementById('postcardConsent');
  const btn = document.getElementById('confirmPostcardBtn');
  consent.onchange = () => {
    btn.disabled = !consent.checked;
    btn.style.opacity = consent.checked ? '1' : '.5';
    btn.style.cursor = consent.checked ? 'pointer' : 'not-allowed';
  };
  btn.onclick = () => { if (consent.checked) sendPostcard(pid, name); };
}

function closePostcardModal() {
  const overlay = document.getElementById('postcard-modal-overlay');
  if (overlay) overlay.remove();
}

function sendPostcard(pid, name) {
  const session = loadSession();
  const s = loadState();
  s.postcards = s.postcards || {};
  s.parcelNames = s.parcelNames || {};
  s.parcelNames[pid] = name;
  s.postcards[pid] = {
    sentAt: new Date().toISOString(),
    sentBy: session?.email || null,
    priceSek: POSTCARD_PRICE_SEK,
    // Prototyp: kön hanteras av backend i Supabase. queued → printed → posted → delivered
    status: 'queued',
  };
  saveState(s);
  closePostcardModal();
  toast("Vykortet är på väg! Vi hör av oss om ägaren går med på ifound.");
  const feat = window._currentPanelFeature;
  if (feat && window._currentPanelPid === pid) renderParcelPanel(feat);
}

// =========================
// AVSTYCKNING / DRAW
// =========================
let drawControl = null;
let drawnItems = null;
let activeDrawFeature = null;

function startDrawSubdivision(feature) {
  // Remove existing draw if any
  stopDraw();
  activeDrawFeature = feature;

  // Init drawn items layer
  drawnItems = new L.FeatureGroup().addTo(map);

  // Custom draw control — only polygon
  drawControl = new L.Control.Draw({
    position: 'topright',
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: false, // leaflet-draw 1.0.4: showArea:true kraschar rektangelritning (readableArea)
        shapeOptions: {
          color: '#CC2936',
          weight: 2,
          fillColor: '#CC2936',
          fillOpacity: 0.15,
        },
        guideLayers: [],
        snapDistance: 10,
      },
      rectangle: {
        shapeOptions: {
          color: '#CC2936',
          weight: 2,
          fillColor: '#CC2936',
          fillOpacity: 0.15,
        },
      },
      circle: false,
      circlemarker: false,
      marker: false,
      polyline: false,
    },
    edit: { featureGroup: drawnItems },
  });

  map.addControl(drawControl);

  // Show instructions
  const panel = document.getElementById("panel");
  if (panel) {
    panel.innerHTML = `
      <button class="panel-close" id="cancelDrawBtn">✕</button>
      <div class="panel-eyebrow">Avstyckning</div>
      <div class="panel-name" style="font-size:15px;">${prettyName(feature)}</div>
      <div style="margin:12px 0;padding:12px;background:var(--accent-soft);border-radius:10px;font-size:12px;color:#7F1D1D;line-height:1.6;">
        <strong>Rita det område du är intresserad av.</strong><br>
        Klicka på kartan för att markera hörnen. Dubbelklicka för att avsluta.
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button id="drawPolygonBtn" class="panel-btn" style="flex:1;background:var(--accent);color:#fff;border-color:var(--accent);">
          <i class="ti ti-vector-triangle"></i> Rita polygon
        </button>
        <button id="drawRectBtn" class="panel-btn" style="flex:1;">
          <i class="ti ti-rectangle"></i> Rita rektangel
        </button>
      </div>
      <div id="drawStatus" style="font-size:12px;color:var(--ink-muted);text-align:center;margin-top:8px;min-height:20px;"></div>
    `;
    panel.classList.remove("hidden");
  }

  document.getElementById("cancelDrawBtn").onclick = () => {
    stopDraw();
    closePanel();
  };

  document.getElementById("drawPolygonBtn").onclick = () => {
    new L.Draw.Polygon(map, drawControl.options.draw.polygon).enable();
    document.getElementById("drawStatus").textContent = "Klicka på kartan för att starta — dubbelklicka för att avsluta";
  };

  document.getElementById("drawRectBtn").onclick = () => {
    new L.Draw.Rectangle(map, drawControl.options.draw.rectangle).enable();
    document.getElementById("drawStatus").textContent = "Klicka och dra för att rita ett område";
  };

  // Listen for drawn shape
  map.on(L.Draw.Event.CREATED, onDrawCreated);
}

function onDrawCreated(e) {
  window._lastDrawCreatedAt = Date.now();
  if (drawnItems) drawnItems.addLayer(e.layer);
  showSubdivisionConfirm(e.layer);
}

function showSubdivisionConfirm(layer) {
  // Rektangel och polygon har olika latlng-struktur; skydda area-beräkningen
  // så att ett fel inte hindrar hela panelen från att ritas.
  let area = null;
  try {
    const latlngs = layer.getLatLngs();
    const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    if (L.GeometryUtil && ring && ring.length >= 3) {
      area = L.GeometryUtil.geodesicArea(ring);
    }
  } catch (err) {
    console.warn("Kunde inte beräkna area:", err);
  }
  const areaText = area ? `Ca ${Math.round(area)} m²` : "";
  const propName = activeDrawFeature ? prettyName(activeDrawFeature) : "fastigheten";

  const panel = document.getElementById("panel");
  if (panel) {
    panel.innerHTML = `
      <button class="panel-close" id="closeConfirmBtn">✕</button>
      <div class="panel-eyebrow">Bekräfta intresse</div>
      <div class="panel-name" style="font-size:15px;">${propName}</div>
      <div style="margin:12px 0;padding:12px;background:#F0FDF4;border-radius:10px;font-size:13px;color:#166534;line-height:1.6;">
        <i class="ti ti-check" style="color:#16a34a;"></i> <strong>Område markerat</strong>${areaText ? ' — ' + areaText : ''}<br>
        Skicka ditt intresse till fastighetsägaren?
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>
          <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);display:block;margin-bottom:5px;">Meddelande (valfritt)</label>
          <textarea id="subdivisionMsg" class="input" placeholder="Berätta lite om ditt intresse..." style="min-height:70px;font-size:13px;"></textarea>
        </div>
        <button id="sendSubdivisionBtn" class="btn-primary" style="width:100%;justify-content:center;">
          <i class="ti ti-send"></i> Skicka intresse
        </button>
        <button id="redrawBtn" style="background:transparent;border:none;font-size:12px;color:var(--ink-muted);cursor:pointer;font-family:var(--font-body);">
          Rita om
        </button>
      </div>
    `;
  }

  document.getElementById("closeConfirmBtn").onclick = () => { stopDraw(); closePanel(); };

  document.getElementById("redrawBtn").onclick = () => {
    if (drawnItems) drawnItems.clearLayers();
    startDrawSubdivision(activeDrawFeature);
  };

  document.getElementById("sendSubdivisionBtn").onclick = () => {
    const msg = document.getElementById("subdivisionMsg").value.trim();
    sendSubdivisionInterest(activeDrawFeature, layer, msg);
  };
}

function sendSubdivisionInterest(feature, layer, message) {
  const pid = getParcelId(feature);
  const name = prettyName(feature);

  // Save to state
  const state = loadState();
  state.subdivisionInterests = state.subdivisionInterests || {};
  state.subdivisionInterests[pid] = {
    parcel: name,
    area: layer.toGeoJSON(),
    message,
    sentAt: new Date().toISOString(),
  };
  saveState(state);

  // Keep drawn area visible but styled as "sent"
  layer.setStyle({ color: "#16a34a", fillColor: "#16a34a", fillOpacity: 0.12, weight: 2 });

  stopDraw(false); // keep drawn layer

  const panel = document.getElementById("panel");
  if (panel) {
    panel.innerHTML = `
      <div style="text-align:center;padding:20px 16px;">
        <div style="width:48px;height:48px;border-radius:50%;background:#F0FDF4;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
          <i class="ti ti-check" style="font-size:24px;color:#16a34a;"></i>
        </div>
        <div style="font-size:16px;font-weight:700;letter-spacing:-.03em;color:var(--ink);margin-bottom:8px;">Intresse skickat!</div>
        <div style="font-size:13px;color:var(--ink-soft);line-height:1.6;margin-bottom:20px;">
          Fastighetsägaren av <strong>${name}</strong> ser ditt intresse för avstyckning. Det markerade området visas på kartan.
        </div>
        <button onclick="closePanel()" class="btn-primary" style="width:100%;justify-content:center;">Stäng</button>
      </div>
    `;
    panel.classList.remove("hidden");
  }

  toast("Intresse för avstyckning skickat!");
}

function stopDraw(clearLayers = true) {
  map.off(L.Draw.Event.CREATED, onDrawCreated);
  if (drawControl) { map.removeControl(drawControl); drawControl = null; }
  if (clearLayers && drawnItems) { drawnItems.remove(); drawnItems = null; }
  activeDrawFeature = null;
}

// =========================
// Panel
// =========================
function openPanel(html) {
  const panel = document.getElementById("panel");
  if (!panel) return;
  panel.innerHTML = '<div class="panel-handle"></div>' + html;
  panel.classList.remove("hidden");
  panel.scrollTop = 0;
}

function closePanel() {
  const panel = document.getElementById("panel");
  if (!panel) return;
  panel.classList.add("hidden");
  panel.innerHTML = "";
}

// =========================
// IMAGE UPLOAD (komprimerar till max 1280px JPEG — mobilfoton är 3-10 MB,
// localStorage rymmer bara ~5 MB totalt)
// =========================
function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Kunde inte läsa bilden"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Ogiltigt bildformat"));
      img.onload = () => {
        const MAX = 1280;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          const scale = MAX / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// =========================
// MOBILE BOTTOM TAB BAR
// =========================
function goTab(view) {
  if (view === "profile") {
    const session = loadSession();
    if (session?.email) { currentView = "dashboard"; render(); }
    else { openAuthModal("login"); }
    return;
  }
  currentView = view;
  render();
}

function mountBottomTabs(active) {
  const session = loadSession();
  const isLoggedIn = !!session?.email;
  const tabs = [
    { id: "welcome", icon: "ti-home",        label: "Hem" },
    { id: "map",     icon: "ti-map-2",       label: "Karta" },
    { id: "feed",    icon: "ti-layout-grid", label: "Utforska" },
    { id: "profile", icon: isLoggedIn ? "ti-user-check" : "ti-user", label: isLoggedIn ? "Min sida" : "Profil" },
  ];
  app.insertAdjacentHTML("beforeend", `
    <nav class="bottom-tabs">
      ${tabs.map(t => `
        <button class="bottom-tab ${active === t.id ? "active" : ""}" onclick="goTab('${t.id}')">
          <i class="ti ${t.icon}" aria-hidden="true"></i>
          <span>${t.label}</span>
        </button>
      `).join("")}
    </nav>
  `);
}

// Kända flerbostadshus/BRF:er i prototypen — ersätts av riktig fastighetsdata i Supabase.
// Intresse mot dessa gäller hela föreningen ("vill bo här"), inte en enskild ägare.
// =========================
// UPPLÅTELSEFORM — vem äger huset
//
// SKILD FRÅN BYGGNADSTYP, med avsikt. Byggnadstypen (villa/flerbostadshus)
// kommer från OSM och ändras nästan aldrig. Upplåtelseformen kommer från
// lagfaren ägare och ändras varje gång ett hus ombildas eller säljs. De ska
// därför kunna uppdateras oberoende av varandra — därav en egen fil.
//
// Den RIKTIGA källan är lagfaren ägare från Lantmäteriet, alternativt
// Bolagsverkets register bakvägen: en ekonomisk förening (org.nr på 7) som
// heter "Brf ..." och är skriven på adressen äger en bostadsrättsfastighet.
// Ett AB på samma plats är hyresfastighet. Tills den datan finns gäller
// enbart listan nedan — och det som INTE står här är okänt, inte BRF.
// =========================

const OWNERSHIP_FORMS = {
  BRF:        "brf",          // bostadsrättsförening äger fastigheten
  HYRES:      "hyresratt",    // privat hyresvärd
  ALLMANNYTTA:"allmannytta",  // kommunalt bostadsbolag
  SAMFALLD:   "samfalld",     // samfällighet, ägarlägenheter m.m.
};

// Manuellt verifierade fastigheter. Seed tills ägardata kopplas in.
// Fyll på med kommunala bolag först — de är få och täcker mycket.
const KNOWN_OWNERSHIP = {
  "HELSINGÖR 1": { form: OWNERSHIP_FORMS.ALLMANNYTTA, owner: "Helsingborgshem AB" },
};

// Förklassad ägardata, samma nyckel som types.json. Laddas separat och får
// saknas — appen ska fungera utan den, bara med mindre precision.
let STATIC_OWNERSHIP = { forms: {}, norm: {}, count: 0 };

const STATIC_OWNERSHIP_READY = (async () => {
  try {
    const res = await fetch("ownership.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const parcels = data.parcels || data.forms;
    if (!parcels || typeof parcels !== "object") throw new Error("oväntat format");
    STATIC_OWNERSHIP = { forms: parcels, norm: {}, count: Object.keys(parcels).length };
    for (const [k, v] of Object.entries(parcels)) {
      STATIC_OWNERSHIP.norm[normParcel(k)] = (typeof v === "string") ? { form: v } : v;
    }
    console.log(`[ifound] ✓ Ägardata laddad: ${STATIC_OWNERSHIP.count} fastigheter (genererad ${data.generated?.slice(0, 10)}).`);
    if (typeof redrawLayer === "function") redrawLayer();
    const panelEl = document.getElementById("panel");
    if (panelEl && !panelEl.classList.contains("hidden") && window._currentPanelFeature) {
      renderParcelPanel(window._currentPanelFeature);
    }
  } catch (err) {
    console.info(`[ifound] Ingen ägardata (${err.message}). Flerbostadshus visas som okänd upplåtelseform — det är korrekt beteende, inte ett fel.`);
  }
  return STATIC_OWNERSHIP;
})();

// Manuella rättelser — vinner över både cache och API. Hit läggs felklassningar
// vi upptäcker (t.ex. mittpunkts-spill från grannbyggnader).
const KNOWN_TYPE_OVERRIDES = {
  "MUSEET 1": "Kommersiell",
};

function normParcel(s) { return String(s).toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g, ""); }

// Förklassad statisk fil, genererad av tools/classify-offline.mjs.
// Laddas en gång vid start. Detta är den PRIMÄRA källan — Overpass i
// webbläsaren är bara reserv för fastigheter som saknas här.
let STATIC_TYPES = { types: {}, sources: {}, count: 0 };

// Ett löfte som allt typuppslag väntar på. Utan det hann panelen fråga efter
// en typ innan filen laddats, fick null, och drog igång ett Overpass-anrop
// helt i onödan — vilket är exakt vad konsolloggen visade.
const STATIC_TYPES_READY = (async () => {
  try {
    // Ingen force-cache. Filen uppdateras när klassificeringen körs om, och
    // force-cache gjorde att gamla data satt kvar i webbläsaren efter varje
    // uppdatering. no-cache låter webbläsaren fråga servern om filen ändrats.
    const res = await fetch("types.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data.types || typeof data.types !== "object") throw new Error("oväntat format");
    STATIC_TYPES = { types: data.types, sources: data.sources || {}, count: Object.keys(data.types).length };

    // Normaliserat register så BRITA 1 matchar "BRITA1", "Brita 1" osv.
    STATIC_TYPES.norm = {};
    for (const [k, v] of Object.entries(data.types)) STATIC_TYPES.norm[normParcel(k)] = v;
    STATIC_TYPES.normSrc = {};
    for (const [k, v] of Object.entries(STATIC_TYPES.sources)) STATIC_TYPES.normSrc[normParcel(k)] = v;

    console.log(`[ifound] ✓ Förklassad typdata laddad: ${STATIC_TYPES.count} fastigheter (genererad ${data.generated?.slice(0, 10)}). Overpass behövs inte.`);
    if (typeof redrawLayer === "function") redrawLayer();
  } catch (err) {
    console.warn(`[ifound] ✗ types.json kunde inte laddas (${err.message}). Ligger filen bredvid index.html?`);
  }
  return STATIC_TYPES;
})();

function getKnownType(pid) {
  const n = normParcel(pid);
  for (const [k, v] of Object.entries(KNOWN_TYPE_OVERRIDES)) {
    if (normParcel(k) === n) return v;
  }
  // Användarrättelser vinner över automatisk klassning
  const st = loadState();
  if (st.typeCorrections?.[pid]) return st.typeCorrections[pid];
  if (st.buildingTypes?.[pid]) return st.buildingTypes[pid];
  return STATIC_TYPES.norm?.[n] || STATIC_TYPES.types?.[pid] || null;
}

// Hur säker är typen? "manuell" och "byggnad" visas rakt av,
// "indikation" och "område" visas med förbehåll.
function getTypeSource(pid) {
  const st = loadState();
  const n = normParcel(pid);
  if (Object.keys(KNOWN_TYPE_OVERRIDES).some(k => normParcel(k) === n)) return TYPE_SOURCE.MANUAL;
  if (st.typeCorrections?.[pid]) return TYPE_SOURCE.MANUAL;
  return st.typeSources?.[pid] || STATIC_TYPES.normSrc?.[n] || null;
}

// Användaren rättar typen. Detta är inte bara en UI-finess — rättelserna är
// utsädet till riktig typdata när Supabase kopplas in, och de kommer från de
// personer som faktiskt känner till fastigheten.
function setTypeCorrection(pid, type, name) {
  const st = loadState();
  st.typeCorrections = st.typeCorrections || {};
  if (type) st.typeCorrections[pid] = type; else { delete st.typeCorrections[pid]; _typeLookupDone.delete(pid); }
  saveState(st);
  closeTypePicker();
  toast(type ? `Tack! ${name} är nu märkt som ${type.toLowerCase()}.` : "Rättelsen är borttagen.");
  if (window._currentPanelFeature) renderParcelPanel(window._currentPanelFeature);
}

function openTypePicker(pid, name) {
  const existing = document.getElementById("type-picker-overlay");
  if (existing) existing.remove();
  const current = getKnownType(pid);
  const options = Object.values(PROPERTY_TYPES);

  const overlay = document.createElement("div");
  overlay.id = "type-picker-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(31,42,22,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:18px;padding:24px;width:100%;max-width:380px;font-family:var(--font-body);box-shadow:0 24px 64px rgba(0,0,0,.2);">
      <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--ink);margin-bottom:5px;">Vad är det här för fastighet?</div>
      <div style="font-size:13px;color:var(--ink-soft);line-height:1.6;margin-bottom:16px;">
        Vi gissar utifrån öppna kartdata, och ibland blir det fel. Känner du till ${name} får du gärna rätta oss.
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;">
        ${options.map(o => `
          <button onclick="setTypeCorrection('${pid.replace(/'/g,"\\'")}','${o}','${name.replace(/'/g,"\\'")}')"
            style="width:100%;text-align:left;padding:12px 14px;border-radius:10px;cursor:pointer;font-family:var(--font-body);font-size:13.5px;font-weight:${o===current?'600':'500'};
            background:${o===current?'var(--green-100)':'var(--surface-2)'};color:${o===current?'var(--green-800)':'var(--ink)'};
            border:1px solid ${o===current?'var(--green-600)':'transparent'};">
            ${o}${o===current?' <span style="float:right;">✓</span>':''}
          </button>
        `).join("")}
      </div>
      <button onclick="closeTypePicker()" style="width:100%;margin-top:12px;padding:11px;border-radius:10px;border:0.5px solid var(--hairline);background:transparent;color:var(--ink-soft);font-size:13px;font-family:var(--font-body);cursor:pointer;">Avbryt</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeTypePicker(); });
}

function closeTypePicker() {
  const el = document.getElementById("type-picker-overlay");
  if (el) el.remove();
}

// Upplåtelseform för en fastighet, eller null när vi inte vet.
// VI GISSAR ALDRIG utifrån byggnadstyp. Ett flerbostadshus kan lika gärna
// vara en hyresfastighet, och att kalla en hyresvärds hus för
// bostadsrättsförening är fel på ett sätt användaren märker direkt.
function getOwnershipForm(pid) {
  const n = normParcel(pid);
  for (const [k, v] of Object.entries(KNOWN_OWNERSHIP)) {
    if (normParcel(k) === n) return v.form || null;
  }
  const hit = STATIC_OWNERSHIP.norm?.[n];
  return hit?.form || null;
}

function getOwnerName(pid) {
  const n = normParcel(pid);
  for (const [k, v] of Object.entries(KNOWN_OWNERSHIP)) {
    if (normParcel(k) === n) return v.owner || null;
  }
  return STATIC_OWNERSHIP.norm?.[n]?.owner || null;
}

function isBrfParcel(pid) {
  return getOwnershipForm(pid) === OWNERSHIP_FORMS.BRF;
}

function isRentalParcel(pid) {
  const f = getOwnershipForm(pid);
  return f === OWNERSHIP_FORMS.HYRES || f === OWNERSHIP_FORMS.ALLMANNYTTA;
}

// Flerbostadshus oavsett upplåtelseform. Det är DENNA som ska styra sådant
// som gäller huset snarare än ägandet: att avstyckning inte är relevant, att
// intresse gäller hela huset, att statistiken heter "vill bo här".
function isMultiDwelling(pid) {
  return getKnownType(pid) === PROPERTY_TYPES.FLERBO;
}

// =========================
// BYGGNADSTYP — klassificering med fallback-kedja
//
// Källa i prototypen: OpenStreetMap. Den RIKTIGA källan är typkod från
// Fastighetstaxeringsregistret (220 småhusenhet, 320 hyreshusenhet,
// 800 specialenhet, 325 kontor/handel osv). Den är licensierad och kopplas
// in via Supabase — se TYPE_SOURCE nedan för hur data flaggas.
//
// Kedjan, i prioritetsordning:
//   1. Manuell rättelse (KNOWN_TYPE_OVERRIDES eller användarrättelse)
//   2. Starka OSM-taggar på byggnad (amenity/office/shop/building)
//   3. Svaga signaler (våningsantal, antal lägenheter, adresspunkter)
//   4. Omgivande markanvändning (landuse) — täcker building=yes och tomma tomter
//   5. "Obebyggd tomt" om ingen byggnad hittades men marken är känd
//   6. Okänd — visas som sådan, med möjlighet för användaren att rätta
// =========================

const PROPERTY_TYPES = {
  SMAHUS:   "Villa/Småhus",
  FLERBO:   "Flerbostadshus",
  SAMHALLE: "Samhällsfastighet",
  KOMMERS:  "Kommersiell",
  OBEBYGGD: "Obebyggd tomt",
};

// Hur säker klassningen är — styr om vi visar den rakt av eller med förbehåll.
const TYPE_SOURCE = { MANUAL: "manuell", STRONG: "byggnad", WEAK: "indikation", LANDUSE: "område", GRANNE: "grannskap" };

// Höj denna vid varje ändring i klassificeringslogiken — den ogiltigförklarar
// cachade resultat på alla enheter så att förbättringar faktiskt slår igenom.
const CLASSIFIER_VERSION = 5;

// Ort som ges företräde i sökningen. Sätt till null när kartdata täcker fler
// orter — sökningen fungerar i hela Sverige oavsett, detta styr bara vad som
// prioriteras vid tvetydiga sökningar ("Storgatan" finns i varje stad).
const SEARCH_BIAS = "Helsingborg";
const PREFETCH_FLAG = "ifound_osm_prefetch_ok_v" + CLASSIFIER_VERSION;

function classifyOsmTags(tagsList) {
  if (!tagsList || !tagsList.length) return null;

  const has = (fn) => tagsList.some(fn);
  const num = (t, k) => parseInt(t[k] || "", 10) || 0;

  // --- 2. Starka signaler ---------------------------------------------------
  // Samhällsfastighet: skola, vård, omsorg, myndighet. Prövas först eftersom
  // en skola ofta ÄVEN har building=yes och annars skulle bli feltolkad.
  const samhalleAmenity = ["school","kindergarten","childcare","university","college","hospital",
                           "clinic","doctors","nursing_home","social_facility","townhall","courthouse",
                           "police","fire_station","library","community_centre","place_of_worship",
                           "public_building","prison"];
  const samhalleBuilding = ["school","kindergarten","hospital","university","civic","government",
                            "public","church","chapel","fire_station","train_station"];
  if (has(t => samhalleAmenity.includes((t.amenity || "").toLowerCase())) ||
      has(t => samhalleBuilding.includes((t.building || "").toLowerCase())) ||
      has(t => t.healthcare || t.government)) {
    return { type: PROPERTY_TYPES.SAMHALLE, source: TYPE_SOURCE.STRONG };
  }

  const flerboBuilding = ["apartments","residential","dormitory","terrace"];
  if (has(t => flerboBuilding.includes((t.building || "").toLowerCase()))) {
    return { type: PROPERTY_TYPES.FLERBO, source: TYPE_SOURCE.STRONG };
  }

  const kommersBuilding = ["retail","commercial","office","industrial","warehouse","supermarket",
                           "kiosk","hotel","hangar","service"];
  if (has(t => kommersBuilding.includes((t.building || "").toLowerCase())) ||
      has(t => t.shop || t.office || t.craft || t.industrial) ||
      has(t => ["hotel","motel","hostel","guest_house"].includes((t.tourism || "").toLowerCase()))) {
    return { type: PROPERTY_TYPES.KOMMERS, source: TYPE_SOURCE.STRONG };
  }

  const smahusBuilding = ["house","detached","semidetached_house","bungalow","villa","farm",
                          "farmhouse","cabin","static_caravan","houseboat"];
  if (has(t => smahusBuilding.includes((t.building || "").toLowerCase()))) {
    return { type: PROPERTY_TYPES.SMAHUS, source: TYPE_SOURCE.STRONG };
  }

  // --- 3. Svaga signaler ----------------------------------------------------
  // Här fångas building=yes, som tidigare kastades bort helt.
  // Tre våningar eller fler, eller flera lägenheter, betyder i praktiken
  // flerbostadshus i svensk bebyggelse.
  if (has(t => num(t, "building:flats") >= 3)) {
    return { type: PROPERTY_TYPES.FLERBO, source: TYPE_SOURCE.WEAK };
  }
  if (has(t => num(t, "building:levels") >= 3)) {
    return { type: PROPERTY_TYPES.FLERBO, source: TYPE_SOURCE.WEAK };
  }
  // Många separata adresspunkter på samma tomt pekar också mot flerbostadshus
  const addrCount = tagsList.filter(t => t["addr:housenumber"]).length;
  if (addrCount >= 4) {
    return { type: PROPERTY_TYPES.FLERBO, source: TYPE_SOURCE.WEAK };
  }
  // building=yes med 1–2 våningar: nästan alltid småhus
  if (has(t => (t.building || "").toLowerCase() === "yes")) {
    const levels = Math.max(...tagsList.map(t => num(t, "building:levels")));
    if (levels > 0 && levels <= 2) {
      return { type: PROPERTY_TYPES.SMAHUS, source: TYPE_SOURCE.WEAK };
    }
  }
  // building=yes helt utan våningsuppgift är vanligast av allt i svensk OSM.
  // Den lämnas medvetet oklassad här så att markanvändning och grannskap får
  // avgöra — de källorna är bättre än en ren gissning.
  return null;
}

// --- 4. Markanvändning som sista utväg ------------------------------------
function classifyLanduse(tags) {
  const lu = (tags.landuse || "").toLowerCase();
  const am = (tags.amenity || "").toLowerCase();
  if (["school","kindergarten","hospital","university","college"].includes(am) ||
      ["religious","cemetery"].includes(lu)) {
    return { type: PROPERTY_TYPES.SAMHALLE, source: TYPE_SOURCE.LANDUSE };
  }
  if (["retail","commercial","industrial"].includes(lu)) {
    return { type: PROPERTY_TYPES.KOMMERS, source: TYPE_SOURCE.LANDUSE };
  }
  // landuse=residential säger BARA att området är bostäder — inte om det är
  // villor eller flerbostadshus. Helsingborgs centrum är residential rakt
  // igenom, och den här raden gjorde tidigare varje otaggat kvartershus till
  // en villa. Bostadsmark lämnas därför oklassad och får avgöras av
  // grannskapsomröstningen i stället.
  if (lu === "allotments") {
    return { type: PROPERTY_TYPES.SMAHUS, source: TYPE_SOURCE.LANDUSE };
  }
  return null;
}

// Bakåtkompatibel wrapper — äldre anrop förväntar sig bara en sträng
function classifyOsmBuildings(tagsList) {
  const r = classifyOsmTags(tagsList);
  return r ? r.type : null;
}

// Areabaserad bedömning. Fungerar HELT utan nätverk och är sista utvägen när
// OSM saknar användbara taggar. En bebyggd tomt på 200–3000 kvm i tätort är i
// svensk bebyggelse nästan undantagslöst ett småhus.
function areaToNumber(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}
function classifyByArea(areaM2, buildingCount, urban) {
  if (!areaM2) return null;
  if (buildingCount === 0) return null;          // tomt utan byggnad — inte vår gissning
  if (areaM2 < 150) return null;                 // för litet: garage, transformator, komplement

  // Stadskvarter: gissa ALDRIG villa. Tomterna i Helsingborgs centrum är
  // 200–1300 kvm med en till tre byggnadspunkter, alltså exakt samma profil
  // som en villatomt. Skillnaden syns bara på omgivningen. Utan den här
  // spärren blev MINERVA 32, DELFINEN 15, KULLEN VÄSTRA 50, MAGNUS STENBOCK 7
  // och JOHN ERICSSON 26 klassade som Villa/Småhus.
  if (urban) return null;

  // Taket sänkt från 3000 till 2000 kvm. Över det är en ensam byggnad i tätort
  // oftare något annat än ett småhus, och gissningen är inte värd felet.
  if (areaM2 <= 2000 && buildingCount <= 3) {
    return { type: PROPERTY_TYPES.SMAHUS, source: TYPE_SOURCE.WEAK };
  }
  return null;                                   // stort eller tätbebyggt: vågar inte gissa
}

// Ligger tomten i ett stadskvarter? Avgörs av vad grannarna redan klassats
// som via STARKA signaler. Ett par flerbostadshus eller kommersiella lokaler
// inom ett kvarters avstånd betyder att området inte är villabebyggelse.
// Ingen nätverkstrafik — allt räknas ur data vi redan har.
function isUrbanContext(c, classified) {
  // Grovt gradmått som i grannskapsomröstningen: ~90 m på denna breddgrad.
  const R2 = 0.0010 ** 2;
  let near = 0, urbanHits = 0;
  for (const o of classified) {
    const d = (o.c[0] - c[0]) ** 2 + (o.c[1] - c[1]) ** 2;
    if (d > R2) continue;
    near++;
    if (o.type === PROPERTY_TYPES.FLERBO || o.type === PROPERTY_TYPES.KOMMERS) urbanHits++;
  }
  return urbanHits >= 2 || (near >= 6 && urbanHits >= 1);
}

// Tomtens mittpunkt (räcker för att testa mot markanvändningspolygoner)
function parcelCentroid(feature) {
  const g = feature?.geometry;
  const coords = g?.type === "Polygon" ? g.coordinates[0]
               : g?.type === "MultiPolygon" ? g.coordinates[0][0] : null;
  if (!coords || !coords.length) return null;
  let x = 0, y = 0;
  for (const c of coords) { x += c[0]; y += c[1]; }
  return [x / coords.length, y / coords.length];
}

const _pendingTypeLookups = {};
// Tomter vi redan försökt slå upp — spärr mot upprepade omrenderingar
const _typeLookupDone = new Set();

// Delad Overpass-hämtning: spegeln först (overpass-api.de är onåbar från vissa nät),
// snabb timeout (6s) så döda servrar inte hänger.
let _overpassFailures = 0;
let _overpassGivenUp = false;
async function overpassFetch(query, timeoutMs = 6000) {
  if (_overpassFailures >= 2) return null; // Overpass onåbar från detta nät — sluta försöka denna session
  const endpoints = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];
  for (const url of endpoints) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) { console.warn("[ifound] Overpass svarade", res.status, "från", url); continue; }
      _overpassFailures = 0; // en server svarar — nollställ
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      console.warn("[ifound] Overpass-anrop misslyckades mot", url, e.name === "AbortError" ? `(timeout ${timeoutMs/1000}s)` : e);
    }
  }
  _overpassFailures++;
  if (_overpassFailures >= 2 && !_overpassGivenUp) {
    _overpassGivenUp = true;
    console.warn("[ifound] Overpass onåbar från webbläsaren (CORS/timeout) — typuppslag avstängda för sessionen. Kör tools/classify-offline.mjs och lägg types.json bredvid index.html.");
  }
  return null;
}

// Punkt-i-polygon (ray casting) för att matcha byggnaders mittpunkt mot tomter
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function featureContainsPoint(feature, lon, lat) {
  const g = feature?.geometry;
  if (!g) return false;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.some(p => p[0] && pointInRing(lon, lat, p[0]));
}

// =========================
// ENGÅNGS-FÖRKLASSNING: en enda stor Overpass-fråga för HELA kartområdet,
// körs en gång per enhet i bakgrunden (25s timeout — ingen väntar på den).
// Lyckas den är varje tomt klassad för alltid. Detta är prototypversionen av
// den riktiga lösningen: förberäknad data i Supabase.
// =========================
let _prefetchBusy = false;
let _prefetchAttempts = 0;
async function prefetchBuildingTypesInView() {
  if (!lastGeoJson || _prefetchBusy) return;
  // Versionerad flagga: höj CLASSIFIER_VERSION när klassificeringslogiken ändras,
  // annars kör befintliga enheter aldrig om och sitter kvar på gamla resultat.
  if (localStorage.getItem(PREFETCH_FLAG)) return; // redan klart med denna logikversion

  // Har vi förklassad data behövs ingen Overpass-körning alls.
  await STATIC_TYPES_READY;
  if (STATIC_TYPES.count > 0) {
    console.log("[ifound] Statisk typdata finns — hoppar över Overpass-klassning.");
    return;
  }
  if (_prefetchAttempts >= 3) return; // ge upp för sessionen — Overpass onåbar från detta nät
  const lastTry = parseInt(localStorage.getItem("ifound_osm_prefetch_at") || "0", 10);
  if (Date.now() - lastTry < 120000) return; // max ett försök per 2 min
  localStorage.setItem("ifound_osm_prefetch_at", String(Date.now()));
  _prefetchAttempts++;
  _prefetchBusy = true;

  try {
    // Bbox över hela det laddade tomtlagret
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const f of (lastGeoJson.features || [])) {
      const coords = f?.geometry?.type === "Polygon" ? f.geometry.coordinates[0]
                   : f?.geometry?.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : null;
      if (!coords) continue;
      for (const c of coords) {
        if (c[0] < minLon) minLon = c[0]; if (c[0] > maxLon) maxLon = c[0];
        if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
      }
    }
    if (!isFinite(minLon)) return;
    const bbox = [minLat, minLon, maxLat, maxLon].join(",");

    console.log("[ifound] Engångsklassning av hela området startar (kan ta upp till 30s i bakgrunden)...");
    const query = `[out:json][timeout:25];(way["building"](${bbox});relation["building"](${bbox}););out center tags;`;
    const data = await overpassFetch(query, 30000);
    if (!data) { console.warn("[ifound] Engångsklassning misslyckades — nytt försök om 2 min"); return; }

    // ALLA taggar behålls, inklusive building=yes. Tidigare filtrerades yes bort,
    // vilket är den vanligaste taggen i svensk OSM — det var därför de flesta
    // fastigheter aldrig fick någon typ.
    const buildings = (data.elements || [])
      .map(e => ({ lon: e.center?.lon, lat: e.center?.lat, tags: e.tags || {} }))
      .filter(x => x.lon && x.lat && x.tags.building);
    const buildingsOk = buildings.length > 0;
    console.log("[ifound]", buildings.length, "byggnader hämtade för hela området");

    // Markanvändning som fallback för tomter utan användbar byggnadstagg.
    // Betydligt färre objekt än byggnader, så full geometri är rimligt här.
    let landuse = [];
    const luQuery = `[out:json][timeout:25];(way["landuse"](${bbox});way["amenity"~"^(school|kindergarten|hospital|university|college)$"](${bbox}););out geom tags;`;
    const luData = await overpassFetch(luQuery, 30000);
    if (luData) {
      landuse = (luData.elements || [])
        .filter(e => e.geometry && e.geometry.length > 2)
        .map(e => ({ tags: e.tags || {}, ring: e.geometry.map(g => [g.lon, g.lat]) }));
      console.log("[ifound]", landuse.length, "markanvändningsområden hämtade");
    }
    if (!buildings.length && !landuse.length) return;

    const s = loadState();
    s.buildingTypes = s.buildingTypes || {};
    let updated = 0;
    // Areagissningen skjuts upp till EFTER grannskapsomröstningen. Tidigare
    // skrev den in "Villa/Småhus" direkt, vilket gjorde tomten klassad — och
    // omröstningen hoppar över redan klassade tomter. Den svagaste signalen
    // i kedjan hann alltså blockera den näst starkaste.
    const areaCandidates = [];

    for (const f of (lastGeoJson.features || [])) {
      const pid = getParcelId(f);
      if (s.buildingTypes[pid]) continue;
      const coords = f?.geometry?.type === "Polygon" ? f.geometry.coordinates[0]
                   : f?.geometry?.type === "MultiPolygon" ? f.geometry.coordinates[0][0] : null;
      if (!coords) continue;
      let fMinLon = Infinity, fMaxLon = -Infinity, fMinLat = Infinity, fMaxLat = -Infinity;
      for (const c of coords) {
        if (c[0] < fMinLon) fMinLon = c[0]; if (c[0] > fMaxLon) fMaxLon = c[0];
        if (c[1] < fMinLat) fMinLat = c[1]; if (c[1] > fMaxLat) fMaxLat = c[1];
      }
      const inParcel = buildings.filter(bd =>
        bd.lon >= fMinLon && bd.lon <= fMaxLon && bd.lat >= fMinLat && bd.lat <= fMaxLat &&
        featureContainsPoint(f, bd.lon, bd.lat)
      );

      let result = inParcel.length ? classifyOsmTags(inParcel.map(bd => bd.tags)) : null;

      // Fallback: vilken markanvändning ligger tomtens mittpunkt i?
      if (!result) {
        const c = parcelCentroid(f);
        if (c) {
          const hit = landuse.find(lu => pointInRing(c[0], c[1], lu.ring));
          if (hit) result = classifyLanduse(hit.tags);
        }
      }

      // Areabaserad bedömning sparas till sist — se kommentaren vid
      // areaCandidates. Här registreras bara att tomten är en kandidat.
      if (!result && inParcel.length) {
        const a = areaToNumber(getParcelMeta(f)?.area);
        if (a) areaCandidates.push({ pid, f, area: a, count: inParcel.length });
      }

      // Ingen byggnad alls är i sig ett svar — men BARA om byggnadsfrågan
      // faktiskt lyckades. Annars skulle ett nätverksfel märka hela kartan
      // som obebyggd, vilket är sämre än att inte veta.
      if (!result && !inParcel.length && buildingsOk) {
        result = { type: PROPERTY_TYPES.OBEBYGGD, source: TYPE_SOURCE.LANDUSE };
      }

      if (result) {
        s.buildingTypes[pid] = result.type;
        s.typeSources = s.typeSources || {};
        s.typeSources[pid] = result.source;
        updated++;
      }
    }

    // --- 5. Grannskapsomröstning ------------------------------------------
    // building=yes utan våningsuppgift är den vanligaste taggen i svensk OSM och
    // säger ingenting i sig. Men en oklassad tomt omgiven av småhus ÄR i praktiken
    // ett småhus. Vi röstar utifrån de närmaste klassade grannarna.
    const classified = [];
    for (const f of (lastGeoJson.features || [])) {
      const pid = getParcelId(f);
      const t = s.buildingTypes[pid];
      if (!t || t === PROPERTY_TYPES.OBEBYGGD) continue;
      const c = parcelCentroid(f);
      if (c) classified.push({ c, type: t });
    }

    let voted = 0;
    if (classified.length > 1500) console.log("[ifound] Hoppar över grannskapsomröstning —", classified.length, "klassade fastigheter är för många för att rösta synkront.");
    // O(n²) — med tusentals fastigheter låser den fliken helt. Vi kör den
    // bara när mängden är hanterbar; annars räcker de andra stegen.
    const VOTE_LIMIT = 1500;
    if (classified.length >= 8 && classified.length <= VOTE_LIMIT) {
      for (const f of (lastGeoJson.features || [])) {
        const pid = getParcelId(f);
        if (s.buildingTypes[pid]) continue;
        const c = parcelCentroid(f);
        if (!c) continue;

        // Endast grannar inom ~300 m får rösta. Utan denna spärr hämtade
        // omröstningen röster från flerbostadshus flera kvarter bort, vilket
        // gjorde den verkningslös i just villaområden.
        const MAX_D2 = 0.0035 ** 2; // ~300 m i grader på denna breddgrad
        const near = classified
          .map(o => ({ type: o.type, d: (o.c[0]-c[0])**2 + (o.c[1]-c[1])**2 }))
          .filter(o => o.d <= MAX_D2)
          .sort((a, b) => a.d - b.d)
          .slice(0, 8);
        if (near.length < 4) continue;

        const votes = {};
        for (const n of near) votes[n.type] = (votes[n.type] || 0) + 1;
        const [winner, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];

        // Krav på tydlig majoritet (minst 70%) — annars är området blandat
        if (count / near.length >= 0.7) {
          s.buildingTypes[pid] = winner;
          s.typeSources = s.typeSources || {};
          s.typeSources[pid] = TYPE_SOURCE.GRANNE;
          voted++;
        }
      }
    }

    // --- 6. Areagissning, allra sist och bara utanför stadskvarter ---------
    let byArea = 0, urbanSkipped = 0;
    for (const cand of areaCandidates) {
      if (s.buildingTypes[cand.pid]) continue;      // omröstningen hann före — bra
      const c = parcelCentroid(cand.f);
      const urban = c ? isUrbanContext(c, classified) : false;
      const result = classifyByArea(cand.area, cand.count, urban);
      if (result) {
        s.buildingTypes[cand.pid] = result.type;
        s.typeSources = s.typeSources || {};
        s.typeSources[cand.pid] = result.source;
        byArea++;
      } else if (urban) {
        urbanSkipped++;                              // lämnas okänd — användaren kan rätta
      }
    }

    saveState(s);
    localStorage.setItem(PREFETCH_FLAG, "1");
    console.log(`[ifound] Klart! ${updated} klassade från kartdata, ${voted} via grannskap, ${byArea} via area. ${urbanSkipped} tomter i stadskvarter lämnades okända i stället för att gissas till villa. Logikversion ${CLASSIFIER_VERSION}.`);

    // Uppdatera öppen panel om dess tomt just fick en klassning
    const panelEl = document.getElementById("panel");
    if (panelEl && !panelEl.classList.contains("hidden") && window._currentPanelFeature) {
      const openPid = getParcelId(window._currentPanelFeature);
      if (s.buildingTypes[openPid]) renderParcelPanel(window._currentPanelFeature);
    }
  } finally {
    _prefetchBusy = false;
  }
}

async function detectBuildingType(feature, pid) {
  // Vänta in den statiska filen först. Finns typen där behövs inget nätverk.
  await STATIC_TYPES_READY;
  if (STATIC_TYPES.count > 0) {
    return getKnownType(pid);   // saknas den i filen har vi ändå inget bättre svar
  }
  const state = loadState();
  const cached = (state.buildingTypes || {})[pid];
  if (cached) return cached; // bara lyckade klassningar är slutgiltiga — null försöks om
  if (_pendingTypeLookups[pid]) return _pendingTypeLookups[pid]; // uppslag pågår redan

  const lookup = (async () => {
    try {
      // Bygg bbox från tomtens polygon
      const coords = feature?.geometry?.type === "Polygon" ? feature.geometry.coordinates[0]
                   : feature?.geometry?.type === "MultiPolygon" ? feature.geometry.coordinates[0][0]
                   : null;
      if (!coords || coords.length < 3) return null;
      const lons = coords.map(c => c[0]), lats = coords.map(c => c[1]);
      const bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)].join(",");

      const query = `[out:json][timeout:10];(way["building"](${bbox});relation["building"](${bbox}););out tags 20;`;
      console.log("[ifound] OSM-uppslag för", pid, "bbox:", bbox);

      const data = await overpassFetch(query);
      if (!data) return null;

      const tagsList = (data.elements || []).map(e => e.tags || {});
      console.log("[ifound] OSM-byggnader på", pid, ":", tagsList.map(t => t.building));
      const res = classifyOsmTags(tagsList);
      const type = res ? res.type : null;
      if (res) {
        const st = loadState();
        st.typeSources = st.typeSources || {};
        st.typeSources[pid] = res.source;
        saveState(st);
      }
      console.log("[ifound] Klassning för", pid, "→", type);

      if (type) {
        const s = loadState();
        s.buildingTypes = s.buildingTypes || {};
        s.buildingTypes[pid] = type;
        saveState(s);
      }
      return type;
    } catch (err) {
      console.warn("[ifound] Kunde inte hämta byggnadstyp:", err);
      return null;
    } finally {
      delete _pendingTypeLookups[pid];
    }
  })();

  _pendingTypeLookups[pid] = lookup;
  return lookup;
}

function renderParcelPanel(feature) {
  // Skydd mot renderingsloop. Anropar något i panelen renderParcelPanel igen
  // medan den redan renderar, avbryts det andra anropet i stället för att
  // låsa fliken. Räknaren nollställs alltid i finally.
  if (_panelRenderDepth > 0) {
    console.warn("[ifound] renderParcelPanel anropade sig själv — avbryter för att undvika loop.");
    return;
  }
  _panelRenderDepth++;
  try {
  return _renderParcelPanelInner(feature);
  } finally { _panelRenderDepth--; }
}

let _panelRenderDepth = 0;

function _renderParcelPanelInner(feature) {
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
  const iFollow = !!state.myFollows?.[pid];
  // TVÅ SKILDA FRÅGOR, med avsikt hållna isär:
  //   isMulti — är det ett flerbostadshus? styr vad som är relevant för HUSET
  //   ownForm — vem äger det? styr vad vi vågar PÅSTÅ om ägandet
  // Att blanda ihop dem gjorde att Helsingborgshems hyresfastighet
  // presenterades som bostadsrättsförening.
  const isMulti = isMultiDwelling(pid);
  const ownForm = getOwnershipForm(pid);
  const isBrf = ownForm === OWNERSHIP_FORMS.BRF;
  const isRental = isRentalParcel(pid);
  const ownerName = getOwnerName(pid);

  // Etikett som bara säger så mycket som vi faktiskt vet.
  const formLabel = isBrf ? "Bostadsrättsförening"
                  : isRental ? "Hyresfastighet"
                  : isMulti ? "Flerbostadshus"
                  : "Besökarläge";

  rememberParcelName(pid, name);

  const detectedType = getKnownType(pid);
  // Typraden ska ALDRIG vara tom. Vet vi inte säger vi det, och ber om hjälp.
  const rawTyp = detectedType || (meta.typ && meta.typ !== "-" ? meta.typ : null);
  const typValue = ownForm ? PROPERTY_TYPES.FLERBO : rawTyp;
  const typSource = ownForm ? TYPE_SOURCE.MANUAL : getTypeSource(pid);
  const uncertain = typValue && [TYPE_SOURCE.WEAK, TYPE_SOURCE.LANDUSE, TYPE_SOURCE.GRANNE].includes(typSource);
  const escName = String(name).replace(/'/g, "\\'");

  const typCell = typValue
    ? `<strong id="parcelTypeValue" style="display:inline-flex;align-items:center;gap:5px;">
         ${typValue}${uncertain ? '<i class="ti ti-help-circle" title="Uppskattad utifrån kartdata" style="font-size:13px;color:var(--ink-muted);"></i>' : ''}
       </strong>`
    : `<button onclick="openTypePicker('${pid.replace(/'/g, "\\'")}','${escName}')"
         style="background:none;border:none;padding:0;cursor:pointer;font-family:var(--font-body);font-size:13px;font-weight:600;color:var(--green-600);text-decoration:underline;">
         Okänd — hjälp oss?
       </button>`;

  const metaRows = `
    <div class="panel-meta-row"><span>Beteckning</span><strong>${formatValue(meta.beteckning)}</strong></div>
    <div class="panel-meta-row"><span>Typ</span>${typCell}</div>
    <div class="panel-meta-row"><span>Area</span><strong>${formatValue(meta.area)}</strong></div>

    ${typValue ? `<div style="text-align:right;padding:5px 2px 0;">
      <button onclick="openTypePicker('${pid.replace(/'/g, "\\'")}','${escName}')"
        style="background:none;border:none;padding:2px;cursor:pointer;font-family:var(--font-body);font-size:11px;color:var(--ink-muted);text-decoration:underline;">
        ${uncertain ? "Stämmer inte typen?" : "Rätta typen"}
      </button>
    </div>` : ''}
  `;

  // Hämta byggnadstyp från OSM i bakgrunden om okänd; rendera om ifall panelen fortfarande visar samma tomt
  window._currentPanelPid = pid;
  window._currentPanelFeature = feature;
  // Kolla mot getKnownType, inte bara den lokala cachen. Annars ansågs typen
  // saknas trots att den fanns i types.json, uppslaget svarade synkront, och
  // panelen renderade om sig i all oändlighet.
  if (!ownForm && !typValue && !_typeLookupDone.has(pid)) {
    _typeLookupDone.add(pid);   // en gång per tomt och session — aldrig en loop
    detectBuildingType(feature, pid).then(type => {
      if (!type) return;
      if (window._currentPanelPid !== pid) return; // användaren har klickat vidare
      const panelEl = document.getElementById("panel");
      if (panelEl && !panelEl.classList.contains("hidden")) renderParcelPanel(feature);
    });
  }

  const statsHtml = `
    <div class="panel-stats">
      <div class="panel-stat"><div class="panel-stat-value">${likes}</div><div class="panel-stat-label">Gillar</div></div>
      <div class="panel-stat"><div class="panel-stat-value">${interests}</div><div class="panel-stat-label">${isMulti ? "Vill bo här" : "Intresserade"}</div></div>
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
      const s = loadState();
      s.ownerParcelId = pid;
      s.parcelNames = s.parcelNames || {};
      s.parcelNames[pid] = name;
      // Store centroid for marker placement
      try {
        const coords = feature?.geometry?.coordinates?.[0] || [];
        if (coords.length) {
          const lons = coords.map(p => p[0]);
          const lats = coords.map(p => p[1]);
          s.ownerLon = lons.reduce((a,b)=>a+b,0)/lons.length;
          s.ownerLat = lats.reduce((a,b)=>a+b,0)/lats.length;
        }
      } catch {}
      saveState(s);
      toast("Fastigheten kopplad till ditt konto.");
      redrawLayer();
      addClaimedMarkers();
      renderParcelPanel(feature);
    };
    document.getElementById("closePanelBtn").onclick = closePanel;
    return;
  }

  // Find image from CLAIMED_PROPS or PROP_DATA
  const claimedProp = CLAIMED_PROPS.find(p => {
    const pNorm = p.id.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'');
    const nNorm = pid.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'');
    return pNorm === nNorm || p.name.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'') === nNorm;
  });
  const panelImg = claimedProp?.img || null;

  // FOMO-teaser: fastigheten har aktivitet men är inte claimad — visa det, och gör claim till nyckeln.
  const isClaimed = !!claimedProp || isOwner;
  const hasActivity = likes > 0 || interests > 0;
  const teaserHtml = (!isClaimed && hasActivity) ? `
    <div style="margin-bottom:12px;padding:12px 14px;background:var(--accent-soft);border:0.5px solid rgba(204,41,54,.25);border-radius:11px;">
      <div style="font-size:13px;font-weight:600;color:var(--accent);line-height:1.5;">
        <i class="ti ti-flame" style="font-size:14px;" aria-hidden="true"></i>
        ${isMulti
          ? `${interests > 0 ? interests + " vill bo i det här huset" : likes + " har gillat den här fastigheten"}`
          : `${likes > 0 ? likes + " har gillat den här fastigheten" : interests + " har visat intresse"}`}
      </div>
      <div style="font-size:12px;color:#9A2530;margin-top:3px;line-height:1.5;">
        ${isBrf ? "Sitter du i styrelsen? Föreningen äger fastigheten och kan claima den — enskilda medlemmar kan inte."
         : isRental ? "Äger du fastigheten? Claima och se intresset — och få en notis när det kommer nya."
         : isMulti ? "Äger du fastigheten? Claima och se intresset — och få en notis när det kommer nya."
         : "Är det din? Claima och se vilka — och få en notis när någon ny gillar."}
      </div>
      <button id="teaserClaimBtn" style="margin-top:9px;width:100%;padding:8px;border-radius:8px;background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);">
        Claima fastigheten
      </button>
    </div>
  ` : '';

  // Vykort: bara relevant när du visat intresse OCH ägaren inte redan finns på ifound.
  // Är fastigheten claimad får ägaren notisen i appen och behöver inget brev.
  const pcStatus = getPostcardStatus(pid);
  const postcardHtml = (iInterested && !isClaimed) ? (
    pcStatus.sent ? `
      <div style="margin-top:8px;padding:11px 13px;background:#F0FDF4;border:0.5px solid rgba(22,163,74,.25);border-radius:11px;display:flex;gap:9px;align-items:flex-start;">
        <i class="ti ti-mail-check" style="font-size:16px;color:#16a34a;flex-shrink:0;margin-top:1px;" aria-hidden="true"></i>
        <div>
          <div style="font-size:12px;font-weight:600;color:#15803d;">Vykort skickat till ägaren</div>
          <div style="font-size:11px;color:#4b5563;margin-top:2px;line-height:1.5;">Vi meddelar dig om ägaren claimar fastigheten.</div>
        </div>
      </div>
    ` : `
      <div style="margin-top:10px;padding:12px 13px;background:var(--honey-soft);border:0.5px solid rgba(194,98,42,.30);border-radius:11px;">
        <div style="font-size:12px;font-weight:600;color:var(--accent-text);line-height:1.5;">
          <i class="ti ti-alert-circle" style="font-size:13px;" aria-hidden="true"></i>
          Ägaren vet inte om ditt intresse ännu
        </div>
        <div style="font-size:11px;color:#9A6B45;margin-top:3px;line-height:1.5;">
          Fastigheten är inte claimad på ifound. Vi kan skicka ett vykort hem till ägaren och berätta att du finns.
        </div>
        <button id="postcardBtn" style="margin-top:9px;width:100%;padding:9px;border-radius:8px;background:var(--accent);color:#fff;border:none;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);display:flex;align-items:center;justify-content:center;gap:6px;">
          <i class="ti ti-mail-fast" style="font-size:14px;" aria-hidden="true"></i> Uppmärksamma fastighetsägaren
        </button>
      </div>
    `
  ) : '';

  const myPhoto = getMyPhoto(pid);
  const headerImg = myPhoto || panelImg;

  openPanel(`
    <button class="panel-close" id="closePanelBtn">✕</button>
    ${headerImg ? `
      <div style="margin:-16px -16px 14px;height:150px;overflow:hidden;border-radius:14px 14px 0 0;position:relative;">
        <img src="${headerImg}" style="width:100%;height:100%;object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.45) 0%,transparent 58%);"></div>
        <div style="position:absolute;bottom:10px;left:14px;">
          <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,.75);text-transform:uppercase;letter-spacing:.08em;">${myPhoto ? "Din bild" : formLabel}</div>
          <div style="font-size:16px;font-weight:700;color:#fff;letter-spacing:-.03em;">${name}</div>
        </div>
        ${myPhoto ? `<button onclick="removeMyPhoto('${escName}'); if(window._currentPanelFeature) renderParcelPanel(window._currentPanelFeature);" title="Ta bort din bild" style="position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;border:none;background:rgba(0,0,0,.45);color:#fff;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);"><i class="ti ti-trash"></i></button>` : ""}
      </div>
    ` : `
      <div class="panel-eyebrow">${formLabel}</div>
      <div class="panel-name">${name}</div>
    `}
    <div class="panel-mode">${isBrf ? "Gilla och intresse gäller hela föreningen." : isRental ? `Hyresfastighet${ownerName ? " — " + ownerName : ""}. Intresse gäller hela huset.` : isMulti ? "Flerbostadshus — intresse gäller hela huset." : "Spara intresse och följ objektet."}</div>
    ${(() => {
      const wp = (state.wishPrices || {})[pid];
      if (!wp?.amount) return "";
      const own = state.ownerParcelId === pid;
      if (!wp.visible && !own) return "";
      return `
      <div class="wish-banner ${own && !wp.visible ? "wish-banner-private" : ""}">
        <div>
          <div class="wish-banner-label">${own && !wp.visible ? "Ditt önskepris (privat)" : "Ägarens önskepris"}</div>
          <div class="wish-banner-amount">${wp.amount} kr</div>
        </div>
        <i class="ti ${own && !wp.visible ? "ti-lock" : "ti-tag"}" aria-hidden="true"></i>
      </div>
      ${own ? "" : `<div class="wish-banner-note">Fastigheten är inte till salu — men ägaren har angett vad de skulle kunna tänka sig.</div>`}`;
    })()}
    ${teaserHtml}
    <div class="panel-meta">${metaRows}</div>
    <div class="panel-actions">
      <button id="likeBtn"     class="panel-btn ${iLiked      ? "active-like"     : ""}"><i class="ti ti-thumb-up"></i> ${iLiked ? "Gillad" : "Gilla"}</button>
      <button id="interestBtn" class="panel-btn ${iInterested ? "active-interest" : ""}"><i class="ti ti-star"></i> ${isMulti ? (iInterested ? "Intresseanmäld" : "Vill bo här") : (iInterested ? "Intresserad" : "Markera intresse")}</button>
    </div>
    <div style="margin-top:8px;">
      <button id="followBtn" class="panel-btn" style="width:100%;${iFollow ? 'background:var(--accent-soft);border-color:var(--accent);color:var(--accent);' : ''}">
        <i class="ti ${iFollow ? 'ti-bell-check' : 'ti-bell-plus'}"></i> ${iFollow ? "Följer — notis vid nytt" : "Följ fastigheten"}
      </button>
    </div>
    ${(iLiked || iInterested) && !myPhoto ? `
    <div style="margin-top:8px;">
      <input type="file" id="myPhotoInput" accept="image/*" capture="environment" style="display:none;" />
      <button id="myPhotoBtn" class="panel-btn" style="width:100%;border-style:dashed;">
        <i class="ti ti-camera"></i> Ta en bild att minnas huset med
      </button>
      <div style="text-align:center;margin-top:5px;font-size:11px;color:var(--ink-muted);line-height:1.5;">Sparas bara för dig — så du minns vad du fastnade för.</div>
    </div>` : ""}
    ${postcardHtml}
    ${isMulti ? '' : `
    <div style="margin-top:8px;">
      <button id="subdivisionBtn" class="panel-btn" style="width:100%;${state.subdivisionInterests?.[pid] ? 'background:#F0FDF4;border-color:#16a34a;color:#16a34a;' : ''}">
        <i class="ti ti-cut"></i> ${state.subdivisionInterests?.[pid] ? "Avstyckning — intresse skickat" : "Intresserad av att stycka av tomt"}
      </button>
      <div style="text-align:center;margin-top:6px;">
        <button onclick="navigate('buildNew')" style="background:none;border:none;padding:2px;font-size:11px;color:var(--ink-muted);cursor:pointer;font-family:var(--font-body);text-decoration:underline;">
          Vad krävs för att bygga? Läs guiden
        </button>
      </div>
    </div>`}
    ${statsHtml}
  `);

  if (document.getElementById("teaserClaimBtn")) {
    document.getElementById("teaserClaimBtn").onclick = () => {
      const session = loadSession();
      if (!session?.email) {
        openAuthModal('reg');
        toast("Skapa ett konto för att claima din fastighet.");
        return;
      }
      const sel = document.getElementById("modeSelect");
      if (sel) { sel.value = "owner"; saveMapMode("owner"); }
      renderParcelPanel(feature);
    };
  }

  const pcBtn = document.getElementById("postcardBtn");
  if (pcBtn) pcBtn.onclick = () => openPostcardModal(pid, name);

  const myPhotoBtn = document.getElementById("myPhotoBtn");
  const myPhotoInput = document.getElementById("myPhotoInput");
  if (myPhotoBtn && myPhotoInput) {
    myPhotoBtn.onclick = () => myPhotoInput.click();
    myPhotoInput.onchange = () => handleMyPhotoPick(pid, name, myPhotoInput);
  }

  document.getElementById("followBtn").onclick = () => {
    const session = loadSession();
    if (!session?.email) {
      openAuthModal('reg');
      toast("Skapa ett konto för att följa och få notiser.");
      return;
    }
    const s = loadState();
    s.myFollows = s.myFollows || {};
    s.parcelNames = s.parcelNames || {}; s.parcelNames[pid] = name;
    if (s.myFollows[pid]) {
      delete s.myFollows[pid];
      saveState(s);
      toast("Du följer inte längre " + name + ".");
    } else {
      s.myFollows[pid] = true;
      saveState(s);
      toast("Du följer nu " + name + " — du får en notis när något händer.");
    }
    renderParcelPanel(feature);
  };

  document.getElementById("likeBtn").onclick = () => {
    const s = loadState(); const already = !!s.myLikes?.[pid];
    s.myLikes = s.myLikes || {}; s.parcelNames = s.parcelNames || {}; s.parcelNames[pid] = name;
    if (already) { delete s.myLikes[pid]; s.likes[pid] = Math.max(0, (s.likes[pid] || 1) - 1); toast("Gillning borttagen."); }
    else { s.likes[pid] = (s.likes[pid] || 0) + 1; s.myLikes[pid] = true; toast("Fastigheten är gillad."); }
    saveState(s); redrawLayer(); renderParcelPanel(feature);
  };

  document.getElementById("interestBtn").onclick = () => {
    const s = loadState();
    if (s.myInterests?.[pid]) {
      // Already interested — toggle off
      delete s.myInterests[pid];
      s.interests[pid] = Math.max(0, (s.interests[pid] || 1) - 1);
      delete (s.interestMessages || {})[pid];
      saveState(s);
      toast("Intressemarkering borttagen.");
      redrawLayer();
      renderParcelPanel(feature);
    } else {
      // Open modal to add interest + optional message
      openInterestModal(feature, pid, name);
    }
  };

  const subBtn = document.getElementById("subdivisionBtn");
  if (subBtn) subBtn.onclick = () => {
    const s = loadState();
    if (s.subdivisionInterests?.[pid]) {
      toast("Du har redan skickat ett intresse för avstyckning av denna fastighet.");
      return;
    }
    closePanel();
    toast("Rita det område du är intresserad av på kartan.");
    setTimeout(() => startDrawSubdivision(feature), 200);
  };

  document.getElementById("closePanelBtn").onclick = closePanel;
}

// =========================
// WELCOME VIEW
// =========================

function switchTab(tab) {
  const isLogin = tab === 'login';
  const tLogin = document.getElementById('tabLogin');
  const tReg   = document.getElementById('tabReg');
  const fLogin = document.getElementById('loginForm');
  const fReg   = document.getElementById('regForm');
  if (!tLogin || !tReg || !fLogin || !fReg) return;
  const activeStyle  = 'flex:1;padding:9px;border-radius:8px;border:none;background:#fff;color:var(--ink);font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.08);';
  const passiveStyle = 'flex:1;padding:9px;border-radius:8px;border:none;background:transparent;color:var(--ink-soft);font-size:13px;font-weight:500;cursor:pointer;font-family:Inter,sans-serif;';
  tLogin.style.cssText = isLogin  ? activeStyle : passiveStyle;
  tReg.style.cssText   = !isLogin ? activeStyle : passiveStyle;
  fLogin.style.display = isLogin  ? 'flex' : 'none';
  fReg.style.display   = !isLogin ? 'flex' : 'none';
}

function openAuthModal(tab = 'login') {
  const existing = document.getElementById('auth-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'auth-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

  overlay.innerHTML = `
    <div class="auth-card" style="background:#fff;border-radius:20px;padding:28px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,.2);font-family:var(--font-body);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="16" height="20" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
          <span style="font-size:17px;font-weight:700;letter-spacing:-.04em;color:var(--ink);">i<em style="font-style:normal;color:var(--accent);">found</em></span>
        </div>
        <button onclick="closeAuthModal()" style="width:30px;height:30px;border-radius:50%;border:none;background:var(--surface-2);cursor:pointer;font-size:16px;color:var(--ink-soft);display:flex;align-items:center;justify-content:center;">✕</button>
      </div>

      <div style="display:flex;background:rgba(17,24,39,.06);border-radius:10px;padding:3px;margin-bottom:20px;">
        <button id="tabLogin" onclick="switchTab('login')" style="flex:1;padding:9px;border-radius:8px;border:none;background:#fff;color:var(--ink);font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.08);">Logga in</button>
        <button id="tabReg"   onclick="switchTab('reg')"   style="flex:1;padding:9px;border-radius:8px;border:none;background:transparent;color:var(--ink-soft);font-size:13px;font-weight:500;cursor:pointer;font-family:Inter,sans-serif;">Skapa konto</button>
      </div>

      <div id="loginForm" style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:#F0FDF4;border-radius:10px;padding:10px 14px;font-size:12px;color:#166534;line-height:1.5;">
          <strong>Logga in för att:</strong> spara gillar, skicka intresse, claima din fastighet.
        </div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:5px;">E-post</label><input id="loginEmail" class="input" type="email" placeholder="din@epost.se" style="width:100%;" /></div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:5px;">Lösenord</label><input id="loginPass" class="input" type="password" placeholder="••••••••" style="width:100%;" /></div>
        <button id="loginBtn" class="btn-primary" style="width:100%;justify-content:center;padding:12px;">Logga in</button>
        <div style="font-size:11px;color:var(--ink-muted);text-align:center;">Admin: admin@ifound.se / ifound2025</div>
      </div>

      <div id="regForm" style="display:none;flex-direction:column;gap:12px;">
        <div style="background:var(--accent-soft);border-radius:10px;padding:10px 14px;font-size:12px;color:#7F1D1D;line-height:1.5;">
          Gratis konto — spara dina favoriter och visa intresse för fastigheter.
        </div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:5px;">Namn</label><input id="regName" class="input" placeholder="Ditt namn" style="width:100%;" /></div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:5px;">E-post</label><input id="regEmail" class="input" type="email" placeholder="din@epost.se" style="width:100%;" /></div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:5px;">Lösenord</label><input id="regPass" class="input" type="password" placeholder="Min 4 tecken" style="width:100%;" /></div>
        <button id="regBtn" class="btn-primary" style="width:100%;justify-content:center;padding:12px;">Skapa gratis konto</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeAuthModal(); });

  if (tab === 'reg') switchTab('reg');

  document.getElementById("loginBtn").onclick = () => {
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("loginPass").value;
    const users = loadUsers();
    const user  = users[email];
    if (!user || user.password !== pass) { toast("Fel e-post eller lösenord."); return; }
    saveSession({ email }); closeAuthModal(); toast("Inloggad!");
    currentView = "feed"; render();
  };

  document.getElementById("regBtn").onclick = () => {
    const name  = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("regPass").value;
    if (!name || !email.includes("@") || pass.length < 4) { toast("Fyll i alla fält korrekt."); return; }
    const users = loadUsers();
    if (users[email]) { toast("Det finns redan ett konto på den e-posten."); return; }
    users[email] = { name, email, password: pass };
    saveUsers(users); saveSession({ email }); closeAuthModal();
    toast("Konto skapat — välkommen!");

    // Skickade de ett meddelande innan kontot fanns? Slutför det nu.
    const st = loadState();
    const pend = st.pendingInterest;
    if (pend) {
      delete st.pendingInterest; saveState(st);
      saveInterest(pend.pid, pend.name, pend.message);
    }

    // Landa på Min sida så välkomstflödet (rollvalet) visas direkt.
    currentView = "dashboard"; render();
  };
}

function closeAuthModal() {
  const overlay = document.getElementById('auth-modal-overlay');
  if (overlay) overlay.remove();
}



// =========================
// AREA SEARCH OVERLAY
// =========================
async function showAreaSearch(query) {
  // Show loading overlay
  const overlay = document.createElement('div');
  overlay.id = 'area-search-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9500;display:flex;flex-direction:column;background:var(--page-bg);font-family:"Inter",sans-serif;';

  overlay.innerHTML = `
    <div style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#fff;border-bottom:1px solid #EBEBEB;flex-shrink:0;">
      <button onclick="closeAreaSearch()" style="display:flex;align-items:center;gap:7px;background:transparent;border:none;font-size:13px;color:#666;cursor:pointer;font-family:var(--font-body);">
        <i class="ti ti-arrow-left" aria-hidden="true"></i> Tillbaka
      </button>
      <div style="font-size:14px;font-weight:600;color:var(--green-900);" id="areaTitle">Söker efter "${query}"...</div>
      <div style="width:80px;"></div>
    </div>
    <div style="flex:1;display:grid;grid-template-columns:1fr 340px;overflow:hidden;">
      <!-- Map side -->
      <div style="position:relative;">
        <div id="areaMap" style="width:100%;height:100%;"></div>
        <div id="areaMapStatus" style="position:absolute;bottom:12px;left:12px;background:rgba(255,255,255,.9);border-radius:8px;padding:7px 12px;font-size:12px;color:#666;backdrop-filter:blur(8px);">
          Laddar karta...
        </div>
      </div>
      <!-- Results side -->
      <div style="border-left:1px solid #EBEBEB;overflow-y:auto;background:#fff;">
        <div style="padding:16px 16px 8px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#999;margin-bottom:12px;">Fastigheter i området</div>
          <div id="areaResults" style="display:flex;flex-direction:column;gap:10px;">
            <div style="text-align:center;padding:40px 16px;color:#BBB;font-size:13px;">Söker...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Init map
  await new Promise(r => setTimeout(r, 100));

  const areaMap = L.map('areaMap', {
    zoomControl: true,
    attributionControl: false,
  }).setView([56.046, 12.694], 13);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  }).addTo(areaMap);

  // Search with Nominatim
  try {
    // Landsomfattande sökning. Tidigare klistrades ' Helsingborg' på varje fråga,
    // vilket gjorde det omöjligt att söka någon annanstans i Sverige.
    // countrycodes=se begränsar till Sverige; SEARCH_BIAS ger hemorten företräde
    // utan att utesluta resten av landet.
    const biased = SEARCH_BIAS ? `${query}, ${SEARCH_BIAS}` : query;
    let res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(biased)}&format=json&limit=3&polygon_geojson=1&countrycodes=se&accept-language=sv`);
    let results = await res.json();

    // Ingen träff nära hemorten? Sök då i hela landet.
    if (!results.length && SEARCH_BIAS) {
      res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=3&polygon_geojson=1&countrycodes=se&accept-language=sv`);
      results = await res.json();
    }
    if (!results.length) {
      document.getElementById('areaTitle').textContent = 'Inga resultat för "' + query + '"';
      document.getElementById('areaResults').innerHTML = '<div style="text-align:center;padding:40px 16px;color:#BBB;font-size:13px;">Hittade inget område. Prova en annan sökning.</div>';
      return;
    }

    const place = results[0];
    const name = place.display_name.split(',')[0];
    document.getElementById('areaTitle').textContent = name;
    document.getElementById('areaMapStatus').textContent = name;

    // Fit map to bbox
    const bbox = place.boundingbox; // [minlat, maxlat, minlon, maxlon]
    const bounds = [[parseFloat(bbox[0]), parseFloat(bbox[2])], [parseFloat(bbox[1]), parseFloat(bbox[3])]];
    areaMap.fitBounds(bounds, { padding: [30, 30] });

    // Draw area polygon if available
    if (place.geojson) {
      L.geoJSON(place.geojson, {
        style: {
          color: '#CC2936',
          weight: 2.5,
          fillColor: '#CC2936',
          fillOpacity: 0.08,
          dashArray: '6,4',
        }
      }).addTo(areaMap);
    } else {
      // Fallback: draw bbox rectangle
      L.rectangle(bounds, {
        color: '#CC2936',
        weight: 2,
        fillColor: '#CC2936',
        fillOpacity: 0.06,
        dashArray: '6,4',
      }).addTo(areaMap);
    }

    // Load parcels in area
    const cached = localStorage.getItem('prop_geojson_helsingborg_v4');
    if (cached) {
      try {
        const geojson = JSON.parse(cached);
        const minLat = parseFloat(bbox[0]), maxLat = parseFloat(bbox[1]);
        const minLon = parseFloat(bbox[2]), maxLon = parseFloat(bbox[3]);

        // Filter parcels in bbox
        const inArea = (geojson.features || []).filter(f => {
          const g = f.geometry;
          if (!g) return false;
          const coords = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
          if (!coords?.length) return false;
          const lons = coords.map(p => p[0]);
          const lats = coords.map(p => p[1]);
          const cx = lons.reduce((a,b)=>a+b)/lons.length;
          const cy = lats.reduce((a,b)=>a+b)/lats.length;
          return cx >= minLon && cx <= maxLon && cy >= minLat && cy <= maxLat;
        });

        // Draw parcels
        if (inArea.length) {
          const parcelLayer = L.geoJSON({ type:'FeatureCollection', features: inArea }, {
            style: { color:'rgba(255,255,255,0.7)', weight:1, fill:true, fillColor:'#fff', fillOpacity:0.01 },
            smoothFactor: 0,
            onEachFeature: (feature, layer) => {
              layer.on('click', () => {
                closeAreaSearch();
                currentView = 'map';
                render();
              });
              layer.on('mouseover', () => layer.setStyle({ color:'#CC2936', weight:2, fillOpacity:0.08 }));
              layer.on('mouseout', () => layer.setStyle({ color:'rgba(255,255,255,0.7)', weight:1, fillOpacity:0.01 }));
            }
          }).addTo(areaMap);

          // Fix pointer events
          setTimeout(() => {
            const pane = areaMap.getPanes().overlayPane;
            if (pane) pane.querySelectorAll('path').forEach(p => p.style.pointerEvents = 'all');
          }, 300);

          document.getElementById('areaMapStatus').textContent = inArea.length.toLocaleString('sv-SE') + ' fastigheter i ' + name;
        }

        // Show mini feed of demo properties in area
        const DEMO = [
          { name:"Laröd 3:19",       meta:"Gård · 5 200 kvm",  likes:41, img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=200&q=60" },
          { name:"Pålsjö 4:7",       meta:"Villa · 240 kvm",   likes:18, img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=200&q=60" },
          { name:"Fredriksdal 6:1",  meta:"Villa · 5,75 mkr",  likes:19, img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=200&q=60" },
          { name:"Söder 8:22",       meta:"Lägenhet · Söder",  likes:14, img:"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=200&q=60" },
        ];

        const resultsEl = document.getElementById('areaResults');
        if (resultsEl) {
          resultsEl.innerHTML = `
            <div style="font-size:12px;color:#999;margin-bottom:8px;">${inArea.length} tomter hittade</div>
            ${DEMO.map(p => `
              <div onclick="closeAreaSearch();currentView='feed';render();" style="display:flex;gap:10px;align-items:center;cursor:pointer;padding:10px;border-radius:10px;border:0.5px solid #EBEBEB;background:#FAFAF8;">
                <img src="${p.img}" style="width:52px;height:52px;border-radius:8px;object-fit:cover;flex-shrink:0;" />
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:var(--green-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
                  <div style="font-size:11px;color:#999;margin-top:2px;">${p.meta}</div>
                  <div style="font-size:11px;color:#999;margin-top:4px;">♡ ${p.likes}</div>
                </div>
                <i class="ti ti-chevron-right" style="font-size:14px;color:#DDD;" aria-hidden="true"></i>
              </div>
            `).join('')}
            <button onclick="closeAreaSearch();currentView='feed';render();" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid #CC2936;background:transparent;color:var(--accent);font-size:13px;font-weight:600;font-family:var(--font-body);cursor:pointer;margin-top:4px;">
              Se alla fastigheter i ${name}
            </button>
          `;
        }

      } catch(e) {
        console.warn('Area filter error:', e);
      }
    } else {
      // No cached parcels — show demo results only
      const resultsEl = document.getElementById('areaResults');
      if (resultsEl) {
        resultsEl.innerHTML = `
          <div style="font-size:12px;color:#999;margin-bottom:12px;">Öppna kartan för att se alla tomter</div>
          <button onclick="closeAreaSearch();currentView='map';render();" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid #CC2936;background:transparent;color:var(--accent);font-size:13px;font-weight:600;font-family:var(--font-body);cursor:pointer;">
            Visa ${name} på kartan
          </button>
        `;
      }
    }

  } catch(e) {
    console.error('Area search error:', e);
    document.getElementById('areaTitle').textContent = 'Sökning misslyckades';
    document.getElementById('areaResults').innerHTML = '<div style="text-align:center;padding:40px 16px;color:#BBB;font-size:13px;">Kunde inte hämta data. Försök igen.</div>';
  }
}

function closeAreaSearch() {
  const overlay = document.getElementById('area-search-overlay');
  if (overlay) overlay.remove();
}

function landingLike(btn) {
  const session = loadSession();
  if (!session?.email) {
    openAuthModal('reg');
    toast("Skapa ett konto för att spara gillar!");
    return;
  }
  const isLiked = btn.style.color === 'rgb(194, 98, 42)';
  btn.style.color = isLiked ? '#9CA3AF' : '#CC2936';
  btn.textContent = isLiked ? '♡' : '♥';
  toast(isLiked ? 'Gillning borttagen' : 'Gillad!');
}

// Visar toningen bara när det finns mer att scrolla till, och döljer den när
// användaren nått slutet. Annars lovar den innehåll som inte finns.
function initHeroChipsOverflow() {
  const wrap = document.getElementById("heroChipsWrap");
  const strip = document.getElementById("heroChips");
  if (!wrap || !strip) return;
  const update = () => {
    const more = strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 8;
    wrap.classList.toggle("has-overflow", more);
  };
  strip.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  requestAnimationFrame(update);
}

function focusLandingSearch() {
  const wrap = document.getElementById("landingSearchWrap");
  const input = document.getElementById("landingSearch");
  if (!wrap || !input) return;
  wrap.scrollIntoView({ behavior: "smooth", block: "center" });
  wrap.classList.add("search-pulse");
  setTimeout(() => wrap.classList.remove("search-pulse"), 1400);
  setTimeout(() => input.focus(), 350);
}

function landingSelectType(btn) {
  const wrap = document.getElementById("landingTypePills");
  if (wrap) wrap.querySelectorAll(".type-pill").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");

  // Tidigare satte den här funktionen bara en variabel som ingen läste — knapparna
  // var alltså rent dekorativa. Nu skrivs valet till samma nyckel som feeden
  // redan filtrerar på, så det följer med när användaren går vidare.
  const type = btn.dataset.type;
  window._landingType = type;
  if (type && type !== "Alla typer") localStorage.setItem("ifound_type_filter", type);
  else localStorage.removeItem("ifound_type_filter");

  const label = document.getElementById("typeFilterHint");
  if (label) {
    label.textContent = (type && type !== "Alla typer")
      ? `Visar ${type.toLowerCase()} när du söker eller utforskar`
      : "";
  }
}

function clearFeedTypeFilter() {
  localStorage.removeItem("ifound_type_filter");
  render();
}

function feedChip(btn) {
  document.querySelectorAll(".area-chip").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  const area = btn.textContent.trim();
  document.querySelectorAll("#masonryGrid .pin-card").forEach(card => {
    const name = card.querySelector(".pin-name")?.textContent || "";
    card.style.display = (area === "Alla" || name.includes(area)) ? "" : "none";
  });
}

function renderWelcome() {
  const PINS = [
    { name:"Laröd 3:19",       meta:"Gård · 5 200 kvm",  badge:"pb-hot",  badgeTxt:"58 gillar", likes:58, interested:12, h:220, img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=70" },
    { name:"Raus Plantage 7:2",meta:"Gård · 4 800 kvm",  badge:"pb-new",  badgeTxt:"Ny claim",  likes:6,  interested:2,  h:175, img:"https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=70" },
    { name:"Fredriksdal 6:1",  meta:"Villa · 5,75 mkr",  badge:"pb-sale", badgeTxt:"Till salu", likes:19, interested:6,  h:190, img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&q=70" },
    { name:"Pålsjö 4:7",       meta:"Villa · 240 kvm",   badge:"",        badgeTxt:"",          likes:41, interested:9,  h:245, img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=70" },
    { name:"Kulla 1:4",        meta:"Tomt · 2 400 kvm",  badge:"pb-hot",  badgeTxt:"Populär",   likes:24, interested:7,  h:175, img:"https://images.unsplash.com/photo-1449844908441-8829872d2607?w=400&q=70" },
    { name:"Söder 8:22",       meta:"Lägenhet · Söder",  badge:"",        badgeTxt:"",          likes:14, interested:3,  h:195, img:"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&q=70" },
    { name:"Viken Strand 4:2", meta:"Kusthus · 145 kvm", badge:"pb-hot",  badgeTxt:"Populär",   likes:58, interested:12, h:225, img:"https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&q=70" },
    { name:"Rådhuset 3:1",     meta:"Villa · Centrum",   badge:"pb-new",  badgeTxt:"Ny claim",  likes:18, interested:4,  h:180, img:"https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=400&q=70" },
  ];

  const TOPS = [
    { n:1, name:"Laröd 3:19",       meta:"58 gillar · Gård",  img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=300&q=60" },
    { n:2, name:"Pålsjö 4:7",       meta:"41 gillar · Villa",  img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=300&q=60" },
    { n:3, name:"Kulla 1:4",        meta:"24 gillar · Tomt",   img:"https://images.unsplash.com/photo-1449844908441-8829872d2607?w=300&q=60" },
    { n:4, name:"Fredriksdal 6:1",  meta:"19 gillar · Villa",  img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=300&q=60" },
  ];

  const session = loadSession();
  const isLoggedIn = !!session?.email;
  const user = isLoggedIn ? getCurrentUser() : null;

  app.innerHTML = `
    <div style="background:var(--page-bg);min-height:100vh;font-family:var(--font-body);">

      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo" style="cursor:default;">
            <svg width="17" height="21" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
          ${isLoggedIn ? `<div class="nav-greeting">Hej, ${user?.name || ""}!</div>` : ''}
        </div>
        <div class="nav-center">
          ${isLoggedIn ? `<button class="nav-tab" onclick="navigate('dashboard')">Min sida</button>` : ''}
          <button class="nav-tab" onclick="currentView='feed';render();">Utforska</button>
          <button class="nav-tab" onclick="currentView='map';render();">Karta</button>
          <button class="nav-tab" onclick="navigate('buildNew')">Bygga nytt hus</button>
          <button class="nav-tab" onclick="navigate('brokerWelcome')">För mäklare</button>
        </div>
        <div class="nav-right">
          ${isLoggedIn
            ? `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" id="logoutBtnWelcome">Logga ut</button>`
            : `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('login')">Logga in</button>
               <button class="btn-primary" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('reg')">Kom igång</button>`
          }
        </div>
      </nav>

      <!-- Hero. Mobil: en kolumn. Desktop (>=900px): asymmetriskt rutnät
           där högerspalten bär riktigt innehåll, inte dekor. -->
      <div class="hero-green">
        <div class="shell hero-grid">
          <div class="hero-main">
            <h1 class="hero-title">Alla hus.<br>Inte bara de<br>till salu.</h1>
            <p class="hero-lead">Varje fastighet finns här, inte bara de som annonseras. Visa intresse för huset du fastnat för — eller se vad folk tycker om ditt eget.</p>
            <div class="hero-search" id="landingSearchWrap">
              <i class="ti ti-search" aria-hidden="true"></i>
              <input id="landingSearch" placeholder="Sök adress eller fastighet..." />
              <button id="landingSearchBtn">Sök</button>
            </div>
            <div class="hero-chips-wrap" id="heroChipsWrap">
              <div class="hero-chips" id="heroChips">
                <button id="landingNearMe" class="chip chip-solid">
                  <i class="ti ti-current-location" aria-hidden="true"></i> Nära mig
                </button>
                ${(()=>{
                  const recent = JSON.parse(localStorage.getItem('ifound_recent_searches') || '[]');
                  if (!recent.length) return '';
                  return recent.slice(0,3).map(q =>
                    '<button class="chip" title="' + q.replace(/"/g,'&quot;') + '" onclick="currentView=\'feed\';render();">' + q + '</button>'
                  ).join('');
                })()}
              </div>
            </div>

            <div class="type-pills-wrap">
            <div id="landingTypePills" class="type-pills type-pills-hero">
              ${(() => {
                const active = localStorage.getItem("ifound_type_filter") || "Alla typer";
                return ["Alla typer","Villa","Lägenhet","Tomt/Gård","Fritidshus","Uthyrning"].map(t =>
                  `<button class="type-pill ${t === active ? "active" : ""}" data-type="${t}" onclick="landingSelectType(this)">${t}</button>`
                ).join("");
              })()}
            </div>
            </div>
          </div>

          <aside class="hero-aside" aria-label="Fastigheter med mest intresse">
            <div class="aside-head">Mest intresse just nu</div>
            ${[...PROP_DATA].sort((a,b)=>b.likes-a.likes).slice(0,4).map(pr => `
              <button class="aside-row" onclick="navigateProp(${pr.id})">
                <span class="aside-name">
                  <span class="beteckning">${pr.name}</span>
                  <span class="aside-meta">${pr.meta.split(" · ").slice(-1)[0]}</span>
                </span>
                <span class="aside-stat">${pr.likes} <i class="ti ti-heart-filled" aria-hidden="true"></i></span>
              </button>
            `).join("")}
            <button class="aside-more" onclick="currentView='feed';render();">Se alla <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
          </aside>
        </div>
      </div>

      <!-- Två valv. Dörren är produktens egen metafor — så rita den som en dörr. -->
      <div class="shell arches">
        <div class="arch" onclick="currentView='map';render();">
          <div class="arch-top"><i class="ti ti-map-search" aria-hidden="true"></i></div>
          <div class="arch-body">
            <div class="arch-label">Jag har sett ett hus</div>
            <div class="arch-title">Åkte du förbi ett hus du aldrig kan glömma?</div>
            <div class="arch-text">Visa ditt intresse — även om det inte är till salu.</div>
            <div class="arch-cta">Utforska på kartan <i class="ti ti-arrow-right" aria-hidden="true"></i></div>
          </div>
        </div>
        <div class="arch" onclick="focusLandingSearch()">
          <div class="arch-top arch-top-owner"><i class="ti ti-home-heart" aria-hidden="true"></i></div>
          <div class="arch-body">
            <div class="arch-label">Jag äger ett hus</div>
            <div class="arch-title">Vad tycker folk om ditt hus?</div>
            <div class="arch-text">Se vem som gillat eller visat intresse för din fastighet.</div>
            <div class="arch-cta">Sök upp min fastighet <i class="ti ti-arrow-right" aria-hidden="true"></i></div>
          </div>
        </div>
      </div>

      <!-- Så funkar det: samma flöde berättat från båda hållen. Här nämns vykortet
           första gången — som utfall av ett flöde, inte som en lös knapp. -->
      <div class="how-section">
        <div class="how-inner">
          <div class="how-heading">Så funkar ifound</div>
          <div class="how-cols">

            <div class="how-col">
              <div class="how-col-head">
                <span class="how-badge how-badge-visitor"><i class="ti ti-map-search" aria-hidden="true"></i></span>
                För dig som hittat ett hus
              </div>
              <ol class="how-steps">
                <li><span class="how-num">1</span><div><strong>Hitta huset på kartan</strong><span>Klicka på vilken tomt som helst — alla fastigheter finns med, inte bara de till salu.</span></div></li>
                <li><span class="how-num">2</span><div><strong>Visa ditt intresse anonymt</strong><span>Skriv några rader om varför just det här huset. Ditt namn syns inte förrän du vill.</span></div></li>
                <li><span class="how-num">3</span><div><strong>Ägaren får veta att du finns</strong><span>Är ägaren inte med på ifound kan vi skicka ett vykort hem i brevlådan.</span></div></li>
              </ol>
            </div>

            <div class="how-col">
              <div class="how-col-head">
                <span class="how-badge how-badge-owner"><i class="ti ti-home-heart" aria-hidden="true"></i></span>
                För dig som äger ett hus
              </div>
              <ol class="how-steps">
                <li><span class="how-num">1</span><div><strong>Sök upp din fastighet</strong><span>Den finns redan på kartan. Du behöver inte lägga upp något.</span></div></li>
                <li><span class="how-num">2</span><div><strong>Se vilka som gillat och visat intresse</strong><span>Kanske står någon redan och väntar på att du ska fundera på att sälja.</span></div></li>
                <li><span class="how-num">3</span><div><strong>Du bestämmer om du vill visas</strong><span>Allt är privat tills du väljer annat. Ingen mäklare, ingen värdering, inget krångel.</span></div></li>
              </ol>
            </div>

          </div>
        </div>
      </div>

      <!-- Scenarier. MEDVETET märkta som exempel, inte som kundomdömen —
           uppdiktade recensioner är vilseledande marknadsföring. Syftet är
           att förklara vad man faktiskt gör med tjänsten. -->
      <div class="stories">
        <div class="shell">
          <div class="stories-head">
            <h2 class="stories-title">Så här kan det gå till</h2>
            <p class="stories-sub">Två situationer som ifound är byggt för. Exemplen är påhittade och beskriver hur tjänsten är tänkt att fungera.</p>
          </div>

          <div class="stories-scatter">
            <article class="story story-buyer">
              <div class="story-img">
                <img src="story-tomt.jpg" alt="Nybyggt hus under uppförande på en avstyckad tomt" loading="lazy" width="1200" height="675" />
              </div>
              <div class="story-tag">Exempel · Köparen</div>
              <h3 class="story-headline">Tomten fanns. Den var bara inte till salu.</h3>
              <div class="story-body">
                <p>Ett par letade villatomt i ett år utan att hitta något. På en promenad gick de förbi en stor trädgård där halva ytan stod oanvänd — men fastigheten låg förstås inte ute.</p>
                <p>Via ifound ritade de ut den del av tomten de var intresserade av och skickade en fråga om avstyckning. Ägaren, ett pensionerat par som tyckte trädgården blivit för stor att sköta, hade funderat på saken i flera år utan att veta hur man börjar.</p>
                <p>De hade aldrig hittat varandra på bostadssajterna, eftersom det inte fanns någon annons att hitta.</p>
              </div>
              <div class="story-foot">
                <span class="beteckning">Skulle du göra samma sak?</span>
                <button class="story-link" onclick="currentView='map';render();">Hitta mark på kartan <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
              </div>
            </article>

            <article class="story story-owner">
              <div class="story-img">
                <img src="story-villa.jpg" alt="Villa med blommande trädgård" loading="lazy" width="1200" height="675" />
              </div>
              <div class="story-tag">Exempel · Ägaren</div>
              <h3 class="story-headline">Sålde utan att någonsin lägga ut huset.</h3>
              <div class="story-body">
                <p>En familj funderade på att flytta, men drog sig för hela processen: styling, fotografering, visningar varje söndag, och risken att ligga ute i flera månader med ett pris som sakta måste sänkas.</p>
                <p>I stället claimade de sin fastighet på ifound och angav vad de skulle kunna tänka sig att sälja för. Huset syntes aldrig som annonserat — bara som möjligt.</p>
                <p>Efter några veckor hörde någon av sig som redan gillat huset tidigare. Affären gjordes upp innan den blev en försäljningsprocess.</p>
              </div>
              <div class="story-foot">
                <span class="beteckning">Äger du en fastighet?</span>
                <button class="story-link" onclick="focusLandingSearch()">Sök upp din fastighet <i class="ti ti-arrow-right" aria-hidden="true"></i></button>
              </div>
            </article>
          </div>
        </div>
      </div>

      <!-- Topplistor -->
      <div style="max-width:900px;margin:0 auto;padding:0 20px 36px;">
        <div style="text-align:center;margin-bottom:22px;">
          <div style="font-size:15px;font-weight:600;letter-spacing:-.03em;color:var(--ink);">Husen folk fastnar för just nu</div>
          <div style="font-size:13px;color:var(--ink-muted);margin-top:3px;">Riktiga fastigheter — och intresset de fått den senaste tiden.</div>
        </div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:var(--ink);">Mest gillade</div>
          <button onclick="currentView='feed';render();" style="font-size:12px;font-weight:600;color:var(--accent);background:transparent;border:none;cursor:pointer;font-family:var(--font-body);display:flex;align-items:center;gap:3px;">Alla <i class="ti ti-chevron-right" style="font-size:12px;" aria-hidden="true"></i></button>
        </div>
        <div class="tops-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:28px;">
          ${TOPS.map(c=>`
            <div onclick="currentView='feed';render();" style="border-radius:12px;overflow:hidden;position:relative;cursor:pointer;height:130px;">
              <img src="${c.img}" style="width:100%;height:100%;object-fit:cover;" alt="${c.name}" loading="lazy" />
              <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65) 0%,transparent 55%);"></div>
              <div style="position:absolute;top:8px;left:8px;width:22px;height:22px;border-radius:50%;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;">${c.n}</div>
              <div style="position:absolute;bottom:0;left:0;right:0;padding:10px;">
                <div style="font-size:12px;font-weight:600;color:#fff;">${c.name}</div>
                <div style="font-size:11px;color:rgba(255,255,255,.7);margin-top:1px;">${c.meta}</div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Masonry grid -->
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:var(--ink);">Utforska fastigheter</div>
          <button onclick="currentView='feed';render();" style="font-size:12px;font-weight:600;color:var(--accent);background:transparent;border:none;cursor:pointer;font-family:var(--font-body);display:flex;align-items:center;gap:3px;">Se alla <i class="ti ti-chevron-right" style="font-size:12px;" aria-hidden="true"></i></button>
        </div>
        <div class="landing-masonry" style="columns:4;column-gap:10px;margin-bottom:36px;">
          ${PINS.map(p=>`
            <div onclick="currentView='feed';render();" style="break-inside:avoid;margin-bottom:10px;border-radius:12px;overflow:hidden;cursor:pointer;background:#fff;border:0.5px solid rgba(17,24,39,.07);position:relative;">
              <div style="position:relative;">
                <img src="${p.img}" style="width:100%;height:${p.h}px;object-fit:cover;display:block;" alt="${p.name}" loading="lazy" />
                ${p.badge ? `<div style="position:absolute;top:8px;left:8px;font-size:10px;font-weight:600;padding:3px 8px;border-radius:999px;background:rgba(204,41,54,.88);color:#fff;">${p.badgeTxt}</div>` : ''}
                <button onclick="event.stopPropagation();landingLike(this)" style="position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.92);border:none;cursor:pointer;font-size:14px;color:var(--ink-muted);">♡</button>
              </div>
              <div style="padding:9px 11px 11px;">
                <div style="font-size:12px;font-weight:600;color:var(--ink);">${p.name}</div>
                <div style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${p.meta}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px;font-size:11px;color:var(--ink-muted);">
                  <span>♡ ${p.likes}</span>
                  ${p.interested ? `<span style="font-size:10px;font-weight:600;color:var(--accent);background:var(--accent-soft);padding:2px 7px;border-radius:999px;">${p.interested} intresserade</span>` : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Hur det fungerar -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:36px;">
          ${[
            {num:"01", title:"Hitta huset", desc:"Sök adress, scrolla flödet eller öppna kartan och zooma in till det hus du fastnade för."},
            {num:"02", title:"Visa ditt intresse", desc:"Gilla eller skicka ett anonymt meddelande — även om fastigheten inte är till salu. Inget konto krävs."},
            {num:"03", title:"Ägaren bestämmer", desc:"Fastighetsägaren ser ditt intresse och väljer om de vill svara, visa upp sin bostad eller sätta ett pris."},
          ].map(s=>`
            <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;">
              <div style="font-size:11px;font-weight:700;color:var(--accent);letter-spacing:.08em;margin-bottom:10px;">${s.num}</div>
              <div style="font-size:14px;font-weight:600;color:var(--ink);margin-bottom:6px;">${s.title}</div>
              <div style="font-size:12px;color:var(--ink-soft);line-height:1.6;">${s.desc}</div>
            </div>
          `).join('')}
        </div>

        <!-- CTA -->
        <div class="welcome-cta">
          <div>
            <div style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#fff;margin-bottom:4px;">Är det ditt hus? Gå med.</div>
            <div style="font-size:13px;color:rgba(255,255,255,.5);">Se vem som är intresserad av din fastighet — gratis.</div>
          </div>
          <div class="welcome-cta-btns">
            <button onclick="openAuthModal('reg')" style="padding:11px 20px;border-radius:10px;border:none;background:#fff;color:var(--ink);font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-body);white-space:nowrap;">Claima din fastighet</button>
            <button onclick="navigate('brokerWelcome')" style="padding:11px 20px;border-radius:10px;border:0.5px solid rgba(255,255,255,.25);background:transparent;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-body);white-space:nowrap;">För mäklare</button>
          </div>
        </div>
      </div>
    </div>
  `;

  if (isLoggedIn) {
    const logoutBtn = document.getElementById("logoutBtnWelcome");
    if (logoutBtn) logoutBtn.onclick = () => { clearSession(); toast("Utloggad."); navigate("welcome"); };
  }

  // Search handler
  document.getElementById("landingSearchBtn").onclick = () => {
    const q = document.getElementById("landingSearch").value.trim();
    // Persist chosen property type so feed can apply it as a filter
    const type = window._landingType && window._landingType !== "Alla typer" ? window._landingType : null;
    if (type) localStorage.setItem("ifound_type_filter", type); else localStorage.removeItem("ifound_type_filter");
    if (!q) { currentView = "map"; render(); return; }
    // Save to recent searches
    const recent = JSON.parse(localStorage.getItem('ifound_recent_searches') || '[]');
    const updated = [q, ...recent.filter(r => r !== q)].slice(0, 5);
    localStorage.setItem('ifound_recent_searches', JSON.stringify(updated));
    // Go to map and trigger area search
    currentView = "map";
    render();
    setTimeout(() => {
      // Invalidate map size after render
      if (typeof map !== 'undefined' && map) {
        try { map.invalidateSize(); } catch {}
      }
      const searchInput = document.getElementById("addressSearch");
      if (searchInput) {
        searchInput.value = q;
        const event = new Event("input", { bubbles: true });
        searchInput.dispatchEvent(event);
        setTimeout(() => {
          const first = document.querySelector("#searchDropdown [data-idx]");
          if (first) first.click();
        }, 900);
      }
    }, 500);
  };

  document.getElementById("landingSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("landingSearchBtn").click();
  });

  initHeroChipsOverflow();

  // Near me
  document.getElementById("landingNearMe").onclick = () => {
    const btn = document.getElementById("landingNearMe");
    if (!navigator.geolocation) { toast("Din webbläsare stödjer inte platsfunktion."); return; }
    btn.textContent = "Söker...";
    navigator.geolocation.getCurrentPosition(
      pos => {
        currentView = "map";
        render();
        setTimeout(() => {
          const mapBtn = document.getElementById("nearMeMapBtn");
          if (mapBtn) mapBtn.click();
        }, 600);
      },
      () => {
        toast("Kunde inte hämta din position.");
        btn.innerHTML = '<i class="ti ti-current-location" style="font-size:13px;"></i> Nära mig';
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };
}

// =========================
// PROP DATA (fastigheter)
// =========================
const PROP_DATA = [
  { id:0, name:"Laröd 3:19",        meta:"Gård · 5 200 kvm · Laröd",         type:"Passiv",    likes:41, interested:9,  img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80&auto=format", imgs:["https://images.unsplash.com/photo-1449844908441-8829872d2607?w=800&q=80&auto=format"], desc:"En magnifik gård i lantligt läge med generösa ytor och äldre karaktärsbyggnad." },
  { id:1, name:"Raus Plantage 7:2",  meta:"Gård · 4 800 kvm · Raus",          type:"Ny claim",  likes:6,  interested:2,  img:"https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80&auto=format", imgs:[], desc:"Nyligen claimad fastighet — ägaren håller sin profil privat för tillfället." },
  { id:2, name:"Kulla 1:4",          meta:"Tomt · 2 400 kvm · Höganäs",       type:"Passiv",    likes:24, interested:7,  img:"https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80&auto=format", imgs:[], desc:"Stor obebyggd tomt med fantastiskt läge. Perfekt för den som drömmer om att bygga sitt drömhus." },
  { id:3, name:"Pålsjö 4:7",         meta:"Villa · 240 kvm · Pålsjö",         type:"Passiv",    likes:18, interested:4,  img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80&auto=format", imgs:["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80&auto=format"], desc:"Välskött villa i ett av Helsingborgs mest eftertraktade lägen." },
  { id:4, name:"Fredriksdal 6:1",    meta:"Villa · 195 kvm · Helsingborg",    type:"Till salu", likes:19, interested:6,  img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80&auto=format", imgs:["https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80&auto=format"], desc:"Rymlig villa med charmig trädgård nära Fredriksdals museer.", price:"5 750 000 kr" },
  { id:5, name:"Söder 8:22",         meta:"Lägenhet · 72 kvm · Helsingborg",  type:"Uthyrning", likes:14, interested:0,  img:"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&q=80&auto=format", imgs:[], desc:"Modern lägenhet på Söder med balkong och öppen planlösning.", price:"9 800 kr/mån" },
  { id:6, name:"Viken Strand 4:2",   meta:"Kusthus · 145 kvm · Viken",        type:"Passiv",    likes:58, interested:12, img:"https://images.unsplash.com/photo-1449844908441-8829872d2607?w=800&q=80&auto=format", imgs:[], desc:"Drömläge direkt mot havet i Viken." },
  { id:7, name:"Pålsjö 12:8",        meta:"Villa · 220 kvm · Pålsjö",         type:"Till salu", likes:31, interested:11, img:"https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=800&q=80&auto=format", imgs:[], desc:"Exklusiv villa i Pålsjö med parkliknande tomt.", price:"4 200 000 kr" },
];

function navigateProp(id) {
  currentView = "property_" + id;
  render();
}

// =========================
// BYGGA NYTT HUS — informationsvy
// Målgrupp: den som vill stycka av och bygga friliggande. Kopplar ihop
// avstyckningsflödet på kartan med hela projektkedjan.
// Siffror är riktvärden (kontrollerade aug 2026) och varierar kraftigt per
// kommun och nätägare — därför alltid spann, aldrig exakta belopp.
// =========================
function renderBuildNew() {
  const session = loadSession();
  const isLoggedIn = !!session?.email;
  const user = isLoggedIn ? getCurrentUser() : null;

  const STEPS = [
    {
      n: 1, icon: "ti-map-search", title: "Hitta marken", time: "Här börjar allt", highlight: true,
      text: "Den svåraste delen är inte bygglovet — det är att hitta marken. Färdiga tomter är sällsynta och säljs ofta innan de annonseras. Med ifound kan du hitta en tomt eller en stor trädgård som aldrig legat ute, och fråga ägaren om möjligheten att stycka av.",
    },
    {
      n: 2, icon: "ti-file-search", title: "Förhandsbesked", time: "10 v – 6 mån",
      text: "Ligger marken utanför detaljplan söker du förhandsbesked hos kommunens byggnadsnämnd. Det är ett bindande besked om att marken får bebyggas, och det gäller i två år. Gör alltid detta <strong>före</strong> avstyckningen — annars riskerar du att betala för en tomt du inte får bygga på.",
    },
    {
      n: 3, icon: "ti-cut", title: "Avstyckning", time: "6–18 mån",
      text: "Lantmäteriet bildar den nya fastigheten genom en lantmäteriförrättning. Här löses också servitut för väg, vatten och avlopp över stamfastigheten. Räkna med lång kötid — det här är oftast projektets tidsmässiga flaskhals.",
    },
    {
      n: 4, icon: "ti-license", title: "Bygglov", time: "10 v – 6 mån",
      text: "Kommunen prövar husets placering, storlek och utformning. Efter beviljat lov krävs tekniskt samråd och startbesked innan du får börja bygga. Du behöver en certifierad kontrollansvarig redan i ansökan.",
    },
    {
      n: 5, icon: "ti-plug-connected", title: "Anslutningar", time: "3–12 mån",
      text: "El, vatten, avlopp och fiber. Den här posten underskattas nästan alltid — se detaljerna nedan. Begär offerter tidigt, eftersom leveranstiderna på elnätssidan kan vara långa och avgörande för byggstarten.",
    },
    {
      n: 6, icon: "ti-home-check", title: "Bygga och flytta in", time: "8–18 mån",
      text: "Grundläggning, stomme, tätt hus, installationer och inredning. Kommunen håller ett slutsamråd och utfärdar slutbesked — först då får du formellt flytta in.",
    },
  ];

  const UTILITIES = [
    {
      icon: "ti-bolt", tone: "el", title: "El",
      lead: "Elnätsanslutningen följer en schablon från Energimarknadsinspektionen, baserad på avståndet fågelvägen till närmaste anslutningspunkt.",
      rows: [
        ["Inom 200 m från anslutningspunkt", "Fast grundavgift, ofta 50 000–60 000 kr"],
        ["Längre än 200 m", "Grundavgift + meteravgift per zon — kan nå 150 000–290 000 kr"],
        ["Över 1 800 m", "Individuell offert, ingen schablon"],
      ],
      tips: [
        "Kolla avståndet till närmaste anslutningspunkt <strong>innan</strong> du binder dig vid marken. Det är den enskilt största prisvariabeln.",
        "Ansluter grannar samtidigt ska kostnaden för sträckan över 200 m delas mellan er — det kan halvera notan.",
        "Beställningen görs av en elinstallatör registrerad hos Elsäkerhetsverket, som skickar föranmälan åt dig.",
        "Begär byggström tidigt. Den behövs långt innan huset står färdigt.",
      ],
    },
    {
      icon: "ti-droplet", tone: "va", title: "Vatten och avlopp",
      lead: "Här går den stora skiljelinjen: ligger tomten inom kommunalt verksamhetsområde eller inte? Svaret ändrar kostnad, tidsplan och vilka tillstånd du behöver.",
      rows: [
        ["Inom verksamhetsområde", "Anläggningsavgift, ofta 100 000–230 000 kr"],
        ["Utanför — enskilt avlopp", "60 000–300 000 kr beroende på lösning"],
        ["Egen borrad brunn", "Tillkommer, prissätts per meter borrdjup"],
        ["Tillstånd för enskilt avlopp", "Ansökningsavgift ofta 3 000–10 000 kr"],
      ],
      tips: [
        "Ligger tomten inom verksamhetsområdet är anslutning normalt <strong>obligatorisk</strong> — du kan inte välja en enskild lösning för att spara pengar.",
        "Enskilt avlopp kräver alltid tillstånd från kommunens miljökontor innan arbetet påbörjas. Bygglov räcker inte.",
        "Markens genomsläpplighet avgör vilken avloppslösning som godkänns. En undersökning tidigt sparar dyra omtag.",
        "Har du egen brunn behöver avståndet till avloppsanläggningar hållas — även grannarnas.",
      ],
    },
    {
      icon: "ti-shovel", tone: "mark", title: "Mark och dagvatten",
      lead: "Det som ligger under marken avgör grundläggningskostnaden — och det syns inte på en visning.",
      rows: [
        ["Geoteknisk undersökning", "Krävs oftast inför bygglov"],
        ["Radonmätning", "Avgör om radonsäker grund behövs"],
        ["Dagvattenhantering", "Kan krävas lokalt omhändertagande på tomten"],
      ],
      tips: [
        "Lera, fyllnadsmassor eller högt grundvatten kan lägga hundratusentals kronor på grunden.",
        "Berg nära ytan låter stabilt, men gör schakt för ledningar dyrt.",
        "Fråga efter tidigare markanvändning — gammal deponi eller verkstad kan innebära saneringskrav.",
      ],
    },
  ];

  const PITFALLS = [
    ["Köpa mark utan förhandsbesked", "Den vanligaste och dyraste missen. Utan besked vet du inte om marken får bebyggas — och förrättningskostnaden tas ut även om svaret blir nej."],
    ["Glömma servituten", "Nya tomten behöver säkrad rätt till väg, vatten och avlopp över stamfastigheten. Löses det inte i förrättningen blir det en grannkonflikt senare."],
    ["Underskatta anslutningarna", "El, VA och fiber kan tillsammans landa på 200 000–400 000 kr. De ingår sällan i priset från husleverantören."],
    ["Missa strandskyddet", "Inom 100 meter från strandlinjen — ibland utvidgat till 300 meter — krävs dispens. Gäller även småbäckar och insjöar."],
    ["Räkna med en snabb process", "Från idé till inflyttning tar det i praktiken ofta 2–4 år. Lantmäteriets kötid går sällan att påskynda."],
  ];

  app.innerHTML = `
    <div style="background:var(--page-bg);min-height:100vh;font-family:var(--font-body);">

      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo" onclick="navigate('welcome')" style="cursor:pointer;">
            <svg width="17" height="21" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
          ${isLoggedIn ? `<div class="nav-greeting">Hej, ${user?.name || ""}!</div>` : ''}
        </div>
        <div class="nav-center">
          ${isLoggedIn ? `<button class="nav-tab" onclick="navigate('dashboard')">Min sida</button>` : ''}
          <button class="nav-tab" onclick="currentView='feed';render();">Utforska</button>
          <button class="nav-tab" onclick="currentView='map';render();">Karta</button>
          <button class="nav-tab active">Bygga nytt hus</button>
        </div>
        <div class="nav-right">
          ${isLoggedIn
            ? `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" id="logoutBtnBuild">Logga ut</button>`
            : `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('login')">Logga in</button>
               <button class="btn-primary" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('reg')">Kom igång</button>`
          }
        </div>
      </nav>

      <div class="bn-hero">
        <div class="bn-hero-inner">
          <div class="bn-eyebrow">Guide</div>
          <h1 class="bn-title">Bygga nytt hus<br>på egen tomt</h1>
          <p class="bn-lead">Hela kedjan från mark till slutbesked — förhandsbesked, avstyckning, bygglov och de anslutningar som nästan alltid kostar mer än man tror. Och varför det allra första steget, att hitta marken, är det som stoppar flest.</p>
        </div>
      </div>

      <div class="bn-wrap">

        <div class="bn-role">
          <div class="bn-role-icon"><i class="ti ti-map-pin-plus" aria-hidden="true"></i></div>
          <div>
            <div class="bn-role-title">Problemet är sällan bygglovet. Det är marken.</div>
            <div class="bn-role-text">
              De flesta som vill bygga fastnar direkt: det finns inga tomter till salu. Men marken finns — den är bara en del av någon annans trädgård, en åkerkant eller en obebyggd lucka mellan två hus. Ägaren har kanske aldrig ens funderat på att stycka av.
              <br><br>
              På ifound hittar du den marken på kartan, ritar ut exakt vilken del du är intresserad av och skickar en fråga till ägaren — även om ingenting är till salu. Det är där husprojektet börjar.
            </div>
            <div class="bn-role-actions">
              <button class="bn-btn-primary" onclick="currentView='map';render();">
                <i class="ti ti-map-2" aria-hidden="true"></i> Hitta mark på kartan
              </button>
              <button class="bn-btn-ghost" onclick="currentView='feed';render();">Se vad andra intresserat sig för</button>
            </div>
          </div>
        </div>

        <h2 class="bn-h2">Processen, steg för steg</h2>
        <div class="bn-steps">
          ${STEPS.map(s => `
            <div class="bn-step ${s.highlight ? 'bn-step-hl' : ''}">
              <div class="bn-step-num"><i class="ti ${s.icon}" aria-hidden="true"></i></div>
              <div class="bn-step-body">
                <div class="bn-step-head">
                  <span class="bn-step-title">${s.n}. ${s.title}</span>
                  <span class="bn-step-time">${s.time}</span>
                </div>
                <div class="bn-step-text">${s.text}</div>
              </div>
            </div>
          `).join("")}
        </div>

        <h2 class="bn-h2">El, vatten och avlopp</h2>
        <p class="bn-sub">Posten som oftast spränger budgeten. Kostnaden styrs av var tomten ligger i förhållande till befintliga ledningar — inte av hur huset ser ut.</p>

        ${UTILITIES.map(u => `
          <div class="bn-card">
            <div class="bn-card-head">
              <span class="bn-card-icon bn-icon-${u.tone}"><i class="ti ${u.icon}" aria-hidden="true"></i></span>
              <span class="bn-card-title">${u.title}</span>
            </div>
            <div class="bn-card-lead">${u.lead}</div>
            <div class="bn-rows">
              ${u.rows.map(r => `<div class="bn-row"><span>${r[0]}</span><strong>${r[1]}</strong></div>`).join("")}
            </div>
            <div class="bn-tips-label">Att tänka på</div>
            <ul class="bn-tips">
              ${u.tips.map(t => `<li><i class="ti ti-point-filled" aria-hidden="true"></i><span>${t}</span></li>`).join("")}
            </ul>
          </div>
        `).join("")}

        <h2 class="bn-h2">Fem dyra misstag</h2>
        <div class="bn-pitfalls">
          ${PITFALLS.map(p => `
            <div class="bn-pitfall">
              <i class="ti ti-alert-triangle" aria-hidden="true"></i>
              <div>
                <strong>${p[0]}</strong>
                <span>${p[1]}</span>
              </div>
            </div>
          `).join("")}
        </div>

        <div class="bn-disclaimer">
          <i class="ti ti-info-circle" aria-hidden="true"></i>
          <div>Beloppen är riktvärden för 2026 och varierar kraftigt mellan kommuner och nätägare. Avgifter och handläggningstider måste alltid kontrolleras mot din kommun, ditt elnätsbolag och Lantmäteriet innan du räknar på ett projekt. Guiden ersätter inte rådgivning.</div>
        </div>

        <div class="bn-cta">
          <div class="bn-cta-title">Börja med marken</div>
          <div class="bn-cta-text">Hitta tomten eller trädgården du vill bygga på — och fråga ägaren, även om den inte är till salu.</div>
          <button class="bn-btn-primary" onclick="currentView='map';render();">
            <i class="ti ti-map-2" aria-hidden="true"></i> Öppna kartan
          </button>
        </div>

      </div>
      <div style="height:90px;"></div>
    </div>
  `;

  const lo = document.getElementById("logoutBtnBuild");
  if (lo) lo.onclick = () => { clearSession(); navigate("welcome"); };
}

// =========================
// SPARADE OBJEKT — dina gillade och intresserade fastigheter
// Läser användarens FAKTISKA likes/intressen, med den egna bilden om den finns.
// =========================
function renderSaved() {
  const session = loadSession();
  const isLoggedIn = !!session?.email;
  const user = isLoggedIn ? getCurrentUser() : null;
  const state = loadState();

  const likes = Object.keys(state.myLikes || {});
  const interests = Object.keys(state.myInterests || {});
  const follows = Object.keys(state.myFollows || {});
  const all = [...new Set([...likes, ...interests, ...follows])];
  const names = state.parcelNames || {};
  const photos = state.myPhotos || {};
  const types = {};
  all.forEach(pid => { types[pid] = getKnownType(pid); });

  const card = (pid) => {
    const nm = names[pid] || pid;
    const photo = photos[pid];
    const liked = !!state.myLikes?.[pid];
    const interested = !!state.myInterests?.[pid];
    const wp = (state.wishPrices || {})[pid];
    return `
      <button class="saved-card" onclick="openParcelById('${String(pid).replace(/'/g,"\\'")}','${String(nm).replace(/'/g,"\\'")}')">
        <div class="saved-thumb ${photo ? '' : 'saved-thumb-empty'}">
          ${photo ? `<img src="${photo}" alt="" />` : `<i class="ti ti-map-pin"></i>`}
          ${photo ? `<span class="saved-thumb-tag">Din bild</span>` : ''}
        </div>
        <div class="saved-info">
          <div class="beteckning">${nm}</div>
          ${types[pid] ? `<div class="saved-type">${types[pid]}</div>` : ''}
          <div class="saved-tags">
            ${liked ? `<span class="saved-pill saved-pill-like"><i class="ti ti-thumb-up"></i> Gillad</span>` : ''}
            ${interested ? `<span class="saved-pill saved-pill-int"><i class="ti ti-star"></i> Intresserad</span>` : ''}
            ${wp?.visible && wp.amount ? `<span class="saved-pill saved-pill-price">${wp.amount} kr</span>` : ''}
          </div>
        </div>
        <i class="ti ti-chevron-right saved-arrow"></i>
      </button>`;
  };

  app.innerHTML = `
    <div style="background:var(--page-bg);min-height:100vh;font-family:var(--font-body);">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo" onclick="navigate('welcome')" style="cursor:pointer;">
            <svg width="17" height="21" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
        </div>
        <div class="nav-center">
          <button class="nav-tab" onclick="navigate('dashboard')">Min sida</button>
          <button class="nav-tab" onclick="currentView='feed';render();">Utforska</button>
          <button class="nav-tab" onclick="currentView='map';render();">Karta</button>
        </div>
        <div class="nav-right">
          <button class="btn-ghost" style="font-size:12px;padding:7px 13px;" onclick="navigate('dashboard')">Tillbaka</button>
        </div>
      </nav>

      <div class="saved-wrap">
        <div class="saved-head">
          <button class="saved-back" onclick="navigate('dashboard')"><i class="ti ti-arrow-left"></i> Min sida</button>
          <h1 class="saved-title">Sparade objekt</h1>
          <p class="saved-sub">${all.length ? `${all.length} ${all.length === 1 ? 'fastighet' : 'fastigheter'} du fastnat för.` : 'Här samlas husen du gillar och visar intresse för.'}</p>
        </div>

        ${all.length ? `<div class="saved-list">${all.map(card).join('')}</div>` : `
          <div class="saved-empty">
            <i class="ti ti-heart"></i>
            <div class="saved-empty-title">Inga sparade objekt ännu</div>
            <div class="saved-empty-sub">Åk ut, hitta ett hus du fastnar för, och gilla det på kartan. Det dyker upp här.</div>
            <button class="bn-btn-primary" onclick="currentView='map';render();"><i class="ti ti-map-2"></i> Öppna kartan</button>
          </div>`}
      </div>
      <div style="height:80px;"></div>
    </div>
  `;
}

// Öppna kartan och zooma till en fastighet från en lista
function openParcelById(pid, name) {
  currentView = "map";
  window._pendingParcelFocus = { pid, name };
  render();
}

// =========================
// FEED VIEW (Pinterest)
// =========================
function renderFeed() {
  const pins = [
    { id:0, name:"Laröd 3:19",       meta:"Gård · 5 200 kvm",  badge:"pb-hot",  badgeText:"41 gillar", likes:41, interested:9,  img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=75&auto=format", imgH:260 },
    { id:1, name:"Raus Plantage 7:2", meta:"Gård · 4 800 kvm",  badge:"pb-new",  badgeText:"Ny claim",  likes:6,  interested:2,  img:"https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=75&auto=format", imgH:180 },
    { id:2, name:"Kulla 1:4",         meta:"Tomt · 2 400 kvm",  badge:"pb-hot",  badgeText:"Populär",   likes:24, interested:7,  img:"https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&q=75&auto=format", imgH:160 },
    { id:3, name:"Pålsjö 4:7",        meta:"Villa · 240 kvm",   badge:"pb-quiet",badgeText:"Passiv",    likes:18, interested:4,  img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=75&auto=format", imgH:220 },
    { id:4, name:"Fredriksdal 6:1",   meta:"Villa · 5,75 mkr",  badge:"pb-sale", badgeText:"Till salu", likes:19, interested:6,  img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&q=75&auto=format", imgH:180 },
    { id:5, name:"Söder 8:22",        meta:"Lägenhet · 9 800/mån", badge:"pb-rent",badgeText:"Uthyrning",likes:14,interested:0,  img:"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&q=75&auto=format", imgH:200 },
    { id:6, name:"Viken Strand 4:2",  meta:"Kusthus · 145 kvm", badge:"pb-hot",  badgeText:"58 gillar", likes:58, interested:12, img:"https://images.unsplash.com/photo-1449844908441-8829872d2607?w=400&q=75&auto=format", imgH:240 },
    { id:7, name:"Pålsjö 12:8",       meta:"Villa · 220 kvm",   badge:"pb-sale", badgeText:"Till salu", likes:31, interested:11, img:"https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=400&q=75&auto=format", imgH:170 },
  ];

  const session = loadSession();
  const state = loadState();
  const myLikes = state.myLikes || {};
  const isLoggedIn = !!session?.email;

  const typeFilter = localStorage.getItem("ifound_type_filter");
  const typeMatchers = {
    "Villa": p => p.meta.includes("Villa"),
    "Lägenhet": p => p.meta.includes("Lägenhet"),
    "Tomt/Gård": p => p.meta.includes("Tomt") || p.meta.includes("Gård"),
    "Fritidshus": p => p.meta.includes("Kusthus"),
    "Uthyrning": p => p.badge === "pb-rent" || p.meta.includes("/mån"),
  };
  const filteredPins = (typeFilter && typeMatchers[typeFilter]) ? pins.filter(typeMatchers[typeFilter]) : pins;

  app.innerHTML = `
    <div class="feed-page">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo" onclick="navigate('welcome')" style="cursor:pointer;">
            <svg width="18" height="23" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
        </div>
        <div class="nav-center">
          ${isLoggedIn ? `<button class="nav-tab" onclick="navigate('dashboard')">Min sida</button>` : ''}
          <button class="nav-tab active">Utforska</button>
          <button class="nav-tab" onclick="currentView='map';render();">Karta</button>
          <button class="nav-tab" onclick="navigate('buildNew')">Bygga nytt hus</button>
        </div>
        <div class="nav-right">
          ${isLoggedIn
            ? `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" id="logoutBtn">Logga ut</button>`
            : `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('login')">Logga in</button>
               <button class="btn-primary" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('reg')">Kom igång</button>`
          }
        </div>
      </nav>

      <!-- Onboarding bar -->
      ${!state.onboardingDone ? `
        <div id="onboardingBar" style="background:var(--ink);border-bottom:0.5px solid rgba(255,255,255,.08);padding:10px 16px;display:flex;align-items:center;gap:0;overflow-x:auto;scrollbar-width:none;">
          ${[
            {icon:"ti-map-2",      label:"Karta",    desc:"Hitta fastigheter nära dig"},
            {icon:"ti-heart",      label:"Gilla",    desc:"Spara det du fastnar för"},
            {icon:"ti-star",       label:"Intresse", desc:"Skicka intresse till ägaren"},
            {icon:"ti-home-check", label:"Claima",   desc:"Är det ditt hus? Gå med!"},
          ].map((s,i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:0 14px;border-right:${i<3?'0.5px solid rgba(255,255,255,.08)':'none'};flex-shrink:0;">
              <div style="width:28px;height:28px;border-radius:7px;background:rgba(204,41,54,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="ti ${s.icon}" style="font-size:14px;color:var(--accent);"></i>
              </div>
              <div>
                <div style="font-size:11px;font-weight:600;color:#fff;">${s.label}</div>
                <div style="font-size:10px;color:rgba(255,255,255,.4);">${s.desc}</div>
              </div>
            </div>
          `).join('')}
          <button onclick="dismissOnboarding()" style="margin-left:auto;flex-shrink:0;background:transparent;border:none;color:rgba(255,255,255,.3);font-size:18px;cursor:pointer;padding:0 8px;line-height:1;">✕</button>
        </div>
      ` : ''}

      <!-- Search bar -->
      <div style="padding:10px 12px;background:#fff;border-bottom:0.5px solid rgba(17,24,39,.08);display:flex;gap:8px;">
        <div style="flex:1;display:flex;align-items:center;gap:8px;background:var(--page-bg);border-radius:999px;padding:8px 14px;border:0.5px solid rgba(17,24,39,.10);position:relative;">
          <i class="ti ti-search" style="font-size:16px;color:var(--ink-muted);flex-shrink:0;"></i>
          <input id="feedSearch" placeholder="Sök område eller gata..." style="flex:1;border:none;background:transparent;font-size:13px;font-family:var(--font-body);color:var(--ink);outline:none;" />
          <div id="searchDropdown" style="display:none;position:absolute;top:calc(100% + 8px);left:0;right:0;background:#fff;border:0.5px solid rgba(17,24,39,.10);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.10);z-index:100;overflow:hidden;"></div>
        </div>
        <button id="nearMeBtn" style="display:flex;align-items:center;gap:6px;background:var(--ink);color:#fff;border:none;border-radius:999px;padding:8px 16px;font-size:12px;font-weight:600;font-family:var(--font-body);cursor:pointer;white-space:nowrap;">
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

      ${typeFilter ? `
        <div style="padding:8px 12px 0;">
          <span style="display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:#fff;font-size:12px;font-weight:600;padding:6px 8px 6px 12px;border-radius:999px;">
            Typ: ${typeFilter}
            <button onclick="clearFeedTypeFilter()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:18px;height:18px;border-radius:50%;font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>
          </span>
        </div>
      ` : ''}

      <!-- Claim nudge -->
      <div class="claim-nudge" onclick="${isLoggedIn ? "navigate('dashboard')" : "openAuthModal('reg')"}">
        <div class="claim-nudge-icon"><i class="ti ti-home-check" style="font-size:20px;color:var(--accent);"></i></div>
        <div style="flex:1;">
          <div class="claim-nudge-title">${isLoggedIn ? '18 gillar ditt hem' : 'Är det ditt hus?'}</div>
          <div class="claim-nudge-sub">${isLoggedIn ? 'Pålsjö 4:7 — claima för att se vem som är intresserad' : 'Claima din fastighet och se vem som är intresserad'}</div>
        </div>
        <i class="ti ti-chevron-right" style="color:var(--ink-muted);"></i>
      </div>

      <!-- Masonry grid -->
      <div class="masonry-grid" id="masonryGrid">
        ${filteredPins.length ? filteredPins.map(p => {
          const liked = !!myLikes[p.id];
          return '<div class="pin-card" onclick="navigateProp(' + p.id + ')">'
            + '<div class="pin-img-wrap">'
            + '<img src="' + p.img + '" alt="' + p.name + '" style="width:100%;height:' + p.imgH + 'px;object-fit:cover;display:block;" loading="lazy" />'
            + '<div class="pin-top">'
            + (p.badge ? '<div class="pin-badge ' + p.badge + '">' + p.badgeText + '</div>' : '<div></div>')
            + '<button class="pin-like-btn ' + (liked ? 'liked' : '') + '" onclick="event.stopPropagation();feedToggleLike(this,' + p.id + ')" aria-label="Gilla"><i class="ti ti-heart"></i></button>'
            + '</div></div>'
            + '<div class="pin-body"><div class="pin-name">' + p.name + '</div><div class="pin-meta">' + p.meta + '</div>'
            + '<div class="pin-footer"><div class="pin-likes"><i class="ti ti-heart" style="font-size:12px;"></i><strong>' + p.likes + '</strong></div>'
            + (p.interested ? '<div class="pin-interest-badge">' + p.interested + ' intresserade</div>' : '')
            + '</div></div></div>';
        }).join('') : '<div style="grid-column:1/-1;text-align:center;padding:48px 16px;color:var(--ink-muted);font-size:13px;">Inga fastigheter av den här typen just nu.</div>'}
      </div>
    </div>
  `;

  if (isLoggedIn) {
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.onclick = () => { clearSession(); toast("Utloggad."); navigate("welcome"); };
  }

  const searchInput = document.getElementById("feedSearch");
  const dropdown = document.getElementById("searchDropdown");
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 3) { dropdown.style.display = "none"; return; }
      searchTimer = setTimeout(() => feedSearch(q, dropdown, searchInput), 300);
    });
    searchInput.addEventListener("keydown", e => { if (e.key === "Escape") dropdown.style.display = "none"; });
  }
  document.addEventListener("click", e => {
    if (dropdown && !dropdown.contains(e.target) && e.target !== searchInput) dropdown.style.display = "none";
  });

  const nearBtn = document.getElementById("nearMeBtn");
  if (nearBtn) nearBtn.onclick = () => {
    if (!navigator.geolocation) { toast("Din webbläsare stödjer inte platsfunktion."); return; }
    nearBtn.textContent = "Söker...";
    navigator.geolocation.getCurrentPosition(pos => {
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&accept-language=sv`)
        .then(r => r.json())
        .then(data => {
          const area = data.address?.suburb || data.address?.city || "din position";
          toast("Visar fastigheter nära " + area);
          nearBtn.innerHTML = '<i class="ti ti-current-location" style="font-size:15px;"></i> Nära mig';
        }).catch(() => { nearBtn.innerHTML = '<i class="ti ti-current-location" style="font-size:15px;"></i> Nära mig'; });
    }, () => { toast("Kunde inte hämta position."); nearBtn.innerHTML = '<i class="ti ti-current-location" style="font-size:15px;"></i> Nära mig'; }, { timeout: 8000 });
  };
}

// =========================
// PROPERTY VIEW (Besökarvy)
// =========================
function renderPropertyView() {
  const session = loadSession();
  const idStr = currentView.replace("property_", "");
  const prop = PROP_DATA[parseInt(idStr)];
  if (!prop) return navigate("feed");

  const state = loadState();
  const iLiked = !!state.myLikes?.[prop.id];
  const iInterested = !!state.myInterests?.[prop.id];

  app.innerHTML = `
    <div style="min-height:100vh;background:var(--page-bg);">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <button onclick="navigate('feed')" class="btn-ghost" style="font-size:12px;padding:7px 13px;display:flex;align-items:center;gap:6px;">
            <i class="ti ti-arrow-left"></i> Tillbaka
          </button>
        </div>
        <div class="nav-right">
          <button class="btn-ghost" style="font-size:12px;padding:7px 13px;display:flex;align-items:center;gap:5px;" onclick="shareProperty('${prop.name}')">
            <i class="ti ti-share"></i> Dela
          </button>
        </div>
      </nav>

      <div style="position:relative;height:320px;overflow:hidden;">
        <img src="${prop.img}" alt="${prop.name}" style="width:100%;height:100%;object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.5) 0%,transparent 50%);"></div>
        <div style="position:absolute;bottom:20px;left:20px;right:20px;">
          <div style="font-size:26px;font-weight:700;letter-spacing:-.04em;color:#fff;margin-top:8px;line-height:1.1;">${prop.name}</div>
          <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;">${prop.meta}</div>
        </div>
      </div>

      <div style="max-width:680px;margin:0 auto;padding:24px 16px 100px;">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px;">
          ${[{n:prop.likes,l:"Gillar"},{n:prop.interested,l:"Intresserade"},{n:Math.floor(prop.likes*3.2),l:"Visningar"}].map(s=>`
            <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:var(--ink);">${s.n}</div>
              <div style="font-size:11px;color:var(--ink-muted);margin-top:3px;text-transform:uppercase;letter-spacing:.06em;">${s.l}</div>
            </div>
          `).join('')}
        </div>

        ${prop.price ? `<div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;margin-bottom:16px;"><div style="font-size:12px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Pris</div><div style="font-size:28px;font-weight:700;color:var(--ink);">${prop.price}</div></div>` : ''}

        <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;margin-bottom:16px;">
          <div style="font-size:12px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">Om fastigheten</div>
          <div style="font-size:14px;color:var(--ink-soft);line-height:1.7;">${prop.desc}</div>
        </div>

        <!-- Similar listings -->
        <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;margin-bottom:16px;">
          <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:14px;">Liknande objekt i området</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${PROP_DATA.filter(p=>p.id!==prop.id).slice(0,3).map(p=>`
              <div onclick="navigateProp(${p.id})" style="display:flex;gap:12px;align-items:center;cursor:pointer;padding:10px;border-radius:10px;border:0.5px solid rgba(17,24,39,.07);">
                <img src="${p.img}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;" />
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:var(--ink);">${p.name}</div>
                  <div style="font-size:11px;color:var(--ink-muted);margin-top:2px;">${p.meta}</div>
                </div>
                <i class="ti ti-chevron-right" style="font-size:16px;color:#D1D5DB;"></i>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div style="position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:0.5px solid rgba(17,24,39,.08);padding:12px 16px;display:flex;gap:10px;z-index:50;">
        <button id="propLikeBtn" onclick="propToggleLike(${prop.id})" style="flex:1;padding:13px;border-radius:12px;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:pointer;border:1.5px solid ${iLiked?'#2563eb':'rgba(17,24,39,.12)'};background:${iLiked?'#EFF6FF':'#fff'};color:${iLiked?'#2563eb':'#111827'};display:flex;align-items:center;justify-content:center;gap:8px;">
          <i class="ti ti-thumb-up"></i> ${iLiked ? 'Gillad' : 'Gilla'}
        </button>
        <button id="propInterestBtn" onclick="propToggleInterest(${prop.id})" style="flex:1;padding:13px;border-radius:12px;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:pointer;border:1.5px solid ${iInterested?'#CC2936':'rgba(17,24,39,.12)'};background:${iInterested?'#FDECEA':'#fff'};color:${iInterested?'#CC2936':'#111827'};display:flex;align-items:center;justify-content:center;gap:8px;">
          <i class="ti ti-star"></i> ${iInterested ? 'Intresserad' : 'Visa intresse'}
        </button>
      </div>
    </div>
  `;
}

function propToggleLike(id) {
  const session = loadSession();
  if (!session?.email) { openAuthModal('reg'); toast("Skapa konto för att gilla!"); return; }
  const s = loadState();
  s.myLikes = s.myLikes || {};
  const already = !!s.myLikes[id];
  if (already) { delete s.myLikes[id]; toast("Gillning borttagen."); }
  else { s.myLikes[id] = true; toast("Fastigheten är gillad!"); }
  saveState(s);
  renderPropertyView();
}

function propToggleInterest(id) {
  const session = loadSession();
  if (!session?.email) { openAuthModal('reg'); toast("Skapa konto för att visa intresse!"); return; }
  const s = loadState();
  s.myInterests = s.myInterests || {};
  const already = !!s.myInterests[id];
  if (already) { delete s.myInterests[id]; toast("Intresse borttaget."); }
  else {
    openInterestModal(PROP_DATA[id], String(id), PROP_DATA[id]?.name || '');
    return;
  }
  saveState(s);
  renderPropertyView();
}

// Varje checklist-steg leder till rätt ställe. Inget steg är obligatoriskt.
function runOnboardingStep(id) {
  switch (id) {
    case "role":    return reopenRolePicker();
    case "notify":  return toggleNotifyPref();
    case "claim":   return openClaimModal();
    case "wish":
      if (!loadState().ownerParcelId) { toast("Koppla din fastighet först, så kan du sätta ett önskepris."); return openClaimModal(); }
      document.getElementById("wishPriceInput")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("wishPriceInput")?.focus();
      return;
    case "photo":   return document.getElementById("homeImageInput")?.click();
    case "area":    return navigate("map");
    case "likes":
    case "explore": return navigate("map");
  }
}

function reopenRolePicker() {
  const p = getProfile();
  // Tvinga fram väljaren igen även om rollen redan är satt
  saveProfile({ welcomeSkipped: false });
  const s = loadState();
  if (s.profile) { delete s.profile.role; saveState(s); }
  maybeShowWelcomeFlow();
}

function toggleNotifyPref() {
  const cur = getProfile().notify;
  const next = cur === true ? false : true;
  saveProfile({ notify: next });
  toast(next ? "Aviseringar på. Vi hör av oss när något händer." : "Aviseringar av.");
  if (currentView === "dashboard") render();
}

function renderDashboard() {
  const session = loadSession();
  if (!session?.email) return navigate("welcome");
  const users   = loadUsers();
  const user    = users[session.email];
  const state   = loadState();
  const ownerId = state.ownerParcelId;
  const ownerName = ownerId ? state.parcelNames?.[ownerId] || ownerId : null;
  const claimStatus = state.claimStatus || null;
  const myLikedIds = Object.keys(state.myLikes || {});
  const ownerLikes = ownerId ? state.likes?.[ownerId] || 0 : 0;
  const ownerInterests = ownerId ? state.interests?.[ownerId] || 0 : 0;
  const homeProfile = getHomeProfile(user);
  const images = homeProfile.images || [];

  const houseSvg = `<svg style="position:absolute;inset:0;width:100%;height:100%;" viewBox="0 0 960 280" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="280" fill="#1a2533"/><rect y="180" width="960" height="100" fill="#2a1a08"/><circle cx="840" cy="50" r="24" fill="#f5e6c8" opacity=".16"/><circle cx="840" cy="50" r="17" fill="#f5e6c8" opacity=".20"/><circle cx="75" cy="35" r="1.1" fill="white" opacity=".55"/><circle cx="200" cy="20" r="1" fill="white" opacity=".5"/><circle cx="360" cy="48" r="1.2" fill="white" opacity=".6"/><circle cx="520" cy="16" r="1" fill="white" opacity=".4"/><circle cx="650" cy="40" r="1.1" fill="white" opacity=".55"/><circle cx="770" cy="26" r="1" fill="white" opacity=".45"/><polygon points="18,182 48,105 78,182" fill="#0d1a0d"/><polygon points="42,182 74,112 106,182" fill="#101f10"/><polygon points="855,182 885,103 915,182" fill="#0d1a0d"/><polygon points="880,182 912,110 944,182" fill="#101f10"/><rect x="345" y="128" width="270" height="148" rx="2" fill="#2C1A0E"/><polygon points="320,133 480,55 640,133" fill="#1a0f06"/><rect x="560" y="64" width="24" height="44" rx="2" fill="#1a0f06"/><rect x="370" y="150" width="50" height="40" rx="3" fill="#3a2510"/><rect x="371" y="151" width="48" height="38" rx="2" fill="#CC2936" opacity=".22"/><line x1="395" y1="151" x2="395" y2="189" stroke="#2a1508" stroke-width="1.5"/><line x1="371" y1="170" x2="419" y2="170" stroke="#2a1508" stroke-width="1.5"/><rect x="437" y="150" width="50" height="40" rx="3" fill="#3a2510"/><rect x="438" y="151" width="48" height="38" rx="2" fill="#e8a060" opacity=".26"/><line x1="462" y1="151" x2="462" y2="189" stroke="#2a1508" stroke-width="1.5"/><line x1="438" y1="170" x2="486" y2="170" stroke="#2a1508" stroke-width="1.5"/><rect x="504" y="150" width="50" height="40" rx="3" fill="#3a2510"/><rect x="505" y="151" width="48" height="38" rx="2" fill="#CC2936" opacity=".16"/><line x1="529" y1="151" x2="529" y2="189" stroke="#2a1508" stroke-width="1.5"/><line x1="505" y1="170" x2="553" y2="170" stroke="#2a1508" stroke-width="1.5"/><rect x="430" y="190" width="40" height="86" rx="2" fill="#1a0f06"/><rect x="431" y="191" width="38" height="84" rx="1.5" fill="#CC2936" opacity=".13"/></svg>`;

  app.innerHTML = `
    <div class="dashboard-page">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo" onclick="navigate('welcome')" style="cursor:pointer;">
            <svg width="18" height="23" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
          <div class="nav-greeting">Hej, ${user?.name || ""}!</div>
        </div>
        <div class="nav-center">
          <button class="nav-tab active" onclick="navigate('dashboard')">Min sida</button>
          <button class="nav-tab" onclick="navigate('feed')">Utforska</button>
          <button class="nav-tab" onclick="currentView='map';render();">Karta</button>
        </div>
        <div class="nav-right">
          <button class="btn-ghost" style="font-size:12px;padding:7px 13px;" id="logoutBtn">Logga ut</button>
        </div>
      </nav>
      <div class="dashboard-body">
        ${(() => {
          const p = getProfile();
          const role = p.role;
          const steps = onboardingSteps(role);
          const doneCount = steps.filter(x => x.done).length;
          const allDone = doneCount === steps.length;
          const roleLabel = role ? ROLES[role].label : null;

          const titles = {
            owner:  ["Din fastighet", "Min sida", "Se vad folk tycker om ditt hus och håll koll på intresset."],
            seeker: ["Din bevakning", "Min sida", "Husen du gillat och områdena du håller ett öga på."],
            curious:["Ditt ifound", "Min sida", "Husen du fastnat för — och nästa steg när du vill mer."],
          };
          const [eyebrow, title, sub] = titles[role] || ["Din profil", "Min sida", "Kom igång med några enkla steg."];

          return `
            <div class="page-eyebrow">${eyebrow}</div>
            <div class="page-title-row">
              <div class="page-title">${title}</div>
              ${role ? `<button class="role-chip" onclick="reopenRolePicker()"><i class="ti ${ROLES[role].icon}"></i> ${roleLabel} <i class="ti ti-chevron-down" style="font-size:12px;opacity:.6;"></i></button>` : ""}
            </div>
            <div class="page-sub">${sub}</div>

            ${allDone ? "" : `
            <div class="setup-card">
              <div class="setup-head">
                <div>
                  <div class="setup-title">Bygg din sida</div>
                  <div class="setup-sub">${doneCount} av ${steps.length} klart · gör resten när du vill</div>
                </div>
                <div class="setup-ring" style="--pct:${Math.round(doneCount/steps.length*100)}">
                  <span>${Math.round(doneCount/steps.length*100)}%</span>
                </div>
              </div>
              <div class="setup-steps">
                ${steps.map(st => `
                  <button class="setup-step ${st.done ? "is-done" : ""}" ${st.done ? "disabled" : `onclick="runOnboardingStep('${st.id}')"`}>
                    <span class="setup-check"><i class="ti ${st.done ? "ti-circle-check-filled" : st.icon}"></i></span>
                    <span class="setup-step-text">
                      <strong>${st.label}</strong>
                      <em>${st.desc}</em>
                    </span>
                    ${st.done ? `<span class="setup-done-tag">Klart</span>` : `<i class="ti ti-arrow-right setup-step-arrow"></i>`}
                  </button>
                `).join("")}
              </div>
            </div>`}
          `;
        })()}

        <div class="hero-section">
          ${images.length ? `<img src="${images[0]}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" alt="Bostad" />` : houseSvg}
          <div class="hero-overlay"></div>
          <button onclick="document.getElementById('homeImageInput').click()" style="position:absolute;top:14px;right:14px;z-index:3;background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.4);color:#fff;border-radius:10px;padding:7px 13px;font-size:12px;font-weight:600;font-family:var(--font-body);cursor:pointer;display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px);">
            <i class="ti ti-camera"></i> ${images.length ? 'Byt bild' : 'Lägg till bild'}
          </button>
          <div class="hero-content">
            <div class="status-row">
              <button class="status-pill active-passive" id="sp-passive" onclick="setStatus('passive')">Passiv</button>
              <button class="status-pill" id="sp-rent" onclick="setStatus('rent')">Till uthyrning</button>
              <button class="status-pill" id="sp-sale" onclick="setStatus('sale')">Till salu</button>
            </div>
            <div class="hero-name">${ownerName || "Ingen fastighet kopplad ännu"}</div>
            <div class="hero-meta" id="hero-meta">Fastigheten visas passivt — besökare kan visa intresse utan aktiv försäljning.</div>
            <div class="hero-actions">
              ${ownerId ? `<button class="hero-btn primary" onclick="navigate('map')"><i class="ti ti-map-pin"></i> Visa i kartan</button>` : `<button class="hero-btn primary" onclick="openClaimModal()"><i class="ti ti-home-check"></i> Claima din fastighet</button>`}
              ${ownerId && claimStatus === 'pending' ? `<span style="background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.3);color:#fff;border-radius:999px;padding:5px 13px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;"><i class="ti ti-clock" style="font-size:13px;"></i> Verifieras inom 24h</span>` : ''}
              ${ownerId && claimStatus === 'verified' ? `<span style="background:rgba(22,163,74,.2);border:1.5px solid rgba(22,163,74,.4);color:#fff;border-radius:999px;padding:5px 13px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:6px;"><i class="ti ti-check" style="font-size:13px;"></i> Verifierad ägare</span>` : ''}
              ${ownerId ? `<button class="hero-btn" id="clearOwnerBtn"><i class="ti ti-switch-horizontal"></i> Byt fastighet</button>` : ""}
            </div>
          </div>
        </div>

        <div class="stats-strip">
          <div class="stat-tile"><div class="stat-icon"><i class="ti ti-thumb-up"></i></div><div><div class="stat-num">${ownerLikes}</div><div class="stat-lbl">Gillar</div></div></div>
          <div class="stat-tile"><div class="stat-icon"><i class="ti ti-star"></i></div><div><div class="stat-num">${ownerInterests}</div><div class="stat-lbl">Intresserade</div></div></div>
          <button class="stat-tile stat-tile-btn" onclick="currentView='saved';render();"><div class="stat-icon"><i class="ti ti-heart"></i></div><div><div class="stat-num">${myLikedIds.length}</div><div class="stat-lbl">Sparade objekt</div></div><i class="ti ti-chevron-right stat-tile-arrow"></i></button>
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
                  <div class="field-group"><label class="label">Visningsdatum</label><input class="input" type="date" /></div>
                </div>
              </div>
              <button class="save-btn" id="saveHomeProfileBtn">Spara profil</button>
            </div>
          </div>
          <div>
            ${ownerId ? (() => {
              const wp = (state.wishPrices || {})[ownerId] || {};
              const amount = wp.amount || "";
              const visible = !!wp.visible;
              return `
            <div class="card wish-card" style="margin-bottom:12px;">
              <div class="card-title">Önskepris</div>
              <div class="wish-intro">
                Din fastighet är <strong>inte</strong> till salu. Men anger du vad du skulle kunna tänka dig att sälja för vet den som är intresserad om det är någon idé att höra av sig — och du slipper bud som ligger långt under.
              </div>

              <div class="wish-input-row">
                <input id="wishPriceInput" class="input" inputmode="numeric" placeholder="t.ex. 4 200 000" value="${amount}" />
                <span class="wish-suffix">kr</span>
              </div>

              <label class="wish-toggle">
                <input type="checkbox" id="wishPriceVisible" ${visible ? "checked" : ""} />
                <span>
                  <strong>Visa priset för intressenter</strong>
                  <em>${visible
                    ? "Den som visar intresse ser summan direkt."
                    : "Priset är privat. Du ser det själv, men ingen annan."}</em>
                </span>
              </label>

              <button class="save-btn" id="saveWishPriceBtn">Spara önskepris</button>

              ${wp.updatedAt ? `<div class="wish-meta">Senast ändrat ${new Date(wp.updatedAt).toLocaleDateString("sv-SE")}</div>` : ""}
            </div>`;
            })() : ""}
            <div class="card" style="margin-bottom:12px;">
              <div class="card-title">Aktivitet</div>
              ${ownerId && state.interestMessages?.[ownerId]?.length ? `
                <div style="margin-bottom:12px;padding:12px;background:var(--accent-soft);border-radius:10px;">
                  <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <i class="ti ti-message" style="font-size:14px;"></i>
                    ${state.interestMessages[ownerId].length} meddelande${state.interestMessages[ownerId].length > 1 ? 'n' : ''} från intressenter
                  </div>
                  ${state.interestMessages[ownerId].map(m => `
                    <div style="background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:12px;color:var(--ink-soft);line-height:1.5;border:0.5px solid rgba(204,41,54,.15);">
                      "${m.message}"
                      <div style="font-size:10px;color:var(--ink-muted);margin-top:4px;">${new Date(m.sentAt).toLocaleDateString('sv-SE')} · Anonymt</div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              <div class="act-row"><div class="act-dot"></div>Utforska fastigheter på kartan</div>
              <div class="act-row"><div class="act-dot"></div>Markera intresse på objekt du gillar</div>
              <div class="act-row"><div class="act-dot"></div>Välj ägarläge och koppla din fastighet</div>
              <div class="act-row"><div class="act-dot"></div>Se vem som är intresserad av din bostad</div>
            </div>
            <div class="card" style="margin-bottom:12px;">
              <div class="card-title">Du följer</div>
              ${(() => {
                const follows = Object.keys(state.myFollows || {});
                const areaFollows = Object.keys(state.areaFollows || {});
                if (!follows.length && !areaFollows.length) {
                  return '<div style="font-size:12px;color:var(--ink-muted);line-height:1.6;">Följ fastigheter och områden på kartan så får du en notis när något händer.</div>';
                }
                return follows.map(fpid => `
                  <div class="act-row" style="justify-content:space-between;">
                    <span style="display:flex;align-items:center;gap:8px;"><i class="ti ti-bell-check" style="font-size:13px;color:var(--accent);"></i>${(state.parcelNames || {})[fpid] || fpid}</span>
                  </div>
                `).join('') + areaFollows.map(a => `
                  <div class="act-row" style="justify-content:space-between;">
                    <span style="display:flex;align-items:center;gap:8px;"><i class="ti ti-map-pin" style="font-size:13px;color:var(--accent);"></i>${a} <span style="font-size:10px;color:var(--ink-muted);">område</span></span>
                  </div>
                `).join('');
              })()}
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

  // Visa välkomstflödet för den som inte valt roll ännu
  maybeShowWelcomeFlow();

  const clearBtn = document.getElementById("clearOwnerBtn");
  if (clearBtn) clearBtn.onclick = () => { const s = loadState(); s.ownerParcelId = null; saveState(s); toast("Välj en ny fastighet."); render(); };

  const wishBtn = document.getElementById("saveWishPriceBtn");
  if (wishBtn) wishBtn.onclick = () => {
    const raw = document.getElementById("wishPriceInput").value;
    const visible = document.getElementById("wishPriceVisible").checked;
    const digits = String(raw).replace(/\D/g, "");
    const st = loadState();
    st.wishPrices = st.wishPrices || {};
    const pid = st.ownerParcelId;
    if (!pid) return;

    if (!digits) {
      delete st.wishPrices[pid];
      saveState(st);
      toast("Önskepriset är borttaget.");
      return render();
    }
    const num = parseInt(digits, 10);
    if (num < 10000) { toast("Ange priset i kronor, till exempel 4 200 000."); return; }

    st.wishPrices[pid] = {
      amount: num.toLocaleString("sv-SE"),
      value: num,
      visible,
      updatedAt: new Date().toISOString(),
    };
    saveState(st);
    toast(visible ? "Önskepriset sparat och synligt för intressenter." : "Önskepriset sparat — bara du ser det.");
    render();
  };

  // Formatera med tusentalsavgränsare medan man skriver
  const wishInput = document.getElementById("wishPriceInput");
  if (wishInput) wishInput.addEventListener("input", () => {
    const d = wishInput.value.replace(/\D/g, "");
    wishInput.value = d ? parseInt(d, 10).toLocaleString("sv-SE") : "";
  });

  document.getElementById("saveHomeProfileBtn").onclick = () => {
    const u = getCurrentUser(); if (!u) return;
    u.homeProfile = { ...getHomeProfile(u), title: document.getElementById("homeTitleInput").value.trim(), description: document.getElementById("homeDescriptionInput").value.trim() };
    saveCurrentUser(u); toast("Bostadsprofil sparad."); render();
  };

  document.getElementById("homeImageInput").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3); if (!files.length) return;
    const u = getCurrentUser(); if (!u) return;
    const profile = getHomeProfile(u);
    try {
      const newImgs = await Promise.all(files.map(readImageAsDataUrl));
      u.homeProfile = { ...profile, images: [...(profile.images || []), ...newImgs].slice(0, 3) };
      saveCurrentUser(u); toast("Bild uppladdad."); render();
    } catch (err) {
      console.error("Bilduppladdning misslyckades:", err);
      toast("Kunde inte ladda upp bilden — prova en annan bild.");
    }
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
  const savedMode = loadSavedMapMode();
  const isLoggedIn = !!session?.email;

  app.innerHTML = `
    <div class="map-shell">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <div class="logo" onclick="navigate('welcome')" style="cursor:pointer;">
            <svg width="18" height="23" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
            <span class="logo-text">i<em>found</em></span>
          </div>
          ${isLoggedIn ? `<div class="nav-greeting">Hej, ${getCurrentUser()?.name || ""}!</div>` : ''}
        </div>
        <div class="nav-center">
          ${isLoggedIn ? `<button class="nav-tab" onclick="navigate('dashboard')">Min sida</button>` : ''}
          <button class="nav-tab" onclick="currentView='feed';render();">Utforska</button>
          <button class="nav-tab active">Karta</button>
          <button class="nav-tab" onclick="navigate('buildNew')">Bygga nytt hus</button>
        </div>
        <div class="nav-right">
          ${isLoggedIn
            ? `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" id="logoutBtnMap">Logga ut</button>`
            : `<button class="btn-ghost" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('login')">Logga in</button>
               <button class="btn-primary" style="font-size:12px;padding:7px 13px;" onclick="openAuthModal('reg')">Kom igång</button>`
          }
        </div>
      </nav>
    <div class="map-page">
      <div class="map-overlay map-tl">
        <div class="glass-card map-search">
          <input id="addressSearch" class="map-search-input" placeholder="Sök adress eller fastighet..." />
          <button id="searchBtn" class="map-search-btn"><i class="ti ti-search" aria-hidden="true"></i></button>
          <div id="searchDropdown" style="display:none;position:absolute;top:calc(100% + 8px);left:0;right:0;background:#fff;border:0.5px solid rgba(17,24,39,.10);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.10);z-index:100;overflow:hidden;max-height:280px;overflow-y:auto;"></div>
        </div>
      </div>

      <div class="map-overlay map-tr">
        <div class="glass-card map-toolbar">
          <select id="modeSelect" class="toolbar-select">
            <option value="visitor" ${savedMode==="visitor"?"selected":""}>Besökarläge</option>
            ${isLoggedIn ? '<option value="owner" ' + (savedMode==="owner"?"selected":"") + '>Ägarläge</option>' : ''}
          </select>
          <button id="nearMeMapBtn" class="toolbar-btn"><i class="ti ti-current-location" aria-hidden="true"></i> Nära mig</button>
          <button id="toggleMapStyleBtn" class="toolbar-btn">Kartvy</button>
        </div>
      </div>

      <div class="map-overlay map-bl">
        <div class="glass-card map-brand">
          <div class="map-brand-name">i<em>found</em></div>
          <div class="map-brand-sub" id="mapStatus">Laddar fastigheter...</div>
        </div>
      </div>

      <div class="map-wrap"><div id="map"></div></div>
      <div id="panel" class="panel hidden"></div>
    </div>
    </div>
    <style>
      .ifound-popup .leaflet-popup-content-wrapper {
        border-radius: 14px;
        box-shadow: 0 8px 32px rgba(17,24,39,.15);
        padding: 0;
        overflow: hidden;
      }
      .ifound-popup .leaflet-popup-content { margin: 0 !important; width: auto !important; }
      .ifound-popup .leaflet-popup-tip-container { margin-top: -1px; }
      .ifound-popup .leaflet-popup-tip { background: #fff; }
      .ifound-popup .leaflet-popup-close-button { color: #fff !important; font-size: 18px !important; padding: 6px 8px !important; z-index: 10; text-shadow: 0 1px 3px rgba(0,0,0,.5); }

    </style>
  `;

  ensureMapMounted();

  // Sync base layer
  ["map","satellite"].forEach(k => {
    if (baseLayers[k] && map.hasLayer(baseLayers[k]) && currentBase !== k) map.removeLayer(baseLayers[k]);
  });
  if (baseLayers[currentBase] && !map.hasLayer(baseLayers[currentBase])) {
    baseLayers[currentBase].addTo(map);
  }

  // If we have cached GeoJSON use it, otherwise fetch fresh
  const cached = localStorage.getItem(LS_GEOJSON);
  if (cached) {
    try {
      const gj = JSON.parse(cached);
      addGeoJsonToMap(gj, { keepView: true });
      updateMapStatus(gj.features?.length || 0);
      addClaimedMarkers();
    } catch { autoLoadCentrum(); }
  } else {
    autoLoadCentrum();
  }

  // Controls
  document.getElementById("toggleMapStyleBtn").onclick = () => {
    if (!map) return;
    if (baseLayers[currentBase] && map.hasLayer(baseLayers[currentBase])) map.removeLayer(baseLayers[currentBase]);
    currentBase = currentBase === "map" ? "satellite" : "map";
    baseLayers[currentBase].addTo(map);
    document.getElementById("toggleMapStyleBtn").textContent = currentBase === "map" ? "Flygfoto" : "Kartvy";
  };

  document.getElementById("modeSelect").addEventListener("change", e => {
    if (e.target.value === "owner" && !loadSession()?.email) {
      e.target.value = "visitor";
      openAuthModal("reg");
      toast("Skapa ett konto för att claima din fastighet!");
      return;
    }
    saveMapMode(e.target.value); closePanel(); redrawLayer();
  });

  if (isLoggedIn) {
    const logoutBtn = document.getElementById("logoutBtnMap");
    if (logoutBtn) logoutBtn.onclick = () => { clearSession(); toast("Utloggad."); navigate("welcome"); };
  }

  document.getElementById("nearMeMapBtn").onclick = () => {
    const btn = document.getElementById("nearMeMapBtn");
    if (!navigator.geolocation) { toast("Din webbläsare stödjer inte platsfunktion."); return; }
    if (!map) { toast("Kartan är inte laddad ännu."); return; }
    btn.textContent = "Söker...";
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        map.setView([lat, lng], 16);
        if (locateMarker) { try { locateMarker.remove(); } catch {} }
        locateMarker = L.circleMarker([lat, lng], {
          radius: 10, weight: 3, color: "#CC2936", fillColor: "#CC2936", fillOpacity: 0.9
        }).addTo(map);
        toast("Visar fastigheter nära dig.");
        btn.innerHTML = '<i class="ti ti-current-location" aria-hidden="true"></i> Nära mig';
        btn.disabled = false;
      },
      () => {
        toast("Kunde inte hämta din position — kontrollera att platsbehörighet är tillåten.");
        btn.innerHTML = '<i class="ti ti-current-location" aria-hidden="true"></i> Nära mig';
        btn.disabled = false;
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Search with autocomplete
  const searchInput = document.getElementById("addressSearch");
  const dropdown   = document.getElementById("searchDropdown");
  let searchTimer  = null;

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 3) { dropdown.style.display = "none"; return; }
    searchTimer = setTimeout(() => mapSearch(q, dropdown, searchInput), 300);
  });

  searchInput.addEventListener("keydown", e => {
    if (e.key === "Escape") { dropdown.style.display = "none"; }
    if (e.key === "Enter") {
      const first = dropdown.querySelector("div[data-lat]");
      if (first) first.click();
    }
  });

  document.addEventListener("click", e => {
    if (!dropdown.contains(e.target) && e.target !== searchInput) dropdown.style.display = "none";
  });

  setTimeout(() => {
    try { map.invalidateSize(); } catch {}
    addClaimedMarkers();
  }, 120);
}


// =========================
// CUSTOM MARKERS
// =========================

// Mock claimed properties for demo — in production these come from database
const CLAIMED_PROPS = [
  { id: "RÅDHUSET 3>1",      lat: 56.04661, lon: 12.69311, status: "passive", name: "Rådhuset 3:1",      likes: 18, interested: 4,  area: "Villa · Centrum",       img: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=60" },
  { id: "PÅLSJÖ 1>27",       lat: 56.07200, lon: 12.70200, status: "sale",    name: "Pålsjö 1:27",       likes: 31, interested: 11, price: "4 200 000 kr", area: "Villa · Pålsjö",         img: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=60" },
  { id: "SÖDER 1>102",       lat: 56.03324, lon: 12.71180, status: "rent",    name: "Söder 1:102",       likes: 14, interested: 5,  price: "9 800 kr/mån",  area: "Lägenhet · Söder",       img: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&q=60" },
  { id: "FREDRIKSDAL 1>1",   lat: 56.06038, lon: 12.72680, status: "sale",    name: "Fredriksdal 1:1",   likes: 19, interested: 6,  price: "5 750 000 kr", area: "Villa · Fredriksdal",    img: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&q=60" },
  { id: "LARÖD 49>126",      lat: 56.08092, lon: 12.71870, status: "passive", name: "Laröd 49:126",      likes: 41, interested: 9,  area: "Gård · Laröd · 5 200 kvm", img: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&q=60" },
  { id: "KULLA 1>4",         lat: 56.06800, lon: 12.73500, status: "passive", name: "Kulla 1:4",         likes: 24, interested: 7,  area: "Tomt · 2 400 kvm",      img: "https://images.unsplash.com/photo-1449844908441-8829872d2607?w=400&q=60" },
  { id: "SÖDER 8>22B",       lat: 56.04100, lon: 12.70500, status: "rent",    name: "Söder 8:22B",       likes: 8,  interested: 3,  price: "7 500 kr/mån",  area: "Lägenhet · Söder",       img: "https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=400&q=60" },
];

// User's own claimed property (always shown if claimedByCurrentUser)
const OWNER_PARCEL_COORDS = {
  "VENDELA 11": { lat: 56.04027, lon: 12.72815 },
};

let markerLayer = null;

function createMarkerIcon(status) {
  // SVG icons for each status
  const icons = {
    passive: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 28 36">
      <path d="M14 0C6.3 0 0 6.3 0 14C0 24.5 14 36 14 36S28 24.5 28 14C28 6.3 21.7 0 14 0Z" fill="#6B7280"/>
      <circle cx="14" cy="14" r="6" fill="white" opacity="0.9"/>
    </svg>`,

    sale: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 64 78">
      <path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/>
      <polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/>
      <rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/>
      <rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/>
    </svg>`,

    rent: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
      <path d="M15 0C6.7 0 0 6.7 0 15C0 26.3 15 38 15 38S30 26.3 30 15C30 6.7 23.3 0 15 0Z" fill="#2563eb"/>
      <polygon points="7,16 15,8 23,16" fill="white" opacity=".95"/>
      <rect x="9" y="16" width="12" height="9" rx="1" fill="white" opacity=".95"/>
      <rect x="12" y="19" width="5" height="6" rx=".5" fill="#2563eb"/>
    </svg>`,

    broker_sale: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 64 78">
      <path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/>
      <polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/>
      <rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/>
      <rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/>
    </svg>`,
  };

  const svgStr = icons[status] || icons.passive;
  const sizes = { passive: [28,36], sale: [32,40], rent: [30,38] };
  const [w, h] = sizes[status] || [28,36];

  return L.divIcon({
    html: svgStr,
    className: '',
    iconSize: [w, h],
    iconAnchor: [w/2, h],
    popupAnchor: [0, -h],
  });
}

function addClaimedMarkers() {
  if (!map) return;
  if (markerLayer) { markerLayer.remove(); markerLayer = null; }
  markerLayer = L.layerGroup().addTo(map);

  const state = loadState();
  const ownerId = state.ownerParcelId;
  const allProps = [...CLAIMED_PROPS];

  // Add user's own claimed property
  if (ownerId) {
    const ownerName = state.parcelNames?.[ownerId] || ownerId;
    let lat = state.ownerLat;
    let lon = state.ownerLon;

    // Check hardcoded coords first
    if (!lat || !lon) {
      const ownerNorm = ownerId.toUpperCase().trim();
      const hardcoded = OWNER_PARCEL_COORDS[ownerNorm];
      if (hardcoded) { lat = hardcoded.lat; lon = hardcoded.lon; }
    }
    // Then try parcelsLayer centroid
    if ((!lat || !lon) && parcelsLayer) {
      try {
        const ownerNorm = ownerId.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'');
        parcelsLayer.eachLayer(layer => {
          if (lat && lon) return;
          if (!layer.feature) return;
          const fname = (layer.feature.properties?.fastighet || '').toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'');
          const pid = getParcelId(layer.feature).toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'');
          if (pid === ownerNorm || fname === ownerNorm || fname.startsWith(ownerNorm)) {
            const bounds = layer.getBounds?.();
            if (bounds?.isValid()) {
              const c = bounds.getCenter();
              lat = c.lat; lon = c.lng;
              const s = loadState(); s.ownerLat = lat; s.ownerLon = lon; saveState(s);
            }
          }
        });
      } catch(e) { console.warn(e); }
    }

    if (lat && lon && !allProps.find(p => p.id === ownerId)) {
      const vis = state.claimData?.visibility;
      allProps.push({
        id: ownerId, lat, lon,
        status: vis === 'sale' ? 'sale' : vis === 'rent' ? 'rent' : 'passive',
        name: ownerName,
        likes: state.likes?.[ownerId] || 0,
        interested: state.interests?.[ownerId] || 0,
      });
    }
  }

  allProps.forEach(prop => {
    const icon = createMarkerIcon(prop.status);
    const marker = L.marker([prop.lat, prop.lon], { icon, zIndexOffset: 1000 });

    const statusLabel = { passive: 'Passiv', sale: 'Till salu', rent: 'Uthyrning' }[prop.status] || 'Passiv';
    const statusColor = { passive: '#6B7280', sale: '#CC2936', rent: '#2563eb' }[prop.status] || '#6B7280';

    // Find matching PROP_DATA entry for image
    const propDataMatch = (typeof PROP_DATA !== 'undefined') ? PROP_DATA.find(p =>
      p.name.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'') === prop.name.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'')
    ) : null;
    const imgSrc = prop.img || propDataMatch?.img || null;
    const area = prop.area || propDataMatch?.meta || '';

    marker.bindPopup(`
      <div style="font-family:var(--font-body);width:220px;overflow:hidden;">
        ${imgSrc ? `
          <div style="margin:-1px -1px 0;height:130px;overflow:hidden;border-radius:12px 12px 0 0;">
            <img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;display:block;" />
          </div>
        ` : `
          <div style="margin:-1px -1px 0;height:80px;background:linear-gradient(135deg,#1a2533,#2a1a08);border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:center;">
            <svg width="32" height="40" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936" opacity=".6"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".8"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".8"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936" opacity=".6"/></svg>
          </div>
        `}
        <div style="padding:12px 14px 14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:10px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:.08em;background:${statusColor}18;padding:2px 7px;border-radius:999px;">${statusLabel}</span>
            ${prop.price ? `<span style="font-size:12px;font-weight:700;color:var(--ink);">${prop.price}</span>` : ''}
          </div>
          <div style="font-size:14px;font-weight:700;letter-spacing:-.03em;color:var(--ink);margin-bottom:2px;">${prop.name}</div>
          ${area ? `<div style="font-size:11px;color:var(--ink-muted);margin-bottom:10px;">${area}</div>` : '<div style="margin-bottom:10px;"></div>'}
          <div style="display:flex;gap:0;border-top:0.5px solid #F3F4F6;padding-top:10px;">
            <div style="flex:1;text-align:center;">
              <div style="font-size:17px;font-weight:700;color:var(--ink);line-height:1;">${prop.likes}</div>
              <div style="font-size:9px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;margin-top:2px;">Gillar</div>
            </div>
            <div style="width:0.5px;background:var(--surface-2);"></div>
            <div style="flex:1;text-align:center;">
              <div style="font-size:17px;font-weight:700;color:var(--ink);line-height:1;">${prop.interested}</div>
              <div style="font-size:9px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;margin-top:2px;">Intresserade</div>
            </div>
          </div>
        </div>
      </div>
    `, { maxWidth: 240, className: 'ifound-popup', offset: [0, -8] });

    markerLayer.addLayer(marker);
  });
}

function autoLoadCentrum() {
  const statusEl = document.getElementById("mapStatus");
  if (statusEl) statusEl.textContent = "Hämtar fastighetsdata...";

  // Hämtas från den egna sajten, inte från raw.githubusercontent.com.
  // GitHubs råfilstjänst är byggd för enstaka nedladdningar och strypar med
  // HTTP 429 per IP — vid skarp trafik hade kartan slutat fungera för alla
  // samtidigt. Filen deployas ändå med projektet, så omvägen fyllde ingen
  // funktion. GitHub finns kvar som reserv om filen skulle saknas lokalt.
  const LOCAL_URL = "helsingborg_centrum.geojson";
  const FALLBACK_URL = "https://raw.githubusercontent.com/MANIfound/ifound/main/helsingborg_centrum.geojson";

  const load = (url, isFallback) => fetch(url)
    .then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(geojson => {
      if (isFallback) console.warn("[ifound] Lokal geojson saknas — hämtade från GitHub. Lägg filen i projektroten.");
      geojson = reprojectGeoJsonIfNeeded(geojson);
      addGeoJsonToMap(geojson, { keepView: false });
      updateMapStatus(geojson.features?.length || 0);
      try { localStorage.setItem(LS_GEOJSON, JSON.stringify(geojson)); } catch {}
      addClaimedMarkers();
    });

  load(LOCAL_URL, false)
    .catch(() => load(FALLBACK_URL, true))
    .catch(err => {
      console.error("[ifound] Kunde inte ladda fastighetsdata:", err.message);
      if (statusEl) statusEl.textContent = "Kunde inte ladda fastighetsdata";
      // Sista utvägen: tidigare hämtad data ur webbläsarens lagring
      try {
        const cached = localStorage.getItem(LS_GEOJSON);
        if (cached) {
          const gj = JSON.parse(cached);
          addGeoJsonToMap(gj, { keepView: false });
          updateMapStatus(gj.features?.length || 0);
          addClaimedMarkers();
          toast("Visar senast hämtade fastighetsdata.");
          return;
        }
      } catch {}
      toast("Kunde inte hämta fastighetsdata — försök igen om en stund.");
    });
}

function updateMapStatus(count) {
  const el = document.getElementById("mapStatus");
  if (el) el.textContent = count.toLocaleString("sv-SE") + " fastigheter laddade";
}

async function feedSearch(query, dropdown, input) {
  dropdown.style.display = "block";
  dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--ink-muted);">Söker...</div>';

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&countrycodes=se&accept-language=sv&polygon_geojson=1`;
    const res = await fetch(url);
    const results = await res.json();

    if (!results.length) {
      dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--ink-muted);">Inga resultat</div>';
      return;
    }

    window._feedSearchResults = results;

    dropdown.innerHTML = results.map((r, idx) => {
      const name = r.display_name.split(",").slice(0,2).join(", ");
      return `<div data-idx="${idx}"
        style="padding:11px 16px;font-size:13px;color:var(--ink);cursor:pointer;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;gap:10px;"
        onmouseover="this.style.background='#F9F6F1'" onmouseout="this.style.background=''">
        <i class="ti ti-map-pin" style="font-size:14px;color:var(--accent);flex-shrink:0;" aria-hidden="true"></i>
        <span>${name}</span>
      </div>`;
    }).join('');

    dropdown.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const r = window._feedSearchResults[parseInt(el.dataset.idx)];
        if (!r) return;
        // Ta med sökningen till kartan och zooma in på området, precis som förstasidans sök
        const q = r.display_name.split(',').slice(0,2).join(',');
        const recent = JSON.parse(localStorage.getItem('ifound_recent_searches') || '[]');
        localStorage.setItem('ifound_recent_searches', JSON.stringify([q, ...recent.filter(x => x !== q)].slice(0, 5)));
        currentView = "map";
        render();
        setTimeout(() => {
          if (typeof map !== 'undefined' && map) { try { map.invalidateSize(); } catch {} }
          mapSelectLocation(q, r.lat, r.lon, r.boundingbox || null, r.geojson || null);
        }, 500);
      });
    });
  } catch {
    dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--ink-muted);">Sökning misslyckades</div>';
  }
}

async function mapSearch(query, dropdown, input) {
  dropdown.style.display = "block";
  dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--ink-muted);">Söker...</div>';

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&countrycodes=se&accept-language=sv&polygon_geojson=1`;
    const res = await fetch(url);
    const results = await res.json();

    if (!results.length) {
      dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--ink-muted);">Inga resultat</div>';
      return;
    }

    // Store results for click handler
    window._mapSearchResults = results;

    dropdown.innerHTML = results.map((r, idx) => {
      const name = r.display_name.split(",").slice(0,2).join(", ");
      return `<div data-idx="${idx}"
        style="padding:11px 16px;font-size:13px;color:var(--ink);cursor:pointer;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;gap:10px;"
        onmouseover="this.style.background='#F9F6F1'" onmouseout="this.style.background=''">
        <i class="ti ti-map-pin" style="font-size:14px;color:var(--accent);flex-shrink:0;" aria-hidden="true"></i>
        <span>${name}</span>
      </div>`;
    }).join('');

    // Add click handlers after render
    dropdown.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const r = window._mapSearchResults[parseInt(el.dataset.idx)];
        if (!r) return;
        mapSelectLocation(
          r.display_name.split(',').slice(0,2).join(','),
          r.lat, r.lon,
          r.boundingbox || null,
          r.geojson || null
        );
      });
    });
  } catch {
    dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--ink-muted);">Sökning misslyckades</div>';
  }
}

function mapSelectLocation(name, lat, lon, bbox, geojson) {
  const input    = document.getElementById("addressSearch");
  const dropdown = document.getElementById("searchDropdown");
  const shortName = name.split(",")[0];
  if (input) input.value = shortName;
  if (dropdown) dropdown.style.display = "none";

  if (bbox) {
    // Zoom to area bounds
    const bounds = [[parseFloat(bbox[0]), parseFloat(bbox[2])], [parseFloat(bbox[1]), parseFloat(bbox[3])]];
    if (map) {
      map.fitBounds(bounds, { padding: [40, 40] });
      // Reload parcels if layer missing after navigation
      if (!parcelsLayer) {
        const cached = localStorage.getItem(LS_GEOJSON);
        if (cached) {
          try { addGeoJsonToMap(JSON.parse(cached), { keepView: true, silent: true }); } catch {}
        } else { autoLoadCentrum(); }
        setTimeout(addClaimedMarkers, 600);
      }
    }

    // Draw area highlight
    if (window._areaHighlight) { window._areaHighlight.remove(); window._areaHighlight = null; }
    if (geojson) {
      window._areaHighlight = L.geoJSON(geojson, {
        style: { color: '#CC2936', weight: 2.5, fillColor: '#CC2936', fillOpacity: 0.07, dashArray: '6,4', interactive: false }
      }).addTo(map);
    } else {
      window._areaHighlight = L.rectangle(bounds, {
        color: '#CC2936', weight: 2, fillColor: '#CC2936', fillOpacity: 0.06, dashArray: '6,4', interactive: false
      }).addTo(map);
    }

    // Show area results card
    showMapAreaCard(shortName, bounds);
  } else {
    if (map) map.setView([parseFloat(lat), parseFloat(lon)], 17);
  }
}

function showMapAreaCard(areaName, bounds) {
  // Remove existing card
  const existing = document.getElementById('map-area-card');
  if (existing) existing.remove();

  // Count parcels in area
  let count = 0;
  const minLat = bounds[0][0], minLon = bounds[0][1];
  const maxLat = bounds[1][0], maxLon = bounds[1][1];

  try {
    const cached = localStorage.getItem('prop_geojson_helsingborg_v4');
    if (cached) {
      const gj = JSON.parse(cached);
      count = (gj.features || []).filter(f => {
        const g = f.geometry;
        const coords = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0] : null;
        if (!coords?.length) return false;
        const lons = coords.map(p=>p[0]), lats = coords.map(p=>p[1]);
        const cx = lons.reduce((a,b)=>a+b)/lons.length;
        const cy = lats.reduce((a,b)=>a+b)/lats.length;
        return cx >= minLon && cx <= maxLon && cy >= minLat && cy <= maxLat;
      }).length;
    }
  } catch {}

  const DEMO_PROPS = [
    { name:"Pålsjö 4:7",      meta:"Villa · 240 kvm",  likes:18, img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=120&q=60" },
    { name:"Laröd 3:19",      meta:"Gård · 5 200 kvm", likes:41, img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=120&q=60" },
    { name:"Fredriksdal 6:1", meta:"Villa · 5,75 mkr",  likes:19, img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=120&q=60" },
  ];

  const card = document.createElement('div');
  card.id = 'map-area-card';
  card.className = 'map-area-card';

  const isMobileCard = window.matchMedia('(max-width: 768px)').matches;

  card.innerHTML = `
    <!-- Header — always visible, click to toggle -->
    <div id="areaCardHeader" style="padding:12px 14px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;" onclick="toggleMapAreaCard()">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--green-900);letter-spacing:-.02em;">${areaName}</div>
        <div style="font-size:11px;color:#999;margin-top:1px;">${count ? count.toLocaleString('sv-SE') + ' fastigheter' : 'Område markerat'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <i id="areaCardChevron" class="ti ti-chevron-up" style="font-size:16px;color:#999;transition:transform .2s;${isMobileCard ? 'transform:rotate(180deg);' : ''}" aria-hidden="true"></i>
        <button onclick="event.stopPropagation();closeMapAreaCard()" style="width:24px;height:24px;border-radius:50%;border:none;background:var(--surface-2);color:var(--ink-soft);font-size:11px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
      </div>
    </div>

    <!-- Body — collapsible, hopfälld från start på mobil så kartan syns -->
    <div id="areaCardBody" style="border-top:${isMobileCard ? 'none' : '0.5px solid #F0F0F0'};overflow:hidden;transition:max-height .25s ease;max-height:${isMobileCard ? '0px' : '400px'};">
      <div style="max-height:240px;overflow-y:auto;">
        ${DEMO_PROPS.map(p => `
          <div style="display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:0.5px solid #F8F8F8;cursor:pointer;" onmouseover="this.style.background='#FAFAF8'" onmouseout="this.style.background=''">
            <img src="${p.img}" style="width:42px;height:42px;border-radius:8px;object-fit:cover;flex-shrink:0;" />
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:500;color:var(--green-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
              <div style="font-size:11px;color:#999;margin-top:1px;">${p.meta}</div>
            </div>
            <div style="font-size:11px;color:var(--accent);font-weight:500;">♡ ${p.likes}</div>
          </div>
        `).join('')}
      </div>
      <div style="padding:10px 14px;display:flex;flex-direction:column;gap:8px;">
        <button onclick="closeMapAreaCard()" style="width:100%;padding:9px;border-radius:9px;background:var(--accent);color:#fff;border:none;font-size:13px;font-weight:600;font-family:var(--font-body);cursor:pointer;">
          Utforska alla i ${areaName}
        </button>
        <button id="followAreaBtn" onclick="toggleFollowArea('${areaName.replace(/'/g, "\\'")}')" style="width:100%;padding:8px;border-radius:9px;background:#fff;color:var(--ink-soft);border:0.5px solid rgba(17,24,39,.14);font-size:12px;font-weight:600;font-family:var(--font-body);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
          <i class="ti ${(loadState().areaFollows || {})[areaName] ? 'ti-bell-check' : 'ti-bell-plus'}" aria-hidden="true"></i>
          ${(loadState().areaFollows || {})[areaName] ? 'Följer ' + areaName : 'Följ ' + areaName}
        </button>
      </div>
    </div>
  `;

  // Append to body (fixed position)
  document.body.appendChild(card);
}

function toggleFollowArea(areaName) {
  const session = loadSession();
  if (!session?.email) {
    openAuthModal('reg');
    toast("Skapa ett konto för att följa områden och få notiser.");
    return;
  }
  const s = loadState();
  s.areaFollows = s.areaFollows || {};
  const btn = document.getElementById("followAreaBtn");
  if (s.areaFollows[areaName]) {
    delete s.areaFollows[areaName];
    saveState(s);
    toast("Du följer inte längre " + areaName + ".");
    if (btn) btn.innerHTML = '<i class="ti ti-bell-plus" aria-hidden="true"></i> Följ ' + areaName;
  } else {
    s.areaFollows[areaName] = true;
    saveState(s);
    toast("Du följer nu " + areaName + " — du får en notis när något händer i området.");
    if (btn) btn.innerHTML = '<i class="ti ti-bell-check" aria-hidden="true"></i> Följer ' + areaName;
  }
}

function toggleMapAreaCard() {
  const body = document.getElementById('areaCardBody');
  const chevron = document.getElementById('areaCardChevron');
  if (!body) return;
  const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '';
  if (isOpen) {
    body.style.maxHeight = '0px';
    body.style.borderTop = 'none';
    if (chevron) chevron.style.transform = 'rotate(180deg)';
  } else {
    body.style.maxHeight = '400px';
    body.style.borderTop = '0.5px solid #F0F0F0';
    if (chevron) chevron.style.transform = 'rotate(0deg)';
  }
}

function closeMapAreaCard() {
  const card = document.getElementById('map-area-card');
  if (card) card.remove();
  if (window._areaHighlight) { window._areaHighlight.remove(); window._areaHighlight = null; }
}


function openClaimModal() {
  const existing = document.getElementById('claim-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'claim-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(17,24,39,.5);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';

  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:28px;width:100%;max-width:440px;box-shadow:0 24px 64px rgba(0,0,0,.2);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div>
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:4px;">Claima fastighet</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:-.03em;color:var(--ink);">Verifiera ditt ägande</div>
        </div>
        <button onclick="closeClaimModal()" style="width:32px;height:32px;border-radius:50%;border:none;background:var(--surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--ink-soft);">✕</button>
      </div>

      <div style="background:var(--page-bg);border-radius:12px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
        <i class="ti ti-home" style="font-size:20px;color:var(--accent);" aria-hidden="true"></i>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--ink);">Ingen fastighet vald</div>
          <div style="font-size:11px;color:var(--ink-muted);">Välj fastighet via kartan för att koppla den till din profil</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:20px;">
        <div>
          <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:6px;">Fullständigt namn</label>
          <input id="claim-name" class="input" placeholder="Anna Lindqvist" style="width:100%;" />
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:6px;">Personnummer</label>
          <input id="claim-pnr" class="input" placeholder="YYYYMMDD-XXXX" maxlength="13" style="width:100%;font-family:monospace;letter-spacing:.05em;" />
          <div style="font-size:11px;color:var(--ink-muted);margin-top:5px;">Används endast för att verifiera ägandet mot fastighetsregistret.</div>
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:6px;">Fastighetsbeteckning</label>
          <input id="claim-prop" class="input" placeholder="Ex. Pålsjö 4:7" style="width:100%;" />
        </div>
      </div>

      <div style="background:var(--accent-soft);border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;gap:10px;align-items:flex-start;">
        <i class="ti ti-clock" style="font-size:16px;color:var(--accent);flex-shrink:0;margin-top:1px;" aria-hidden="true"></i>
        <div style="font-size:12px;color:#7F1D1D;line-height:1.5;">Din claim behandlas inom <strong>24 timmar</strong>. Vi verifierar manuellt att uppgifterna stämmer mot fastighetsregistret innan fastigheten kopplas till din profil.</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:-6px;">Hur vill du synas?</div>
        ${[
          { id:'vis-private', val:'private', label:'Privat', desc:'Bara du ser statistiken. Syns inte utåt.' },
          { id:'vis-public',  val:'public',  label:'Synlig', desc:'Din profil och bilder syns för besökare.' },
          { id:'vis-sale',    val:'sale',    label:'Till salu eller uthyrning', desc:'Visa pris och ta emot intresse direkt.' },
        ].map((o,i) => `
          <div id="vo-${o.val}" onclick="selectClaimVis('${o.val}')" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:11px;border:1.5px solid ${i===0?'#CC2936':'rgba(17,24,39,.08)'};background:${i===0?'rgba(204,41,54,.03)':'#fff'};cursor:pointer;">
            <div id="radio-${o.val}" style="width:18px;height:18px;border-radius:50%;border:2px solid ${i===0?'#CC2936':'rgba(17,24,39,.18)'};flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;background:${i===0?'#CC2936':'transparent'};">
              ${i===0?'<div style="width:6px;height:6px;border-radius:50%;background:#fff;"></div>':''}
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:2px;">${o.label}</div>
              <div style="font-size:11px;color:var(--ink-muted);line-height:1.5;">${o.desc}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <button onclick="submitClaim()" style="width:100%;padding:14px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:pointer;letter-spacing:-.01em;">
        Skicka in claim
      </button>

      <div style="font-size:11px;color:var(--ink-muted);text-align:center;margin-top:12px;line-height:1.5;">
        Ditt personnummer lagras krypterat och används endast för verifiering. Det visas aldrig publikt.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeClaimModal(); });
}

function closeClaimModal() {
  const overlay = document.getElementById('claim-modal-overlay');
  if (overlay) overlay.remove();
}

let selectedClaimVis = 'private';

function selectClaimVis(val) {
  selectedClaimVis = val;
  ['private','public','sale'].forEach(v => {
    const el = document.getElementById('vo-' + v);
    const radio = document.getElementById('radio-' + v);
    if (!el || !radio) return;
    if (v === val) {
      el.style.borderColor = '#CC2936';
      el.style.background = 'rgba(204,41,54,.03)';
      radio.style.borderColor = '#CC2936';
      radio.style.background = '#CC2936';
      radio.innerHTML = '<div style="width:6px;height:6px;border-radius:50%;background:#fff;"></div>';
    } else {
      el.style.borderColor = 'rgba(17,24,39,.08)';
      el.style.background = '#fff';
      radio.style.borderColor = 'rgba(17,24,39,.18)';
      radio.style.background = 'transparent';
      radio.innerHTML = '';
    }
  });
}

function submitClaim() {
  const name = document.getElementById('claim-name')?.value.trim();
  const pnr  = document.getElementById('claim-pnr')?.value.trim();
  const prop = document.getElementById('claim-prop')?.value.trim();

  if (!name || !pnr || !prop) {
    toast('Fyll i alla fält för att fortsätta.');
    return;
  }

  if (!/^\d{8}-\d{4}$/.test(pnr)) {
    toast('Personnummer måste vara i format YYYYMMDD-XXXX.');
    return;
  }

  const s = loadState();
  s.claimStatus = 'pending';
  s.claimData = { name, pnr: pnr.slice(0,8) + '-****', prop, visibility: selectedClaimVis, submittedAt: new Date().toISOString() };
  s.ownerParcelId = prop;
  s.parcelNames = s.parcelNames || {};
  s.parcelNames[prop] = prop;
  saveState(s);

  // Save pending claim for admin
  const users = loadUsers();
  const session = loadSession();
  if (session?.email && users[session.email]) {
    users[session.email].pendingClaim = { name, pnr: pnr.slice(0,8) + '-****', prop, visibility: selectedClaimVis, submittedAt: new Date().toISOString(), status: 'pending' };
    saveUsers(users);
  }

  closeClaimModal();
  toast('Claim inskickad! Vi återkommer inom 24h.');
  render();
}


function renderInterestMessages() {
  const s = loadState();
  const msgs = s.interestMessages || {};
  const names = s.parcelNames || {};
  const allMsgs = [];
  for (const [pid, arr] of Object.entries(msgs)) {
    for (const m of arr) {
      allMsgs.push({ pid, parcel: names[pid] || pid, ...m });
    }
  }
  allMsgs.sort((a,b) => new Date(b.sentAt) - new Date(a.sentAt));

  if (!allMsgs.length) {
    return '<div style="padding:16px 20px;font-size:13px;color:var(--ink-muted);">Inga meddelanden ännu.</div>';
  }

  return allMsgs.map(m => `
    <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.05);display:flex;gap:12px;align-items:flex-start;">
      <div style="width:36px;height:36px;border-radius:9px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="ti ti-message" style="font-size:16px;color:var(--accent);" aria-hidden="true"></i>
      </div>
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:3px;">${m.parcel}</div>
        <div style="font-size:13px;color:var(--ink-soft);line-height:1.5;">&ldquo;${m.message}&rdquo;</div>
        <div style="font-size:11px;color:var(--ink-muted);margin-top:4px;">${new Date(m.sentAt).toLocaleDateString('sv-SE')} · Anonymt</div>
      </div>
    </div>
  `).join('');
}

// =========================
// ADMIN VIEW
// =========================

let adminTab = "overview";

// Godkänn eller avslå ett ägaranspråk. Sätter claimStatus, som tidigare
// aldrig kunde bli något annat än 'pending'.
function decideClaim(email, decision) {
  const users = loadUsers();
  const u = users[email];
  if (!u?.pendingClaim) return;
  u.pendingClaim.status = decision;
  u.pendingClaim.decidedAt = new Date().toISOString();
  saveUsers(users);

  const st = loadState();
  st.claimStatus = decision === "verified" ? "verified" : "rejected";
  if (decision !== "verified") st.ownerParcelId = null;
  saveState(st);

  toast(decision === "verified"
    ? `${u.pendingClaim.prop} är nu verifierad för ${u.name}.`
    : `Anspråket på ${u.pendingClaim.prop} avslogs.`);
  renderAdmin();
}

function renderAdmin() {
  const users = loadUsers();
  const state = loadState();
  const userList = Object.values(users).filter(u => u.email !== "admin@ifound.se");
  const totalLikes = Object.values(state.likes || {}).reduce((a,b) => a+b, 0);
  const totalInterests = Object.values(state.interests || {}).reduce((a,b) => a+b, 0);

  const mockUsers = [
    { name:"Anna Lindqvist",  email:"anna@example.se",    joined:"2025-06-12", role:"Ägare",    likes:3,  claims:1, status:"active" },
    { name:"Marcus Holm",     email:"marcus@example.se",  joined:"2025-06-14", role:"Besökare", likes:7,  claims:0, status:"active" },
    { name:"Sara Björk",      email:"sara@example.se",    joined:"2025-06-15", role:"Ägare",    likes:2,  claims:1, status:"active" },
    { name:"Johan Eriksson",  email:"johan@example.se",   joined:"2025-06-17", role:"Besökare", likes:5,  claims:0, status:"active" },
    { name:"Lena Svensson",   email:"lena@example.se",    joined:"2025-06-18", role:"Ägare",    likes:1,  claims:1, status:"active" },
    { name:"Erik Strand",     email:"erik@example.se",    joined:"2025-06-18", role:"Besökare", likes:9,  claims:0, status:"blocked" },
    ...userList.map(u => ({ name:u.name, email:u.email, joined:"2025-06-19", role: state.ownerParcelId ? "Ägare" : "Besökare", likes: Object.keys(state.myLikes||{}).length, claims: state.ownerParcelId ? 1 : 0, status:"active" }))
  ];

  const mockProps = [
    { prop:"Pålsjö 4:7",       user:"Anna Lindqvist",  date:"2025-06-12", visible:"Privat",    likes:18, interested:4,  img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=120&q=60" },
    { prop:"Laröd 3:19",       user:"Sara Björk",      date:"2025-06-15", visible:"Synlig",    likes:41, interested:9,  img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=120&q=60" },
    { prop:"Fredriksdal 6:1",  user:"Lena Svensson",   date:"2025-06-18", visible:"Till salu", likes:19, interested:6,  img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=120&q=60" },
    { prop:"Raus Plantage 7:2",user:"Sara Björk",       date:"2025-06-15", visible:"Privat",    likes:6,  interested:2,  img:"https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=120&q=60" },
    ...(state.ownerParcelId ? [{ prop: state.parcelNames?.[state.ownerParcelId] || state.ownerParcelId, user: userList[0]?.name || "Du", date:"2025-06-19", visible:"Privat", likes: state.likes?.[state.ownerParcelId]||0, interested: state.interests?.[state.ownerParcelId]||0, img:"https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=120&q=60" }] : [])
  ];

  const mockActivity = [
    { icon:"ti-user-plus",  color:"#16a34a", bg:"#F0FDF4", text:"Marcus Holm registrerade sig",           time:"14 min sedan" },
    { icon:"ti-heart",      color:"#CC2936", bg:"#FDECEA", text:"Ny gillning på Laröd 3:19",              time:"32 min sedan" },
    { icon:"ti-home-check", color:"#2563eb", bg:"#EFF6FF", text:"Sara Björk claimade Laröd 3:19",         time:"2 h sedan" },
    { icon:"ti-star",       color:"#7c3aed", bg:"#F5F3FF", text:"Nytt intresse på Fredriksdal 6:1",       time:"3 h sedan" },
    { icon:"ti-user-plus",  color:"#16a34a", bg:"#F0FDF4", text:"Lena Svensson registrerade sig",         time:"5 h sedan" },
    { icon:"ti-heart",      color:"#CC2936", bg:"#FDECEA", text:"Ny gillning på Pålsjö 4:7",              time:"Igår" },
    { icon:"ti-flag",       color:"#dc2626", bg:"#FEF2F2", text:"Innehåll rapporterat — Söder 8:22",      time:"Igår" },
    { icon:"ti-star",       color:"#7c3aed", bg:"#F5F3FF", text:"Nytt intresse på Pålsjö 4:7",            time:"Igår" },
  ];

  const tabs = [
    { id:"overview",    label:"Översikt",       icon:"ti-layout-dashboard" },
    { id:"claims",      label:"Ägaranspråk",    icon:"ti-id-badge-2" },
    { id:"users",       label:"Användare",      icon:"ti-users" },
    { id:"properties",  label:"Fastigheter",    icon:"ti-home-check" },
    { id:"moderation",  label:"Moderering",     icon:"ti-shield-check" },
    { id:"insights",    label:"Insikter",       icon:"ti-chart-bar" },
    { id:"premium",     label:"Premium",        icon:"ti-star" },
  ];

  const visStyle = (v) => ({
    "Privat":    "background:var(--surface-2);color:var(--ink-soft);",
    "Synlig":    "background:#EFF6FF;color:#2563eb;",
    "Till salu": "background:#F0FDF4;color:#16a34a;",
    "Uthyrning": "background:#F5F3FF;color:#7c3aed;",
  }[v] || "background:var(--surface-2);color:var(--ink-soft);");

  const overviewHtml = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px;">
      ${[
        { num:mockUsers.length,          lbl:"Användare",         icon:"ti-users",      sub:"+2 denna vecka" },
        { num:mockProps.length,          lbl:"Claimade",          icon:"ti-home-check", sub:`${mockProps.filter(p=>p.visible==="Synlig"||p.visible==="Till salu").length} synliga` },
        { num:totalLikes+116,            lbl:"Gillar",            icon:"ti-heart",      sub:"+23 idag" },
        { num:totalInterests+34,         lbl:"Intresseanmälningar",icon:"ti-star",      sub:"+5 idag" },
      ].map(s=>`
        <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:18px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <div style="width:38px;height:38px;border-radius:9px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;">
              <i class="ti ${s.icon}" style="font-size:18px;color:var(--accent);" aria-hidden="true"></i>
            </div>
          </div>
          <div style="font-size:28px;font-weight:700;letter-spacing:-.04em;color:var(--ink);line-height:1;">${s.num}</div>
          <div style="font-size:12px;color:var(--ink-muted);margin-top:4px;">${s.lbl}</div>
          <div style="font-size:11px;color:#16a34a;margin-top:6px;font-weight:500;">${s.sub}</div>
        </div>
      `).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:13px;font-weight:600;color:var(--ink);">Senaste aktivitet</div>
          <span style="font-size:11px;color:var(--ink-muted);">Live</span>
        </div>
        ${mockActivity.slice(0,6).map(a=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:0.5px solid rgba(17,24,39,.04);">
            <div style="width:32px;height:32px;border-radius:8px;background:${a.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="ti ${a.icon}" style="font-size:15px;color:${a.color};" aria-hidden="true"></i>
            </div>
            <div style="flex:1;font-size:12px;color:var(--ink-soft);line-height:1.4;">${a.text}</div>
            <div style="font-size:11px;color:var(--ink-muted);white-space:nowrap;">${a.time}</div>
          </div>
        `).join('')}
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:0.5px solid rgba(17,24,39,.06);">
          <div style="font-size:13px;font-weight:600;color:var(--ink);">Hetaste fastigheter</div>
        </div>
        ${mockProps.sort((a,b)=>b.likes-a.likes).slice(0,4).map(p=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:0.5px solid rgba(17,24,39,.04);">
            <img src="${p.img}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;" />
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.prop}</div>
              <div style="font-size:11px;color:var(--ink-muted);">${p.likes} gillar · ${p.interested} intresserade</div>
            </div>
            <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;${visStyle(p.visible)}">${p.visible}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  const usersHtml = `
    <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:13px;font-weight:600;color:var(--ink);">${mockUsers.length} användare</div>
        <div style="display:flex;gap:8px;">
          <div style="display:flex;align-items:center;gap:6px;background:var(--page-bg);border:0.5px solid rgba(17,24,39,.08);border-radius:8px;padding:6px 12px;">
            <i class="ti ti-search" style="font-size:13px;color:var(--ink-muted);" aria-hidden="true"></i>
            <input placeholder="Sök användare..." style="border:none;background:transparent;font-size:12px;font-family:var(--font-body);color:var(--ink);outline:none;width:140px;" />
          </div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:var(--page-bg);">
            <th style="text-align:left;padding:10px 20px;font-size:11px;font-weight:600;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;">Användare</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;">Roll</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;">Gillar</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;">Registrerad</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;">Status</th>
            <th style="padding:10px 20px 10px 12px;"></th>
          </tr>
        </thead>
        <tbody>
          ${mockUsers.map(u=>`
            <tr style="border-top:0.5px solid rgba(17,24,39,.05);">
              <td style="padding:12px 20px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--accent);flex-shrink:0;">${u.name[0]}</div>
                  <div>
                    <div style="font-size:13px;font-weight:600;color:var(--ink);">${u.name}</div>
                    <div style="font-size:11px;color:var(--ink-muted);">${u.email}</div>
                  </div>
                </div>
              </td>
              <td style="padding:12px;">
                <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;${u.role==='Ägare'?'background:#F0FDF4;color:#16a34a;':'background:var(--surface-2);color:var(--ink-soft);'}">${u.role}</span>
              </td>
              <td style="padding:12px;font-size:13px;color:var(--ink-soft);">${u.likes}</td>
              <td style="padding:12px;font-size:12px;color:var(--ink-muted);">${u.joined}</td>
              <td style="padding:12px;">
                <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;${u.status==='active'?'background:#F0FDF4;color:#16a34a;':'background:#FEF2F2;color:#dc2626;'}">${u.status==='active'?'Aktiv':'Blockerad'}</span>
              </td>
              <td style="padding:12px 20px 12px 12px;">
                <div style="display:flex;gap:6px;">
                  <button onclick="adminToast('Visa ${u.name}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:var(--ink);cursor:pointer;font-family:var(--font-body);">Visa</button>
                  <button onclick="adminToast('${u.status==='active'?'Blockerar':'Aktiverar'} ${u.name}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:${u.status==='active'?'#dc2626':'#16a34a'};cursor:pointer;font-family:var(--font-body);">${u.status==='active'?'Blockera':'Aktivera'}</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  const propertiesHtml = `
    <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;justify-content:space-between;">
        <div style="font-size:13px;font-weight:600;color:var(--ink);">${mockProps.length} claimade fastigheter</div>
        <div style="display:flex;gap:6px;">
          ${["Alla","Privat","Synlig","Till salu"].map(f=>`<button onclick="adminToast('Filtrerar: ${f}')" style="padding:5px 12px;border-radius:999px;border:0.5px solid rgba(17,24,39,.12);background:${f==='Alla'?'#111827':'#fff'};color:${f==='Alla'?'#fff':'#374151'};font-size:11px;font-weight:500;cursor:pointer;font-family:var(--font-body);">${f}</button>`).join('')}
        </div>
      </div>
      ${mockProps.map(p=>`
        <div style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.05);">
          <img src="${p.img}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;flex-shrink:0;" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:2px;">${p.prop}</div>
            <div style="font-size:11px;color:var(--ink-muted);">Ägare: ${p.user} · Claimad ${p.date}</div>
            <div style="display:flex;gap:10px;margin-top:6px;">
              <span style="font-size:11px;color:var(--ink-muted);">${p.likes} gillar</span>
              <span style="font-size:11px;color:var(--ink-muted);">${p.interested} intresserade</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:999px;${visStyle(p.visible)}">${p.visible}</span>
            <div style="display:flex;gap:6px;">
              <button onclick="adminToast('Öppnar ${p.prop}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:var(--ink);cursor:pointer;font-family:var(--font-body);">Visa</button>
              <button onclick="adminToast('Ta bort claim: ${p.prop}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:#dc2626;cursor:pointer;font-family:var(--font-body);">Ta bort</button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  const pendingClaims = Object.values(users).filter(u => u.pendingClaim && u.pendingClaim.status === 'pending');

  const pendingClaimsHtml = pendingClaims.length > 0 ? pendingClaims.map(u => `
    <div style="padding:16px 20px;border-bottom:0.5px solid rgba(17,24,39,.05);">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;">
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--ink);">${u.pendingClaim.prop}</div>
          <div style="font-size:11px;color:var(--ink-muted);margin-top:2px;">Inskickad av ${u.pendingClaim.name}</div>
        </div>
        <span style="font-size:10px;font-weight:600;background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:3px 9px;flex-shrink:0;margin-left:10px;">Inväntar</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:var(--page-bg);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Namn</div>
          <div style="font-size:12px;font-weight:600;color:var(--ink);">${u.pendingClaim.name}</div>
        </div>
        <div style="background:var(--page-bg);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Personnummer</div>
          <div style="font-size:12px;font-weight:600;color:var(--ink);font-family:monospace;">${u.pendingClaim.pnr}</div>
        </div>
        <div style="background:var(--page-bg);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Fastighet</div>
          <div style="font-size:12px;font-weight:600;color:var(--ink);">${u.pendingClaim.prop}</div>
        </div>
        <div style="background:var(--page-bg);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Synlighet</div>
          <div style="font-size:12px;font-weight:600;color:var(--ink);">${{private:'Privat',public:'Synlig',sale:'Till salu'}[u.pendingClaim.visibility]||'Privat'}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="approveClaim('${u.email}')" style="flex:1;padding:9px;border-radius:9px;border:none;background:#16a34a;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Godkänn</button>
        <button onclick="rejectClaim('${u.email}')" style="flex:1;padding:9px;border-radius:9px;border:0.5px solid rgba(17,24,39,.12);background:#fff;color:#dc2626;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Neka</button>
      </div>
    </div>
  `).join('') : '<div style="padding:16px 20px;font-size:13px;color:var(--ink-muted);">Inga väntande claims.</div>';

  const moderationHtml = `
    <div style="display:grid;gap:12px;">

      <div style="background:#fff;border:1.5px solid #CC2936;border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;justify-content:space-between;background:var(--accent-soft);">
          <div style="display:flex;align-items:center;gap:8px;">
            <i class="ti ti-home-check" style="font-size:16px;color:var(--accent);" aria-hidden="true"></i>
            <div style="font-size:13px;font-weight:600;color:var(--accent);">Claims som väntar verifiering</div>
          </div>
          <span style="font-size:11px;font-weight:700;background:var(--accent);color:#fff;border-radius:999px;padding:2px 8px;">${pendingClaims.length}</span>
        </div>
        ${pendingClaimsHtml}
      </div>

            <!-- Interest messages section -->
      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:13px;font-weight:600;color:var(--ink);">Meddelanden från intressenter</div>
          <div style="font-size:11px;color:var(--ink-muted);">Anonyma tills ägaren svarar</div>
        </div>
        ${renderInterestMessages()}
      </div>

      <div style="background:#FEF2F2;border:0.5px solid rgba(220,38,38,.15);border-radius:14px;padding:18px 20px;">
        <div style="display:flex;align-items:flex-start;gap:14px;">
          <div style="width:40px;height:40px;border-radius:10px;background:#FEE2E2;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="ti ti-flag" style="font-size:18px;color:#dc2626;" aria-hidden="true"></i>
          </div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px;">Rapport: Söder 8:22</div>
            <div style="font-size:12px;color:var(--ink-soft);line-height:1.5;margin-bottom:12px;">Användaren "erik@example.se" rapporterade att beskrivningen är vilseledande. Kontaktuppgifterna stämmer inte överens med fastigheten.</div>
            <div style="display:flex;gap:8px;">
              <button onclick="adminToast('Granskar Söder 8:22...')" style="padding:7px 14px;border-radius:8px;border:none;background:#dc2626;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Granska</button>
              <button onclick="adminToast('Rapport avfärdad')" style="padding:7px 14px;border-radius:8px;border:0.5px solid rgba(17,24,39,.12);background:#fff;color:var(--ink-soft);font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Avfärda</button>
            </div>
          </div>
          <div style="font-size:11px;color:var(--ink-muted);">Igår</div>
        </div>
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);">
          <div style="font-size:13px;font-weight:600;color:var(--ink);">Bilder som väntar på granskning</div>
          <div style="font-size:12px;color:var(--ink-muted);margin-top:2px;">Automatisk granskning är inte aktiverad ännu — kommande funktion</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:16px 20px;">
          ${["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=160&q=60","https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=160&q=60","https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=160&q=60","https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=160&q=60"].map(img=>`
            <div style="position:relative;">
              <img src="${img}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block;" />
              <div style="display:flex;gap:4px;margin-top:6px;">
                <button onclick="adminToast('Bild godkänd')" style="flex:1;padding:4px;border-radius:6px;border:none;background:#16a34a;color:#fff;font-size:10px;font-weight:600;cursor:pointer;font-family:var(--font-body);">OK</button>
                <button onclick="adminToast('Bild nekad')" style="flex:1;padding:4px;border-radius:6px;border:none;background:#dc2626;color:#fff;font-size:10px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Neka</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:18px 20px;">
        <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:4px;">Blockerade användare</div>
        <div style="font-size:12px;color:var(--ink-muted);margin-bottom:14px;">1 blockerat konto</div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:0.5px solid rgba(17,24,39,.06);">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--accent);">E</div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:var(--ink);">Erik Strand</div>
            <div style="font-size:11px;color:var(--ink-muted);">erik@example.se · Blockerad 2025-06-18</div>
          </div>
          <button onclick="adminToast('Erik Strand aktiverad')" style="padding:6px 12px;border-radius:8px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:12px;font-weight:600;color:#16a34a;cursor:pointer;font-family:var(--font-body);">Aktivera</button>
        </div>
      </div>
    </div>
  `;

  const insightsHtml = `
    <div style="display:grid;gap:16px;">
      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;">
        <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:16px;">Aktivitet senaste 7 dagarna</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:100px;">
          ${[12,19,8,24,31,18,27].map((v,i)=>`
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:100%;background:var(--accent);border-radius:4px 4px 0 0;opacity:${0.4+v/60};" title="${v}" style="height:${v*3}px;"></div>
              <div style="font-size:10px;color:var(--ink-muted);">${['M','T','O','T','F','L','S'][i]}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;">
          <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:14px;">Populäraste områden</div>
          ${[["Pålsjö",42],["Laröd",38],["Raus",24],["Söder",18],["Höganäs",12]].map(([area,pct])=>`
            <div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:12px;color:var(--ink-soft);">${area}</span>
                <span style="font-size:12px;color:var(--ink-muted);">${pct}%</span>
              </div>
              <div style="height:4px;background:var(--surface-2);border-radius:999px;">
                <div style="height:4px;background:var(--accent);border-radius:999px;width:${pct}%;"></div>
              </div>
            </div>
          `).join('')}
        </div>

        <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;">
          <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:14px;">Konvertering</div>
          ${[["Besökare → Gilla","68%","#16a34a"],["Gilla → Intresse","24%","#2563eb"],["Intresse → Claim","8%","#CC2936"]].map(([label,pct,color])=>`
            <div style="margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:12px;color:var(--ink-soft);">${label}</span>
                <span style="font-size:13px;font-weight:700;color:${color};">${pct}</span>
              </div>
              <div style="height:4px;background:var(--surface-2);border-radius:999px;">
                <div style="height:4px;background:${color};border-radius:999px;width:${pct};"></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  const premiumHtml = `
    <div style="display:grid;gap:16px;">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
        ${[
          { name:"Gratis",   price:"0",   color:"#6B7280", users:mockUsers.length-1, features:["3 bilder","Gillar och statistik","Karta med tomtgräns","Passiv synlighet"] },
          { name:"Synlig",   price:"49",  color:"#2563eb", users:2, features:["Allt i Gratis","Synlig i flödet","Besökarstatistik","Kontaktformulär","Utvald-badge"] },
          { name:"Aktiv",    price:"249", color:"#CC2936", users:1, features:["Allt i Synlig","Till salu / uthyrning","Budgivning","Mäklarintegration","Prioritet i flödet"] },
        ].map(p=>`
          <div style="background:#fff;border:1.5px solid ${p.color === '#CC2936' ? '#CC2936' : 'rgba(17,24,39,.08)'};border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:${p.color};margin-bottom:4px;">${p.name}</div>
            <div style="font-size:26px;font-weight:700;letter-spacing:-.04em;color:var(--ink);">${p.price} <span style="font-size:13px;font-weight:400;color:var(--ink-muted);">kr/mån</span></div>
            <div style="font-size:11px;color:var(--ink-muted);margin:8px 0 14px;">${p.users} aktiva användare</div>
            ${p.features.map(f=>`
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <i class="ti ti-check" style="font-size:14px;color:#16a34a;" aria-hidden="true"></i>
                <span style="font-size:12px;color:var(--ink-soft);">${f}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);">
          <div style="font-size:13px;font-weight:600;color:var(--ink);">Premium-konton</div>
        </div>
        ${[
          { name:"Sara Björk",    email:"sara@example.se",   plan:"Synlig", since:"2025-06-15", mrr:"49 kr" },
          { name:"Anna Lindqvist",email:"anna@example.se",   plan:"Aktiv",  since:"2025-06-12", mrr:"249 kr" },
          { name:"Lena Svensson", email:"lena@example.se",   plan:"Synlig", since:"2025-06-18", mrr:"49 kr" },
        ].map(u=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:0.5px solid rgba(17,24,39,.05);">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--accent);flex-shrink:0;">${u.name[0]}</div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:var(--ink);">${u.name}</div>
              <div style="font-size:11px;color:var(--ink-muted);">${u.email} · sedan ${u.since}</div>
            </div>
            <span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:${u.plan==='Aktiv'?'#FDECEA':'#EFF6FF'};color:${u.plan==='Aktiv'?'#CC2936':'#2563eb'};">${u.plan}</span>
            <div style="font-size:13px;font-weight:600;color:var(--ink);min-width:52px;text-align:right;">${u.mrr}</div>
            <button onclick="adminToast('Hanterar ${u.name}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:var(--ink-soft);cursor:pointer;font-family:var(--font-body);">Hantera</button>
          </div>
        `).join('')}
        <div style="padding:14px 20px;border-top:0.5px solid rgba(17,24,39,.06);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:12px;color:var(--ink-muted);">Total MRR</div>
          <div style="font-size:16px;font-weight:700;color:var(--ink);">347 kr/mån</div>
        </div>
      </div>
    </div>
  `;

  // Ägaranspråk. Innan BankID finns är detta den manuella verifieringen —
  // claimStatus sattes tidigare till 'pending' utan att något kunde godkänna den.
  const claimUsers = Object.values(loadUsers()).filter(u => u.pendingClaim);
  const claimsHtml = `
    <div class="card">
      <div class="card-title">Ägaranspråk att granska</div>
      <div style="font-size:12.5px;color:var(--ink-soft);line-height:1.65;margin-bottom:16px;">
        Manuell verifiering tills BankID är på plats. Kontrollera att personen står som lagfaren ägare
        till fastigheten innan du godkänner — det är den enda spärren mot att någon claimar ett hus de inte äger.
      </div>
      ${claimUsers.length ? claimUsers.map(u => {
        const c = u.pendingClaim;
        const done = c.status && c.status !== "pending";
        return `
        <div style="border:1px solid var(--hairline);border-radius:13px;padding:15px 16px;margin-bottom:10px;background:${done ? "var(--surface-2)" : "var(--surface)"};">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
            <div>
              <div style="font-family:var(--font-data);font-size:13px;font-weight:500;letter-spacing:.04em;color:var(--ink);">${c.prop}</div>
              <div style="font-size:13px;color:var(--ink);margin-top:5px;font-weight:600;">${c.name}</div>
              <div style="font-size:12px;color:var(--ink-muted);margin-top:2px;">${c.pnr} · ${u.email}</div>
              <div style="font-size:11.5px;color:var(--ink-muted);margin-top:5px;">
                Synlighet: ${c.visibility || "—"} · Inskickad ${new Date(c.submittedAt).toLocaleDateString("sv-SE")}
              </div>
            </div>
            <div style="display:flex;gap:7px;flex-shrink:0;">
              ${done
                ? `<span style="font-size:11.5px;font-weight:600;padding:6px 12px;border-radius:999px;background:${c.status === "verified" ? "var(--green-100)" : "#FDE7E3"};color:${c.status === "verified" ? "var(--green-800)" : "#9B3A22"};">
                     ${c.status === "verified" ? "Godkänd" : "Avslagen"}
                   </span>`
                : `<button onclick="decideClaim('${u.email}','verified')" style="padding:8px 14px;border-radius:9px;border:none;background:var(--green-600);color:#fff;font-size:12.5px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Godkänn</button>
                   <button onclick="decideClaim('${u.email}','rejected')" style="padding:8px 14px;border-radius:9px;border:0.5px solid var(--hairline);background:transparent;color:var(--ink-soft);font-size:12.5px;font-weight:500;cursor:pointer;font-family:var(--font-body);">Avslå</button>`}
            </div>
          </div>
        </div>`;
      }).join("") : `<div style="font-size:13px;color:var(--ink-muted);padding:22px 0;text-align:center;">Inga anspråk väntar på granskning.</div>`}
    </div>`;

  const tabContent = { overview:overviewHtml, claims:claimsHtml, users:usersHtml, properties:propertiesHtml, moderation:moderationHtml, insights:insightsHtml, premium:premiumHtml };

  app.innerHTML = `
    <div style="min-height:100vh;background:var(--page-bg);">
      <nav style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:var(--ink);border-bottom:0.5px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:50;">
        <div style="display:flex;align-items:center;gap:10px;">
          <svg width="18" height="23" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
          <span style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#fff;font-family:var(--font-body);">i<em style="font-style:normal;color:var(--accent);">found</em></span>
          <span style="font-size:10px;font-weight:700;background:rgba(204,41,54,.25);color:var(--accent);border-radius:999px;padding:3px 9px;letter-spacing:.08em;">ADMIN</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:rgba(255,255,255,.4);">admin@ifound.se</span>
          <button onclick="clearSession();navigate('welcome');" style="font-size:12px;color:rgba(255,255,255,.5);background:transparent;border:none;cursor:pointer;font-family:var(--font-body);padding:6px 12px;border-radius:8px;border:0.5px solid rgba(255,255,255,.12);">Logga ut</button>
        </div>
      </nav>

      <div style="display:flex;">
        <!-- Sidebar -->
        <div style="width:200px;min-height:calc(100vh - 56px);background:#fff;border-right:0.5px solid rgba(17,24,39,.08);padding:16px 10px;flex-shrink:0;">
          ${tabs.map(t=>`
            <button id="tab-${t.id}" onclick="switchAdminTab('${t.id}')"
              style="width:100%;display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;border:none;background:${adminTab===t.id?'#FDECEA':'transparent'};color:${adminTab===t.id?'#CC2936':'#6B7280'};font-size:13px;font-weight:${adminTab===t.id?'600':'500'};cursor:pointer;font-family:var(--font-body);margin-bottom:2px;text-align:left;">
              <i class="ti ${t.icon}" style="font-size:17px;" aria-hidden="true"></i>
              ${t.label}
              ${t.id==='moderation'?'<span style="margin-left:auto;font-size:10px;font-weight:700;background:#FEF2F2;color:#dc2626;border-radius:999px;padding:1px 6px;">1</span>':''}
            </button>
          `).join('')}
        </div>

        <!-- Content -->
        <div style="flex:1;padding:24px;min-width:0;" id="admin-content">
          ${tabContent[adminTab]}
        </div>
      </div>
    </div>
  `;

  window._adminTabContent = tabContent;
}

function switchAdminTab(tab) {
  adminTab = tab;
  const content = window._adminTabContent;
  if (!content) { renderAdmin(); return; }
  document.getElementById('admin-content').innerHTML = content[tab];
  document.querySelectorAll('[id^="tab-"]').forEach(btn => {
    const id = btn.id.replace('tab-','');
    btn.style.background = id === tab ? '#FDECEA' : 'transparent';
    btn.style.color = id === tab ? '#CC2936' : '#6B7280';
    btn.style.fontWeight = id === tab ? '600' : '500';
  });
}

function adminToast(msg) {
  toast(msg);
}



function approveClaim(email) {
  const users = loadUsers();
  if (users[email]?.pendingClaim) {
    users[email].pendingClaim.status = 'approved';
    saveUsers(users);
  }
  toast('Claim godkänd — ' + email);
  renderAdmin();
}

function rejectClaim(email) {
  const users = loadUsers();
  if (users[email]?.pendingClaim) {
    users[email].pendingClaim.status = 'rejected';
    saveUsers(users);
  }
  toast('Claim nekad — ' + email);
  renderAdmin();
}


// =========================
// MÄKLARPORTAL
// =========================

const MOCK_BROKER_ACCOUNTS = {
  "maklare@fastighetsbyran.se": { password: "demo2025", name: "Anna Lindqvist", firm: "Fastighetsbyrån AB", logo: "FA", verified: true },
  "erik@stadsmäklarna.se":      { password: "demo2025", name: "Erik Strand",     firm: "Stadsmäklarna",    logo: "SM", verified: true },
};

const MOCK_BROKER_LISTINGS = [
  { id: "b1", address: "Pålsjövägen 12", area: "Pålsjö", type: "Villa", sqm: 185, rooms: 5, price: "4 750 000 kr", status: "active", likes: 31, interested: 8, views: 142, messages: 3, img: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=70" },
  { id: "b2", address: "Kungsörsgatan 7", area: "Söder",  type: "Lägenhet", sqm: 78, rooms: 3, price: "2 100 000 kr", status: "active", likes: 19, interested: 5, views: 88,  messages: 1, img: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&q=70" },
  { id: "b3", address: "Larödsvägen 44", area: "Laröd",  type: "Gård", sqm: 320, rooms: 7, price: "6 900 000 kr", status: "active", likes: 44, interested: 12, views: 201, messages: 5, img: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=70" },
  { id: "b4", address: "Fredriksdalsgatan 3", area: "Fredriksdal", type: "Villa", sqm: 210, rooms: 6, price: "5 200 000 kr", status: "draft", likes: 0, interested: 0, views: 0, messages: 0, img: "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&q=70" },
];

function isBroker() {
  const s = loadSession();
  return !!MOCK_BROKER_ACCOUNTS[s?.email];
}

function getBroker() {
  const s = loadSession();
  if (!s?.email) return null;
  // Check mock accounts first
  if (MOCK_BROKER_ACCOUNTS[s.email]) return MOCK_BROKER_ACCOUNTS[s.email];
  // Check registered brokers
  const users = loadUsers();
  const u = users[s.email];
  if (u?.isBroker) return u;
  return null;
}


function switchBrokerTab(tab) {
  const isLogin = tab === 'login';
  const tLogin = document.getElementById('bTabLogin');
  const tReg   = document.getElementById('bTabReg');
  const fLogin = document.getElementById('bLoginForm');
  const fReg   = document.getElementById('bRegForm');
  if (!tLogin) return;
  tLogin.style.background = isLogin  ? '#CC2936' : 'transparent';
  tLogin.style.color      = isLogin  ? '#fff' : 'rgba(255,255,255,.5)';
  tLogin.style.fontWeight = isLogin  ? '600' : '500';
  tReg.style.background   = !isLogin ? '#CC2936' : 'transparent';
  tReg.style.color        = !isLogin ? '#fff' : 'rgba(255,255,255,.5)';
  tReg.style.fontWeight   = !isLogin ? '600' : '500';
  fLogin.style.display    = isLogin  ? 'flex' : 'none';
  fReg.style.display      = !isLogin ? 'flex' : 'none';
}

function renderBrokerWelcome() {
  app.innerHTML = `
    <div style="min-height:100vh;background:#0F1117;font-family:var(--font-body);display:flex;flex-direction:column;">
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:24px;">
        <div style="width:100%;max-width:400px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:9px;margin-bottom:20px;">
              <svg width="22" height="27" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
              <span style="font-size:22px;font-weight:700;letter-spacing:-.04em;color:#fff;">i<em style="font-style:normal;color:var(--accent);">found</em></span>
            </div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(204,41,54,.15);border:1px solid rgba(204,41,54,.3);color:var(--accent);border-radius:999px;padding:4px 12px;font-size:11px;font-weight:600;letter-spacing:.06em;margin-bottom:16px;">
              <i class="ti ti-building" style="font-size:12px;" aria-hidden="true"></i> MÄKLARPORTAL
            </div>
            <div style="font-size:24px;font-weight:700;letter-spacing:-.04em;color:#fff;margin-bottom:8px;">Logga in</div>
            <div style="font-size:13px;color:rgba(255,255,255,.4);">Hantera dina objekt och leads</div>
          </div>

          <!-- Tab switcher -->
          <div style="display:flex;background:rgba(255,255,255,.06);border-radius:10px;padding:3px;margin-bottom:16px;">
            <button id="bTabLogin" onclick="switchBrokerTab('login')" style="flex:1;padding:8px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font-body);">Logga in</button>
            <button id="bTabReg"   onclick="switchBrokerTab('reg')"   style="flex:1;padding:8px;border-radius:8px;border:none;background:transparent;color:rgba(255,255,255,.5);font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font-body);">Skapa konto</button>
          </div>

          <!-- Login form -->
          <div id="bLoginForm" style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">E-post</label>
              <input id="brokerEmail" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="din@maklarfirma.se" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Lösenord</label>
              <input id="brokerPass" type="password" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="••••••••" />
            </div>
            <button id="brokerLoginBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:pointer;">
              Logga in
            </button>
            <div style="font-size:11px;color:rgba(255,255,255,.25);text-align:center;">Demo: maklare@fastighetsbyran.se / demo2025</div>
          </div>

          <!-- Register form -->
          <div id="bRegForm" style="display:none;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Namn</label>
              <input id="bRegName" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="Anna Lindqvist" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Mäklarfirma</label>
              <input id="bRegFirm" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="Fastighetsbyrån AB" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">E-post</label>
              <input id="bRegEmail" type="email" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="anna@maklarfirma.se" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Lösenord</label>
              <input id="bRegPass" type="password" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="Min 6 tecken" />
            </div>
            <button id="brokerRegBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:pointer;">
              Skapa mäklarkonto
            </button>
            <div style="font-size:11px;color:rgba(255,255,255,.25);text-align:center;">Kontot aktiveras inom 24h efter verifiering.</div>
          </div>

          <div style="text-align:center;margin-top:20px;">
            <button onclick="navigate('welcome')" style="background:transparent;border:none;color:rgba(255,255,255,.35);font-size:12px;cursor:pointer;font-family:var(--font-body);">
              Tillbaka till ifound.se
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("brokerLoginBtn").onclick = () => {
    const email = document.getElementById("brokerEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("brokerPass").value;
    const broker = MOCK_BROKER_ACCOUNTS[email];
    // Also check registered brokers in users store
    const users = loadUsers();
    const registeredBroker = users[email];
    if (broker && broker.password === pass) {
      saveSession({ email, isBroker: true });
      navigate("broker");
    } else if (registeredBroker?.isBroker && registeredBroker.password === pass) {
      saveSession({ email, isBroker: true });
      navigate("broker");
    } else {
      toast("Fel e-post eller lösenord.");
    }
  };

  document.getElementById("brokerRegBtn").onclick = () => {
    const name  = document.getElementById("bRegName").value.trim();
    const firm  = document.getElementById("bRegFirm").value.trim();
    const email = document.getElementById("bRegEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("bRegPass").value;
    if (!name || !firm || !email.includes("@") || pass.length < 6) {
      toast("Fyll i alla fält korrekt (lösenord min 6 tecken).");
      return;
    }
    const users = loadUsers();
    if (users[email] || MOCK_BROKER_ACCOUNTS[email]) {
      toast("Det finns redan ett konto på den e-posten.");
      return;
    }
    users[email] = {
      name, email, password: pass,
      firm, logo: name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(),
      isBroker: true, verified: false,
    };
    saveUsers(users);
    saveSession({ email, isBroker: true });
    toast("Konto skapat — välkommen " + name + "!");
    navigate("broker");
  };
}

function renderBrokerDashboard() {
  const broker = getBroker();
  if (!broker) { navigate("brokerWelcome"); return; }

  const active = MOCK_BROKER_LISTINGS.filter(l => l.status === "active");
  const drafts = MOCK_BROKER_LISTINGS.filter(l => l.status === "draft");
  const totalLikes = MOCK_BROKER_LISTINGS.reduce((a,l) => a + l.likes, 0);
  const totalInterested = MOCK_BROKER_LISTINGS.reduce((a,l) => a + l.interested, 0);
  const totalMessages = MOCK_BROKER_LISTINGS.reduce((a,l) => a + l.messages, 0);

  app.innerHTML = `
    <div style="min-height:100vh;background:#0F1117;font-family:var(--font-body);">
      <nav style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:rgba(255,255,255,.03);border-bottom:0.5px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:50;">
        <div style="display:flex;align-items:center;gap:10px;">
          <svg width="18" height="23" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#CC2936"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#CC2936"/></svg>
          <span style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#fff;">i<em style="font-style:normal;color:var(--accent);">found</em></span>
          <span style="font-size:10px;font-weight:700;background:rgba(204,41,54,.2);color:var(--accent);border-radius:999px;padding:3px 9px;letter-spacing:.08em;">MÄKLARE</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button onclick="navigate('feed')" style="font-size:12px;color:rgba(255,255,255,.45);background:transparent;border:none;cursor:pointer;font-family:var(--font-body);display:flex;align-items:center;gap:5px;">
            <i class="ti ti-layout-grid" style="font-size:14px;" aria-hidden="true"></i> Utforska
          </button>
          <button onclick="navigate('map')" style="font-size:12px;color:rgba(255,255,255,.45);background:transparent;border:none;cursor:pointer;font-family:var(--font-body);display:flex;align-items:center;gap:5px;">
            <i class="ti ti-map-2" style="font-size:14px;" aria-hidden="true"></i> Karta
          </button>
          <div style="width:1px;height:20px;background:rgba(255,255,255,.1);"></div>
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(204,41,54,.2);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--accent);">${broker.logo}</div>
          <button onclick="clearSession();navigate('brokerWelcome');" style="font-size:12px;color:rgba(255,255,255,.35);background:transparent;border:none;cursor:pointer;font-family:var(--font-body);">Logga ut</button>
        </div>
      </nav>

      <div style="max-width:900px;margin:0 auto;padding:28px 20px 60px;">

        <div style="margin-bottom:28px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:6px;">Välkommen</div>
          <div style="font-size:26px;font-weight:700;letter-spacing:-.04em;color:#fff;">${broker.name}</div>
          <div style="font-size:13px;color:rgba(255,255,255,.4);margin-top:3px;">${broker.firm}</div>
        </div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:28px;">
          ${[
            { num: active.length, lbl: "Aktiva objekt", icon: "ti-home-check" },
            { num: totalLikes,     lbl: "Totalt gillar",  icon: "ti-heart" },
            { num: totalInterested, lbl: "Intressenter",  icon: "ti-star" },
            { num: totalMessages,  lbl: "Meddelanden",    icon: "ti-message" },
          ].map(s => `
            <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:16px;">
              <div style="width:36px;height:36px;border-radius:9px;background:rgba(204,41,54,.15);display:flex;align-items:center;justify-content:center;margin-bottom:10px;">
                <i class="ti ${s.icon}" style="font-size:17px;color:var(--accent);" aria-hidden="true"></i>
              </div>
              <div style="font-size:26px;font-weight:700;letter-spacing:-.04em;color:#fff;line-height:1;">${s.num}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:4px;">${s.lbl}</div>
            </div>
          `).join('')}
        </div>

        <!-- Listings header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:600;letter-spacing:-.03em;color:#fff;">Mina objekt</div>
          <button id="addListingBtn" style="display:flex;align-items:center;gap:7px;background:var(--accent);color:#fff;border:none;border-radius:9px;padding:8px 16px;font-size:12px;font-weight:600;font-family:var(--font-body);cursor:pointer;">
            <i class="ti ti-plus" aria-hidden="true"></i> Lägg till objekt
          </button>
        </div>

        <!-- Listings -->
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px;">
          ${MOCK_BROKER_LISTINGS.map(l => `
            <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:16px;display:flex;gap:16px;align-items:center;">
              <img src="${l.img}" style="width:72px;height:72px;border-radius:10px;object-fit:cover;flex-shrink:0;" />
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                  <div style="font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.address}</div>
                  <span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:999px;flex-shrink:0;${l.status === 'active' ? 'background:rgba(22,163,74,.15);color:#4ade80;' : 'background:rgba(255,255,255,.08);color:rgba(255,255,255,.4);'}">${l.status === 'active' ? 'Aktiv' : 'Utkast'}</span>
                </div>
                <div style="font-size:12px;color:rgba(255,255,255,.35);margin-bottom:8px;">${l.area} · ${l.type} · ${l.sqm} kvm · ${l.price}</div>
                <div style="display:flex;gap:14px;">
                  <span style="font-size:11px;color:rgba(255,255,255,.35);display:flex;align-items:center;gap:4px;"><i class="ti ti-heart" style="font-size:12px;" aria-hidden="true"></i> ${l.likes}</span>
                  <span style="font-size:11px;color:rgba(255,255,255,.35);display:flex;align-items:center;gap:4px;"><i class="ti ti-star" style="font-size:12px;" aria-hidden="true"></i> ${l.interested}</span>
                  <span style="font-size:11px;color:rgba(255,255,255,.35);display:flex;align-items:center;gap:4px;"><i class="ti ti-eye" style="font-size:12px;" aria-hidden="true"></i> ${l.views}</span>
                  ${l.messages ? `<span style="font-size:11px;color:var(--accent);display:flex;align-items:center;gap:4px;font-weight:600;"><i class="ti ti-message" style="font-size:12px;" aria-hidden="true"></i> ${l.messages} nya</span>` : ''}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
                <button onclick="brokerViewMessages('${l.id}')" style="padding:7px 14px;border-radius:8px;border:0.5px solid rgba(255,255,255,.12);background:transparent;font-size:12px;font-weight:600;color:#fff;cursor:pointer;font-family:var(--font-body);white-space:nowrap;">Se detaljer</button>
                <button onclick="brokerEditListing('${l.id}')" style="padding:7px 14px;border-radius:8px;border:0.5px solid rgba(255,255,255,.08);background:transparent;font-size:12px;color:rgba(255,255,255,.4);cursor:pointer;font-family:var(--font-body);white-space:nowrap;">Redigera</button>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Messages inbox -->
        <div style="font-size:16px;font-weight:600;letter-spacing:-.03em;color:#fff;margin-bottom:16px;">Senaste meddelanden</div>
        <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;">
          ${[
            { obj:"Laröd 44", msg:"Hej! Vi är mycket intresserade av fastigheten. Är det möjligt att boka en visning?", time:"Idag 09:14" },
            { obj:"Laröd 44", msg:"Vilken är lägsta accepterade bud? Vi är en familj på 4 som söker större boende.", time:"Igår 18:32" },
            { obj:"Pålsjövägen 12", msg:"Finns det möjlighet till en privat visning denna vecka?", time:"Igår 11:05" },
            { obj:"Kungsörsgatan 7", msg:"Är taket nytt? Vi är intresserade men vill veta mer om renoveringsbehovet.", time:"2 dagar sedan" },
          ].map((m,i,arr) => `
            <div style="display:flex;gap:14px;padding:14px 18px;border-bottom:${i<arr.length-1?'0.5px solid rgba(255,255,255,.06)':'none'};">
              <div style="width:36px;height:36px;border-radius:50%;background:rgba(204,41,54,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="ti ti-user" style="font-size:16px;color:var(--accent);" aria-hidden="true"></i>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:3px;">${m.obj}</div>
                <div style="font-size:13px;color:rgba(255,255,255,.65);line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">"${m.msg}"</div>
                <div style="font-size:11px;color:rgba(255,255,255,.25);margin-top:4px;">${m.time} · Anonymt</div>
              </div>
              <button onclick="toast('Svara — kommer snart!')" style="padding:6px 12px;border-radius:8px;border:0.5px solid rgba(255,255,255,.12);background:transparent;font-size:11px;font-weight:600;color:rgba(255,255,255,.5);cursor:pointer;font-family:var(--font-body);flex-shrink:0;align-self:center;">Svara</button>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  document.getElementById("addListingBtn").onclick = () => navigate("brokerAddListing");
}

function renderBrokerAddListing() {
  const broker = getBroker();
  if (!broker) { navigate("brokerWelcome"); return; }

  app.innerHTML = `
    <div style="min-height:100vh;background:#0F1117;font-family:var(--font-body);">
      <nav style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:rgba(255,255,255,.03);border-bottom:0.5px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:50;">
        <button onclick="navigate('broker')" style="display:flex;align-items:center;gap:7px;background:transparent;border:none;color:rgba(255,255,255,.5);font-size:13px;cursor:pointer;font-family:var(--font-body);">
          <i class="ti ti-arrow-left" aria-hidden="true"></i> Tillbaka
        </button>
        <div style="font-size:14px;font-weight:600;color:#fff;">Lägg till objekt</div>
        <div style="width:60px;"></div>
      </nav>

      <div style="max-width:620px;margin:0 auto;padding:32px 20px 80px;">
        <div style="font-size:22px;font-weight:700;letter-spacing:-.04em;color:#fff;margin-bottom:4px;">Nytt objekt</div>
        <div style="font-size:13px;color:rgba(255,255,255,.4);margin-bottom:28px;">Fyll i uppgifterna nedan. Du kan redigera när som helst.</div>

        <div style="display:flex;flex-direction:column;gap:16px;">

          <!-- Bilder -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px;">Bilder</div>
            <div style="font-size:12px;color:rgba(255,255,255,.35);margin-bottom:14px;">Första bilden blir huvudbild. Max 20 bilder.</div>
            <div id="imagePreview" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;">
              ${["https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=200&q=60",
                 "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=200&q=60",
                 "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=200&q=60"].map((src,i) => `
                <div style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;">
                  <img src="${src}" style="width:100%;height:100%;object-fit:cover;" />
                  ${i===0?'<div style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,.6);color:#fff;font-size:9px;font-weight:600;padding:2px 6px;border-radius:4px;">HUVUDBILD</div>':''}
                </div>
              `).join('')}
              <label style="border:1.5px dashed rgba(255,255,255,.15);border-radius:8px;aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;gap:4px;">
                <i class="ti ti-plus" style="font-size:20px;color:rgba(255,255,255,.3);" aria-hidden="true"></i>
                <span style="font-size:10px;color:rgba(255,255,255,.3);">Lägg till</span>
                <input type="file" accept="image/*" multiple style="display:none;" />
              </label>
            </div>
          </div>

          <!-- Fastighetsuppgifter -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:14px;">Fastighetsuppgifter</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              ${[
                {lbl:"Adress", ph:"Storgatan 12", full:true},
                {lbl:"Område/stadsdel", ph:"Pålsjö", full:true},
                {lbl:"Bostadstyp", ph:"Villa"},
                {lbl:"Upplåtelseform", ph:"Äganderätt"},
                {lbl:"Storlek (kvm)", ph:"185"},
                {lbl:"Tomtarea (kvm)", ph:"820"},
                {lbl:"Antal rum", ph:"5"},
                {lbl:"Byggår", ph:"1965"},
                {lbl:"Utgångspris", ph:"4 750 000 kr", full:true},
                {lbl:"Driftkostnad (kr/mån)", ph:"4 500"},
                {lbl:"Månadsavgift", ph:"—"},
              ].map(f => `
                <div style="${f.full?'grid-column:1/-1;':''}">
                  <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.35);margin-bottom:5px;">${f.lbl}</label>
                  <input style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="${f.ph}" />
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Beskrivning -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:14px;">Beskrivning</div>
            <textarea style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;min-height:140px;resize:vertical;line-height:1.7;" placeholder="Beskriv fastigheten utförligt — läge, skick, renoveringar, trädgård, närmiljö..."></textarea>
          </div>

          <!-- Planritning -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px;">Planritning</div>
            <div style="font-size:12px;color:rgba(255,255,255,.35);margin-bottom:14px;">Ladda upp planritning som PDF eller bild.</div>
            <label id="planLabel" style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.04);border:1.5px dashed rgba(255,255,255,.15);border-radius:10px;padding:16px;cursor:pointer;">
              <div style="width:40px;height:40px;border-radius:9px;background:rgba(204,41,54,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="ti ti-file-upload" style="font-size:19px;color:var(--accent);" aria-hidden="true"></i>
              </div>
              <div>
                <div style="font-size:13px;font-weight:600;color:#fff;" id="planName">Klicka för att ladda upp</div>
                <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:2px;">PDF, JPG eller PNG · Max 10 MB</div>
              </div>
              <input id="planInput" type="file" accept=".pdf,image/*" style="display:none;" />
            </label>
          </div>

          <!-- Visning -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:14px;">Visning</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              ${[
                {lbl:"Datum", ph:"2025-09-15", type:"date"},
                {lbl:"Tid", ph:"13:00–15:00", type:"text"},
                {lbl:"Anmälningslänk (valfritt)", ph:"https://...", full:true},
                {lbl:"Övrigt om visning", ph:"Parkering finns längs Storgatan", full:true},
              ].map(f => `
                <div style="${f.full?'grid-column:1/-1;':''}">
                  <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.35);margin-bottom:5px;">${f.lbl}</label>
                  <input type="${f.type||'text'}" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="${f.ph}" />
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Ansvarig mäklare -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:14px;">Ansvarig mäklare</div>
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:14px;background:rgba(255,255,255,.04);border-radius:10px;border:0.5px solid rgba(255,255,255,.08);">
              <div style="width:44px;height:44px;border-radius:50%;background:rgba(204,41,54,.2);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:var(--accent);flex-shrink:0;">${broker.logo}</div>
              <div style="flex:1;">
                <div style="font-size:14px;font-weight:600;color:#fff;">${broker.name}</div>
                <div style="font-size:12px;color:rgba(255,255,255,.4);">${broker.firm}</div>
              </div>
              <button onclick="toast('Byt mäklare — kommer snart!')" style="padding:6px 12px;border-radius:7px;border:0.5px solid rgba(255,255,255,.12);background:transparent;font-size:11px;color:rgba(255,255,255,.4);cursor:pointer;font-family:var(--font-body);">Byt</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              ${[
                {lbl:"Telefon", ph:"070-123 45 67"},
                {lbl:"E-post", ph:"anna@fastighetsbyraan.se"},
              ].map(f => `
                <div>
                  <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.35);margin-bottom:5px;">${f.lbl}</label>
                  <input style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;font-size:13px;font-family:var(--font-body);color:#fff;outline:none;" placeholder="${f.ph}" />
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Synlighet -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px;">Synlighet</div>
            <div style="font-size:12px;color:rgba(255,255,255,.35);margin-bottom:14px;">Hur ska objektet visas på ifound?</div>
            <div style="display:flex;flex-direction:column;gap:8px;" id="visibilityOpts">
              ${[
                {val:"coming", lbl:"Coming soon", desc:"Bygg intresse innan officiell publicering. Syns utan pris."},
                {val:"active", lbl:"Till salu",   desc:"Visar pris, visningsdatum och kontaktformulär."},
                {val:"passive",lbl:"Passiv",       desc:"Syns på kartan utan att aktivt marknadsföra."},
              ].map((o,i) => `
                <div onclick="brokerSelVis(this,'${o.val}')" data-vis="${o.val}" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1.5px solid ${i===0?'#CC2936':'rgba(255,255,255,.1)'};background:${i===0?'rgba(204,41,54,.08)':'transparent'};cursor:pointer;">
                  <div style="width:17px;height:17px;border-radius:50%;border:2px solid ${i===0?'#CC2936':'rgba(255,255,255,.2)'};flex-shrink:0;margin-top:1px;background:${i===0?'#CC2936':'transparent'};display:flex;align-items:center;justify-content:center;">
                    ${i===0?'<div style="width:5px;height:5px;border-radius:50%;background:#fff;"></div>':''}
                  </div>
                  <div>
                    <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:2px;">${o.lbl}</div>
                    <div style="font-size:11px;color:rgba(255,255,255,.35);">${o.desc}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <button id="publishBtn" style="width:100%;padding:14px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;font-family:var(--font-body);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
            <i class="ti ti-send" aria-hidden="true"></i> Publicera objekt
          </button>
          <button onclick="navigate('broker')" style="width:100%;padding:12px;border-radius:12px;border:0.5px solid rgba(255,255,255,.1);background:transparent;font-size:13px;color:rgba(255,255,255,.4);font-family:var(--font-body);cursor:pointer;">
            Spara som utkast
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById("publishBtn").onclick = () => {
    toast("Objekt publicerat! Syns nu på ifound.");
    setTimeout(() => navigate("broker"), 1200);
  };

  document.getElementById("planInput").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) {
      document.getElementById("planName").textContent = file.name;
      toast("Planritning uppladdad: " + file.name);
    }
  });
}

function brokerSelVis(el, val) {
  document.querySelectorAll('[data-vis]').forEach(opt => {
    opt.style.borderColor = 'rgba(255,255,255,.1)';
    opt.style.background = 'transparent';
    const radio = opt.querySelector('div');
    if (radio) { radio.style.borderColor = 'rgba(255,255,255,.2)'; radio.style.background = 'transparent'; radio.innerHTML = ''; }
  });
  el.style.borderColor = '#CC2936';
  el.style.background = 'rgba(204,41,54,.08)';
  const radio = el.querySelector('div');
  if (radio) { radio.style.borderColor = '#CC2936'; radio.style.background = '#CC2936'; radio.innerHTML = '<div style="width:5px;height:5px;border-radius:50%;background:#fff;"></div>'; }
}

function brokerViewMessages(id) {
  const listing = MOCK_BROKER_LISTINGS.find(l => l.id === id);
  if (!listing) return;
  toast(`${listing.messages || 0} meddelanden för ${listing.address}`);
}

function brokerEditListing(id) {
  toast("Redigera objekt — kommer snart!");
}

// =========================
// Render & boot
// =========================
function render() {
  renderView();
  const s = loadSession();
  if (s?.email === "admin@ifound.se" || isBroker()) return;
  if (currentView === "brokerWelcome") return;
  let active = "welcome";
  if (currentView === "map") active = "map";
  else if (currentView === "buildNew") active = "welcome";
  else if (currentView === "feed" || currentView.startsWith("property_")) active = "feed";
  else if (currentView !== "welcome" && s?.email) active = "profile";
  mountBottomTabs(active);
}

function renderView() {
  const session = loadSession();

  // Anonymous users can access welcome, feed, map, property views
  if (!session?.email) {
    if (currentView === "brokerWelcome") { renderBrokerWelcome(); return; }
    if (currentView === "feed")   { renderFeed(); return; }
    if (currentView === "map")    { renderMapView(); return; }
    if (currentView === "buildNew") { renderBuildNew(); return; }
  if (currentView === "saved") { renderSaved(); return; }
    if (currentView === "saved") { renderSaved(); return; }
    if (currentView.startsWith("property_")) { renderPropertyView(); return; }
    renderWelcome(); return;
  }
  if (session.email === "admin@ifound.se") { renderAdmin(); return; }
  if (isBroker()) {
    if (currentView === "brokerAddListing") { renderBrokerAddListing(); return; }
    if (currentView === "feed")   { renderFeed(); return; }
    if (currentView === "map")    { renderMapView(); return; }
    if (currentView === "buildNew") { renderBuildNew(); return; }
    if (currentView === "saved") { renderSaved(); return; }
    if (currentView.startsWith("property_")) { renderPropertyView(); return; }
    if (currentView === "broker" || currentView === "dashboard") { renderBrokerDashboard(); return; }
    renderBrokerDashboard(); return;
  }
  if (currentView === "welcome") { renderWelcome(); return; }
  if (currentView === "map") { renderMapView(); return; }
  if (currentView === "feed") { renderFeed(); return; }
  if (currentView === "buildNew") { renderBuildNew(); return; }
  if (currentView.startsWith("property_")) { renderPropertyView(); return; }
  renderDashboard();
}

window.addEventListener("keydown", ev => { if (currentView === "map" && ev.key === "Escape") closePanel(); });

(() => {
  // Pre-register admin account
  const users = loadUsers();
  if (!users["admin@ifound.se"]) {
    users["admin@ifound.se"] = { name: "Admin", email: "admin@ifound.se", password: "ifound2025" };
    saveUsers(users);
  }
  const session = loadSession();
  currentView = session?.email ? "feed" : "welcome";
  render();
})();


// =========================
// DIAGNOSTIK — kör ifoundTypeStats() i konsolen för att se täckningsgrad,
// och ifoundReclassify() för att tvinga en omklassning av hela området.
// =========================
window.ifoundTypeStats = function () {
  const st = loadState();
  const types = st.buildingTypes || {};
  const sources = st.typeSources || {};
  const feats = (lastGeoJson?.features || []);
  const total = feats.length;
  let known = 0;
  const byType = {}, bySource = {};
  for (const f of feats) {
    const pid = getParcelId(f);
    const t = getKnownType(pid);
    if (t) { known++; byType[t] = (byType[t] || 0) + 1; }
    const src = sources[pid] || (t ? "manuell" : "—");
    bySource[src] = (bySource[src] || 0) + 1;
  }
  console.log(`[ifound] Täckning: ${known} av ${total} (${total ? Math.round(known / total * 100) : 0}%)`);
  console.table(byType);
  console.table(bySource);
  console.log("Overpass-fel denna session:", _overpassFailures, "| Förklassning klar:", !!localStorage.getItem(PREFETCH_FLAG));
  return { total, known, byType, bySource };
};

window.ifoundReclassify = function () {
  const st = loadState();
  st.buildingTypes = {};
  st.typeSources = {};
  saveState(st);
  localStorage.removeItem(PREFETCH_FLAG);
  localStorage.removeItem("ifound_osm_prefetch_at");
  _overpassFailures = 0;
  _prefetchAttempts = 0;
  console.log("[ifound] Cache rensad. Startar omklassning...");
  prefetchBuildingTypesInView();
};
