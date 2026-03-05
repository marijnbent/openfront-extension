/**
 * OpenFront Enhanced — Content Script (runs in ISOLATED world)
 *
 * During spawn phase: adds red glowing dots on every nation so you can see
 * them from any zoom level when picking a start location. Removed when
 * the game starts.
 *
 * Reads data from attributes on <html> set by page-hook.js (MAIN world):
 *   - data-ofe-nations: nation positions for spawn dots
 */

"use strict";

(() => {
  let interval = null;
  let spawnActive = false;
  let dotContainer = null;
  const DOT_COLOR = "#ef4444";
  const DOT_MIN = 6;
  const DOT_MAX = 18;

  function getNationPositions() {
    try {
      const raw = document.documentElement.getAttribute("data-ofe-nations");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function getNameLayerContainer() {
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
        return div;
      }
    }
    return null;
  }

  /** Parse translate(Xpx, Ypx) and scale(S) from a transform string */
  function parseTransform(tf) {
    const result = { tx: 0, ty: 0, scale: 1 };
    if (!tf) return result;
    const tMatch = tf.match(/translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/);
    if (tMatch) {
      result.tx = parseFloat(tMatch[1]);
      result.ty = parseFloat(tMatch[2]);
    }
    const sMatch = tf.match(/scale\(\s*([-\d.]+)\s*\)/);
    if (sMatch) {
      result.scale = parseFloat(sMatch[1]);
    }
    return result;
  }

  function isSpawnPhase() {
    const timer = document.querySelector("spawn-timer");
    if (!timer) return false;
    // SpawnTimer uses light DOM (createRenderRoot returns this).
    // During spawn phase it renders a div with class "w-full".
    if (timer.querySelector(".w-full") !== null) {
      const style = getComputedStyle(timer);
      return style.display !== "none" && style.visibility !== "hidden";
    }
    return false;
  }

  function ensureDotContainer() {
    if (dotContainer && document.body.contains(dotContainer)) return;
    dotContainer = document.createElement("div");
    dotContainer.id = "ofe-dot-container";
    dotContainer.style.cssText =
      "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:hidden;";
    document.body.appendChild(dotContainer);
  }

  function updateSpawnDots(ct, halfW, halfH) {
    const spawning = isSpawnPhase();

    if (spawning && !spawnActive) {
      spawnActive = true;
    } else if (!spawning && spawnActive) {
      spawnActive = false;
      if (dotContainer) {
        dotContainer.remove();
        dotContainer = null;
      }
      return;
    }

    if (!spawnActive) return;

    ensureDotContainer();

    const nations = getNationPositions();
    const usedDots = new Set();

    for (const pid in nations) {
      const pos = nations[pid];

      const screenX = halfW + ct.tx + pos.x * ct.scale;
      const screenY = halfH + ct.ty + pos.y * ct.scale;

      if (
        screenX < -20 || screenX > window.innerWidth + 20 ||
        screenY < -20 || screenY > window.innerHeight + 20
      ) {
        continue;
      }

      const dotSize = Math.max(DOT_MIN, Math.min(DOT_MAX, 4 * ct.scale));

      const dotId = `ofe-dot-${pid}`;
      let dot = dotContainer.querySelector(`#${CSS.escape(dotId)}`);

      if (!dot) {
        dot = document.createElement("div");
        dot.id = dotId;
        dot.style.cssText =
          "position:fixed;border-radius:50%;pointer-events:none;";
        dotContainer.appendChild(dot);
      }

      dot.style.width = `${dotSize}px`;
      dot.style.height = `${dotSize}px`;
      dot.style.left = `${screenX - dotSize / 2}px`;
      dot.style.top = `${screenY - dotSize / 2}px`;
      dot.style.background = DOT_COLOR;
      dot.style.boxShadow = `0 0 ${dotSize}px ${DOT_COLOR}, 0 0 ${dotSize * 2}px ${DOT_COLOR}88`;

      usedDots.add(dotId);
    }

    if (dotContainer) {
      for (const child of [...dotContainer.children]) {
        if (!usedDots.has(child.id)) {
          child.remove();
        }
      }
    }
  }

  function update() {
    const container = getNameLayerContainer();
    if (!container) return;

    const ct = parseTransform(container.style.transform);
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;

    updateSpawnDots(ct, halfW, halfH);
  }

  function init() {
    if (interval) return;
    interval = setInterval(update, 300);
    update();
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
