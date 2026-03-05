"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  function hideEmojiSearchPalette() {
    if (state.emojiSearchWatch) {
      clearInterval(state.emojiSearchWatch);
      state.emojiSearchWatch = null;
    }
    if (state.emojiSearchState && state.emojiSearchState.panel) {
      state.emojiSearchState.panel.remove();
    }
    state.emojiSearchState = null;
  }

  function getEmojiButtons() {
    const emojiTable = fn.getEmojiTable();
    if (!emojiTable) return [];
    return Array.from(emojiTable.querySelectorAll(".grid button"));
  }

  function emojiMatchesQuery(emoji, tokens) {
    const keywords = constants.EMOJI_KEYWORDS[emoji] || [];
    return fn.matchesAllTokens(`${emoji} ${keywords.join(" ")}`, tokens);
  }

  function applyEmojiFilter() {
    const s = state.emojiSearchState;
    if (!s) return null;

    const tokens = fn.splitTokens(s.input.value);
    let firstVisible = null;

    for (const button of getEmojiButtons()) {
      const emoji = (button.textContent || "").trim();
      const visible = emojiMatchesQuery(emoji, tokens);
      button.style.display = visible ? "" : "none";
      if (visible && !firstVisible) firstVisible = button;
    }

    s.firstVisible = firstVisible;
    return firstVisible;
  }

  function showEmojiSearchPalette() {
    const emojiTable = fn.getEmojiTable();
    if (!emojiTable || !emojiTable.isVisible) return;

    hideEmojiSearchPalette();

    const panel = document.createElement("div");
    panel.id = "ofe-emoji-search";
    panel.style.cssText =
      "position:fixed;left:50%;top:20px;transform:translateX(-50%);" +
      "z-index:10021;width:min(520px,90vw);background:#0f172a;border:1px solid #334155;" +
      "border-radius:12px;padding:10px;box-shadow:0 18px 50px rgba(0,0,0,0.5);";

    const title = document.createElement("div");
    title.textContent = "Emoji search";
    title.style.cssText = "color:#e5e7eb;font-size:12px;font-weight:700;margin-bottom:6px;";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type keywords (fire, target, heart, surrender...)";
    input.autocomplete = "off";
    input.style.cssText =
      "width:100%;border:1px solid #475569;background:#020617;color:#fff;" +
      "border-radius:8px;padding:8px 10px;outline:none;";

    panel.appendChild(title);
    panel.appendChild(input);
    document.body.appendChild(panel);

    state.emojiSearchState = { panel, input, emojiTable, firstVisible: null };

    input.addEventListener("input", () => applyEmojiFilter());
    input.addEventListener("keydown", (e) => {
      if (!state.emojiSearchState) return;

      if (e.key === "Enter") {
        const first = applyEmojiFilter();
        if (first) {
          e.preventDefault();
          first.click();
          hideEmojiSearchPalette();
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (typeof emojiTable.hideTable === "function") {
          emojiTable.hideTable();
        }
        hideEmojiSearchPalette();
      }
    });

    applyEmojiFilter();
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);

    state.emojiSearchWatch = setInterval(() => {
      if (!emojiTable.isVisible) hideEmojiSearchPalette();
    }, 200);
  }

  fn.hideEmojiSearchPalette = hideEmojiSearchPalette;

  fn.openEmojiForHoveredTile = () => {
    const x = fn.clamp(state.lastMouseX, 0, window.innerWidth - 1);
    const y = fn.clamp(state.lastMouseY, 0, window.innerHeight - 1);

    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 0,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        clientX: x,
        clientY: y,
        altKey: true,
      }),
    );

    setTimeout(showEmojiSearchPalette, 0);
  };
})();
