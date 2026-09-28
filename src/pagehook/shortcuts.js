"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;

  function getShortcutActionForEvent(event) {
    if (fn.getShortcutActionForEvent) return fn.getShortcutActionForEvent(event);
    if (!fn.getShortcutActionByCode) return null;
    return fn.getShortcutActionByCode(event.code);
  }

  function isShortcutReady(event) {
    if (fn.isShortcutEventReady) return fn.isShortcutEventReady(event);
    return fn.isShortcutCodeReady ? fn.isShortcutCodeReady(event.code) : false;
  }

  function watchNativeAttack(event) {
    const bindings = fn.getEffectiveGameKeybinds?.();
    const boat = fn.keybindMatchesEvent?.(event, bindings?.boatAttack);
    const ground = fn.keybindMatchesEvent?.(event, bindings?.groundAttack);
    if (!boat && !ground) return;

    const game = fn.getNativeContext?.()?.game;
    const player = game?.myPlayer?.();
    const method = boat ? "buildables" : "actions";
    const nativeCheck = player?.[method];
    if (typeof nativeCheck !== "function") return;
    const ownMethod = Object.prototype.hasOwnProperty.call(player, method);

    const restore = () => {
      if (player[method] !== checkAttack) return;
      if (ownMethod) player[method] = nativeCheck;
      else delete player[method];
    };
    function checkAttack(...args) {
      const matches = boat
        ? args[1]?.length === 1 && args[1][0] === "Transport"
        : args[1] === null;
      if (!matches) return nativeCheck.apply(this, args);
      restore();
      const result = nativeCheck.apply(this, args);
      Promise.resolve(result).then((value) => {
        if (fn.getNativeContext?.()?.game !== game) return;
        const blocked = boat
          ? (value?.find((unit) => unit.type === "Transport")?.canBuild ?? false) === false
          : value?.canAttack === false;
        if (blocked) fn.playExtensionSound?.("actionBlocked");
      }).catch(() => {});
      return result;
    }

    player[method] = checkAttack;
    setTimeout(restore, 0);
  }

  fn.initShortcutHandlers = () => {
    if (state.shortcutHandlersInitialized) return;
    state.shortcutHandlersInitialized = true;

    window.addEventListener(
      "keydown",
      (e) => {
        if (fn.isTextInput(e.target) || fn.hasCommandModifier(e)) return;
        const action = getShortcutActionForEvent(e);
        if (!action) return;
        if (!isShortcutReady(e)) return;

        e.stopImmediatePropagation();
        e.preventDefault();
      },
      true,
    );

    window.addEventListener(
      "keyup",
      (e) => {
        if (fn.isTextInput(e.target) || fn.hasCommandModifier(e)) return;
        const action = getShortcutActionForEvent(e);
        if (!action) {
          watchNativeAttack(e);
          return;
        }

        if (!isShortcutReady(e)) {
          const key = fn.getShortcutEventKey ? fn.getShortcutEventKey(e) : e.code;
          fn.maybeNotifyShortcutBlocked(key);
          fn.playExtensionSound?.("actionBlocked");
          return;
        }

        e.stopImmediatePropagation();
        e.preventDefault();

        switch (action) {
          case "showMiniTerritories": {
            if (fn.triggerShowMiniTerritories) fn.triggerShowMiniTerritories();
            break;
          }
          case "chatSearch": {
            if (fn.hideEmojiSearchPalette) fn.hideEmojiSearchPalette();
            if (fn.openChatForHoveredPlayer) fn.openChatForHoveredPlayer();
            break;
          }
          case "emojiSearch": {
            if (fn.hideChatSearchPalette) fn.hideChatSearchPalette();
            if (fn.openEmojiForHoveredTile) fn.openEmojiForHoveredTile();
            break;
          }
          case "boatOnePercent": {
            if (fn.triggerBoatOnePercentAttack) fn.triggerBoatOnePercentAttack();
            break;
          }
          case "lastOfeAlert": {
            if (!fn.focusLastOfeAlert || !fn.focusLastOfeAlert()) {
              fn.pushBottomRightLog("No recent OFE alert to jump to.");
              fn.playExtensionSound?.("actionBlocked");
            }
            break;
          }
          default:
            break;
        }
      },
      true,
    );
  };
})();
