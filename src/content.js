/**
 * OpenFront Enhanced — Content Script (runs in ISOLATED world)
 *
 * Adds highly visible markers for nations, building stacks, and transport
 * ships. It also shows temporary markers where transport ships land.
 *
 * Reads data from attributes on <html> set by page-hook.js (MAIN world):
 *   - data-ofe-game-phase: current game phase from the live GameView
 *   - data-ofe-nations: nation positions
 *   - data-ofe-building-stacks: high-level structure positions
 *   - data-ofe-transport-ships: active transport ship positions
 *   - data-ofe-boat-landings: recent transport ship landing positions
 *   - data-ofe-mini-territories: temporary disconnected-territory markers
 *   - data-ofe-map-transform: current world-to-screen transform
 */

"use strict";

(() => {
  let watchInterval = null;
  let markersActive = false;
  let dotContainer = null;
  let cachedNameLayerContainer = null;
  let gameDataObserver = null;
  let markerExpiryTimer = null;
  const markerById = new Map();
  const MARKER_SIZE = 24;
  const MARKER_TARGET_SCREEN_SIZE = 24;
  const MARKER_MIN_SCALE = 0.03;
  const MARKER_MAX_SCALE = 1.15;
  const TRANSPORT_MARKER_SIZE = 9;
  const TRANSPORT_TARGET_SCREEN_SIZE = 13;
  const TRANSPORT_MIN_SCALE = 0.8;
  const TRANSPORT_MAX_SCALE = 3;
  const NATION_MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<circle cx='50' cy='50' r='36' fill='none' stroke='#111827' stroke-width='12' opacity='0.75'/>" +
        "<circle cx='50' cy='50' r='31' fill='none' stroke='#ffffff' stroke-width='8'/>" +
        "<circle cx='50' cy='50' r='20' fill='none' stroke='#ef4444' stroke-width='10'/>" +
        "<circle cx='50' cy='50' r='7' fill='#ef4444'/>" +
      "</svg>",
    );
  const BUILDING_STACK_MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<path d='M50 6 94 50 50 94 6 50Z' fill='none' stroke='#111827' stroke-width='16' stroke-linejoin='round' opacity='0.92'/>" +
        "<path d='M50 9 91 50 50 91 9 50Z' fill='none' stroke='#fef3c7' stroke-width='9' stroke-linejoin='round'/>" +
        "<path d='M50 17 83 50 50 83 17 50Z' fill='none' stroke='#f59e0b' stroke-width='8' stroke-linejoin='round'/>" +
        "<path d='M50 25 75 50 50 75 25 50Z' fill='none' stroke='#111827' stroke-width='4' stroke-linejoin='round' opacity='0.74'/>" +
      "</svg>",
    );
  const BOAT_LANDING_MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<circle cx='50' cy='50' r='36' fill='rgba(15,23,42,0.72)' stroke='#111827' stroke-width='14'/>" +
        "<circle cx='50' cy='50' r='34' fill='none' stroke='#fef08a' stroke-width='8'/>" +
        "<path d='M50 8v20M50 72v20M8 50h20M72 50h20' stroke='#f59e0b' stroke-width='10' stroke-linecap='round'/>" +
        "<circle cx='50' cy='50' r='9' fill='#fbbf24' stroke='#ffffff' stroke-width='5'/>" +
      "</svg>",
    );
  const MINI_TERRITORY_MARKER_SVG_DATA_URI =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
        "<circle cx='50' cy='50' r='37' fill='rgba(15,23,42,0.78)' stroke='#07131f' stroke-width='14'/>" +
        "<circle cx='50' cy='50' r='34' fill='none' stroke='#67e8f9' stroke-width='8'/>" +
        "<path d='M50 5v22M50 73v22M5 50h22M73 50h22' stroke='#22d3ee' stroke-width='10' stroke-linecap='round'/>" +
        "<path d='M50 35 65 50 50 65 35 50Z' fill='#a5f3fc' stroke='#fff' stroke-width='5'/>" +
      "</svg>",
    );

  function readMarkerData(attributeName) {
    try {
      const raw = document.documentElement.getAttribute(attributeName);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function getNationPositions() {
    return readMarkerData("data-ofe-nations");
  }

  function getBuildingStackPositions() {
    return readMarkerData("data-ofe-building-stacks");
  }

  function getTransportShipPositions() {
    return readMarkerData("data-ofe-transport-ships");
  }

  function getBoatLandingPositions() {
    const landings = readMarkerData("data-ofe-boat-landings");
    return Array.isArray(landings) ? landings : [];
  }

  function getMiniTerritoryPositions() {
    const minis = readMarkerData("data-ofe-mini-territories");
    return Array.isArray(minis) ? minis : [];
  }

  function getMapTransform() {
    return readMarkerData("data-ofe-map-transform");
  }

  function getNameLayerContainer() {
    if (
      cachedNameLayerContainer &&
      document.contains(cachedNameLayerContainer) &&
      cachedNameLayerContainer.style &&
      cachedNameLayerContainer.style.left === "50%" &&
      cachedNameLayerContainer.style.top === "50%" &&
      cachedNameLayerContainer.style.zIndex === "2"
    ) {
      return cachedNameLayerContainer;
    }

    // Match the container by its structural CSS properties set in NameLayer.init():
    // position: fixed, left: 50%, top: 50%, pointer-events: none, z-index: 2
    const divs = document.querySelectorAll("div[style*='position: fixed']");
    for (const div of divs) {
      if (
        div.style.left === "50%" &&
        div.style.top === "50%" &&
        div.style.zIndex === "2" &&
        div.style.pointerEvents === "none"
      ) {
        cachedNameLayerContainer = div;
        return div;
      }
    }
    cachedNameLayerContainer = null;
    return null;
  }

  function extractScaleFromTransform(tf) {
    if (!tf || tf === "none") return 1;

    if (tf.startsWith("matrix3d(")) {
      const values = tf.slice(9, -1).split(",").map((v) => Number(v.trim()));
      if (values.length === 16 && values.every((v) => Number.isFinite(v))) {
        const sx = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
        return sx > 0 ? sx : 1;
      }
    }

    if (tf.startsWith("matrix(")) {
      const values = tf.slice(7, -1).split(",").map((v) => Number(v.trim()));
      if (values.length === 6 && values.every((v) => Number.isFinite(v))) {
        const sx = Math.sqrt(values[0] * values[0] + values[1] * values[1]);
        return sx > 0 ? sx : 1;
      }
    }

    const sMatch = tf.match(/scale\(\s*([-\d.]+)\s*\)/);
    if (sMatch) {
      const s = Number(sMatch[1]);
      return Number.isFinite(s) && s > 0 ? s : 1;
    }

    return 1;
  }

  function hasActiveGamePhase() {
    const phase = document.documentElement.getAttribute("data-ofe-game-phase");
    return phase === "spawn" || phase === "playing";
  }

  function ensureDotContainer() {
    const nameLayerContainer = getNameLayerContainer();
    if (!nameLayerContainer) {
      const mapTransform = getMapTransform();
      if (
        !mapTransform ||
        !Number.isFinite(Number(mapTransform.x)) ||
        !Number.isFinite(Number(mapTransform.y)) ||
        !Number.isFinite(Number(mapTransform.scale)) ||
        Number(mapTransform.scale) <= 0
      ) {
        return false;
      }

      if (dotContainer && dotContainer.dataset.ofeMarkerHost === "fallback") {
        return true;
      }
      if (dotContainer) dotContainer.remove();

      dotContainer = document.createElement("div");
      dotContainer.id = "ofe-dot-container";
      dotContainer.dataset.ofeMarkerHost = "fallback";
      dotContainer.style.cssText =
        "position:fixed;left:50%;top:50%;pointer-events:none;z-index:3;" +
        "--ofe-marker-scale:1;--ofe-transport-scale:1;";
      document.body.appendChild(dotContainer);
      return true;
    }

    if (dotContainer && nameLayerContainer.contains(dotContainer)) {
      dotContainer.dataset.ofeMarkerHost = "name-layer";
      return true;
    }
    if (dotContainer) dotContainer.remove();

    dotContainer = document.createElement("div");
    dotContainer.id = "ofe-dot-container";
    dotContainer.dataset.ofeMarkerHost = "name-layer";
    dotContainer.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;z-index:4;" +
      "--ofe-marker-scale:1;--ofe-transport-scale:1;";
    nameLayerContainer.appendChild(dotContainer);
    return true;
  }

  function updateMarkerScale() {
    if (!markersActive || !dotContainer) return;
    const nameLayerContainer = getNameLayerContainer();
    const mapTransform = getMapTransform();
    let zoomScale = 1;
    if (nameLayerContainer) {
      const tf = nameLayerContainer.style.transform || getComputedStyle(nameLayerContainer).transform;
      zoomScale = Math.max(0.0001, extractScaleFromTransform(tf));
    } else if (Number.isFinite(Number(mapTransform.scale))) {
      zoomScale = Math.max(0.0001, Number(mapTransform.scale));
    } else {
      return;
    }
    const highZoomTarget =
      zoomScale > 8 ? MARKER_TARGET_SCREEN_SIZE * 0.72 : MARKER_TARGET_SCREEN_SIZE;
    const desiredScale = highZoomTarget / (MARKER_SIZE * zoomScale);
    const clampedScale = Math.max(MARKER_MIN_SCALE, Math.min(MARKER_MAX_SCALE, desiredScale));
    const next = clampedScale.toFixed(4);
    if (dotContainer.style.getPropertyValue("--ofe-marker-scale") !== next) {
      dotContainer.style.setProperty("--ofe-marker-scale", next);
    }
    const transportScale = Math.max(
      TRANSPORT_MIN_SCALE,
      Math.min(
        TRANSPORT_MAX_SCALE,
        TRANSPORT_TARGET_SCREEN_SIZE / (TRANSPORT_MARKER_SIZE * zoomScale),
      ),
    ).toFixed(4);
    if (
      dotContainer.style.getPropertyValue("--ofe-transport-scale") !==
      transportScale
    ) {
      dotContainer.style.setProperty("--ofe-transport-scale", transportScale);
    }
  }

  function clearMarkers() {
    markerById.clear();
    if (markerExpiryTimer) {
      clearTimeout(markerExpiryTimer);
      markerExpiryTimer = null;
    }
    if (dotContainer) {
      dotContainer.remove();
      dotContainer = null;
    }
  }

  function styleMarker(marker, kind) {
    if (kind === "transport") {
      marker.style.cssText =
        "position:absolute;left:0;top:0;pointer-events:none;" +
        `width:${TRANSPORT_MARKER_SIZE}px;height:${TRANSPORT_MARKER_SIZE}px;box-sizing:border-box;` +
        "transition:transform 250ms linear;" +
        "border:2px solid rgba(255,255,255,0.98);border-radius:2px;" +
        "box-shadow:0 0 0 1px #020617,0 0 7px 2px rgba(14,165,233,0.9);";
      marker.dataset.ofeMarkerKind = kind;
      return;
    }

    if (kind === "boat-landing") {
      marker.style.cssText =
        "position:absolute;left:0;top:0;pointer-events:none;" +
        "width:32px;height:32px;background-repeat:no-repeat;background-size:contain;background-position:center;" +
        "filter:drop-shadow(0 0 8px rgba(245,158,11,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.85));" +
        `background-image:url("${BOAT_LANDING_MARKER_SVG_DATA_URI}");`;
      marker.dataset.ofeMarkerKind = kind;
      return;
    }

    if (kind === "mini-territory") {
      marker.style.cssText =
        "position:absolute;left:0;top:0;pointer-events:none;" +
        "width:36px;height:36px;background-repeat:no-repeat;background-size:contain;background-position:center;" +
        "filter:drop-shadow(0 0 9px rgba(34,211,238,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.9));" +
        `background-image:url("${MINI_TERRITORY_MARKER_SVG_DATA_URI}");`;
      marker.dataset.ofeMarkerKind = kind;
      return;
    }

    const image =
      kind === "building-stack"
        ? BUILDING_STACK_MARKER_SVG_DATA_URI
        : NATION_MARKER_SVG_DATA_URI;
    const shadow =
      kind === "building-stack"
        ? "drop-shadow(0 0 7px rgba(245,158,11,0.82)) drop-shadow(0 1px 2px rgba(0,0,0,0.72))"
        : "drop-shadow(0 0 6px rgba(239,68,68,0.55))";

    marker.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;" +
      `width:${MARKER_SIZE}px;height:${MARKER_SIZE}px;` +
      "display:flex;align-items:center;justify-content:center;" +
      "background-repeat:no-repeat;background-size:contain;background-position:center;" +
      `filter:${shadow};` +
      `background-image:url(\"${image}\");`;
    marker.dataset.ofeMarkerKind = kind;
  }

  function getOrCreateMarker(markerId, kind) {
    let marker = markerById.get(markerId);
    if (marker && dotContainer && dotContainer.contains(marker)) {
      if (marker.dataset.ofeMarkerKind !== kind) {
        marker.textContent = "";
        styleMarker(marker, kind);
      }
      return marker;
    }

    marker = document.createElement("div");
    marker.id = markerId;
    styleMarker(marker, kind);

    markerById.set(markerId, marker);
    dotContainer.appendChild(marker);
    return marker;
  }

  function setBuildingStackLabel(marker, level) {
    const text = Number.isFinite(Number(level)) ? String(Math.floor(Number(level))) : "";
    if (!text) {
      marker.textContent = "";
      return;
    }

    let label = marker.querySelector("span");
    if (!label) {
      marker.textContent = "";
      label = document.createElement("span");
      label.style.cssText =
        "position:absolute;left:50%;top:-9px;transform:translateX(-50%);" +
        "display:block;min-width:14px;max-width:24px;height:11px;padding:0 2px;overflow:hidden;text-align:center;" +
        "border:1px solid #111827;border-radius:2px;background:#fef3c7;" +
        "box-shadow:0 0 0 1px rgba(254,243,199,0.82),0 1px 3px rgba(0,0,0,0.65);" +
        "font:800 9px/11px Arial,sans-serif;color:#111827;text-shadow:none;";
      marker.appendChild(label);
    }
    if (label.textContent !== text) label.textContent = text;
  }

  function setMiniTerritoryLabel(marker, size) {
    let label = marker.querySelector("span");
    if (!label) {
      label = document.createElement("span");
      label.style.cssText =
        "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
        "min-width:16px;height:12px;padding:0 2px;text-align:center;" +
        "border-radius:4px;background:rgba(2,6,23,0.9);color:#cffafe;" +
        "font:800 9px/12px Arial,sans-serif;text-shadow:0 1px 1px #000;";
      marker.appendChild(label);
    }
    const text = String(size);
    if (label.textContent !== text) label.textContent = text;
  }

  function setMarkerTransform(marker, transform) {
    if (marker.style.transform !== transform) {
      marker.style.transform = transform;
    }
  }

  function updateMarkers() {
    if (!markersActive) return;
    if (!ensureDotContainer()) return;

    const nations = getNationPositions();
    const buildingStacks = getBuildingStackPositions();
    const transportShips = getTransportShipPositions();
    const boatLandings = getBoatLandingPositions();
    const miniTerritories = getMiniTerritoryPositions();
    const mapTransform = getMapTransform();
    if (
      dotContainer.dataset.ofeMarkerHost === "fallback" &&
      mapTransform &&
      Number.isFinite(Number(mapTransform.x)) &&
      Number.isFinite(Number(mapTransform.y)) &&
      Number.isFinite(Number(mapTransform.scale))
    ) {
      setMarkerTransform(
        dotContainer,
        `translate(${Number(mapTransform.x)}px, ${Number(mapTransform.y)}px) scale(${Number(mapTransform.scale)})`,
      );
    }
    const usedDots = new Set();

    for (const pid in nations) {
      const pos = nations[pid];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }

      const markerId = `ofe-nation-${pid}`;
      const marker = getOrCreateMarker(markerId, "nation");
      setMarkerTransform(
        marker,
        `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(var(--ofe-marker-scale))`,
      );

      usedDots.add(markerId);
    }

    for (const id in buildingStacks) {
      const pos = buildingStacks[id];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }

      const markerId = `ofe-building-stack-${id}`;
      const marker = getOrCreateMarker(markerId, "building-stack");
      setBuildingStackLabel(marker, pos.level);
      setMarkerTransform(
        marker,
        `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(var(--ofe-marker-scale))`,
      );

      usedDots.add(markerId);
    }

    for (const id in transportShips) {
      const pos = transportShips[id];
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
        continue;
      }

      const markerId = `ofe-transport-${id}`;
      const marker = getOrCreateMarker(markerId, "transport");
      setMarkerTransform(
        marker,
        `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%) scale(var(--ofe-transport-scale))`,
      );
      usedDots.add(markerId);
    }

    const now = Date.now();
    let nextMarkerExpiry = Infinity;
    for (const landing of boatLandings) {
      if (
        !landing ||
        !Number.isFinite(Number(landing.id)) ||
        !Number.isFinite(Number(landing.x)) ||
        !Number.isFinite(Number(landing.y)) ||
        !Number.isFinite(Number(landing.expiresAt)) ||
        Number(landing.expiresAt) <= now
      ) {
        continue;
      }

      const markerId = `ofe-boat-landing-${Number(landing.id)}`;
      const marker = getOrCreateMarker(markerId, "boat-landing");
      setMarkerTransform(
        marker,
        `translate(${Number(landing.x)}px, ${Number(landing.y)}px) translate(-50%, -50%) scale(var(--ofe-marker-scale))`,
      );
      usedDots.add(markerId);
      nextMarkerExpiry = Math.min(nextMarkerExpiry, Number(landing.expiresAt));
    }

    for (const mini of miniTerritories) {
      if (
        !mini ||
        !Number.isFinite(Number(mini.id)) ||
        !Number.isFinite(Number(mini.x)) ||
        !Number.isFinite(Number(mini.y)) ||
        !Number.isFinite(Number(mini.size)) ||
        !Number.isFinite(Number(mini.expiresAt)) ||
        Number(mini.expiresAt) <= now
      ) {
        continue;
      }

      const markerId = `ofe-mini-territory-${Number(mini.id)}`;
      const marker = getOrCreateMarker(markerId, "mini-territory");
      setMiniTerritoryLabel(marker, Number(mini.size));
      setMarkerTransform(
        marker,
        `translate(${Number(mini.x)}px, ${Number(mini.y)}px) translate(-50%, -50%) scale(var(--ofe-marker-scale))`,
      );
      usedDots.add(markerId);
      nextMarkerExpiry = Math.min(nextMarkerExpiry, Number(mini.expiresAt));
    }

    if (markerExpiryTimer) {
      clearTimeout(markerExpiryTimer);
      markerExpiryTimer = null;
    }
    if (Number.isFinite(nextMarkerExpiry)) {
      markerExpiryTimer = setTimeout(
        updateMarkers,
        Math.max(0, nextMarkerExpiry - now + 20),
      );
    }

    for (const [id, marker] of markerById.entries()) {
      if (!usedDots.has(id)) {
        marker.remove();
        markerById.delete(id);
      }
    }
  }

  function initGameDataObserver() {
    if (gameDataObserver) return;
    gameDataObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "attributes") continue;
        if (mutation.attributeName === "data-ofe-game-phase") {
          syncMarkerState();
          return;
        }
        if (
          mutation.attributeName === "data-ofe-nations" ||
          mutation.attributeName === "data-ofe-building-stacks" ||
          mutation.attributeName === "data-ofe-transport-ships" ||
          mutation.attributeName === "data-ofe-boat-landings" ||
          mutation.attributeName === "data-ofe-mini-territories" ||
          mutation.attributeName === "data-ofe-map-transform"
        ) {
          if (markersActive) updateMarkers();
          if (markersActive) updateMarkerScale();
          return;
        }
      }
    });
    gameDataObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-ofe-game-phase",
        "data-ofe-nations",
        "data-ofe-building-stacks",
        "data-ofe-transport-ships",
        "data-ofe-boat-landings",
        "data-ofe-mini-territories",
        "data-ofe-map-transform",
      ],
    });
  }

  function syncMarkerState() {
    const active = hasActiveGamePhase();
    if (active === markersActive) return;

    markersActive = active;
    if (markersActive) {
      updateMarkers();
      updateMarkerScale();
      return;
    }

    clearMarkers();
  }

  function init() {
    if (watchInterval) return;
    initGameDataObserver();
    watchInterval = setInterval(() => {
      syncMarkerState();
      if (markersActive) {
        if (!dotContainer || !document.contains(dotContainer)) {
          updateMarkers();
        }
        updateMarkerScale();
      }
    }, 120);
    syncMarkerState();
  }

  function waitForCanvas() {
    if (document.querySelector("canvas")) {
      init();
      return;
    }
    const target = document.body || document.documentElement;
    const observer = new MutationObserver(() => {
      if (document.querySelector("canvas")) {
        observer.disconnect();
        init();
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForCanvas);
  } else {
    waitForCanvas();
  }
})();
