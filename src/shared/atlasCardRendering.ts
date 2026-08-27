const ATLAS_ORIGIN = "https://play.riftatlas.com";

const ATLAS_EMBEDDED_COMPATIBILITY_CSS = `
@media (max-resolution: 1.05dppx) {
  .gb-board [data-card-id] img {
    image-rendering: -webkit-optimize-contrast;
  }
}

/*
 * Atlas places a named inline-size query container below a display:contents
 * wrapper. Chromium 142 (Electron 39) can collapse that flex column's header
 * and lobby grid to 0x0. Materialize the wrapper and keep the same named query
 * one level higher so Atlas's responsive rules still apply. Both rules are
 * required: relocating prevents the collapse, while the wrapper lets a late
 * injection recover a tree that Chromium has already collapsed.
 */
.hub-theme > .contents:has(.lobby-content-column) {
  display: block !important;
  min-height: 100dvh !important;
}

.hub-theme .lobby-content-column {
  container-type: normal !important;
  container-name: none !important;
}

.hub-theme :has(> .lobby-content-column) {
  container: lobby-content / inline-size !important;
}
`.trim();

export function atlasCardRenderingCssForUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin === ATLAS_ORIGIN ? ATLAS_EMBEDDED_COMPATIBILITY_CSS : "";
  } catch {
    return "";
  }
}
