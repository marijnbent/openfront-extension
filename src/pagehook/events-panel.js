"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;
  const FILTER_KEY = "ofe.events.panel.hidden";
  const BUTTON_ID = "ofe-events-filter-toggle";
  const MARKER = "\u2063\u2064\u2063";
  const MOVED_EVENT_TYPES = new Set([
    constants.MESSAGE_TYPE.RENEW_ALLIANCE,
    constants.MESSAGE_TYPE.MIRV_INBOUND,
    constants.MESSAGE_TYPE.NUKE_INBOUND,
    constants.MESSAGE_TYPE.HYDROGEN_BOMB_INBOUND,
  ]);

  function readHiddenSetting() {
    try {
      return localStorage.getItem(FILTER_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function writeHiddenSetting(hidden) {
    try {
      localStorage.setItem(FILTER_KEY, hidden ? "1" : "0");
    } catch (_) {}
  }

  function ensureState() {
    if (!state.eventsPanelState) {
      state.eventsPanelState = {
        hidden: readHiddenSetting(),
      };
    }
    return state.eventsPanelState;
  }

  function isOfeRow(row) {
    return String(row && row.textContent ? row.textContent : "").includes(MARKER);
  }

  function getVisibleOfeEvents(eventsDisplay) {
    const events = Array.isArray(eventsDisplay.events) ? eventsDisplay.events : [];
    return events
      .filter((event) => event && event.ofeExtensionEvent)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  function eventText(event) {
    const holder = document.createElement("div");
    if (event.unsafeDescription) {
      holder.innerHTML = String(event.description || "");
    } else {
      holder.textContent = String(event.description || "");
    }
    return String(holder.textContent || "").trim();
  }

  function removeMovedEvents(eventsDisplay) {
    if (!Array.isArray(eventsDisplay.events)) return;
    const events = eventsDisplay.events.filter(
      (event) => !MOVED_EVENT_TYPES.has(event?.type),
    );
    if (events.length === eventsDisplay.events.length) return;
    eventsDisplay.events = events;
    eventsDisplay.requestUpdate?.();
  }

  function bindOfeRowInteraction(row, event) {
    if (row.__ofeClickHandler) {
      row.removeEventListener("click", row.__ofeClickHandler, true);
      row.__ofeClickHandler = null;
    }

    const hasExactLocation =
      event &&
      Number.isFinite(Number(event.x)) &&
      Number.isFinite(Number(event.y));

    if (!hasExactLocation) {
      row.style.cursor = "";
      row.title = "";
      return;
    }

    const handler = (domEvent) => {
      if (fn.focusOfeTarget?.({ x: event.x, y: event.y }, { instant: true })) {
        domEvent.preventDefault();
        domEvent.stopImmediatePropagation();
      }
    };

    row.__ofeClickHandler = handler;
    row.addEventListener("click", handler, true);
    row.style.cursor = "pointer";
    row.title = "Jump to event location";
  }

  function updateButtonAppearance(button, hidden) {
    button.style.opacity = hidden ? "0.45" : "1";
    button.style.filter = hidden ? "grayscale(1)" : "none";
    button.title = hidden ? "Show OFE messages" : "Hide OFE messages";
    button.setAttribute("aria-label", button.title);
  }

  function ensureButton(eventsDisplay, visible) {
    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.id = BUTTON_ID;
      button.textContent = "OFE";
      button.style.cssText =
        "position:fixed;z-index:6;display:inline-flex;align-items:center;justify-content:center;" +
        "height:20px;min-width:30px;" +
        "padding:0 6px;border:1px solid rgba(148,163,184,0.28);border-radius:6px;" +
        "background:rgba(15,23,42,0.72);color:#e2e8f0;font-size:10px;font-weight:700;" +
        "cursor:pointer;line-height:1;";
      button.addEventListener("click", () => {
        const panelState = ensureState();
        panelState.hidden = !panelState.hidden;
        writeHiddenSetting(panelState.hidden);
        syncEventsPanel();
      });
      document.body.appendChild(button);
    }

    const rect = eventsDisplay.getBoundingClientRect();
    button.style.left = `${Math.max(4, Math.round(rect.left - 38))}px`;
    button.style.top = `${Math.max(4, Math.round(rect.top))}px`;
    button.style.display = visible ? "inline-flex" : "none";
    updateButtonAppearance(button, ensureState().hidden);
    return button;
  }

  function syncEventsPanel() {
    const eventsDisplay = document.querySelector("events-display");
    if (!eventsDisplay) return;

    removeMovedEvents(eventsDisplay);
    const panelState = ensureState();
    const ofeEvents = getVisibleOfeEvents(eventsDisplay);
    const rows = eventsDisplay.querySelectorAll(
      ".events-container tbody tr, .important-events-container tbody tr",
    );
    const unmatchedEvents = [...ofeEvents];
    let hasOfeRows = false;

    for (const row of rows) {
      if (!isOfeRow(row)) continue;
      hasOfeRows = true;

      const rowText = String(row.textContent || "").trim();
      let eventIndex = unmatchedEvents.findIndex(
        (event) => eventText(event) === rowText,
      );
      if (eventIndex < 0) eventIndex = 0;
      const event = unmatchedEvents.splice(eventIndex, 1)[0] || null;
      row.style.display = panelState.hidden ? "none" : "";
      bindOfeRowInteraction(row, event);
    }

    ensureButton(eventsDisplay, hasOfeRows);
  }

  function observeEventsDisplay() {
    const eventsDisplay = document.querySelector("events-display");
    if (!eventsDisplay || state.eventsPanelElement === eventsDisplay) return;

    state.eventsPanelObserver?.disconnect();
    state.eventsPanelElement = eventsDisplay;
    state.eventsPanelObserver = new MutationObserver(syncEventsPanel);
    state.eventsPanelObserver.observe(eventsDisplay, {
      childList: true,
      subtree: true,
    });
    syncEventsPanel();
  }

  fn.initEventsPanelIntegration = () => {
    if (state.eventsPanelInitialized) return;
    ensureState();
    state.eventsPanelInitialized = true;
    customElements.whenDefined("events-display").then(observeEventsDisplay);
    fn.onNativeGameTick?.(() => {
      observeEventsDisplay();
      syncEventsPanel();
    });
    window.addEventListener("resize", syncEventsPanel);
  };
})();
