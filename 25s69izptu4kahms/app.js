(() => {
  "use strict";

  const CHARLESTON = { lat: 38.35, lon: -81.63 };
  const SEARCH_RADIUS_M = 6000;
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const CACHE_PREFIX = "crapapp-cache-v1:";
  const FETCH_TIMEOUT_MS = 8000;
  const OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];

  const $ = (id) => document.getElementById(id);
  const panic = $("panic");
  const gpsBtn = $("gps");
  const demoBtn = $("demo");
  const accessBtn = $("access");
  const statusEl = $("status");
  const listEl = $("list");
  const sheet = $("sheet");
  const handle = $("sheet-handle");

  const map = L.map("map", { zoomControl: false, attributionControl: true })
    .setView([CHARLESTON.lat, CHARLESTON.lon], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  let all = [];
  let onlyAccessible = false;
  let origin = null;
  let searchVersion = 0;
  let searched = false;
  let lastSearchOk = false;
  let youMarker = null;
  const markersById = new Map();

  /* ---------- helpers ---------- */
  function setStatus(text, kind) {
    statusEl.textContent = text;
    if (kind) statusEl.setAttribute("data-kind", kind);
    else statusEl.removeAttribute("data-kind");
  }

  function setBusy(busy) {
    [panic, gpsBtn, demoBtn].forEach((b) => { b.disabled = busy; });
    statusEl.setAttribute("aria-busy", busy ? "true" : "false");
  }

  function coordsOf(item) {
    const lat = item.lat ?? item.center?.lat;
    const lon = item.lon ?? item.center?.lon;
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  }

  function haversine(a, b) {
    const rad = (d) => d * Math.PI / 180;
    const R = 6371000;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "";
    if (meters < 1000) return Math.round(meters) + " m away";
    return (meters / 1000).toFixed(1) + " km away";
  }

  function voteKey(item) {
    return "crapapp-vote-" + item.type + "-" + item.id;
  }

  function getVote(item) {
    const raw = localStorage.getItem(voteKey(item));
    if (raw == null || raw === "") return -1;
    const n = Number(raw);
    return Number.isFinite(n) ? n : -1;
  }

  function isAccessible(item) {
    const w = (item.tags || {}).wheelchair;
    return w === "yes" || w === "designated";
  }

  function feeInfo(item) {
    const fee = (item.tags || {}).fee;
    if (!fee) return null;
    const v = String(fee).toLowerCase();
    if (v === "no" || v === "free" || v === "0" || v === "none") return "free";
    if (v === "yes" || v === "customers" || /[0-9]/.test(v)) return "paid";
    return null;
  }

  function hasChangingTable(item) {
    const v = String((item.tags || {}).changing_table || "").toLowerCase();
    return v === "yes" || v === "only" || v === "room" || v === "limited";
  }

  /* ---------- opening_hours (simple, unverified) ---------- */
  const DAY_INDEX = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };

  function parseMinutes(token) {
    const m = String(token).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h === 24 && min === 0) return 24 * 60;
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function parseDays(text) {
    const days = new Set();
    for (const part of text.split(",")) {
      const bit = part.trim().toLowerCase();
      if (!bit) continue;
      if (bit.includes("-")) {
        const [a, b] = bit.split("-").map((x) => DAY_INDEX[x.trim()]);
        if (a == null || b == null) return null;
        let i = a;
        days.add(i);
        while (i !== b) {
          i = (i + 1) % 7;
          days.add(i);
        }
      } else {
        if (DAY_INDEX[bit] == null) return null;
        days.add(DAY_INDEX[bit]);
      }
    }
    return days;
  }

  function parseRule(chunk) {
    const raw = chunk.trim();
    if (!raw) return { days: new Set([0, 1, 2, 3, 4, 5, 6]), off: true, spans: [] };
    const off = /\boff\b/i.test(raw);
    const match = raw.match(/^(?:([A-Za-z][a-zA-Z0-9, \-]+?)\s+)?(?:off|((?:\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?(?:\s*,\s*)?)+))$/i);
    if (!match && !off) return null;
    let days;
    const dayPart = raw.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)\b/i);
    if (dayPart) {
      days = parseDays(dayPart[1]);
      if (!days) return null;
    } else if (/^(Mo|Tu|We|Th|Fr|Sa|Su|PH|SH|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(raw)) {
      return null;
    } else {
      days = new Set([0, 1, 2, 3, 4, 5, 6]);
    }
    if (off) return { days, off: true, spans: [] };
    const timePart = raw.replace(dayPart ? dayPart[0] : "", "").trim();
    const spans = [];
    for (const span of timePart.split(",")) {
      const [a, b] = span.trim().split("-");
      const start = parseMinutes(a);
      const end = b != null ? parseMinutes(b) : null;
      if (start == null || end == null) return null;
      spans.push([start, end]);
    }
    return { days, off: false, spans };
  }

  function openingStatus(oh, now = new Date()) {
    const unverified = true;
    if (!oh || !String(oh).trim()) return { state: "unknown", unverified };
    const text = String(oh).trim();
    if (/^24\s*\/\s*7$/i.test(text)) return { state: "open", unverified };
    if (/\b(PH|SH|sunrise|sunset|dawn|dusk|week|year|\+)\b/i.test(text)) {
      return { state: "unknown", unverified };
    }
    const rules = [];
    for (const chunk of text.split(";")) {
      const rule = parseRule(chunk);
      if (!rule) return { state: "unknown", unverified };
      rules.push(rule);
    }
    const dow = (now.getDay() + 6) % 7;
    const mins = now.getHours() * 60 + now.getMinutes();
    let applies = false;
    let open = false;
    for (const rule of rules) {
      if (!rule.days.has(dow)) continue;
      applies = true;
      if (rule.off) {
        open = false;
        continue;
      }
      open = rule.spans.some(([start, end]) => {
        if (start === end) return true;
        if (start < end) return mins >= start && mins < end;
        return mins >= start || mins < end;
      });
    }
    if (!applies) return { state: "closed", unverified };
    return { state: open ? "open" : "closed", unverified };
  }

  /* ---------- cache ---------- */
  function cacheKey(lat, lon) {
    return CACHE_PREFIX + lat.toFixed(3) + "," + lon.toFixed(3);
  }

  function readCache(lat, lon) {
    try {
      const raw = localStorage.getItem(cacheKey(lat, lon));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.elements) || !Number.isFinite(data.ts)) return null;
      if (Date.now() - data.ts > CACHE_TTL_MS) return null;
      return data.elements;
    } catch {
      return null;
    }
  }

  function writeCache(lat, lon, elements) {
    try {
      localStorage.setItem(cacheKey(lat, lon), JSON.stringify({ ts: Date.now(), elements }));
    } catch { /* quota or private mode */ }
  }

  /* ---------- data sources ---------- */
  async function fetchWithTimeout(url, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function overpassQuery(lat, lon) {
    const around = "(around:" + SEARCH_RADIUS_M + "," + lat + "," + lon + ")";
    return "[out:json][timeout:20];(" +
      'node["amenity"="toilets"]' + around + ";" +
      'way["amenity"="toilets"]' + around + ";" +
      'relation["amenity"="toilets"]' + around + ";" +
      ");out center tags;";
  }

  async function queryOneOverpass(url, query) {
    // Avoid Accept: application/json — it triggers a CORS preflight some servers reject.
    const attempts = [
      () => fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ data: query })
      }, FETCH_TIMEOUT_MS),
      () => fetchWithTimeout(url + "?data=" + encodeURIComponent(query), { method: "GET" }, FETCH_TIMEOUT_MS)
    ];
    let lastError = null;
    for (const attempt of attempts) {
      try {
        const response = await attempt();
        if (!response.ok) {
          lastError = new Error("Overpass returned " + response.status);
          continue;
        }
        const data = await response.json();
        if (!Array.isArray(data.elements)) {
          lastError = new Error("Invalid Overpass response");
          continue;
        }
        return data.elements;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Overpass failed");
  }

  async function queryOverpass(lat, lon, onBusy, version) {
    const cached = readCache(lat, lon);
    if (cached) return { elements: cached, fromCache: true };
    const query = overpassQuery(lat, lon);
    let lastError = null;
    for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
      if (version !== searchVersion) return { elements: [], fromCache: false, cancelled: true };
      try {
        if (i > 0 && onBusy) onBusy("Map server busy. Trying backup " + i + "…");
        const elements = await queryOneOverpass(OVERPASS_SERVERS[i], query);
        writeCache(lat, lon, elements);
        return { elements, fromCache: false };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("All Overpass servers failed");
  }

  async function queryRefuge(lat, lon) {
    const url = "https://www.refugerestrooms.org/api/v1/restrooms/by_location.json?lat=" +
      encodeURIComponent(lat) + "&lng=" + encodeURIComponent(lon) + "&per_page=50";
    const response = await fetchWithTimeout(url, { method: "GET" }, FETCH_TIMEOUT_MS);
    if (!response.ok) throw new Error("Refuge returned " + response.status);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("Invalid Refuge response");
    return rows.map((row) => {
      const tags = {
        name: row.name || "Public restroom",
        wheelchair: row.accessible ? "yes" : "unknown"
      };
      if (row.changing_table) tags.changing_table = "yes";
      if (row.street) tags["addr:street"] = row.street;
      return {
        type: "refuge",
        id: row.id,
        lat: Number(row.latitude),
        lon: Number(row.longitude),
        tags,
        source: "refuge"
      };
    }).filter((item) => {
      const pos = coordsOf(item);
      return pos && haversine({ lat, lon }, pos) <= SEARCH_RADIUS_M;
    });
  }

  /* ---------- directions ---------- */
  function isAppleDevice() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function directionsUrl(lat, lon) {
    if (isAppleDevice()) return "https://maps.apple.com/?daddr=" + lat + "," + lon + "&dirflg=d";
    return "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lon;
  }

  function directionsLabel() {
    return isAppleDevice() ? "Directions in Apple Maps" : "Directions in Google Maps";
  }

  /* ---------- UI ---------- */
  function displayName(item) {
    return (item.tags && item.tags.name) || "Public restroom";
  }

  function badgesFor(item) {
    const badges = [];
    const hours = openingStatus((item.tags || {}).opening_hours);
    if (hours.state === "open") badges.push({ text: "Open now · unverified", kind: "open unverified" });
    if (hours.state === "closed") badges.push({ text: "Closed · unverified", kind: "closed unverified" });
    const fee = feeInfo(item);
    if (fee === "free") badges.push({ text: "Free", kind: "free" });
    if (fee === "paid") badges.push({ text: "Paid", kind: "paid" });
    if (hasChangingTable(item)) badges.push({ text: "Baby changing", kind: "baby" });
    if (isAccessible(item)) badges.push({ text: "Accessible", kind: "access" });
    return badges;
  }

  function renderBadges(target, item) {
    const wrap = document.createElement("div");
    wrap.className = "badges";
    badgesFor(item).forEach((badge) => {
      const el = document.createElement("span");
      el.className = "badge " + badge.kind;
      el.textContent = badge.text;
      wrap.append(el);
    });
    if (wrap.childNodes.length) target.append(wrap);
  }

  function metaLine(item, distance) {
    const bits = [];
    if (Number.isFinite(distance)) bits.push(formatDistance(distance));
    const t = item.tags || {};
    if (t["addr:street"]) bits.push(t["addr:street"]);
    if (t.opening_hours) bits.push("Hours: " + t.opening_hours);
    if (item.source === "refuge") bits.push("Source: Refuge Restrooms");
    else bits.push("Source: OpenStreetMap");
    return bits.join(" · ");
  }

  function popupContent(item, lat, lon, distance) {
    const wrap = document.createElement("div");
    wrap.className = "popup";
    const title = document.createElement("strong");
    title.textContent = displayName(item);
    wrap.append(title);
    renderBadges(wrap, item);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = metaLine(item, distance);
    wrap.append(meta);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "🧭 " + directionsLabel();
    btn.addEventListener("click", () => window.open(directionsUrl(lat, lon), "_blank", "noopener"));
    wrap.append(btn);
    return wrap;
  }

  function showOnMap(id) {
    const marker = markersById.get(id);
    if (!marker) return;
    const pad = sheetPad();
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16), { animate: true, paddingBottomRight: [0, pad] });
    marker.openPopup();
    listEl.querySelectorAll(".card.is-active").forEach((n) => n.classList.remove("is-active"));
    const card = listEl.querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (card) {
      card.classList.add("is-active");
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (window.innerWidth < 900 && sheet.dataset.state === "peek") setSheet("mid");
  }

  function sheetPad() {
    if (window.innerWidth >= 900) return 0;
    return sheet.getBoundingClientRect().height || 168;
  }

  function render(opts = {}) {
    layer.clearLayers();
    markersById.clear();
    listEl.replaceChildren();
    if (youMarker) youMarker.addTo(layer);
    if (!searched) return;
    if (!lastSearchOk) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Unable to load restroom data. Try again in a moment.";
      listEl.append(empty);
      return;
    }

    const items = all
      .map((item) => {
        const pos = coordsOf(item);
        if (!pos) return null;
        return { item, ...pos, distance: origin ? haversine(origin, pos) : Infinity };
      })
      .filter(Boolean)
      .filter(({ item }) => !onlyAccessible || isAccessible(item))
      .sort((a, b) => a.distance - b.distance);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = onlyAccessible
        ? "No wheelchair-accessible restrooms in this result. Turn the filter off to see all mapped spots."
        : "No mapped restrooms found within 6 km. Try another location.";
      listEl.append(empty);
      return;
    }

    const bounds = [];
    items.forEach(({ item, lat, lon, distance }) => {
      const id = item.type + "-" + item.id;
      const score = getVote(item);
      const marker = L.marker([lat, lon]).addTo(layer);
      marker.bindPopup(() => popupContent(item, lat, lon, distance));
      marker.on("click", () => showOnMap(id));
      markersById.set(id, marker);
      bounds.push([lat, lon]);

      const card = document.createElement("article");
      card.className = "card";
      card.dataset.id = id;
      const h = document.createElement("h3");
      h.textContent = displayName(item);
      card.append(h);
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = metaLine(item, distance);
      card.append(meta);
      renderBadges(card, item);
      const rating = document.createElement("p");
      rating.className = "vote-note";
      rating.textContent = score >= 0
        ? "Your rating on this device: " + (score ? "🧻".repeat(score) : "0")
        : "Not rated on this device yet";
      card.append(rating);
      const ratings = document.createElement("div");
      ratings.className = "ratings";
      ratings.setAttribute("aria-label", "Your local rating for " + displayName(item));
      for (let i = 0; i <= 5; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = i ? ("🧻 " + i) : "0";
        b.setAttribute("aria-pressed", score === i ? "true" : "false");
        b.addEventListener("click", (event) => {
          event.stopPropagation();
          localStorage.setItem(voteKey(item), String(i));
          render({ fit: false });
          showOnMap(id);
        });
        ratings.append(b);
      }
      card.append(ratings);
      const actions = document.createElement("div");
      actions.className = "actions";
      const show = document.createElement("button");
      show.type = "button";
      show.textContent = "📍 Show on map";
      show.addEventListener("click", (event) => {
        event.stopPropagation();
        showOnMap(id);
      });
      const dir = document.createElement("button");
      dir.type = "button";
      dir.textContent = "🧭 " + directionsLabel();
      dir.addEventListener("click", (event) => {
        event.stopPropagation();
        window.open(directionsUrl(lat, lon), "_blank", "noopener");
      });
      actions.append(show, dir);
      card.append(actions);
      card.addEventListener("click", () => showOnMap(id));
      listEl.append(card);
    });

    if (opts.fit !== false && bounds.length) {
      const fit = L.latLngBounds(bounds);
      if (youMarker) fit.extend(youMarker.getLatLng());
      map.fitBounds(fit.pad(0.18), { paddingBottomRight: [0, sheetPad()] });
    }
  }

  function updateMapPadding() {
    map.invalidateSize();
    const zoom = document.querySelector(".leaflet-bottom.leaflet-right");
    if (zoom && window.innerWidth < 900) {
      zoom.style.marginBottom = (sheetPad() + 8) + "px";
    } else if (zoom) {
      zoom.style.marginBottom = "";
    }
  }

  function setSheet(state) {
    sheet.dataset.state = state;
    requestAnimationFrame(updateMapPadding);
  }

  /* ---------- search ---------- */
  async function search(lat, lon, label) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const version = ++searchVersion;
    searched = true;
    lastSearchOk = false;
    origin = { lat, lon };
    setBusy(true);
    try {
      map.setView([lat, lon], 14);
      requestAnimationFrame(updateMapPadding);
      layer.clearLayers();
      all = [];
      if (youMarker) {
        youMarker.remove();
        youMarker = null;
      }
      if (label !== "demo") {
        youMarker = L.circleMarker([lat, lon], {
          radius: 8,
          color: "#15483b",
          fillColor: "#3db8a0",
          fillOpacity: 0.95,
          weight: 2
        }).bindPopup(label === "gps" ? "You are here" : "Search center");
        youMarker.addTo(layer);
      }
      listEl.replaceChildren();
      const searching = document.createElement("div");
      searching.className = "empty";
      searching.textContent = "Searching for restrooms…";
      listEl.append(searching);
      setStatus("Searching nearby restrooms…");

      let osm = null;
      let refuge = null;
      const osmTask = queryOverpass(lat, lon, (text) => {
        if (version === searchVersion && !lastSearchOk) setStatus(text);
      }, version).then((result) => {
        if (result.cancelled) return;
        osm = (result.elements || []).map((item) => ({ ...item, source: "osm" }));
      }).catch((error) => {
        console.warn("OpenStreetMap lookup:", error);
      });
      const refugeTask = queryRefuge(lat, lon).then((rows) => {
        refuge = rows;
      }).catch((error) => {
        console.warn("Refuge Restrooms lookup:", error);
      });

      await Promise.race([osmTask, refugeTask]);
      if (version !== searchVersion) return;
      applyResults(osm, refuge, true);
      setBusy(false);
      await Promise.all([osmTask, refugeTask]);
      if (version !== searchVersion) return;
      applyResults(osm, refuge, true);
    } finally {
      if (version === searchVersion) setBusy(false);
    }
  }

  function applyResults(osm, refuge, fit) {
    const osmItems = Array.isArray(osm) ? osm : [];
    const refugeItems = Array.isArray(refuge) ? refuge : [];
    const merged = [...osmItems];
    for (const item of refugeItems) {
      const pos = coordsOf(item);
      if (!pos) continue;
      const duplicate = merged.some((other) => {
        const otherPos = coordsOf(other);
        return otherPos && haversine(pos, otherPos) < 40;
      });
      if (!duplicate) merged.push(item);
    }
    all = merged.filter((item) => coordsOf(item));
    lastSearchOk = osm != null || refuge != null;
    if (!lastSearchOk) {
      setStatus("Restroom data servers are unavailable. The map itself is still working.", "error");
    } else if (!all.length) {
      setStatus("No mapped restrooms found within 6 km. Try another location.");
    } else if (osm == null && refuge != null) {
      setStatus(all.length + " restroom" + (all.length === 1 ? "" : "s") + " found nearby. OpenStreetMap is busy, so these come from Refuge Restrooms.");
    } else {
      setStatus(all.length + " restroom" + (all.length === 1 ? "" : "s") + " found nearby, nearest first.");
    }
    render({ fit });
    if (lastSearchOk && all.length && window.innerWidth < 900 && sheet.dataset.state === "peek") {
      setSheet("mid");
    }
  }

  function geoErrorMessage(error) {
    if (!navigator.geolocation) return "This browser can't share your location. Try Charleston, WV instead.";
    const code = error && error.code;
    if (code === 1) return "Location permission was denied. Allow location in your browser settings, or try Charleston, WV.";
    if (code === 2) return "Your location could not be found. Try Charleston, WV instead.";
    if (code === 3) return "Location request timed out. Try again, or use Try Charleston, WV.";
    return "Location unavailable. Try Charleston, WV instead.";
  }

  function locate() {
    setStatus("Requesting location…");
    if (!navigator.geolocation) {
      setStatus(geoErrorMessage(null), "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => search(pos.coords.latitude, pos.coords.longitude, "gps"),
      (error) => setStatus(geoErrorMessage(error), "error"),
      { timeout: 12000, maximumAge: 15000, enableHighAccuracy: true }
    );
  }

  /* ---------- sheet drag ---------- */
  const SHEET_STATES = ["peek", "mid", "full"];
  handle.addEventListener("click", () => {
    const i = SHEET_STATES.indexOf(sheet.dataset.state || "peek");
    setSheet(SHEET_STATES[(i + 1) % SHEET_STATES.length]);
  });

  let drag = null;
  handle.addEventListener("pointerdown", (event) => {
    drag = {
      startY: event.clientY,
      startH: sheet.getBoundingClientRect().height,
      max: window.innerHeight - 86
    };
    handle.setPointerCapture(event.pointerId);
    sheet.style.transition = "none";
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const next = Math.min(drag.max, Math.max(140, drag.startH - (event.clientY - drag.startY)));
    sheet.style.height = next + "px";
  });
  function endDrag() {
    if (!drag) return;
    const h = sheet.getBoundingClientRect().height;
    const max = window.innerHeight - 86;
    sheet.style.transition = "";
    sheet.style.height = "";
    if (h < max * 0.33) setSheet("peek");
    else if (h < max * 0.7) setSheet("mid");
    else setSheet("full");
    drag = null;
  }
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);

  panic.addEventListener("click", locate);
  gpsBtn.addEventListener("click", locate);
  demoBtn.addEventListener("click", () => search(CHARLESTON.lat, CHARLESTON.lon, "demo"));
  accessBtn.addEventListener("click", () => {
    onlyAccessible = !onlyAccessible;
    accessBtn.setAttribute("aria-pressed", onlyAccessible ? "true" : "false");
    accessBtn.textContent = onlyAccessible ? "♿ Accessible only · On" : "♿ Accessible only";
    render({ fit: false });
  });

  window.addEventListener("resize", updateMapPadding);
  window.addEventListener("load", updateMapPadding);
  setTimeout(updateMapPadding, 300);

  // Expose a tiny hook for tests.
  window.CRAPAPP = { search, openingStatus, CHARLESTON };
})();
