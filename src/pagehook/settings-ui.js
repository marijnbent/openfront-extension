"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  const ROOT_ID = "ofe-keybind-settings-root";
  const SECTION_TITLE = "OpenFront Enhanced";

  function formatCodeForDisplay(code) {
    if (!code || code === "Null") return "";
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }

  function findKeybindContainer() {
    const modal = document.querySelector("user-setting");
    if (!modal || !modal.isModalOpen) return null;

    const anchor = modal.querySelector('setting-keybind[action="moveRight"]');
    if (!anchor) return null;

    return {
      modal,
      parent: anchor.parentElement,
      anchor,
    };
  }

  function extensionBindingEntry(action) {
    const raw = fn.getExtensionBindingsRaw ? fn.getExtensionBindingsRaw() : {};
    return raw[action] || null;
  }

  function getCurrentCode(action) {
    const bindings = fn.getEffectiveExtensionBindings
      ? fn.getEffectiveExtensionBindings()
      : {};
    return bindings[action] || constants.EXT_SHORTCUTS[action].defaultCode;
  }

  function showErrorMessage(text) {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: text,
          color: "red",
          duration: 2500,
        },
      }),
    );
  }

  function validateExtensionBinding(action, code) {
    if (!code || code === "Null") return [];

    const gameBindings = fn.getEffectiveGameKeybinds
      ? fn.getEffectiveGameKeybinds()
      : {};
    const extBindings = fn.getEffectiveExtensionBindings
      ? fn.getEffectiveExtensionBindings()
      : {};

    const conflicts = [];

    for (const [gameAction, gameCode] of Object.entries(gameBindings)) {
      if (gameCode === code) {
        conflicts.push(`game:${gameAction}`);
      }
    }

    for (const [otherAction, otherCode] of Object.entries(extBindings)) {
      if (otherAction === action) continue;
      if (otherCode === code) {
        const label = constants.EXT_SHORTCUTS[otherAction]
          ? constants.EXT_SHORTCUTS[otherAction].label
          : otherAction;
        conflicts.push(`extension:${label}`);
      }
    }

    return conflicts;
  }

  function syncSettingElementValue(el, action) {
    const entry = extensionBindingEntry(action);
    const code = getCurrentCode(action);
    el.value = code === "Null" ? "" : code;
    el.display = entry && entry.key ? entry.key : formatCodeForDisplay(code);
    el.requestUpdate();
  }

  function onKeybindChange(event) {
    const detail = event.detail || {};
    const fullAction = detail.action;
    if (!fullAction || typeof fullAction !== "string") return;
    if (!fullAction.startsWith("ofe.")) return;

    const action = fullAction.slice(4);
    const meta = constants.EXT_SHORTCUTS[action];
    if (!meta) return;

    const value = detail.value;
    const key = typeof detail.key === "string" ? detail.key : "";

    const conflicts = validateExtensionBinding(action, value);
    if (conflicts.length > 0 && value !== "Null") {
      showErrorMessage(
        `OFE keybind conflict for ${meta.label}: ${conflicts.join(", ")}`,
      );

      const root = document.getElementById(ROOT_ID);
      if (root) {
        const el = root.querySelector(`setting-keybind[action="ofe.${action}"]`);
        if (el) syncSettingElementValue(el, action);
      }
      return;
    }

    if (fn.saveExtensionBinding) {
      fn.saveExtensionBinding(action, value, key);
    }

    const root = document.getElementById(ROOT_ID);
    if (root) {
      const el = root.querySelector(`setting-keybind[action="ofe.${action}"]`);
      if (el) syncSettingElementValue(el, action);
    }
  }

  function buildExtensionSettingRows(root) {
    for (const [action, meta] of Object.entries(constants.EXT_SHORTCUTS)) {
      const row = document.createElement("setting-keybind");
      row.action = `ofe.${action}`;
      row.label = `OFE: ${meta.label}`;
      row.description = meta.desc;
      row.defaultKey = meta.defaultCode;

      syncSettingElementValue(row, action);

      row.addEventListener("change", onKeybindChange);
      root.appendChild(row);
    }
  }

  function ensureSettingsSection() {
    const ctx = findKeybindContainer();
    if (!ctx || !ctx.parent) return;

    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;

      const heading = document.createElement("h2");
      heading.textContent = SECTION_TITLE;
      heading.className =
        "text-blue-200 text-xl font-bold mt-8 mb-3 border-b border-white/10 pb-2";

      const helper = document.createElement("p");
      helper.className = "text-white/60 text-xs mb-3";
      helper.textContent =
        "Configure extension shortcuts here. Conflicts with game keybinds are blocked.";

      root.appendChild(heading);
      root.appendChild(helper);
      buildExtensionSettingRows(root);

      ctx.parent.appendChild(root);
    }

    for (const action of Object.keys(constants.EXT_SHORTCUTS)) {
      const el = root.querySelector(`setting-keybind[action="ofe.${action}"]`);
      if (el) syncSettingElementValue(el, action);
    }
  }

  fn.initSettingsIntegration = () => {
    if (state.settingsIntegrationInit) return;
    state.settingsIntegrationInit = true;

    setInterval(() => {
      ensureSettingsSection();
    }, 800);
  };
})();
