"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  ns.constants.SHORTCUT_PANEL_VISIBLE_KEY = "ofe.shortcuts.panel.visible";

  // Values from OpenFront MessageType enum.
  ns.constants.MESSAGE_TYPE = {
    ALLIANCE_REQUEST: 15,
    CHAT: 23,
  };

  ns.constants.EXT_SHORTCUTS = {
    chatSearch: {
      action: "chatSearch",
      label: "Chat Search",
      desc: "Hovered player chat + search",
      defaultCode: "KeyZ",
    },
    emojiSearch: {
      action: "emojiSearch",
      label: "Emoji Search",
      desc: "Emoji selector + search",
      defaultCode: "KeyX",
    },
    allianceRequest: {
      action: "allianceRequest",
      label: "Alliance Request",
      desc: "Send alliance request to hovered player",
      defaultCode: "KeyV",
    },
    boatOnePercent: {
      action: "boatOnePercent",
      label: "Boat 1%",
      desc: "Boat attack with fixed 1% troops",
      defaultCode: "KeyN",
    },
    territoryCycle: {
      action: "territoryCycle",
      label: "Cycle Territories",
      desc: "Jump camera between disconnected territories",
      defaultCode: "KeyL",
    },
  };

  ns.constants.EMOJI_KEYWORDS = {
    "😀": ["grin", "happy", "smile"],
    "😊": ["smile", "blush", "nice"],
    "🥰": ["love", "hearts", "adorable"],
    "😇": ["angel", "innocent", "halo"],
    "😎": ["cool", "sunglasses", "swag"],
    "😞": ["sad", "down", "disappointed"],
    "🥺": ["please", "beg", "puppy"],
    "😭": ["cry", "tears", "sob"],
    "😱": ["shock", "scream", "scared"],
    "😡": ["angry", "mad", "rage"],
    "😈": ["devil", "evil"],
    "🤡": ["clown", "joke"],
    "🥱": ["yawn", "bored", "sleepy"],
    "🫡": ["salute", "respect", "sir"],
    "🖕": ["middle", "finger", "rude"],
    "👋": ["wave", "hello", "bye"],
    "👏": ["clap", "applause", "gg"],
    "✋": ["stop", "hand", "halt"],
    "🙏": ["pray", "thanks", "please"],
    "💪": ["strong", "flex", "power"],
    "👍": ["thumbs", "up", "yes", "good"],
    "👎": ["thumbs", "down", "no", "bad"],
    "🫴": ["offer", "give", "hand"],
    "🤌": ["pinch", "what", "italian"],
    "🤦‍♂️": ["facepalm", "fail", "disbelief"],
    "🤝": ["handshake", "deal", "ally"],
    "🆘": ["help", "sos", "rescue"],
    "🕊️": ["peace", "dove", "calm"],
    "🏳️": ["white", "flag", "surrender"],
    "⏳": ["wait", "time", "soon"],
    "🔥": ["fire", "hot", "burn"],
    "💥": ["boom", "explode", "impact"],
    "💀": ["skull", "dead", "rip"],
    "☢️": ["nuke", "nuclear", "radiation"],
    "⚠️": ["warning", "alert", "danger"],
    "↖️": ["northwest", "up", "left"],
    "⬆️": ["up", "north", "top"],
    "↗️": ["northeast", "up", "right"],
    "👑": ["crown", "king", "winner"],
    "🥇": ["gold", "first", "1st"],
    "⬅️": ["left", "west", "back"],
    "🎯": ["target", "aim", "focus"],
    "➡️": ["right", "east", "forward"],
    "🥈": ["silver", "second", "2nd"],
    "🥉": ["bronze", "third", "3rd"],
    "↙️": ["southwest", "down", "left"],
    "⬇️": ["down", "south", "bottom"],
    "↘️": ["southeast", "down", "right"],
    "❤️": ["heart", "love", "care"],
    "💔": ["broken", "heart", "sad"],
    "💰": ["money", "gold", "cash"],
    "⚓": ["anchor", "navy", "port"],
    "⛵": ["boat", "sail", "ship"],
    "🏡": ["home", "house", "base"],
    "🛡️": ["shield", "defense", "protect"],
    "🏭": ["factory", "industry", "build"],
    "🚂": ["train", "rail", "locomotive"],
    "❓": ["question", "what", "confused"],
    "🐔": ["chicken", "coward", "bird"],
    "🐀": ["rat", "sneaky", "rodent"],
  };
})();
