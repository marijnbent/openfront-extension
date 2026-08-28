"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  state.nativeTickListeners ||= new Set();
  state.nativeGameChangeListeners ||= new Set();

  function emit(listeners, payload) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        console.error("[OFE] Native game listener failed", error);
      }
    }
  }

  function getContext() {
    const eventsDisplay = document.querySelector("events-display");
    const buildMenu = document.querySelector("build-menu");
    const game = eventsDisplay?.game || buildMenu?.game || null;

    return {
      game,
      eventsDisplay,
      eventBus: eventsDisplay?.eventBus || buildMenu?.eventBus || null,
      uiState: eventsDisplay?.uiState || buildMenu?.uiState || null,
      transformHandler: buildMenu?.transformHandler || null,
    };
  }

  function publishTick(eventsDisplay) {
    const game = eventsDisplay?.game;
    if (!game || typeof game.ticks !== "function") return;

    const tick = Number(game.ticks());
    if (!Number.isFinite(tick)) return;

    if (state.nativeGame !== game) {
      const previousGame = state.nativeGame || null;
      state.nativeGame = game;
      state.lastNativeTick = null;
      emit(state.nativeGameChangeListeners, { game, previousGame });
    }

    if (state.lastNativeTick === tick) return;
    state.lastNativeTick = tick;

    // Catch-up can process many historical ticks in a short burst. Extension
    // panels, markers, and alerts only need the current state once it ends.
    if (
      typeof game.isCatchingUp === "function" &&
      game.isCatchingUp()
    ) {
      return;
    }

    const updates = typeof game.updatesSinceLastTick === "function"
      ? game.updatesSinceLastTick()
      : null;
    emit(state.nativeTickListeners, { game, tick, updates, eventsDisplay });
  }

  function installTickHook() {
    const EventsDisplay = customElements.get("events-display");
    const prototype = EventsDisplay?.prototype;
    if (!prototype || typeof prototype.tick !== "function") return false;
    if (prototype.__ofeNativeTickHooked) return true;

    const nativeTick = prototype.tick;
    prototype.tick = function (...args) {
      const result = nativeTick.apply(this, args);
      publishTick(this);
      return result;
    };
    prototype.__ofeNativeTickHooked = true;
    return true;
  }

  fn.getNativeContext = getContext;
  fn.onNativeGameTick = (listener) => {
    if (typeof listener === "function") state.nativeTickListeners.add(listener);
    return () => state.nativeTickListeners.delete(listener);
  };
  fn.onNativeGameChange = (listener) => {
    if (typeof listener === "function") {
      state.nativeGameChangeListeners.add(listener);
    }
    return () => state.nativeGameChangeListeners.delete(listener);
  };

  fn.initNativeRuntime = () => {
    if (state.nativeRuntimeInitialized) return;
    state.nativeRuntimeInitialized = true;

    customElements.whenDefined("events-display").then(() => {
      if (!installTickHook()) {
        console.warn("[OFE] OpenFront events controller is unavailable");
      }
    });
  };
})();
