"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  function keyCodeLabel(code) {
    if (!code) return "unbound";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }

  function readPanelVisibleSetting() {
    try {
      const raw = localStorage.getItem(constants.SHORTCUT_PANEL_VISIBLE_KEY);
      if (raw === null) return true;
      return raw === "1";
    } catch (_) {
      return true;
    }
  }

  function writePanelVisibleSetting(visible) {
    try {
      localStorage.setItem(constants.SHORTCUT_PANEL_VISIBLE_KEY, visible ? "1" : "0");
    } catch (_) {}
  }

  function setShortcutPanelVisible(visible) {
    if (!state.shortcutPanelState) return;
    state.shortcutPanelState.visible = visible;
    state.shortcutPanelState.panel.style.display = visible ? "" : "none";
    state.shortcutPanelState.toggle.textContent = visible ? "OFE Hide" : "OFE";
    state.shortcutPanelState.toggle.style.opacity = visible ? "0.75" : "1";
    updatePanelPlacement();
    writePanelVisibleSetting(visible);
  }

  function updatePanelPlacement() {
    if (!state.shortcutPanelState) return;
    const { panel, toggle, visible } = state.shortcutPanelState;

    panel.style.left = "12px";
    panel.style.top = "50%";
    panel.style.transform = "translateY(-50%)";

    if (!visible) {
      toggle.style.left = "12px";
      toggle.style.top = "50%";
      toggle.style.transform = "translateY(-50%)";
      return;
    }

    toggle.style.left = "12px";
    const panelHeight = panel.getBoundingClientRect().height;
    const offset = Number.isFinite(panelHeight) && panelHeight > 0
      ? Math.round(panelHeight / 2 + 10)
      : 92;
    toggle.style.top = `calc(50% + ${offset}px)`;
    toggle.style.transform = "translateY(-50%)";
  }

  function renderShortcutPanel() {
    if (!state.shortcutPanelState || !fn.getShortcutDiagnostics) return;

    const diagnostics = fn.getShortcutDiagnostics();
    const statusEl = state.shortcutPanelState.status;
    statusEl.textContent = "";

    let allReady = true;

    state.shortcutPanelState.panel.style.width = "min(148px,30vw)";
    state.shortcutPanelState.panel.style.padding = "3px 5px";
    state.shortcutPanelState.title.textContent = "OFE";
    state.shortcutPanelState.title.style.fontSize = "9px";
    state.shortcutPanelState.title.style.marginBottom = "2px";
    state.shortcutPanelState.warning.style.fontSize = "7px";
    state.shortcutPanelState.warning.style.marginTop = "3px";

    for (const meta of Object.values(constants.EXT_SHORTCUTS)) {
      const diag = diagnostics.byAction[meta.action];
      if (!diag) continue;

      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "gap:4px;padding:0 0;font-size:8px;";

      const left = document.createElement("div");
      left.style.cssText =
        "display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;";

      const dot = document.createElement("span");
      dot.textContent = "●";
      dot.style.color = diag.ready ? "#86efac" : "#fca5a5";

      const text = document.createElement("span");
      text.textContent = `${keyCodeLabel(diag.code)} ${meta.label}`;

      const right = document.createElement("span");
      right.style.color = diag.ready ? "#86efac" : "#fca5a5";
      right.textContent = diag.ready ? "" : "!";

      left.appendChild(dot);
      left.appendChild(text);
      row.appendChild(left);
      row.appendChild(right);
      statusEl.appendChild(row);

      if (!diag.ready) allReady = false;
    }

    state.shortcutPanelState.warning.textContent = allReady
      ? "All ready."
      : "Blocked keys. Fix in Settings.";
    state.shortcutPanelState.warning.style.color = allReady ? "#93c5fd" : "#fca5a5";

    updatePanelPlacement();
  }

  fn.initShortcutPanel = () => {
    if (state.shortcutPanelState) return;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = "ofe-shortcuts-toggle";
    toggle.style.cssText =
      "position:fixed;left:12px;top:50%;z-index:10030;transform:translateY(-50%);" +
      "border:1px solid #475569;background:#0f172a;color:#fff;border-radius:999px;" +
      "padding:5px 9px;font-size:11px;cursor:pointer;";

    const panel = document.createElement("div");
    panel.id = "ofe-shortcuts-panel";
    panel.style.cssText =
      "position:fixed;left:12px;top:50%;z-index:10029;transform:translateY(-50%);width:min(148px,30vw);" +
      "background:#0b1220;border:1px solid #334155;color:#e2e8f0;border-radius:10px;" +
      "padding:3px 5px;box-shadow:0 10px 30px rgba(0,0,0,0.45);font-size:8px;line-height:1.3;";

    const title = document.createElement("div");
    title.textContent = "OFE";
    title.style.cssText = "font-weight:700;color:#fff;margin-bottom:2px;font-size:9px;";

    const status = document.createElement("div");
    status.style.cssText = "display:flex;flex-direction:column;gap:2px;";

    const warning = document.createElement("div");
    warning.style.cssText = "margin-top:3px;font-size:7px;";

    panel.appendChild(title);
    panel.appendChild(status);
    panel.appendChild(warning);

    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    state.shortcutPanelState = {
      toggle,
      panel,
      title,
      status,
      warning,
      visible: true,
    };

    toggle.addEventListener("click", () => {
      if (!state.shortcutPanelState) return;
      setShortcutPanelVisible(!state.shortcutPanelState.visible);
    });

    setShortcutPanelVisible(readPanelVisibleSetting());
    renderShortcutPanel();

    state.shortcutPanelWatch = setInterval(renderShortcutPanel, 1000);
  };
})();
