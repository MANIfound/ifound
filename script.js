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
function renderWelcome() {
  app.innerHTML = `
    <div style="min-height:100vh;background:#0F1117;font-family:'Inter',sans-serif;">

      <!-- Nav -->
      <nav style="height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;background:rgba(15,17,23,.8);backdrop-filter:blur(12px);position:sticky;top:0;z-index:50;border-bottom:0.5px solid rgba(255,255,255,.06);">
        <div style="display:flex;align-items:center;gap:9px;">
          <svg width="18" height="23" viewBox="0 0 64 78" fill="none" aria-hidden="true"><path d="M32 4C18 4 8 15 8 28C8 46 32 74 32 74S56 46 56 28C56 15 46 4 32 4Z" fill="#C2622A"/><polygon points="16,32 32,18 48,32" fill="white" opacity=".95"/><rect x="20" y="32" width="24" height="17" rx="1.5" fill="white" opacity=".95"/><rect x="27" y="37" width="10" height="12" rx="1" fill="#C2622A"/></svg>
          <span style="font-size:19px;font-weight:700;letter-spacing:-.04em;color:#fff;">i<em style="font-style:normal;color:#C2622A;">found</em></span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:11px;font-weight:600;color:#C2622A;background:rgba(194,98,42,.15);border-radius:999px;padding:3px 10px;letter-spacing:.06em;">BETA · Helsingborg</span>
          <button onclick="navigate('brokerWelcome')" style="padding:8px 18px;border-radius:9px;border:0.5px solid rgba(255,255,255,.2);background:transparent;color:rgba(255,255,255,.7);font-size:13px;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;margin-right:8px;">För mäklare</button>
          <button onclick="document.getElementById('auth-section').scrollIntoView({behavior:'smooth'})" style="padding:8px 18px;border-radius:9px;border:none;background:#C2622A;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Kom igång</button>
        </div>
      </nav>

      <!-- Hero -->
      <div style="position:relative;height:90vh;min-height:580px;overflow:hidden;display:flex;align-items:flex-end;">
        <img src="https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1800&q=85&auto=format&fit=crop" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(10,10,15,.92) 0%,rgba(10,10,15,.4) 45%,rgba(10,10,15,.1) 100%);"></div>
        <div style="position:relative;z-index:2;width:100%;padding:52px 48px;display:grid;grid-template-columns:1fr 400px;gap:40px;align-items:flex-end;">
          <div>
            <div style="font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#C2622A;margin-bottom:16px;">Fastigheter på ett nytt sätt</div>
            <h1 style="font-size:clamp(44px,5.5vw,80px);font-weight:700;line-height:1.0;color:#fff;letter-spacing:-.05em;margin:0 0 20px;font-family:'Inter',sans-serif;">Hitta hem.<br><em style="font-style:normal;color:#C2622A;">Eller låt hemmet<br>hitta dig.</em></h1>
            <p style="font-size:16px;line-height:1.7;color:rgba(255,255,255,.6);max-width:500px;margin:0 0 28px;">Du åker förbi ett hus och blir förälskad. Idag finns inget att göra. Med ifound lämnar du ditt intresse direkt — ägaren ser det och väljer själv vad som händer sen.</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${["Utforska på karta","Spara favoriter","Visa upp ditt hem","Få notiser om intresse"].map(f=>`
                <div style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:500;color:rgba(255,255,255,.75);">${f}</div>
              `).join('')}
            </div>
          </div>

          <!-- Auth box -->
          <div id="auth-section" style="background:rgba(255,255,255,.96);backdrop-filter:blur(20px);border-radius:20px;padding:28px;box-shadow:0 24px 64px rgba(0,0,0,.3);">
            <div style="display:flex;background:rgba(17,24,39,.07);border-radius:10px;padding:3px;margin-bottom:22px;">
              <button id="tabLogin" onclick="switchTab('login')" style="flex:1;padding:9px;border-radius:8px;border:none;background:#fff;color:#111827;font-size:13px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.08);">Logga in</button>
              <button id="tabReg" onclick="switchTab('reg')" style="flex:1;padding:9px;border-radius:8px;border:none;background:transparent;color:#6B7280;font-size:13px;font-weight:500;cursor:pointer;font-family:'Inter',sans-serif;">Skapa konto</button>
            </div>

            <div id="loginForm" style="display:flex;flex-direction:column;gap:12px;">
              <div>
                <div style="font-size:19px;font-weight:700;letter-spacing:-.04em;color:#111827;">Välkommen tillbaka</div>
                <div style="font-size:12px;color:#9CA3AF;margin-top:3px;">Ange dina uppgifter för att fortsätta.</div>
              </div>
              <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">E-post</label><input id="loginEmail" class="input" type="email" placeholder="din@epost.se" /></div>
              <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">Lösenord</label><input id="loginPass" class="input" type="password" placeholder="••••••••" /></div>
              <button id="loginBtn" class="btn-primary" style="width:100%;justify-content:center;padding:12px;">Logga in</button>
              <div style="font-size:11px;color:#9CA3AF;text-align:center;">Demo: registrera ett konto och logga in.</div>
            </div>

            <div id="regForm" style="display:none;flex-direction:column;gap:12px;">
              <div>
                <div style="font-size:19px;font-weight:700;letter-spacing:-.04em;color:#111827;">Skapa konto</div>
                <div style="font-size:12px;color:#9CA3AF;margin-top:3px;">Kom igång på ett par sekunder.</div>
              </div>
              <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">Namn</label><input id="regName" class="input" placeholder="Ditt namn" /></div>
              <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">E-post</label><input id="regEmail" class="input" type="email" placeholder="din@epost.se" /></div>
              <div><label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;margin-bottom:5px;">Lösenord</label><input id="regPass" class="input" type="password" placeholder="Min 4 tecken" /></div>
              <button id="regBtn" class="btn-primary" style="width:100%;justify-content:center;padding:12px;">Skapa konto</button>
              <div style="font-size:11px;color:#9CA3AF;text-align:center;">Riktig version: BankID-verifiering.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Vision -->
      <div style="background:#0F1117;padding:80px 48px;">
        <div style="max-width:1000px;margin:0 auto;">
          <div style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#C2622A;margin-bottom:12px;">Hur det fungerar</div>
          <div style="font-size:clamp(26px,3vw,42px);font-weight:700;letter-spacing:-.04em;color:#fff;max-width:640px;line-height:1.1;margin-bottom:52px;">Från förälskelse till möjlighet — utan att fastigheten behöver vara till salu.</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:32px;">
            ${[
              { num:"01", title:"Du hittar drömfastigheten", desc:"Du åker förbi ett hus eller en tomt och tänder till. Sök upp fastigheten på kartan och lämna ett gilla eller ett intresse — anonymt." },
              { num:"02", title:"Ägaren väcks till liv", desc:"Fastighetsägaren får en notis om att någon visat intresse. Kanske visste de inte ens att deras hem var eftertraktat." },
              { num:"03", title:"En marknad på egna villkor", desc:"Ägaren väljer själv om de vill vara passiva, visa upp fastigheten, eller sätta ett pris. Du följer i din egen takt." },
            ].map(s=>`
              <div>
                <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#C2622A;margin-bottom:14px;">${s.num}</div>
                <div style="font-size:17px;font-weight:600;letter-spacing:-.03em;color:#fff;margin-bottom:10px;line-height:1.2;">${s.title}</div>
                <div style="font-size:14px;color:rgba(255,255,255,.5);line-height:1.7;">${s.desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Pinterest grid -->
      <div style="background:#111318;padding:60px 24px 80px;">
        <div style="max-width:1000px;margin:0 auto;">
          <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:28px;">
            <div>
              <div style="font-size:22px;font-weight:700;letter-spacing:-.04em;color:#fff;">Fastigheter på ifound</div>
              <div style="font-size:13px;color:rgba(255,255,255,.4);margin-top:4px;">Villor, tomter, lägenheter och kustnära hem</div>
            </div>
          </div>
          <div style="columns:3;column-gap:10px;">
            ${[
              { img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=80&auto=format", name:"Pålsjö 4:7", meta:"Villa · 240 kvm", likes:18, badge:"Passiv", h:200 },
              { img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=80&auto=format", name:"Laröd 3:19", meta:"Gård · 5 200 kvm", likes:41, badge:"Populär", h:260 },
              { img:"https://images.unsplash.com/photo-1449844908441-8829872d2607?w=400&q=80&auto=format", name:"Viken Strand 4:2", meta:"Kusthus · 145 kvm", likes:58, badge:"58 gillar", h:230 },
              { img:"https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&q=80&auto=format", name:"Kulla 1:4", meta:"Tomt · 2 400 kvm", likes:24, badge:"Passiv", h:180 },
              { img:"https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=80&auto=format", name:"Raus Plantage 7:2", meta:"Gård · 4 800 kvm", likes:6, badge:"Ny claim", h:210 },
              { img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&q=80&auto=format", name:"Fredriksdal 6:1", meta:"Villa · 195 kvm", likes:19, badge:"Till salu", h:190 },
            ].map(p=>`
              <div style="break-inside:avoid;margin-bottom:10px;border-radius:14px;overflow:hidden;position:relative;cursor:pointer;">
                <img src="${p.img}" alt="${p.name}" style="width:100%;height:${p.h}px;object-fit:cover;display:block;" loading="lazy" />
                <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.65) 0%,transparent 55%);"></div>
                <div style="position:absolute;top:10px;left:10px;">
                  <span style="font-size:10px;font-weight:600;background:rgba(194,98,42,.88);color:#fff;border-radius:999px;padding:3px 9px;">${p.badge}</span>
                </div>
                <div style="position:absolute;bottom:0;left:0;right:0;padding:14px;">
                  <div style="font-size:13px;font-weight:600;color:#fff;letter-spacing:-.02em;">${p.name}</div>
                  <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:2px;display:flex;align-items:center;gap:8px;">${p.meta} <span style="display:flex;align-items:center;gap:3px;"><i class="ti ti-heart" style="font-size:11px;" aria-hidden="true"></i>${p.likes}</span></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- CTA -->
      <div style="background:#0F1117;border-top:0.5px solid rgba(255,255,255,.06);padding:72px 48px;text-align:center;">
        <div style="font-size:clamp(26px,3.5vw,48px);font-weight:700;letter-spacing:-.05em;color:#fff;margin-bottom:14px;line-height:1.05;">Redo att hitta ditt<br><em style="font-style:normal;color:#C2622A;">nästa hem?</em></div>
        <p style="font-size:15px;color:rgba(255,255,255,.5);max-width:440px;margin:0 auto 28px;line-height:1.6;">Gå med tusentals nyfikna och ägare som vill synas — utan att behöva sälja.</p>
        <button onclick="document.getElementById('auth-section').scrollIntoView({behavior:'smooth'})" style="padding:14px 32px;border-radius:12px;border:none;background:#C2622A;color:#fff;font-size:15px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Skapa gratis konto</button>
      </div>

      <!-- Footer -->
      <div style="background:#0a0b0f;padding:20px 48px;display:flex;align-items:center;justify-content:space-between;border-top:0.5px solid rgba(255,255,255,.05);">
        <div style="font-size:15px;font-weight:700;letter-spacing:-.04em;color:rgba(255,255,255,.4);">i<em style="font-style:normal;color:#C2622A;">found</em></div>
        <div style="font-size:12px;color:rgba(255,255,255,.2);">© 2025 ifound.se · Beta · Helsingborg</div>
      </div>
    </div>
  `;

  function switchTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tabLogin').style.cssText = isLogin
      ? 'flex:1;padding:9px;border-radius:8px;border:none;background:#fff;color:#111827;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.08);'
      : 'flex:1;padding:9px;border-radius:8px;border:none;background:transparent;color:#6B7280;font-size:13px;font-weight:500;cursor:pointer;font-family:Inter,sans-serif;';
    document.getElementById('tabReg').style.cssText = !isLogin
      ? 'flex:1;padding:9px;border-radius:8px;border:none;background:#fff;color:#111827;font-size:13px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.08);'
      : 'flex:1;padding:9px;border-radius:8px;border:none;background:transparent;color:#6B7280;font-size:13px;font-weight:500;cursor:pointer;font-family:Inter,sans-serif;';
    document.getElementById('loginForm').style.display = isLogin ? 'flex' : 'none';
    document.getElementById('regForm').style.display = !isLogin ? 'flex' : 'none';
  }

  document.getElementById("loginBtn").onclick = () => {
    const email = document.getElementById("loginEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("loginPass").value;
    const users = loadUsers();
    const user  = users[email];
    if (!user || user.password !== pass) { toast("Fel e-post eller lösenord."); return; }
    saveSession({ email }); toast("Inloggad!"); navigate("feed");
  };

  document.getElementById("regBtn").onclick = () => {
    const name  = document.getElementById("regName").value.trim();
    const email = document.getElementById("regEmail").value.trim().toLowerCase();
    const pass  = document.getElementById("regPass").value;
    if (!name || !email.includes("@") || pass.length < 4) { toast("Fyll i alla fält korrekt."); return; }
    const users = loadUsers();
    if (users[email]) { toast("Det finns redan ett konto på den e-posten."); return; }
    users[email] = { name, email, password: pass };
    saveUsers(users); saveSession({ email }); toast("Konto skapat — välkommen!"); navigate("feed");
  };
}
function readImageAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}



// =========================
// PROPERTY VIEW (Besökarvy)
// =========================
const PROP_DATA = [
  { id:0, name:"Laröd 3:19",        meta:"Gård · 5 200 kvm · Laröd",         badge:"pb-hot",   type:"Passiv",    likes:41, interested:9,  img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&q=80&auto=format", imgs:["https://images.unsplash.com/photo-1449844908441-8829872d2607?w=800&q=80&auto=format","https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80&auto=format"], desc:"En magnifik gård i lantligt läge med generösa ytor, äldre karaktärsbyggnad och stora grönområden. Fastigheten är inte aktiv till salu men ägaren är öppen för intresse." },
  { id:1, name:"Raus Plantage 7:2",  meta:"Gård · 4 800 kvm · Raus",          badge:"pb-new",   type:"Ny claim",  likes:6,  interested:2,  img:"https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&q=80&auto=format", imgs:[], desc:"Nyligen claimad fastighet — ägaren har valt att hålla sin profil privat för tillfället." },
  { id:2, name:"Kulla 1:4",          meta:"Tomt · 2 400 kvm · Höganäs",       badge:"pb-hot",   type:"Passiv",    likes:24, interested:7,  img:"https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=800&q=80&auto=format", imgs:[], desc:"Stor obebyggd tomt med fantastiskt läge. Perfekt för den som drömmer om att bygga sitt drömhus i naturskön miljö." },
  { id:3, name:"Pålsjö 4:7",         meta:"Villa · 240 kvm · Pålsjö",         badge:"pb-quiet", type:"Passiv",    likes:18, interested:4,  img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80&auto=format", imgs:["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80&auto=format"], desc:"Välskött villa i ett av Helsingborgs mest eftertraktade lägen. Ägaren är inte aktiv till salu men tar gärna emot intresse." },
  { id:4, name:"Fredriksdal 6:1",    meta:"Villa · 195 kvm · Helsingborg",    badge:"pb-sale",  type:"Till salu", likes:19, interested:6,  img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&q=80&auto=format", imgs:["https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=80&auto=format"], desc:"Rymlig villa med charmig trädgård nära Fredriksdals museer. 5 rum, nytt kök 2022, garage.", price:"5 750 000 kr" },
  { id:5, name:"Söder 8:22",         meta:"Lägenhet · 72 kvm · Helsingborg",  badge:"pb-rent",  type:"Uthyrning", likes:14, interested:0,  img:"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800&q=80&auto=format", imgs:[], desc:"Modern lägenhet på Söder med balkong och öppen planlösning. Tillgänglig från 1 september.", price:"9 800 kr/mån" },
  { id:6, name:"Viken Strand 4:2",   meta:"Kusthus · 145 kvm · Viken",        badge:"pb-hot",   type:"Passiv",    likes:58, interested:12, img:"https://images.unsplash.com/photo-1449844908441-8829872d2607?w=800&q=80&auto=format", imgs:[], desc:"Drömläge direkt mot havet i Viken. Ägaren bor kvar men är nyfiken på vem som är intresserad." },
  { id:7, name:"Pålsjö 12:8",        meta:"Villa · 220 kvm · Pålsjö",         badge:"pb-sale",  type:"Till salu", likes:31, interested:11, img:"https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=800&q=80&auto=format", imgs:[], desc:"Exklusiv villa i Pålsjö med parkliknande tomt. 6 rum, pool, dubbelgarage.", price:"4 200 000 kr" },
];

function navigateProp(id) {
  currentView = "property_" + id;
  render();
}

function renderPropertyView() {
  const session = loadSession();
  if (!session?.email) return navigate("welcome");

  const idStr = currentView.replace("property_", "");
  const prop = PROP_DATA[parseInt(idStr)];
  if (!prop) return navigate("feed");

  const state = loadState();
  const iLiked = !!state.myLikes?.[prop.id];
  const iInterested = !!state.myInterests?.[prop.id];
  const isPrivate = prop.id === 1; // Raus is private

  const badgeColors = {
    "Passiv":    "background:#F3F4F6;color:#6B7280;",
    "Ny claim":  "background:#F0FDF4;color:#16a34a;",
    "Till salu": "background:#EFF6FF;color:#2563eb;",
    "Uthyrning": "background:#F5F3FF;color:#7c3aed;",
  };

  app.innerHTML = `
    <div style="min-height:100vh;background:#F9F6F1;">
      <nav class="dashboard-nav">
        <div class="nav-left">
          <button onclick="navigate('feed')" class="btn-ghost" style="font-size:12px;padding:7px 13px;display:flex;align-items:center;gap:6px;">
            <i class="ti ti-arrow-left"></i> Tillbaka
          </button>
        </div>
        <div class="nav-right">
          <button class="btn-ghost" style="font-size:12px;padding:7px 13px;display:flex;align-items:center;gap:5px;" onclick="shareProperty('${prop.name}')">
            <i class="ti ti-share" aria-hidden="true"></i> Dela
          </button>
        </div>
      </nav>

      <!-- Hero image -->
      <div style="position:relative;height:320px;overflow:hidden;">
        <img src="${prop.img}" alt="${prop.name}" style="width:100%;height:100%;object-fit:cover;display:block;" />
        <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.5) 0%,transparent 50%);"></div>
        <div style="position:absolute;bottom:20px;left:20px;right:20px;">
          <span style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;${badgeColors[prop.type] || ''}">${prop.type}</span>
          <div style="font-size:26px;font-weight:700;letter-spacing:-.04em;color:#fff;margin-top:8px;line-height:1.1;">${prop.name}</div>
          <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:4px;">${prop.meta}</div>
        </div>
      </div>

      <!-- Extra images -->
      ${prop.imgs && prop.imgs.length ? `
        <div style="display:flex;gap:4px;padding:4px;background:#111;overflow-x:auto;">
          ${prop.imgs.map(src => `<img src="${src}" style="height:80px;width:120px;object-fit:cover;border-radius:6px;flex-shrink:0;" />`).join('')}
        </div>
      ` : ''}

      <!-- Content -->
      <div style="max-width:680px;margin:0 auto;padding:24px 16px 100px;">

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px;">
          <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:24px;font-weight:700;letter-spacing:-.04em;color:#111827;">${prop.likes}</div>
            <div style="font-size:11px;color:#9CA3AF;margin-top:3px;text-transform:uppercase;letter-spacing:.06em;font-weight:500;">Gillar</div>
          </div>
          <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:24px;font-weight:700;letter-spacing:-.04em;color:#111827;">${prop.interested}</div>
            <div style="font-size:11px;color:#9CA3AF;margin-top:3px;text-transform:uppercase;letter-spacing:.06em;font-weight:500;">Intresserade</div>
          </div>
          <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:12px;padding:16px;text-align:center;">
            <div style="font-size:24px;font-weight:700;letter-spacing:-.04em;color:#111827;">${Math.floor(prop.likes * 3.2)}</div>
            <div style="font-size:11px;color:#9CA3AF;margin-top:3px;text-transform:uppercase;letter-spacing:.06em;font-weight:500;">Visningar</div>
          </div>
        </div>

        ${prop.price ? `
          <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;margin-bottom:16px;">
            <div style="font-size:12px;color:#9CA3AF;font-weight:500;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Pris</div>
            <div style="font-size:28px;font-weight:700;letter-spacing:-.04em;color:#111827;">${prop.price}</div>
          </div>
        ` : ''}

        <!-- Description -->
        ${isPrivate ? `
          <div style="background:#F9F6F1;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;margin-bottom:16px;text-align:center;">
            <i class="ti ti-lock" style="font-size:28px;color:#9CA3AF;display:block;margin-bottom:10px;"></i>
            <div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:6px;">Profilen är privat</div>
            <div style="font-size:13px;color:#9CA3AF;line-height:1.6;">Ägaren har valt att inte visa upp sin bostad ännu. Du kan fortfarande gilla och visa intresse.</div>
          </div>
        ` : `
          <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;margin-bottom:16px;">
            <div style="font-size:12px;color:#9CA3AF;font-weight:500;text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">Om fastigheten</div>
            <div style="font-size:14px;color:#374151;line-height:1.7;">${prop.desc}</div>
          </div>
        `}

      </div>

      <!-- Similar listings -->
      <div style="background:#fff;border:0.5px solid rgba(17,24,39,.08);border-radius:14px;padding:20px;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:14px;">Liknande objekt i området</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${PROP_DATA.filter(p => p.id !== prop.id).slice(0,3).map(p => `
            <div onclick="navigateProp(${p.id})" style="display:flex;gap:12px;align-items:center;cursor:pointer;padding:10px;border-radius:10px;border:0.5px solid rgba(17,24,39,.07);">
              <img src="${p.img}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;" />
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.name}</div>
                <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">${p.meta}</div>
                <div style="font-size:11px;color:#9CA3AF;margin-top:4px;display:flex;gap:10px;">
                  <span>${p.likes} gillar</span><span>${p.interested} intresserade</span>
                </div>
              </div>
              <i class="ti ti-chevron-right" style="font-size:16px;color:#D1D5DB;flex-shrink:0;" aria-hidden="true"></i>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Sticky action bar -->
      <div style="position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:0.5px solid rgba(17,24,39,.08);padding:12px 16px;display:flex;gap:10px;z-index:50;">
        <button id="propLikeBtn" onclick="propToggleLike(${prop.id})"
          style="flex:1;padding:13px;border-radius:12px;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;border:1.5px solid ${iLiked ? '#2563eb' : 'rgba(17,24,39,.12)'};background:${iLiked ? '#EFF6FF' : '#fff'};color:${iLiked ? '#2563eb' : '#111827'};display:flex;align-items:center;justify-content:center;gap:8px;">
          <i class="ti ti-thumb-up"></i> ${iLiked ? 'Gillad' : 'Gilla'}
        </button>
        <button id="propInterestBtn" onclick="propToggleInterest(${prop.id})"
          style="flex:1;padding:13px;border-radius:12px;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;border:1.5px solid ${iInterested ? '#C2622A' : 'rgba(17,24,39,.12)'};background:${iInterested ? '#FEF0E7' : '#fff'};color:${iInterested ? '#C2622A' : '#111827'};display:flex;align-items:center;justify-content:center;gap:8px;">
          <i class="ti ti-star"></i> ${iInterested ? 'Intresserad' : 'Visa intresse'}
        </button>
      </div>
    </div>
  `;
}

function propToggleLike(id) {
  const s = loadState();
  s.myLikes = s.myLikes || {};
  const already = !!s.myLikes[id];
  if (already) { delete s.myLikes[id]; toast("Gillning borttagen."); }
  else { s.myLikes[id] = true; toast("Fastigheten är gillad!"); }
  saveState(s);
  renderPropertyView();
}

function propToggleInterest(id) {
  const s = loadState();
  s.myInterests = s.myInterests || {};
  const already = !!s.myInterests[id];
  if (already) { delete s.myInterests[id]; toast("Intresse borttaget."); }
  else { s.myInterests[id] = true; toast("Intresse markerat — ägaren ser detta!"); }
  saveState(s);
  renderPropertyView();
}

function shareProperty(name) {
  const url = window.location.href.split('?')[0] + '?prop=' + encodeURIComponent(name);
  if (navigator.share) {
    navigator.share({ title: name + ' — ifound', text: 'Kolla in den här fastigheten på ifound!', url });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(url);
    toast("Länk kopierad!");
  } else {
    toast("Dela: " + url);
  }
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
    { id:0, name:"Laröd 3:19",        meta:"Gård · 5 200 kvm",         badge:"pb-hot",   badgeText:"41 gillar", likes:41, interested:9,  img:"https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&q=75&auto=format", imgH:260 },
    { id:1, name:"Raus Plantage 7:2",  meta:"Gård · 4 800 kvm",         badge:"pb-new",   badgeText:"Ny claim",  likes:6,  interested:2,  img:"https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=75&auto=format", imgH:180 },
    { id:2, name:"Kulla 1:4",          meta:"Tomt · 2 400 kvm",         badge:"pb-hot",   badgeText:"Populär",   likes:24, interested:7,  img:"https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&q=75&auto=format", imgH:160 },
    { id:3, name:"Pålsjö 4:7",         meta:"Villa · 240 kvm",          badge:"pb-quiet", badgeText:"Passiv",    likes:18, interested:4,  img:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=75&auto=format", imgH:220 },
    { id:4, name:"Fredriksdal 6:1",    meta:"Villa · 5,75 mkr",         badge:"pb-sale",  badgeText:"Till salu", likes:19, interested:6,  img:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&q=75&auto=format", imgH:180 },
    { id:5, name:"Söder 8:22",         meta:"Lägenhet · 9 800 kr/mån",  badge:"pb-rent",  badgeText:"Uthyrning", likes:14, interested:0,  img:"https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=400&q=75&auto=format", imgH:200 },
    { id:6, name:"Viken Strand 4:2",   meta:"Kusthus · 145 kvm",        badge:"pb-hot",   badgeText:"58 gillar", likes:58, interested:12, img:"https://images.unsplash.com/photo-1449844908441-8829872d2607?w=400&q=75&auto=format", imgH:240 },
    { id:7, name:"Pålsjö 12:8",        meta:"Villa · 220 kvm",          badge:"pb-sale",  badgeText:"Till salu", likes:31, interested:11, img:"https://images.unsplash.com/photo-1523217582562-09d0def993a6?w=400&q=75&auto=format", imgH:170 },
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

      <!-- Onboarding bar — shown first time only -->
      ${!loadState().onboardingDone ? `
        <div id="onboardingBar" style="background:#111827;border-bottom:0.5px solid rgba(255,255,255,.08);padding:10px 16px;display:flex;align-items:center;gap:0;overflow-x:auto;scrollbar-width:none;">
          ${[
            {icon:"ti-map-2",   label:"Karta",     desc:"Hitta fastigheter nära dig"},
            {icon:"ti-heart",   label:"Gilla",      desc:"Spara det du fastnar för"},
            {icon:"ti-star",    label:"Intresse",   desc:"Skicka ett intresse till ägaren"},
            {icon:"ti-home-check", label:"Claima", desc:"Är det ditt hus? Gå med!"},
          ].map((s,i) => `
            <div style="display:flex;align-items:center;gap:8px;padding:0 14px;border-right:${i<3?'0.5px solid rgba(255,255,255,.08)':'none'};flex-shrink:0;">
              <div style="width:28px;height:28px;border-radius:7px;background:rgba(194,98,42,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="ti ${s.icon}" style="font-size:14px;color:#C2622A;" aria-hidden="true"></i>
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
          <div class="pin-card" onclick="navigateProp(${p.id})">
            <div class="pin-img-wrap">
              <img src="${p.img}" alt="${p.name}" style="width:100%;height:${p.imgH}px;object-fit:cover;display:block;" loading="lazy" />
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

function dismissOnboarding() {
  const s = loadState();
  s.onboardingDone = true;
  saveState(s);
  const bar = document.getElementById('onboardingBar');
  if (bar) bar.style.display = 'none';
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
      .ifound-popup .leaflet-popup-content { margin: 16px; }
      .ifound-popup .leaflet-popup-tip { background: #fff; }

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
  { id: "RÅDHUSET 3>1",      lat: 56.04661, lon: 12.69311, status: "passive", name: "Rådhuset 3:1",      likes: 18, interested: 4 },
  { id: "PÅLSJÖ 1>27",       lat: 56.07200, lon: 12.70200, status: "sale",    name: "Pålsjö 1:27",       likes: 31, interested: 11, price: "4 200 000 kr" },
  { id: "SÖDER 1>102",       lat: 56.03324, lon: 12.71180, status: "rent",    name: "Söder 1:102",       likes: 14, interested: 5,  price: "9 800 kr/mån" },
  { id: "FREDRIKSDAL 1>1",   lat: 56.06038, lon: 12.72680, status: "sale",    name: "Fredriksdal 1:1",   likes: 19, interested: 6,  price: "5 750 000 kr" },
  { id: "LARÖD 49>126",      lat: 56.08092, lon: 12.71870, status: "passive", name: "Laröd 49:126",      likes: 41, interested: 9 },
  { id: "KULLA 1>4",         lat: 56.06800, lon: 12.73500, status: "passive", name: "Kulla 1:4",         likes: 24, interested: 7 },
  { id: "SÖDER 8>22B",       lat: 56.04100, lon: 12.70500, status: "rent",    name: "Söder 8:22B",       likes: 8,  interested: 3,  price: "7 500 kr/mån" },
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

    marker.bindPopup(`
      <div style="font-family:'Inter',sans-serif;min-width:200px;padding:4px;">
        <div style="font-size:11px;font-weight:600;color:${statusColor};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">${statusLabel}</div>
        <div style="font-size:15px;font-weight:700;letter-spacing:-.03em;color:#111827;margin-bottom:6px;">${prop.name}</div>
        ${prop.price ? `<div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:8px;">${prop.price}</div>` : ''}
        <div style="display:flex;gap:14px;padding-top:8px;border-top:1px solid #F3F4F6;">
          <div style="text-align:center;">
            <div style="font-size:18px;font-weight:700;color:#111827;">${prop.likes}</div>
            <div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Gillar</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:18px;font-weight:700;color:#111827;">${prop.interested}</div>
            <div style="font-size:10px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Intresserade</div>
          </div>
        </div>
      </div>
    `, { maxWidth: 240, className: 'ifound-popup' });

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
  return MOCK_BROKER_ACCOUNTS[s?.email] || null;
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

          <div style="background:rgba(255,255,255,.04);border:0.5px solid rgba(255,255,255,.1);border-radius:16px;padding:24px;display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">E-post</label>
              <input id="brokerEmail" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="din@maklarfirma.se" />
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.4);margin-bottom:6px;">Lösenord</label>
              <input id="brokerPass" type="password" style="width:100%;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.12);border-radius:9px;padding:10px 13px;font-size:13px;font-family:'Inter',sans-serif;color:#fff;outline:none;" placeholder="••••••••" />
            </div>
            <button id="brokerLoginBtn" style="width:100%;padding:13px;border-radius:11px;border:none;background:#C2622A;color:#fff;font-size:14px;font-weight:600;font-family:'Inter',sans-serif;cursor:pointer;margin-top:4px;">
              Logga in som mäklare
            </button>
            <div style="font-size:11px;color:rgba(255,255,255,.25);text-align:center;">Demo: maklare@fastighetsbyran.se / demo2025</div>
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
    if (!broker || broker.password !== pass) { toast("Fel e-post eller lösenord."); return; }
    saveSession({ email, isBroker: true });
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
  if (!session?.email) {
    if (currentView === "brokerWelcome") { renderBrokerWelcome(); return; }
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
