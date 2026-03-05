"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function playerColorHex(player) {
    try {
      if (player && typeof player.territoryColor === "function") {
        const color = player.territoryColor();
        const hex = color && typeof color.toHex === "function" ? color.toHex() : "";
        if (/^#[0-9a-fA-F]{6}$/.test(hex) || /^#[0-9a-fA-F]{3}$/.test(hex)) {
          return hex;
        }
      }
    } catch (_) {}
    return "#93c5fd";
  }

  function playerNameHtml(player) {
    const smallID = player && typeof player.smallID === "function" ? player.smallID() : "?";
    const name = escapeHtml(fn.getPlayerDisplayName(player) || `#${smallID}`);
    const color = playerColorHex(player);
    return `<span style="color:${color};font-weight:700;text-decoration:underline;">${name}</span>`;
  }

  async function collectNeighborPlayers(game, myPlayer) {
    if (!myPlayer || typeof myPlayer.borderTiles !== "function") return [];
    if (typeof game.neighbors !== "function" || typeof game.ownerID !== "function") return [];

    let borderData = null;
    try {
      borderData = await myPlayer.borderTiles();
    } catch (_) {
      return [];
    }

    const borderTiles =
      borderData && borderData.borderTiles && Symbol.iterator in Object(borderData.borderTiles)
        ? borderData.borderTiles
        : [];

    const mySmallID = typeof myPlayer.smallID === "function" ? myPlayer.smallID() : null;
    const neighborIds = new Set();

    for (const tile of borderTiles) {
      const adj = game.neighbors(tile);
      for (const ref of adj) {
        if (!game.hasOwner || !game.hasOwner(ref)) continue;
        const ownerSmallID = Number(game.ownerID(ref));
        if (!Number.isFinite(ownerSmallID) || ownerSmallID <= 0) continue;
        if (mySmallID != null && ownerSmallID === mySmallID) continue;
        neighborIds.add(ownerSmallID);
      }
    }

    const players = [];
    for (const smallID of neighborIds) {
      let player = null;
      try {
        player = game.playerBySmallID(smallID);
      } catch (_) {
        player = null;
      }
      if (!player || typeof player.isPlayer !== "function" || !player.isPlayer()) continue;
      if (typeof player.isAlive === "function" && !player.isAlive()) continue;
      players.push(player);
    }

    return players;
  }

  function notifyNeighborChange(player, kind) {
    if (!fn.pushBottomRightEvent) return;
    const smallID = typeof player.smallID === "function" ? player.smallID() : null;
    const colored = playerNameHtml(player);
    const description =
      kind === "sleeping"
        ? `${colored} is sleeping`
        : `${colored} betrayed and is now traitor`;

    fn.pushBottomRightEvent({
      description,
      type: constants.MESSAGE_TYPE.CHAT,
      unsafeDescription: true,
      focusID: smallID != null ? smallID : undefined,
      duration: 1200,
    });
  }

  async function scanNeighborStatuses() {
    if (state.neighborWatchBusy) return;
    state.neighborWatchBusy = true;

    try {
      const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
      if (!game || typeof game.myPlayer !== "function") {
        state.neighborStatusById = {};
        return;
      }
      if (typeof game.inSpawnPhase === "function" && game.inSpawnPhase()) {
        state.neighborStatusById = {};
        return;
      }

      const myPlayer = game.myPlayer();
      if (!myPlayer || (typeof myPlayer.isAlive === "function" && !myPlayer.isAlive())) {
        state.neighborStatusById = {};
        return;
      }

      const neighbors = await collectNeighborPlayers(game, myPlayer);
      const nextStatusById = {};

      for (const player of neighbors) {
        const smallID = typeof player.smallID === "function" ? player.smallID() : null;
        if (smallID == null) continue;

        const sleeping =
          typeof player.isDisconnected === "function" ? Boolean(player.isDisconnected()) : false;
        const betrayed = typeof player.isTraitor === "function" ? Boolean(player.isTraitor()) : false;

        const prev = state.neighborStatusById[smallID];
        if (prev) {
          if (!prev.sleeping && sleeping) {
            notifyNeighborChange(player, "sleeping");
          }
          if (!prev.betrayed && betrayed) {
            notifyNeighborChange(player, "betrayed");
          }
        }

        nextStatusById[smallID] = { sleeping, betrayed };
      }

      state.neighborStatusById = nextStatusById;
    } finally {
      state.neighborWatchBusy = false;
    }
  }

  fn.initNeighborWatch = () => {
    if (state.neighborWatchInterval) return;
    state.neighborWatchInterval = setInterval(() => {
      void scanNeighborStatuses();
    }, 1000);
    void scanNeighborStatuses();
  };
})();
