"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;
  const BOAT_INTENT_TIMEOUT_MS = 1500;

  function getControlPanel() {
    const controlPanel = document.querySelector("control-panel");
    return controlPanel &&
      typeof controlPanel.onAttackRatioChange === "function"
      ? controlPanel
      : null;
  }

  function readAttackRatio(controlPanel) {
    const ratio = Number(controlPanel?.attackRatio);
    return Number.isFinite(ratio)
      ? Math.min(1, Math.max(0.01, ratio))
      : null;
  }

  function applyAttackRatio(controlPanel, ratio) {
    const clamped = Math.min(1, Math.max(0.01, Number(ratio)));
    if (!controlPanel || !Number.isFinite(clamped)) return false;

    controlPanel.attackRatio = clamped;
    controlPanel.onAttackRatioChange(clamped);
    controlPanel.requestUpdate?.();
    return true;
  }

  function isBoatIntent(event) {
    return (
      event != null &&
      Object.prototype.hasOwnProperty.call(event, "dst") &&
      Object.prototype.hasOwnProperty.call(event, "troops") &&
      Number.isFinite(Number(event.troops))
    );
  }

  function parseKeybind(keybind) {
    return typeof keybind === "string" && keybind.startsWith("Shift+")
      ? { code: keybind.slice(6), shiftKey: true }
      : { code: keybind || "KeyB", shiftKey: false };
  }

  fn.triggerBoatOnePercentAttack = () => {
    if (state.boatDispatching) {
      fn.playExtensionSound?.("actionBlocked");
      return;
    }

    const controlPanel = getControlPanel();
    const eventBus = fn.getNativeContext?.()?.eventBus;
    const previousRatio = readAttackRatio(controlPanel);
    if (
      previousRatio == null ||
      !eventBus ||
      typeof eventBus.emit !== "function" ||
      !applyAttackRatio(controlPanel, 0.01)
    ) {
      fn.pushBottomRightLog?.("Boat 1% is unavailable right now.");
      fn.playExtensionSound?.("actionBlocked");
      return;
    }

    const nativeEmit = eventBus.emit;
    let timeoutID = null;
    let finished = false;

    // OpenFront checks boat availability in its worker before it creates the
    // intent. Restore the user's ratio only after that intent has been sent.
    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeoutID != null) clearTimeout(timeoutID);
      if (eventBus.emit === emitUntilBoatIntent) eventBus.emit = nativeEmit;
      state.boatDispatching = false;
      applyAttackRatio(controlPanel, previousRatio);
    };

    function emitUntilBoatIntent(event, ...args) {
      try {
        return nativeEmit.call(this, event, ...args);
      } finally {
        if (isBoatIntent(event)) finish();
      }
    }

    state.boatDispatching = true;
    eventBus.emit = emitUntilBoatIntent;
    timeoutID = setTimeout(finish, BOAT_INTENT_TIMEOUT_MS);

    const attackKey = parseKeybind(fn.getBoatAttackKey?.() || "KeyB");
    try {
      window.dispatchEvent(
        new KeyboardEvent("keyup", {
          code: attackKey.code,
          shiftKey: attackKey.shiftKey,
          bubbles: true,
        }),
      );
    } catch (error) {
      finish();
      throw error;
    }
  };
})();
