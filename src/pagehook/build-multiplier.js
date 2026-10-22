"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;
  const MULTIPLIERS = [1, 5, 10, 100];
  const INDICATOR_STYLE_ID = "ofe-build-multiplier-styles";
  const hookedEventBuses = new WeakSet();

  function installIndicatorStyles() {
    if (!document.head || document.getElementById(INDICATOR_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = INDICATOR_STYLE_ID;
    style.textContent = `
      .ofe-build-multiplier-bar::after {
        content: attr(data-ofe-build-multiplier);
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 2rem;
        padding: 0 0.35rem;
        border: 1px solid rgba(100, 116, 139, 0.45);
        border-radius: 0.125rem;
        background: rgba(15, 23, 42, 0.22);
        color: rgba(148, 163, 184, 0.72);
        font-size: 0.75rem;
        font-weight: 500;
        line-height: 1;
        box-sizing: border-box;
        cursor: pointer;
      }

      .ofe-build-multiplier-bar[data-ofe-build-multiplier="×5"]::after {
        border-color: rgba(245, 158, 11, 0.95);
        background: rgba(120, 53, 15, 0.72);
        color: #fde68a;
        font-weight: 800;
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.45);
      }

      .ofe-build-multiplier-bar[data-ofe-build-multiplier="×10"]::after,
      .ofe-build-multiplier-bar[data-ofe-build-multiplier="×100"]::after {
        border-color: rgba(248, 113, 113, 0.98);
        background: rgba(127, 29, 29, 0.82);
        color: #fef2f2;
        font-weight: 800;
        box-shadow: 0 0 10px rgba(239, 68, 68, 0.58);
      }
    `;
    document.head.appendChild(style);
  }

  function renderBuildMultiplier() {
    installIndicatorStyles();

    const buildBar = document.querySelector(
      "unit-display .grid.grid-rows-1.grid-flow-col",
    );
    if (!buildBar) return;

    buildBar.classList.add("ofe-build-multiplier-bar");
    buildBar.dataset.ofeBuildMultiplier = `×${state.buildMultiplier}`;
    fn.renderDefensePaintButton?.(buildBar);

    if (!buildBar.__ofeBuildMultiplierClickInstalled) {
      buildBar.__ofeBuildMultiplierClickInstalled = true;
      buildBar.addEventListener("click", (event) => {
        if (event.target !== buildBar) return;

        const lastBuildButton = Array.from(buildBar.children).filter(
          (child) => !child.hasAttribute("data-ofe-defense-paint"),
        ).at(-1);
        if (
          lastBuildButton &&
          event.clientX <= lastBuildButton.getBoundingClientRect().right
        ) {
          return;
        }

        event.stopPropagation();
        toggleBuildMultiplier();
      });
    }
  }

  function getUiState() {
    const controlPanel = document.querySelector("control-panel");
    if (controlPanel && controlPanel.uiState) return controlPanel.uiState;

    const buildMenu = document.querySelector("build-menu");
    return buildMenu && buildMenu.uiState ? buildMenu.uiState : null;
  }

  function installBatchDispatch() {
    const eventBus = fn.getNativeContext?.()?.eventBus;
    if (
      !eventBus ||
      typeof eventBus.emit !== "function" ||
      hookedEventBuses.has(eventBus)
    ) return;

    const nativeEmit = eventBus.emit;
    eventBus.emit = function (event, ...args) {
      const isUpgrade =
        Number.isInteger(event?.unitId) && typeof event?.unitType === "string";
      const isAtomBomb = event?.unit === "Atom Bomb" && Number.isInteger(event?.tile);
      if (
        state.buildMultiplier !== 100 ||
        event?.amount !== 10 ||
        (!isUpgrade && !isAtomBomb)
      ) {
        return nativeEmit.call(this, event, ...args);
      }

      for (let batch = 0; batch < 10; batch++) {
        const batchEvent = Object.assign(
          Object.create(Object.getPrototypeOf(event)), event,
        );
        nativeEmit.call(this, batchEvent, ...args);
      }
    };
    hookedEventBuses.add(eventBus);
  }

  function installMultiplierLock() {
    installBatchDispatch();
    const uiState = getUiState();
    if (!uiState || uiState === state.buildMultiplierUiState) return;

    state.buildMultiplierUiState = uiState;
    Object.defineProperty(uiState, "upgradeMultiplier", {
      configurable: true,
      enumerable: true,
      get: () => Math.min(state.buildMultiplier, 10),
      // OpenFront writes here when a build hotkey is pressed twice. The
      // extension owns the value so repeated build hotkeys no longer change it.
      set: () => {},
    });
  }

  function setBuildMultiplier(multiplier) {
    if (!MULTIPLIERS.includes(multiplier)) return false;
    state.buildMultiplier = multiplier;
    installMultiplierLock();
    renderBuildMultiplier();
    fn.renderShortcutPanel?.();
    return true;
  }

  function toggleBuildMultiplier() {
    const currentIndex = MULTIPLIERS.indexOf(state.buildMultiplier);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % MULTIPLIERS.length;
    setBuildMultiplier(MULTIPLIERS[nextIndex]);
  }

  function isToggleEvent(event) {
    const producedBackslash = event.key === "\\";
    const plainBackslashKey =
      (event.code === "Backslash" || event.code === "IntlBackslash") &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey;

    return (
      (producedBackslash || plainBackslashKey) &&
      !event.metaKey &&
      !fn.isTextInput(event.target)
    );
  }

  fn.getBuildMultiplier = () => state.buildMultiplier;
  fn.renderBuildControls = renderBuildMultiplier;
  fn.setBuildMultiplier = setBuildMultiplier;
  fn.toggleBuildMultiplier = toggleBuildMultiplier;

  fn.initBuildMultiplier = () => {
    if (state.buildMultiplierInitialized) return;
    state.buildMultiplierInitialized = true;
    state.buildMultiplier = 1;

    window.addEventListener(
      "keydown",
      (event) => {
        installMultiplierLock();
        renderBuildMultiplier();
        if (!isToggleEvent(event)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        if (!event.repeat) toggleBuildMultiplier();
      },
      true,
    );

    window.addEventListener(
      "keyup",
      (event) => {
        if (!isToggleEvent(event)) return;
        event.stopImmediatePropagation();
        event.preventDefault();
      },
      true,
    );

    installMultiplierLock();
    renderBuildMultiplier();

    const observeUnitDisplay = () => {
      const unitDisplay = document.querySelector("unit-display");
      if (!unitDisplay || state.buildMultiplierElement === unitDisplay) return;
      state.buildMultiplierObserver?.disconnect();
      state.buildMultiplierElement = unitDisplay;
      state.buildMultiplierObserver = new MutationObserver(renderBuildMultiplier);
      state.buildMultiplierObserver.observe(unitDisplay, {
        childList: true,
        subtree: true,
      });
      renderBuildMultiplier();
    };

    customElements.whenDefined("unit-display").then(observeUnitDisplay);
    fn.onNativeGameChange?.(() => {
      installMultiplierLock();
      renderBuildMultiplier();
      observeUnitDisplay();
    });
  };
})();
