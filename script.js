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
  const svgRenderer = L.svg({ padding: 0.5 });
  map = L.map("map", { zoomControl: true, renderer: svgRenderer }).setView([56.0465, 12.6945], 13);
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
        layer.setStyle({ color: "#C2622A", weight: 2 });
        setTimeout(() => layer.setStyle({ color: "rgba(255,255,255,0.75)", weight: 1 }), 1000);
        renderParcelPanel(feature);
      });

      layer.on("mouseover", () => {
        map.getContainer().style.cursor = "pointer";
        layer.setStyle({ color: "#C2622A", weight: 2, fillOpacity: 0.06 });
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
    <div style="background:#fff;border-radius:20px;padding:28px;width:100%;max-width:420px;box-shadow:0 24px 64px rgba(0,0,0,.2);font-family:'Inter',sans-serif;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;">
        <div>
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#C2622A;margin-bottom:4px;">Visa intresse</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:-.03em;color:#111827;">${name}</div>
        </div>
        <button onclick="closeInterestModal()" style="width:32px;height:32px;border-radius:50%;border:none;background:#F3F4F6;cursor:pointer;font-size:16px;color:#6B7280;display:flex;align-items:center;justify-content:center;flex-shrink:0;">✕</button>
      </div>

      <div style="background:#F9F6F1;border-radius:12px;padding:14px 16px;margin-bottom:20px;font-size:13px;color:#6B7280;line-height:1.6;">
        Ditt intresse sparas på fastigheten. Om ägaren ännu inte är med på ifound kommer de att se det när de går med och claimar sin fastighet.
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:6px;">Meddelande till ägaren <span style="font-weight:400;text-transform:none;letter-spacing:0;">(valfritt)</span></label>
        <textarea id="interestMessage" style="width:100%;border:0.5px solid rgba(17,24,39,.12);border-radius:9px;padding:11px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#111827;outline:none;min-height:100px;resize:vertical;line-height:1.6;background:#fff;" placeholder="Ex: Jag är intresserad av att köpa denna fastighet om ni någonsin funderar på att sälja. Hör gärna av er!"></textarea>
        <div style="font-size:11px;color:#9CA3AF;margin-top:5px;">Meddelandet är anonymt tills du väljer att avslöja din identitet.</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;">
        <button id="sendInterestBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:#C2622A;color:#fff;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
          <i class="ti ti-star" aria-hidden="true"></i> Skicka intresse
        </button>
        <button onclick="sendInterestWithoutMessage('${pid}', '${name}')" style="width:100%;padding:11px;border-radius:11px;border:0.5px solid rgba(17,24,39,.12);background:transparent;color:#6B7280;font-size:13px;font-weight:500;font-family:'Inter',sans-serif;cursor:pointer;">
          Bara markera intresse utan meddelande
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeInterestModal(); });

  document.getElementById('sendInterestBtn').onclick = () => {
    const msg = document.getElementById('interestMessage').value.trim();
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

  if (message) {
    toast("Intresse och meddelande skickat till ägaren!");
  } else {
    toast("Intresse markerat!");
  }

  // Re-render panel if still open
  renderParcelPanel({ properties: { fastighet: name }, geometry: null, _pid: pid });
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
        showArea: true,
        shapeOptions: {
          color: '#C2622A',
          weight: 2,
          fillColor: '#C2622A',
          fillOpacity: 0.15,
        },
        guideLayers: [],
        snapDistance: 10,
      },
      rectangle: {
        shapeOptions: {
          color: '#C2622A',
          weight: 2,
          fillColor: '#C2622A',
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
      <div style="margin:12px 0;padding:12px;background:#FEF0E7;border-radius:10px;font-size:12px;color:#92400E;line-height:1.6;">
        <strong>Rita det område du är intresserad av.</strong><br>
        Klicka på kartan för att markera hörnen. Dubbelklicka för att avsluta.
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button id="drawPolygonBtn" class="panel-btn" style="flex:1;background:#C2622A;color:#fff;border-color:#C2622A;">
          <i class="ti ti-vector-triangle"></i> Rita polygon
        </button>
        <button id="drawRectBtn" class="panel-btn" style="flex:1;">
          <i class="ti ti-rectangle"></i> Rita rektangel
        </button>
      </div>
      <div id="drawStatus" style="font-size:12px;color:#9CA3AF;text-align:center;margin-top:8px;min-height:20px;"></div>
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
  if (drawnItems) drawnItems.addLayer(e.layer);
  showSubdivisionConfirm(e.layer);
}

function showSubdivisionConfirm(layer) {
  const area = L.GeometryUtil ? L.GeometryUtil.geodesicArea(layer.getLatLngs()[0]) : null;
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
          <label style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;display:block;margin-bottom:5px;">Meddelande (valfritt)</label>
          <textarea id="subdivisionMsg" class="input" placeholder="Berätta lite om ditt intresse..." style="min-height:70px;font-size:13px;"></textarea>
        </div>
        <button id="sendSubdivisionBtn" class="btn-primary" style="width:100%;justify-content:center;">
          <i class="ti ti-send"></i> Skicka intresse
        </button>
        <button id="redrawBtn" style="background:transparent;border:none;font-size:12px;color:#9CA3AF;cursor:pointer;font-family:'Inter',sans-serif;">
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
        <div style="font-size:16px;font-weight:700;letter-spacing:-.03em;color:#111827;margin-bottom:8px;">Intresse skickat!</div>
        <div style="font-size:13px;color:#6B7280;line-height:1.6;margin-bottom:20px;">
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

  openPanel(`
    <button class="panel-close" id="closePanelBtn">✕</button>
    ${panelImg ? `
      <div style="margin:-16px -16px 14px;height:140px;overflow:hidden;border-radius:14px 14px 0 0;position:relative;">
        <img src="${panelImg}" style="width:100%;height:100%;object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.4) 0%,transparent 60%);"></div>
        <div style="position:absolute;bottom:10px;left:14px;">
          <div style="font-size:10px;font-weight:600;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.08em;">Besökarläge</div>
          <div style="font-size:16px;font-weight:700;color:#fff;letter-spacing:-.03em;">${name}</div>
        </div>
      </div>
    ` : `
      <div class="panel-eyebrow">Besökarläge</div>
      <div class="panel-name">${name}</div>
    `}
    <div class="panel-mode">Spara intresse och följ objektet.</div>
    <div class="panel-meta">${metaRows}</div>
    <div class="panel-actions">
      <button id="likeBtn"     class="panel-btn ${iLiked      ? "active-like"     : ""}"><i class="ti ti-thumb-up"></i> ${iLiked ? "Gillad" : "Gilla"}</button>
      <button id="interestBtn" class="panel-btn ${iInterested ? "active-interest" : ""}"><i class="ti ti-star"></i> ${iInterested ? "Intresserad" : "Markera intresse"}</button>
    </div>
    <div style="margin-top:8px;">
      <button id="subdivisionBtn" class="panel-btn" style="width:100%;${state.subdivisionInterests?.[pid] ? 'background:#F0FDF4;border-color:#16a34a;color:#16a34a;' : ''}">
        <i class="ti ti-cut"></i> ${state.subdivisionInterests?.[pid] ? "Avstyckning — intresse skickat" : "Intresserad av att stycka av tomt"}
      </button>
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

  document.getElementById("subdivisionBtn").onclick = () => {
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
  const activeStyle  = 'flex:1;padding:9px;border-radius:8px;border:none;background:#fff;color:#111827;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.08);';
  const passiveStyle = 'flex:1;padding:9px;border-radius:8px;border:none;background:transparent;color:#6B7280;font-size:13px;font-weight:500;cursor:pointer;font-family:Inter,sans-serif;';
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
    <div style="background:#fff;border-radius:20px;padding:28px;width:100%;max-width:400px;box-shadow:0 24px 64px rgba(0,0,0,.2);font-family:'Inter',sans-serif;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="16" height="20" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
          <span style="font-size:17px;font-weight:700;letter-spacing:-.04em;color:#111827;">i<em style="font-style:normal;color:#C2622A;">found</em></span>
        </div>
        <button onclick="closeAuthModal()" style="width:30px;height:30px;border-radius:50%;border:none;background:#F3F4F6;cursor:pointer;font-size:16px;color:#6B7280;display:flex;align-items:center;justify-content:center;">✕</button>
      </div>

      <div style="display:flex;background:rgba(17,24,39,.06);border-radius:10px;padding:3px;margin-bottom:20px;">
        <button id="tabLogin" onclick="switchTab('login')" style="flex:1;padding:9px;border-radius:8px;border:none;background:#fff;color:#111827;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.08);">Logga in</button>
        <button id="tabReg"   onclick="switchTab('reg')"   style="flex:1;padding:9px;border-radius:8px;border:none;background:transparent;color:#6B7280;font-size:13px;font-weight:500;cursor:pointer;font-family:Inter,sans-serif;">Skapa konto</button>
      </div>

      <div id="loginForm" style="display:flex;flex-direction:column;gap:12px;">
        <div style="background:#F0FDF4;border-radius:10px;padding:10px 14px;font-size:12px;color:#166534;line-height:1.5;">
          <strong>Logga in för att:</strong> spara gillar, skicka intresse, claima din fastighet.
        </div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">E-post</label><input id="loginEmail" class="input" type="email" placeholder="din@epost.se" style="width:100%;" /></div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">Lösenord</label><input id="loginPass" class="input" type="password" placeholder="••••••••" style="width:100%;" /></div>
        <button id="loginBtn" class="btn-primary" style="width:100%;justify-content:center;padding:12px;">Logga in</button>
        <div style="font-size:11px;color:#9CA3AF;text-align:center;">Admin: admin@ifound.se / ifound2025</div>
      </div>

      <div id="regForm" style="display:none;flex-direction:column;gap:12px;">
        <div style="background:#FEF0E7;border-radius:10px;padding:10px 14px;font-size:12px;color:#92400E;line-height:1.5;">
          Gratis konto — spara dina favoriter och visa intresse för fastigheter.
        </div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">Namn</label><input id="regName" class="input" placeholder="Ditt namn" style="width:100%;" /></div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">E-post</label><input id="regEmail" class="input" type="email" placeholder="din@epost.se" style="width:100%;" /></div>
        <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">Lösenord</label><input id="regPass" class="input" type="password" placeholder="Min 4 tecken" style="width:100%;" /></div>
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
    toast("Konto skapat — välkommen!"); currentView = "feed"; render();
  };
}

function closeAuthModal() {
  const overlay = document.getElementById('auth-modal-overlay');
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
  btn.style.color = isLiked ? '#9CA3AF' : '#C2622A';
  btn.textContent = isLiked ? '♡' : '♥';
  toast(isLiked ? 'Gillning borttagen' : 'Gillad!');
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

  app.innerHTML = `
    <div style="background:#F9F6F1;min-height:100vh;font-family:'Inter',sans-serif;">

      <nav style="display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:56px;background:rgba(249,246,241,.95);border-bottom:0.5px solid rgba(17,24,39,.07);position:sticky;top:0;z-index:50;backdrop-filter:blur(8px);">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="17" height="21" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
          <span style="font-size:19px;font-weight:700;letter-spacing:-.05em;color:#111827;">i<em style="font-style:normal;color:#C2622A;">found</em></span>
        </div>
        <div style="display:flex;gap:2px;">
          <button onclick="currentView='feed';render();" style="padding:7px 13px;border-radius:8px;font-size:13px;font-weight:500;color:#6B7280;background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;">Utforska</button>
          <button onclick="currentView='map';render();" style="padding:7px 13px;border-radius:8px;font-size:13px;font-weight:500;color:#6B7280;background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;">Karta</button>
          <button onclick="navigate('brokerWelcome')" style="padding:7px 13px;border-radius:8px;font-size:13px;font-weight:500;color:#6B7280;background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;">För mäklare</button>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button onclick="openAuthModal('login')" style="padding:7px 14px;border-radius:8px;font-size:13px;font-weight:500;color:#374151;background:transparent;border:0.5px solid rgba(17,24,39,.12);cursor:pointer;font-family:'Inter',sans-serif;">Logga in</button>
          <button onclick="openAuthModal('reg')" style="padding:7px 14px;border-radius:9px;font-size:13px;font-weight:600;color:#fff;background:#C2622A;border:none;cursor:pointer;font-family:'Inter',sans-serif;">Kom igång</button>
        </div>
      </nav>

      <!-- Hero -->
      <div style="max-width:700px;margin:0 auto;padding:48px 24px 36px;text-align:center;">
        <div style="font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#C2622A;margin-bottom:12px;">Fastigheter på ett nytt sätt</div>
        <h1 style="font-size:40px;font-weight:700;letter-spacing:-.05em;line-height:1.05;color:#111827;margin-bottom:14px;font-family:'Inter',sans-serif;">Åkte du förbi ett hus<br>du <em style="font-style:normal;color:#C2622A;">aldrig kan glömma?</em></h1>
        <p style="font-size:16px;color:#6B7280;line-height:1.7;margin-bottom:28px;max-width:480px;margin-left:auto;margin-right:auto;">Sök upp det, visa ditt intresse — även om det inte är till salu. Inget konto krävs.</p>

        <!-- Search -->
        <div style="display:flex;gap:8px;background:#fff;border:1.5px solid rgba(17,24,39,.12);border-radius:13px;padding:5px 5px 5px 14px;align-items:center;margin-bottom:12px;">
          <i class="ti ti-search" style="font-size:18px;color:#9CA3AF;flex-shrink:0;" aria-hidden="true"></i>
          <input id="landingSearch" placeholder="Sök adress, område eller gata..." style="flex:1;border:none;background:transparent;font-size:15px;font-family:'Inter',sans-serif;color:#111827;outline:none;padding:7px 0;" />
          <button id="landingSearchBtn" style="background:#C2622A;color:#fff;border:none;border-radius:9px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;">Sök</button>
        </div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button id="landingNearMe" style="display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;font-size:12px;font-weight:600;background:#111827;color:#fff;border:none;cursor:pointer;font-family:'Inter',sans-serif;">
            <i class="ti ti-current-location" style="font-size:13px;" aria-hidden="true"></i> Nära mig
          </button>
          <button onclick="currentView='map';render();" style="display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:999px;font-size:12px;font-weight:500;background:#fff;color:#374151;border:0.5px solid rgba(17,24,39,.12);cursor:pointer;font-family:'Inter',sans-serif;">
            <i class="ti ti-map-2" style="font-size:13px;" aria-hidden="true"></i> Öppna karta
          </button>
          ${["Pålsjö","Laröd","Söder","Centrum"].map(a=>`
            <button onclick="currentView='feed';render();" style="padding:7px 14px;border-radius:999px;font-size:12px;font-weight:500;background:#fff;color:#374151;border:0.5px solid rgba(17,24,39,.12);cursor:pointer;font-family:'Inter',sans-serif;">${a}</button>
          `).join('')}
        </div>
      </div>

      <!-- Topplistor -->
      <div style="max-width:900px;margin:0 auto;padding:0 20px 36px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#111827;">Mest gillade</div>
          <button onclick="currentView='feed';render();" style="font-size:12px;font-weight:600;color:#C2622A;background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:3px;">Alla <i class="ti ti-chevron-right" style="font-size:12px;" aria-hidden="true"></i></button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:28px;">
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
          <div style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#111827;">Utforska fastigheter</div>
          <button onclick="currentView='feed';render();" style="font-size:12px;font-weight:600;color:#C2622A;background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:3px;">Se alla <i class="ti ti-chevron-right" style="font-size:12px;" aria-hidden="true"></i></button>
        </div>
        <div style="columns:4;column-gap:10px;margin-bottom:36px;">
          ${PINS.map(p=>`
            <div onclick="currentView='feed';render();" style="break-inside:avoid;margin-bottom:10px;border-radius:12px;overflow:hidden;cursor:pointer;background:#fff;border:0.5px solid rgba(17,24,39,.07);position:relative;">
              <div style="position:relative;">
                <img src="${p.img}" style="width:100%;height:${p.h}px;object-fit:cover;display:block;" alt="${p.name}" loading="lazy" />
                ${p.badge ? `<div style="position:absolute;top:8px;left:8px;font-size:10px;font-weight:600;padding:3px 8px;border-radius:999px;background:rgba(194,98,42,.88);color:#fff;">${p.badgeTxt}</div>` : ''}
                <button onclick="event.stopPropagation();landingLike(this)" style="position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.92);border:none;cursor:pointer;font-size:14px;color:#9CA3AF;">♡</button>
              </div>
              <div style="padding:9px 11px 11px;">
                <div style="font-size:12px;font-weight:600;color:#111827;">${p.name}</div>
                <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">${p.meta}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:7px;font-size:11px;color:#9CA3AF;">
                  <span>♡ ${p.likes}</span>
                  ${p.interested ? `<span style="font-size:10px;font-weight:600;color:#C2622A;background:#FEF0E7;padding:2px 7px;border-radius:999px;">${p.interested} intresserade</span>` : ''}
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
              <div style="font-size:11px;font-weight:700;color:#C2622A;letter-spacing:.08em;margin-bottom:10px;">${s.num}</div>
              <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:6px;">${s.title}</div>
              <div style="font-size:12px;color:#6B7280;line-height:1.6;">${s.desc}</div>
            </div>
          `).join('')}
        </div>

        <!-- CTA -->
        <div style="background:#111827;border-radius:16px;padding:28px 32px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#fff;margin-bottom:4px;">Är det ditt hus? Gå med.</div>
            <div style="font-size:13px;color:rgba(255,255,255,.5);">Se vem som är intresserad av din fastighet — gratis.</div>
          </div>
          <div style="display:flex;gap:10px;flex-shrink:0;">
            <button onclick="openAuthModal('reg')" style="padding:10px 20px;border-radius:10px;border:none;background:#fff;color:#111827;font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Claima din fastighet</button>
            <button onclick="navigate('brokerWelcome')" style="padding:10px 20px;border-radius:10px;border:0.5px solid rgba(255,255,255,.25);background:transparent;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">För mäklare</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Search handler
  document.getElementById("landingSearchBtn").onclick = () => {
    const q = document.getElementById("landingSearch").value.trim();
    if (q) { toast("Söker efter " + q + "..."); }
    currentView = "map"; render();
  };
  document.getElementById("landingSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("landingSearchBtn").click();
  });

  // Near me
  document.getElementById("landingNearMe").onclick = () => {
    currentView = "map"; render();
    setTimeout(() => {
      const btn = document.getElementById("nearMeMapBtn");
      if (btn) btn.click();
    }, 500);
  };
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
          <button onclick="document.getElementById('homeImageInput').click()" style="position:absolute;top:14px;right:14px;z-index:3;background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.4);color:#fff;border-radius:10px;padding:7px 13px;font-size:12px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px);">
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
              ${ownerId && state.interestMessages?.[ownerId]?.length ? `
                <div style="margin-bottom:12px;padding:12px;background:#FEF0E7;border-radius:10px;">
                  <div style="font-size:12px;font-weight:700;color:#C2622A;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <i class="ti ti-message" style="font-size:14px;"></i>
                    ${state.interestMessages[ownerId].length} meddelande${state.interestMessages[ownerId].length > 1 ? 'n' : ''} från intressenter
                  </div>
                  ${state.interestMessages[ownerId].map(m => `
                    <div style="background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:6px;font-size:12px;color:#374151;line-height:1.5;border:0.5px solid rgba(194,98,42,.15);">
                      "${m.message}"
                      <div style="font-size:10px;color:#9CA3AF;margin-top:4px;">${new Date(m.sentAt).toLocaleDateString('sv-SE')} · Anonymt</div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
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

  app.innerHTML = `
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
            <option value="owner"   ${savedMode==="owner"  ?"selected":""}>Ägarläge</option>
          </select>
          <button id="nearMeMapBtn" class="toolbar-btn"><i class="ti ti-current-location" aria-hidden="true"></i> Nära mig</button>
          <button id="toggleMapStyleBtn" class="toolbar-btn">Kartvy</button>
          <button id="backBtn" class="toolbar-btn"><i class="ti ti-arrow-left" aria-hidden="true"></i> Min sida</button>
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
    saveMapMode(e.target.value); closePanel(); redrawLayer();
  });

  document.getElementById("backBtn").onclick = () => { closePanel(); navigate("dashboard"); };

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
          radius: 10, weight: 3, color: "#C2622A", fillColor: "#C2622A", fillOpacity: 0.9
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
      <path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/>
      <polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/>
      <rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/>
      <rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/>
    </svg>`,

    rent: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 30 38">
      <path d="M15 0C6.7 0 0 6.7 0 15C0 26.3 15 38 15 38S30 26.3 30 15C30 6.7 23.3 0 15 0Z" fill="#2563eb"/>
      <polygon points="7,16 15,8 23,16" fill="white" opacity=".95"/>
      <rect x="9" y="16" width="12" height="9" rx="1" fill="white" opacity=".95"/>
      <rect x="12" y="19" width="5" height="6" rx=".5" fill="#2563eb"/>
    </svg>`,

    broker_sale: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 64 78">
      <path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/>
      <polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/>
      <rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/>
      <rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/>
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
    const statusColor = { passive: '#6B7280', sale: '#C2622A', rent: '#2563eb' }[prop.status] || '#6B7280';

    // Find matching PROP_DATA entry for image
    const propDataMatch = (typeof PROP_DATA !== 'undefined') ? PROP_DATA.find(p =>
      p.name.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'') === prop.name.toUpperCase().replace(/[^A-ZÅÄÖ0-9]/g,'')
    ) : null;
    const imgSrc = prop.img || propDataMatch?.img || null;
    const area = prop.area || propDataMatch?.meta || '';

    marker.bindPopup(`
      <div style="font-family:'Inter',sans-serif;width:220px;overflow:hidden;">
        ${imgSrc ? `
          <div style="margin:-1px -1px 0;height:130px;overflow:hidden;border-radius:12px 12px 0 0;">
            <img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;display:block;" />
          </div>
        ` : `
          <div style="margin:-1px -1px 0;height:80px;background:linear-gradient(135deg,#1a2533,#2a1a08);border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:center;">
            <svg width="32" height="40" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A" opacity=".6"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".8"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".8"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A" opacity=".6"/></svg>
          </div>
        `}
        <div style="padding:12px 14px 14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:10px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:.08em;background:${statusColor}18;padding:2px 7px;border-radius:999px;">${statusLabel}</span>
            ${prop.price ? `<span style="font-size:12px;font-weight:700;color:#111827;">${prop.price}</span>` : ''}
          </div>
          <div style="font-size:14px;font-weight:700;letter-spacing:-.03em;color:#111827;margin-bottom:2px;">${prop.name}</div>
          ${area ? `<div style="font-size:11px;color:#9CA3AF;margin-bottom:10px;">${area}</div>` : '<div style="margin-bottom:10px;"></div>'}
          <div style="display:flex;gap:0;border-top:0.5px solid #F3F4F6;padding-top:10px;">
            <div style="flex:1;text-align:center;">
              <div style="font-size:17px;font-weight:700;color:#111827;line-height:1;">${prop.likes}</div>
              <div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;">Gillar</div>
            </div>
            <div style="width:0.5px;background:#F3F4F6;"></div>
            <div style="flex:1;text-align:center;">
              <div style="font-size:17px;font-weight:700;color:#111827;line-height:1;">${prop.interested}</div>
              <div style="font-size:9px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;">Intresserade</div>
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

  // Load from GitHub repo
  const url = "https://raw.githubusercontent.com/MANIfound/ifound/main/helsingborg_centrum.geojson";

  fetch(url)
    .then(r => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(geojson => {
      geojson = reprojectGeoJsonIfNeeded(geojson);
      addGeoJsonToMap(geojson, { keepView: false });
      updateMapStatus(geojson.features?.length || 0);
      try { localStorage.setItem(LS_GEOJSON, JSON.stringify(geojson)); } catch {}
      addClaimedMarkers();
    })
    .catch(err => {
      console.error(err);
      if (statusEl) statusEl.textContent = "Kunde inte ladda fastighetsdata";
      toast("Kunde inte hämta fastighetsdata — kontrollera anslutningen.");
    });
}

function updateMapStatus(count) {
  const el = document.getElementById("mapStatus");
  if (el) el.textContent = count.toLocaleString("sv-SE") + " fastigheter laddade";
}

async function mapSearch(query, dropdown, input) {
  dropdown.style.display = "block";
  dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;">Söker...</div>';

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&countrycodes=se&accept-language=sv`;
    const res = await fetch(url);
    const results = await res.json();

    if (!results.length) {
      dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;">Inga resultat</div>';
      return;
    }

    dropdown.innerHTML = results.map(r => {
      const name = r.display_name.split(",").slice(0,2).join(", ");
      return `<div data-lat="${r.lat}" data-lon="${r.lon}"
        style="padding:11px 16px;font-size:13px;color:#111827;cursor:pointer;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;gap:10px;"
        onmouseover="this.style.background='#F9F6F1'" onmouseout="this.style.background=''"
        onclick="mapSelectLocation('${r.display_name.replace(/'/g,"\\'").split(',').slice(0,2).join(',')}', ${r.lat}, ${r.lon})">
        <i class="ti ti-map-pin" style="font-size:14px;color:#C2622A;flex-shrink:0;" aria-hidden="true"></i>
        <span>${name}</span>
      </div>`;
    }).join('');
  } catch {
    dropdown.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:#9CA3AF;">Sökning misslyckades</div>';
  }
}

function mapSelectLocation(name, lat, lon) {
  const input    = document.getElementById("addressSearch");
  const dropdown = document.getElementById("searchDropdown");
  if (input) input.value = name.split(",")[0];
  if (dropdown) dropdown.style.display = "none";
  if (map) map.setView([parseFloat(lat), parseFloat(lon)], 17);
  toast("Visar " + name.split(",")[0]);
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
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#C2622A;margin-bottom:4px;">Claima fastighet</div>
          <div style="font-size:18px;font-weight:700;letter-spacing:-.03em;color:#111827;">Verifiera ditt ägande</div>
        </div>
        <button onclick="closeClaimModal()" style="width:32px;height:32px;border-radius:50%;border:none;background:#F3F4F6;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;color:#6B7280;">✕</button>
      </div>

      <div style="background:#F9F6F1;border-radius:12px;padding:14px 16px;margin-bottom:20px;display:flex;align-items:center;gap:12px;">
        <i class="ti ti-home" style="font-size:20px;color:#C2622A;" aria-hidden="true"></i>
        <div>
          <div style="font-size:13px;font-weight:600;color:#111827;">Ingen fastighet vald</div>
          <div style="font-size:11px;color:#9CA3AF;">Välj fastighet via kartan för att koppla den till din profil</div>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:20px;">
        <div>
          <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:6px;">Fullständigt namn</label>
          <input id="claim-name" class="input" placeholder="Anna Lindqvist" style="width:100%;" />
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:6px;">Personnummer</label>
          <input id="claim-pnr" class="input" placeholder="YYYYMMDD-XXXX" maxlength="13" style="width:100%;font-family:monospace;letter-spacing:.05em;" />
          <div style="font-size:11px;color:#9CA3AF;margin-top:5px;">Används endast för att verifiera ägandet mot fastighetsregistret.</div>
        </div>
        <div>
          <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:6px;">Fastighetsbeteckning</label>
          <input id="claim-prop" class="input" placeholder="Ex. Pålsjö 4:7" style="width:100%;" />
        </div>
      </div>

      <div style="background:#FEF0E7;border-radius:10px;padding:12px 14px;margin-bottom:20px;display:flex;gap:10px;align-items:flex-start;">
        <i class="ti ti-clock" style="font-size:16px;color:#C2622A;flex-shrink:0;margin-top:1px;" aria-hidden="true"></i>
        <div style="font-size:12px;color:#92400E;line-height:1.5;">Din claim behandlas inom <strong>24 timmar</strong>. Vi verifierar manuellt att uppgifterna stämmer mot fastighetsregistret innan fastigheten kopplas till din profil.</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:20px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:-6px;">Hur vill du synas?</div>
        ${[
          { id:'vis-private', val:'private', label:'Privat', desc:'Bara du ser statistiken. Syns inte utåt.' },
          { id:'vis-public',  val:'public',  label:'Synlig', desc:'Din profil och bilder syns för besökare.' },
          { id:'vis-sale',    val:'sale',    label:'Till salu eller uthyrning', desc:'Visa pris och ta emot intresse direkt.' },
        ].map((o,i) => `
          <div id="vo-${o.val}" onclick="selectClaimVis('${o.val}')" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:11px;border:1.5px solid ${i===0?'#C2622A':'rgba(17,24,39,.08)'};background:${i===0?'rgba(194,98,42,.03)':'#fff'};cursor:pointer;">
            <div id="radio-${o.val}" style="width:18px;height:18px;border-radius:50%;border:2px solid ${i===0?'#C2622A':'rgba(17,24,39,.18)'};flex-shrink:0;margin-top:1px;display:flex;align-items:center;justify-content:center;background:${i===0?'#C2622A':'transparent'};">
              ${i===0?'<div style="width:6px;height:6px;border-radius:50%;background:#fff;"></div>':''}
            </div>
            <div>
              <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:2px;">${o.label}</div>
              <div style="font-size:11px;color:#9CA3AF;line-height:1.5;">${o.desc}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <button onclick="submitClaim()" style="width:100%;padding:14px;border-radius:12px;border:none;background:#C2622A;color:#fff;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;letter-spacing:-.01em;">
        Skicka in claim
      </button>

      <div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:12px;line-height:1.5;">
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
      el.style.borderColor = '#C2622A';
      el.style.background = 'rgba(194,98,42,.03)';
      radio.style.borderColor = '#C2622A';
      radio.style.background = '#C2622A';
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
    return '<div style="padding:16px 20px;font-size:13px;color:#9CA3AF;">Inga meddelanden ännu.</div>';
  }

  return allMsgs.map(m => `
    <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.05);display:flex;gap:12px;align-items:flex-start;">
      <div style="width:36px;height:36px;border-radius:9px;background:#FEF0E7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="ti ti-message" style="font-size:16px;color:#C2622A;" aria-hidden="true"></i>
      </div>
      <div style="flex:1;">
        <div style="font-size:12px;font-weight:600;color:#C2622A;margin-bottom:3px;">${m.parcel}</div>
        <div style="font-size:13px;color:#374151;line-height:1.5;">&ldquo;${m.message}&rdquo;</div>
        <div style="font-size:11px;color:#9CA3AF;margin-top:4px;">${new Date(m.sentAt).toLocaleDateString('sv-SE')} · Anonymt</div>
      </div>
    </div>
  `).join('');
}

// =========================
// ADMIN VIEW
// =========================

let adminTab = "overview";

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
    { icon:"ti-heart",      color:"#C2622A", bg:"#FEF0E7", text:"Ny gillning på Laröd 3:19",              time:"32 min sedan" },
    { icon:"ti-home-check", color:"#2563eb", bg:"#EFF6FF", text:"Sara Björk claimade Laröd 3:19",         time:"2 h sedan" },
    { icon:"ti-star",       color:"#7c3aed", bg:"#F5F3FF", text:"Nytt intresse på Fredriksdal 6:1",       time:"3 h sedan" },
    { icon:"ti-user-plus",  color:"#16a34a", bg:"#F0FDF4", text:"Lena Svensson registrerade sig",         time:"5 h sedan" },
    { icon:"ti-heart",      color:"#C2622A", bg:"#FEF0E7", text:"Ny gillning på Pålsjö 4:7",              time:"Igår" },
    { icon:"ti-flag",       color:"#dc2626", bg:"#FEF2F2", text:"Innehåll rapporterat — Söder 8:22",      time:"Igår" },
    { icon:"ti-star",       color:"#7c3aed", bg:"#F5F3FF", text:"Nytt intresse på Pålsjö 4:7",            time:"Igår" },
  ];

  const tabs = [
    { id:"overview",    label:"Översikt",       icon:"ti-layout-dashboard" },
    { id:"users",       label:"Användare",      icon:"ti-users" },
    { id:"properties",  label:"Fastigheter",    icon:"ti-home-check" },
    { id:"moderation",  label:"Moderering",     icon:"ti-shield-check" },
    { id:"insights",    label:"Insikter",       icon:"ti-chart-bar" },
    { id:"premium",     label:"Premium",        icon:"ti-star" },
  ];

  const visStyle = (v) => ({
    "Privat":    "background:#F3F4F6;color:#6B7280;",
    "Synlig":    "background:#EFF6FF;color:#2563eb;",
    "Till salu": "background:#F0FDF4;color:#16a34a;",
    "Uthyrning": "background:#F5F3FF;color:#7c3aed;",
  }[v] || "background:#F3F4F6;color:#6B7280;");

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
            <div style="width:38px;height:38px;border-radius:9px;background:#FEF0E7;display:flex;align-items:center;justify-content:center;">
              <i class="ti ${s.icon}" style="font-size:18px;color:#C2622A;" aria-hidden="true"></i>
            </div>
          </div>
          <div style="font-size:28px;font-weight:700;letter-spacing:-.04em;color:#111827;line-height:1;">${s.num}</div>
          <div style="font-size:12px;color:#9CA3AF;margin-top:4px;">${s.lbl}</div>
          <div style="font-size:11px;color:#16a34a;margin-top:6px;font-weight:500;">${s.sub}</div>
        </div>
      `).join('')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:13px;font-weight:600;color:#111827;">Senaste aktivitet</div>
          <span style="font-size:11px;color:#9CA3AF;">Live</span>
        </div>
        ${mockActivity.slice(0,6).map(a=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:0.5px solid rgba(17,24,39,.04);">
            <div style="width:32px;height:32px;border-radius:8px;background:${a.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="ti ${a.icon}" style="font-size:15px;color:${a.color};" aria-hidden="true"></i>
            </div>
            <div style="flex:1;font-size:12px;color:#374151;line-height:1.4;">${a.text}</div>
            <div style="font-size:11px;color:#9CA3AF;white-space:nowrap;">${a.time}</div>
          </div>
        `).join('')}
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:0.5px solid rgba(17,24,39,.06);">
          <div style="font-size:13px;font-weight:600;color:#111827;">Hetaste fastigheter</div>
        </div>
        ${mockProps.sort((a,b)=>b.likes-a.likes).slice(0,4).map(p=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:0.5px solid rgba(17,24,39,.04);">
            <img src="${p.img}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;flex-shrink:0;" />
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.prop}</div>
              <div style="font-size:11px;color:#9CA3AF;">${p.likes} gillar · ${p.interested} intresserade</div>
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
        <div style="font-size:13px;font-weight:600;color:#111827;">${mockUsers.length} användare</div>
        <div style="display:flex;gap:8px;">
          <div style="display:flex;align-items:center;gap:6px;background:#F9F6F1;border:0.5px solid rgba(17,24,39,.08);border-radius:8px;padding:6px 12px;">
            <i class="ti ti-search" style="font-size:13px;color:#9CA3AF;" aria-hidden="true"></i>
            <input placeholder="Sök användare..." style="border:none;background:transparent;font-size:12px;font-family:'Inter',sans-serif;color:#111827;outline:none;width:140px;" />
          </div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#F9F6F1;">
            <th style="text-align:left;padding:10px 20px;font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;">Användare</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;">Roll</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;">Gillar</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;">Registrerad</th>
            <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:600;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;">Status</th>
            <th style="padding:10px 20px 10px 12px;"></th>
          </tr>
        </thead>
        <tbody>
          ${mockUsers.map(u=>`
            <tr style="border-top:0.5px solid rgba(17,24,39,.05);">
              <td style="padding:12px 20px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#FEF0E7;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#C2622A;flex-shrink:0;">${u.name[0]}</div>
                  <div>
                    <div style="font-size:13px;font-weight:600;color:#111827;">${u.name}</div>
                    <div style="font-size:11px;color:#9CA3AF;">${u.email}</div>
                  </div>
                </div>
              </td>
              <td style="padding:12px;">
                <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;${u.role==='Ägare'?'background:#F0FDF4;color:#16a34a;':'background:#F3F4F6;color:#6B7280;'}">${u.role}</span>
              </td>
              <td style="padding:12px;font-size:13px;color:#374151;">${u.likes}</td>
              <td style="padding:12px;font-size:12px;color:#9CA3AF;">${u.joined}</td>
              <td style="padding:12px;">
                <span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;${u.status==='active'?'background:#F0FDF4;color:#16a34a;':'background:#FEF2F2;color:#dc2626;'}">${u.status==='active'?'Aktiv':'Blockerad'}</span>
              </td>
              <td style="padding:12px 20px 12px 12px;">
                <div style="display:flex;gap:6px;">
                  <button onclick="adminToast('Visa ${u.name}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:#111827;cursor:pointer;font-family:'Inter',sans-serif;">Visa</button>
                  <button onclick="adminToast('${u.status==='active'?'Blockerar':'Aktiverar'} ${u.name}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:${u.status==='active'?'#dc2626':'#16a34a'};cursor:pointer;font-family:'Inter',sans-serif;">${u.status==='active'?'Blockera':'Aktivera'}</button>
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
        <div style="font-size:13px;font-weight:600;color:#111827;">${mockProps.length} claimade fastigheter</div>
        <div style="display:flex;gap:6px;">
          ${["Alla","Privat","Synlig","Till salu"].map(f=>`<button onclick="adminToast('Filtrerar: ${f}')" style="padding:5px 12px;border-radius:999px;border:0.5px solid rgba(17,24,39,.12);background:${f==='Alla'?'#111827':'#fff'};color:${f==='Alla'?'#fff':'#374151'};font-size:11px;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;">${f}</button>`).join('')}
        </div>
      </div>
      ${mockProps.map(p=>`
        <div style="display:flex;align-items:center;gap:14px;padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.05);">
          <img src="${p.img}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;flex-shrink:0;" />
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:2px;">${p.prop}</div>
            <div style="font-size:11px;color:#9CA3AF;">Ägare: ${p.user} · Claimad ${p.date}</div>
            <div style="display:flex;gap:10px;margin-top:6px;">
              <span style="font-size:11px;color:#9CA3AF;">${p.likes} gillar</span>
              <span style="font-size:11px;color:#9CA3AF;">${p.interested} intresserade</span>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
            <span style="font-size:10px;font-weight:600;padding:3px 9px;border-radius:999px;${visStyle(p.visible)}">${p.visible}</span>
            <div style="display:flex;gap:6px;">
              <button onclick="adminToast('Öppnar ${p.prop}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:#111827;cursor:pointer;font-family:'Inter',sans-serif;">Visa</button>
              <button onclick="adminToast('Ta bort claim: ${p.prop}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:#dc2626;cursor:pointer;font-family:'Inter',sans-serif;">Ta bort</button>
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
          <div style="font-size:13px;font-weight:600;color:#111827;">${u.pendingClaim.prop}</div>
          <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">Inskickad av ${u.pendingClaim.name}</div>
        </div>
        <span style="font-size:10px;font-weight:600;background:#FEF0E7;color:#C2622A;border-radius:999px;padding:3px 9px;flex-shrink:0;margin-left:10px;">Inväntar</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div style="background:#F9F6F1;border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Namn</div>
          <div style="font-size:12px;font-weight:600;color:#111827;">${u.pendingClaim.name}</div>
        </div>
        <div style="background:#F9F6F1;border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Personnummer</div>
          <div style="font-size:12px;font-weight:600;color:#111827;font-family:monospace;">${u.pendingClaim.pnr}</div>
        </div>
        <div style="background:#F9F6F1;border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Fastighet</div>
          <div style="font-size:12px;font-weight:600;color:#111827;">${u.pendingClaim.prop}</div>
        </div>
        <div style="background:#F9F6F1;border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:3px;">Synlighet</div>
          <div style="font-size:12px;font-weight:600;color:#111827;">${{private:'Privat',public:'Synlig',sale:'Till salu'}[u.pendingClaim.visibility]||'Privat'}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button onclick="approveClaim('${u.email}')" style="flex:1;padding:9px;border-radius:9px;border:none;background:#16a34a;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Godkänn</button>
        <button onclick="rejectClaim('${u.email}')" style="flex:1;padding:9px;border-radius:9px;border:0.5px solid rgba(17,24,39,.12);background:#fff;color:#dc2626;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Neka</button>
      </div>
    </div>
  `).join('') : '<div style="padding:16px 20px;font-size:13px;color:#9CA3AF;">Inga väntande claims.</div>';

  const moderationHtml = `
    <div style="display:grid;gap:12px;">

      <div style="background:#fff;border:1.5px solid #C2622A;border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;justify-content:space-between;background:#FEF0E7;">
          <div style="display:flex;align-items:center;gap:8px;">
            <i class="ti ti-home-check" style="font-size:16px;color:#C2622A;" aria-hidden="true"></i>
            <div style="font-size:13px;font-weight:600;color:#C2622A;">Claims som väntar verifiering</div>
          </div>
          <span style="font-size:11px;font-weight:700;background:#C2622A;color:#fff;border-radius:999px;padding:2px 8px;">${pendingClaims.length}</span>
        </div>
        ${pendingClaimsHtml}
      </div>

            <!-- Interest messages section -->
      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:13px;font-weight:600;color:#111827;">Meddelanden från intressenter</div>
          <div style="font-size:11px;color:#9CA3AF;">Anonyma tills ägaren svarar</div>
        </div>
        ${renderInterestMessages()}
      </div>

      <div style="background:#FEF2F2;border:0.5px solid rgba(220,38,38,.15);border-radius:14px;padding:18px 20px;">
        <div style="display:flex;align-items:flex-start;gap:14px;">
          <div style="width:40px;height:40px;border-radius:10px;background:#FEE2E2;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="ti ti-flag" style="font-size:18px;color:#dc2626;" aria-hidden="true"></i>
          </div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;">Rapport: Söder 8:22</div>
            <div style="font-size:12px;color:#6B7280;line-height:1.5;margin-bottom:12px;">Användaren "erik@example.se" rapporterade att beskrivningen är vilseledande. Kontaktuppgifterna stämmer inte överens med fastigheten.</div>
            <div style="display:flex;gap:8px;">
              <button onclick="adminToast('Granskar Söder 8:22...')" style="padding:7px 14px;border-radius:8px;border:none;background:#dc2626;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Granska</button>
              <button onclick="adminToast('Rapport avfärdad')" style="padding:7px 14px;border-radius:8px;border:0.5px solid rgba(17,24,39,.12);background:#fff;color:#374151;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Avfärda</button>
            </div>
          </div>
          <div style="font-size:11px;color:#9CA3AF;">Igår</div>
        </div>
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);">
          <div style="font-size:13px;font-weight:600;color:#111827;">Bilder som väntar på granskning</div>
          <div style="font-size:12px;color:#9CA3AF;margin-top:2px;">Automatisk granskning är inte aktiverad ännu — kommande funktion</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:16px 20px;">
          ${["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=160&q=60","https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=160&q=60","https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=160&q=60","https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=160&q=60"].map(img=>`
            <div style="position:relative;">
              <img src="${img}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block;" />
              <div style="display:flex;gap:4px;margin-top:6px;">
                <button onclick="adminToast('Bild godkänd')" style="flex:1;padding:4px;border-radius:6px;border:none;background:#16a34a;color:#fff;font-size:10px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">OK</button>
                <button onclick="adminToast('Bild nekad')" style="flex:1;padding:4px;border-radius:6px;border:none;background:#dc2626;color:#fff;font-size:10px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Neka</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:18px 20px;">
        <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;">Blockerade användare</div>
        <div style="font-size:12px;color:#9CA3AF;margin-bottom:14px;">1 blockerat konto</div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-top:0.5px solid rgba(17,24,39,.06);">
          <div style="width:32px;height:32px;border-radius:50%;background:#FEF0E7;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#C2622A;">E</div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;color:#111827;">Erik Strand</div>
            <div style="font-size:11px;color:#9CA3AF;">erik@example.se · Blockerad 2025-06-18</div>
          </div>
          <button onclick="adminToast('Erik Strand aktiverad')" style="padding:6px 12px;border-radius:8px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:12px;font-weight:600;color:#16a34a;cursor:pointer;font-family:'Inter',sans-serif;">Aktivera</button>
        </div>
      </div>
    </div>
  `;

  const insightsHtml = `
    <div style="display:grid;gap:16px;">
      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;">
        <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:16px;">Aktivitet senaste 7 dagarna</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:100px;">
          ${[12,19,8,24,31,18,27].map((v,i)=>`
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
              <div style="width:100%;background:#C2622A;border-radius:4px 4px 0 0;opacity:${0.4+v/60};" title="${v}" style="height:${v*3}px;"></div>
              <div style="font-size:10px;color:#9CA3AF;">${['M','T','O','T','F','L','S'][i]}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;">
          <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:14px;">Populäraste områden</div>
          ${[["Pålsjö",42],["Laröd",38],["Raus",24],["Söder",18],["Höganäs",12]].map(([area,pct])=>`
            <div style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:12px;color:#374151;">${area}</span>
                <span style="font-size:12px;color:#9CA3AF;">${pct}%</span>
              </div>
              <div style="height:4px;background:#F3F4F6;border-radius:999px;">
                <div style="height:4px;background:#C2622A;border-radius:999px;width:${pct}%;"></div>
              </div>
            </div>
          `).join('')}
        </div>

        <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;">
          <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:14px;">Konvertering</div>
          ${[["Besökare → Gilla","68%","#16a34a"],["Gilla → Intresse","24%","#2563eb"],["Intresse → Claim","8%","#C2622A"]].map(([label,pct,color])=>`
            <div style="margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span style="font-size:12px;color:#374151;">${label}</span>
                <span style="font-size:13px;font-weight:700;color:${color};">${pct}</span>
              </div>
              <div style="height:4px;background:#F3F4F6;border-radius:999px;">
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
          { name:"Aktiv",    price:"249", color:"#C2622A", users:1, features:["Allt i Synlig","Till salu / uthyrning","Budgivning","Mäklarintegration","Prioritet i flödet"] },
        ].map(p=>`
          <div style="background:#fff;border:1.5px solid ${p.color === '#C2622A' ? '#C2622A' : 'rgba(17,24,39,.08)'};border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:${p.color};margin-bottom:4px;">${p.name}</div>
            <div style="font-size:26px;font-weight:700;letter-spacing:-.04em;color:#111827;">${p.price} <span style="font-size:13px;font-weight:400;color:#9CA3AF;">kr/mån</span></div>
            <div style="font-size:11px;color:#9CA3AF;margin:8px 0 14px;">${p.users} aktiva användare</div>
            ${p.features.map(f=>`
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <i class="ti ti-check" style="font-size:14px;color:#16a34a;" aria-hidden="true"></i>
                <span style="font-size:12px;color:#374151;">${f}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>

      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;overflow:hidden;">
        <div style="padding:14px 20px;border-bottom:0.5px solid rgba(17,24,39,.06);">
          <div style="font-size:13px;font-weight:600;color:#111827;">Premium-konton</div>
        </div>
        ${[
          { name:"Sara Björk",    email:"sara@example.se",   plan:"Synlig", since:"2025-06-15", mrr:"49 kr" },
          { name:"Anna Lindqvist",email:"anna@example.se",   plan:"Aktiv",  since:"2025-06-12", mrr:"249 kr" },
          { name:"Lena Svensson", email:"lena@example.se",   plan:"Synlig", since:"2025-06-18", mrr:"49 kr" },
        ].map(u=>`
          <div style="display:flex;align-items:center;gap:12px;padding:12px 20px;border-bottom:0.5px solid rgba(17,24,39,.05);">
            <div style="width:32px;height:32px;border-radius:50%;background:#FEF0E7;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#C2622A;flex-shrink:0;">${u.name[0]}</div>
            <div style="flex:1;">
              <div style="font-size:13px;font-weight:600;color:#111827;">${u.name}</div>
              <div style="font-size:11px;color:#9CA3AF;">${u.email} · sedan ${u.since}</div>
            </div>
            <span style="font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;background:${u.plan==='Aktiv'?'#FEF0E7':'#EFF6FF'};color:${u.plan==='Aktiv'?'#C2622A':'#2563eb'};">${u.plan}</span>
            <div style="font-size:13px;font-weight:600;color:#111827;min-width:52px;text-align:right;">${u.mrr}</div>
            <button onclick="adminToast('Hanterar ${u.name}')" style="padding:5px 10px;border-radius:7px;border:0.5px solid rgba(17,24,39,.12);background:#fff;font-size:11px;font-weight:600;color:#374151;cursor:pointer;font-family:'Inter',sans-serif;">Hantera</button>
          </div>
        `).join('')}
        <div style="padding:14px 20px;border-top:0.5px solid rgba(17,24,39,.06);display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:12px;color:#9CA3AF;">Total MRR</div>
          <div style="font-size:16px;font-weight:700;color:#111827;">347 kr/mån</div>
        </div>
      </div>
    </div>
  `;

  const tabContent = { overview:overviewHtml, users:usersHtml, properties:propertiesHtml, moderation:moderationHtml, insights:insightsHtml, premium:premiumHtml };

  app.innerHTML = `
    <div style="min-height:100vh;background:#F9F6F1;">
      <nav style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#111827;border-bottom:0.5px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:50;">
        <div style="display:flex;align-items:center;gap:10px;">
          <svg width="18" height="23" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
          <span style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#fff;font-family:'Inter',sans-serif;">i<em style="font-style:normal;color:#C2622A;">found</em></span>
          <span style="font-size:10px;font-weight:700;background:rgba(194,98,42,.25);color:#C2622A;border-radius:999px;padding:3px 9px;letter-spacing:.08em;">ADMIN</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:rgba(255,255,255,.4);">admin@ifound.se</span>
          <button onclick="clearSession();navigate('welcome');" style="font-size:12px;color:rgba(255,255,255,.5);background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;padding:6px 12px;border-radius:8px;border:0.5px solid rgba(255,255,255,.12);">Logga ut</button>
        </div>
      </nav>

      <div style="display:flex;">
        <!-- Sidebar -->
        <div style="width:200px;min-height:calc(100vh - 56px);background:#fff;border-right:0.5px solid rgba(17,24,39,.08);padding:16px 10px;flex-shrink:0;">
          ${tabs.map(t=>`
            <button id="tab-${t.id}" onclick="switchAdminTab('${t.id}')"
              style="width:100%;display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;border:none;background:${adminTab===t.id?'#FEF0E7':'transparent'};color:${adminTab===t.id?'#C2622A':'#6B7280'};font-size:13px;font-weight:${adminTab===t.id?'600':'500'};cursor:pointer;font-family:'Inter',sans-serif;margin-bottom:2px;text-align:left;">
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
    btn.style.background = id === tab ? '#FEF0E7' : 'transparent';
    btn.style.color = id === tab ? '#C2622A' : '#6B7280';
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
  tLogin.style.background = isLogin  ? '#C2622A' : 'transparent';
  tLogin.style.color      = isLogin  ? '#fff' : 'rgba(255,255,255,.5)';
  tLogin.style.fontWeight = isLogin  ? '600' : '500';
  tReg.style.background   = !isLogin ? '#C2622A' : 'transparent';
  tReg.style.color        = !isLogin ? '#fff' : 'rgba(255,255,255,.5)';
  tReg.style.fontWeight   = !isLogin ? '600' : '500';
  fLogin.style.display    = isLogin  ? 'flex' : 'none';
  fReg.style.display      = !isLogin ? 'flex' : 'none';
}

function renderBrokerWelcome() {
  app.innerHTML = `
    <div style="min-height:100vh;background:#0F1117;font-family:'Inter',sans-serif;display:flex;flex-direction:column;">
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:24px;">
        <div style="width:100%;max-width:400px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-flex;align-items:center;gap:9px;margin-bottom:20px;">
              <svg width="22" height="27" viewBox="0 0 64 78" fill="none"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
              <span style="font-size:22px;font-weight:700;letter-spacing:-.04em;color:#fff;">i<em style="font-style:normal;color:#C2622A;">found</em></span>
            </div>
            <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(194,98,42,.15);border:1px solid rgba(194,98,42,.3);color:#C2622A;border-radius:999px;padding:4px 12px;font-size:11px;font-weight:600;letter-spacing:.06em;margin-bottom:16px;">
              <i class="ti ti-building" style="font-size:12px;" aria-hidden="true"></i> MÄKLARPORTAL
            </div>
            <div style="font-size:24px;font-weight:700;letter-spacing:-.04em;color:#fff;margin-bottom:8px;">Logga in</div>
            <div style="font-size:13px;color:rgba(255,255,255,.4);">Hantera dina objekt och leads</div>
          </div>

          <!-- Tab switcher -->
          <div style="display:flex;background:rgba(255,255,255,.06);border-radius:10px;padding:3px;margin-bottom:16px;">
            <button id="bTabLogin" onclick="switchBrokerTab('login')" style="flex:1;padding:8px;border-radius:8px;border:none;background:#C2622A;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Logga in</button>
            <button id="bTabReg"   onclick="switchBrokerTab('reg')"   style="flex:1;padding:8px;border-radius:8px;border:none;background:transparent;color:rgba(255,255,255,.5);font-size:13px;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;">Skapa konto</button>
          </div>

          <!-- Login form -->
          <div id="bLoginForm" style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">E-post</label>
              <input id="brokerEmail" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="din@maklarfirma.se" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Lösenord</label>
              <input id="brokerPass" type="password" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="••••••••" />
            </div>
            <button id="brokerLoginBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:#C2622A;color:#fff;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;">
              Logga in
            </button>
            <div style="font-size:11px;color:rgba(255,255,255,.25);text-align:center;">Demo: maklare@fastighetsbyran.se / demo2025</div>
          </div>

          <!-- Register form -->
          <div id="bRegForm" style="display:none;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Namn</label>
              <input id="bRegName" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="Anna Lindqvist" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Mäklarfirma</label>
              <input id="bRegFirm" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="Fastighetsbyrån AB" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">E-post</label>
              <input id="bRegEmail" type="email" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="anna@maklarfirma.se" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Lösenord</label>
              <input id="bRegPass" type="password" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="Min 6 tecken" />
            </div>
            <button id="brokerRegBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:#C2622A;color:#fff;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;">
              Skapa mäklarkonto
            </button>
            <div style="font-size:11px;color:rgba(255,255,255,.25);text-align:center;">Kontot aktiveras inom 24h efter verifiering.</div>
          </div>

          <div style="text-align:center;margin-top:20px;">
            <button onclick="navigate('welcome')" style="background:transparent;border:none;color:rgba(255,255,255,.35);font-size:12px;cursor:pointer;font-family:'Inter',sans-serif;">
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
    <div style="min-height:100vh;background:#0F1117;font-family:'Inter',sans-serif;">
      <nav style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:rgba(255,255,255,.03);border-bottom:0.5px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:50;">
        <div style="display:flex;align-items:center;gap:10px;">
          <svg width="18" height="23" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
          <span style="font-size:18px;font-weight:700;letter-spacing:-.04em;color:#fff;">i<em style="font-style:normal;color:#C2622A;">found</em></span>
          <span style="font-size:10px;font-weight:700;background:rgba(194,98,42,.2);color:#C2622A;border-radius:999px;padding:3px 9px;letter-spacing:.08em;">MÄKLARE</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button onclick="navigate('feed')" style="font-size:12px;color:rgba(255,255,255,.45);background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:5px;">
            <i class="ti ti-layout-grid" style="font-size:14px;" aria-hidden="true"></i> Utforska
          </button>
          <button onclick="navigate('map')" style="font-size:12px;color:rgba(255,255,255,.45);background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;display:flex;align-items:center;gap:5px;">
            <i class="ti ti-map-2" style="font-size:14px;" aria-hidden="true"></i> Karta
          </button>
          <div style="width:1px;height:20px;background:rgba(255,255,255,.1);"></div>
          <div style="width:32px;height:32px;border-radius:50%;background:rgba(194,98,42,.2);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#C2622A;">${broker.logo}</div>
          <button onclick="clearSession();navigate('brokerWelcome');" style="font-size:12px;color:rgba(255,255,255,.35);background:transparent;border:none;cursor:pointer;font-family:'Inter',sans-serif;">Logga ut</button>
        </div>
      </nav>

      <div style="max-width:900px;margin:0 auto;padding:28px 20px 60px;">

        <div style="margin-bottom:28px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#C2622A;margin-bottom:6px;">Välkommen</div>
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
              <div style="width:36px;height:36px;border-radius:9px;background:rgba(194,98,42,.15);display:flex;align-items:center;justify-content:center;margin-bottom:10px;">
                <i class="ti ${s.icon}" style="font-size:17px;color:#C2622A;" aria-hidden="true"></i>
              </div>
              <div style="font-size:26px;font-weight:700;letter-spacing:-.04em;color:#fff;line-height:1;">${s.num}</div>
              <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:4px;">${s.lbl}</div>
            </div>
          `).join('')}
        </div>

        <!-- Listings header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:600;letter-spacing:-.03em;color:#fff;">Mina objekt</div>
          <button id="addListingBtn" style="display:flex;align-items:center;gap:7px;background:#C2622A;color:#fff;border:none;border-radius:9px;padding:8px 16px;font-size:12px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;">
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
                  ${l.messages ? `<span style="font-size:11px;color:#C2622A;display:flex;align-items:center;gap:4px;font-weight:600;"><i class="ti ti-message" style="font-size:12px;" aria-hidden="true"></i> ${l.messages} nya</span>` : ''}
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
                <button onclick="brokerViewMessages('${l.id}')" style="padding:7px 14px;border-radius:8px;border:0.5px solid rgba(255,255,255,.12);background:transparent;font-size:12px;font-weight:600;color:#fff;cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;">Se detaljer</button>
                <button onclick="brokerEditListing('${l.id}')" style="padding:7px 14px;border-radius:8px;border:0.5px solid rgba(255,255,255,.08);background:transparent;font-size:12px;color:rgba(255,255,255,.4);cursor:pointer;font-family:'Inter',sans-serif;white-space:nowrap;">Redigera</button>
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
              <div style="width:36px;height:36px;border-radius:50%;background:rgba(194,98,42,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="ti ti-user" style="font-size:16px;color:#C2622A;" aria-hidden="true"></i>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:600;color:#C2622A;margin-bottom:3px;">${m.obj}</div>
                <div style="font-size:13px;color:rgba(255,255,255,.65);line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">"${m.msg}"</div>
                <div style="font-size:11px;color:rgba(255,255,255,.25);margin-top:4px;">${m.time} · Anonymt</div>
              </div>
              <button onclick="toast('Svara — kommer snart!')" style="padding:6px 12px;border-radius:8px;border:0.5px solid rgba(255,255,255,.12);background:transparent;font-size:11px;font-weight:600;color:rgba(255,255,255,.5);cursor:pointer;font-family:'Inter',sans-serif;flex-shrink:0;align-self:center;">Svara</button>
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
    <div style="min-height:100vh;background:#0F1117;font-family:'Inter',sans-serif;">
      <nav style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:rgba(255,255,255,.03);border-bottom:0.5px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:50;">
        <button onclick="navigate('broker')" style="display:flex;align-items:center;gap:7px;background:transparent;border:none;color:rgba(255,255,255,.5);font-size:13px;cursor:pointer;font-family:'Inter',sans-serif;">
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
                  <input style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="${f.ph}" />
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Beskrivning -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:14px;">Beskrivning</div>
            <textarea style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:10px 12px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;min-height:140px;resize:vertical;line-height:1.7;" placeholder="Beskriv fastigheten utförligt — läge, skick, renoveringar, trädgård, närmiljö..."></textarea>
          </div>

          <!-- Planritning -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px;">Planritning</div>
            <div style="font-size:12px;color:rgba(255,255,255,.35);margin-bottom:14px;">Ladda upp planritning som PDF eller bild.</div>
            <label id="planLabel" style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.04);border:1.5px dashed rgba(255,255,255,.15);border-radius:10px;padding:16px;cursor:pointer;">
              <div style="width:40px;height:40px;border-radius:9px;background:rgba(194,98,42,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="ti ti-file-upload" style="font-size:19px;color:#C2622A;" aria-hidden="true"></i>
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
                  <input type="${f.type||'text'}" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="${f.ph}" />
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Ansvarig mäklare -->
          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.08);border-radius:14px;padding:20px;">
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:14px;">Ansvarig mäklare</div>
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:14px;background:rgba(255,255,255,.04);border-radius:10px;border:0.5px solid rgba(255,255,255,.08);">
              <div style="width:44px;height:44px;border-radius:50%;background:rgba(194,98,42,.2);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#C2622A;flex-shrink:0;">${broker.logo}</div>
              <div style="flex:1;">
                <div style="font-size:14px;font-weight:600;color:#fff;">${broker.name}</div>
                <div style="font-size:12px;color:rgba(255,255,255,.4);">${broker.firm}</div>
              </div>
              <button onclick="toast('Byt mäklare — kommer snart!')" style="padding:6px 12px;border-radius:7px;border:0.5px solid rgba(255,255,255,.12);background:transparent;font-size:11px;color:rgba(255,255,255,.4);cursor:pointer;font-family:'Inter',sans-serif;">Byt</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              ${[
                {lbl:"Telefon", ph:"070-123 45 67"},
                {lbl:"E-post", ph:"anna@fastighetsbyraan.se"},
              ].map(f => `
                <div>
                  <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.35);margin-bottom:5px;">${f.lbl}</label>
                  <input style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 12px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="${f.ph}" />
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
                <div onclick="brokerSelVis(this,'${o.val}')" data-vis="${o.val}" style="display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:10px;border:1.5px solid ${i===0?'#C2622A':'rgba(255,255,255,.1)'};background:${i===0?'rgba(194,98,42,.08)':'transparent'};cursor:pointer;">
                  <div style="width:17px;height:17px;border-radius:50%;border:2px solid ${i===0?'#C2622A':'rgba(255,255,255,.2)'};flex-shrink:0;margin-top:1px;background:${i===0?'#C2622A':'transparent'};display:flex;align-items:center;justify-content:center;">
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

          <button id="publishBtn" style="width:100%;padding:14px;border-radius:12px;border:none;background:#C2622A;color:#fff;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
            <i class="ti ti-send" aria-hidden="true"></i> Publicera objekt
          </button>
          <button onclick="navigate('broker')" style="width:100%;padding:12px;border-radius:12px;border:0.5px solid rgba(255,255,255,.1);background:transparent;font-size:13px;color:rgba(255,255,255,.4);font-family:'Inter',sans-serif;cursor:pointer;">
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
  el.style.borderColor = '#C2622A';
  el.style.background = 'rgba(194,98,42,.08)';
  const radio = el.querySelector('div');
  if (radio) { radio.style.borderColor = '#C2622A'; radio.style.background = '#C2622A'; radio.innerHTML = '<div style="width:5px;height:5px;border-radius:50%;background:#fff;"></div>'; }
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
  const session = loadSession();

  // Anonymous users can access welcome, feed, map, property views
  if (!session?.email) {
    if (currentView === "brokerWelcome") { renderBrokerWelcome(); return; }
    if (currentView === "feed")   { renderFeed(); return; }
    if (currentView === "map")    { renderMapView(); return; }
    if (currentView.startsWith("property_")) { renderPropertyView(); return; }
    renderWelcome(); return;
  }
  if (session.email === "admin@ifound.se") { renderAdmin(); return; }
  if (isBroker()) {
    if (currentView === "brokerAddListing") { renderBrokerAddListing(); return; }
    if (currentView === "feed")   { renderFeed(); return; }
    if (currentView === "map")    { renderMapView(); return; }
    if (currentView.startsWith("property_")) { renderPropertyView(); return; }
    if (currentView === "broker" || currentView === "dashboard") { renderBrokerDashboard(); return; }
    renderBrokerDashboard(); return;
  }
  if (currentView === "map") { renderMapView(); return; }
  if (currentView === "feed") { renderFeed(); return; }
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
