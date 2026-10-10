const CLOCK_PREFIX = /^\d{1,2}:\d{2}(?::\d{2})?\s*/;
const LOG_CONTAINER = "[role='log'], [class~='log' i], [class*='game-log' i], [class*='gameLog' i], [class*='match-log' i], [class*='matchLog' i]";

/** Exclude page copy and log-window placeholders, including in older captures. */
export function isAtlasGameLogText(value: string): boolean {
  const text = value.replace(/[\u21ba\u21bb]/g, "").replace(/\s+/g, " ").trim().replace(CLOCK_PREFIX, "");
  return Boolean(text)
    && !/^earlier activity\b/i.test(text)
    && !/^play riftbound online\b/i.test(text)
    && !/\bat\s+\d{1,2}:\d{2}\s*:/i.test(text);
}

/** Atlas sometimes uses plain lists: require a clock/turn label outside a log. */
export function selectAtlasLogRows(root: Pick<Document, "querySelectorAll">): Element[] {
  return Array.from(root.querySelectorAll("ul li, [role='log'] li, [class*='log' i] li, [data-log-id]"))
    .filter((row) => {
      // A list-item wrapper must not repeat all of its nested action rows.
      if (row.querySelector("li, [data-log-id]")) return false;
      const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!isAtlasGameLogText(text)) return false;
      return Boolean(row.closest(LOG_CONTAINER) || row.getAttribute("data-log-id")
        || CLOCK_PREFIX.test(text) || /^turn\s+\d+\b/i.test(text));
    });
}
