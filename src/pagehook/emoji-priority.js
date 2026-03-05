"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { constants, fn } = ns;

  function getCompactQuery(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return "";
    return tokens.join("");
  }

  function getCompactKeywordScore(emoji, compactQuery) {
    if (!compactQuery) return 0;

    const keywords = constants.EMOJI_KEYWORDS[emoji] || [];
    let best = 0;

    for (const rawKeyword of keywords) {
      const keyword = String(rawKeyword || "").toLowerCase();
      if (!keyword) continue;

      if (keyword === compactQuery) {
        best = Math.max(best, 300);
        continue;
      }
      if (keyword.startsWith(compactQuery)) {
        best = Math.max(best, 220);
        continue;
      }
      if (keyword.includes(compactQuery)) {
        best = Math.max(best, 120);
      }
    }

    return best;
  }

  function getPriorityBoost(emoji) {
    const priorities = constants.EMOJI_SEARCH_PRIORITY || {};
    const value = Number(priorities[emoji] || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function getEmojiScore(emoji, tokens) {
    const compactQuery = getCompactQuery(tokens);
    if (!compactQuery) return 0;
    return getCompactKeywordScore(emoji, compactQuery) + getPriorityBoost(emoji);
  }

  fn.rankEmojiMatches = (matches, tokens) => {
    const queryTokens = Array.isArray(tokens) ? tokens : [];
    if (!queryTokens.length) {
      return matches.slice().sort((a, b) => a.index - b.index);
    }

    return matches
      .map((match) => ({
        ...match,
        score: getEmojiScore(match.emoji, queryTokens),
      }))
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.index - b.index;
      });
  };
})();
