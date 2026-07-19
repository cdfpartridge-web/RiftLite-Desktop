const ATLAS_ORIGIN = "https://play.riftatlas.com";

const LOW_DPI_CARD_RENDERING_CSS = `
@media (max-resolution: 1.05dppx) {
  .gb-board [data-card-id] img {
    image-rendering: -webkit-optimize-contrast;
  }
}
`.trim();

export function atlasCardRenderingCssForUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin === ATLAS_ORIGIN ? LOW_DPI_CARD_RENDERING_CSS : "";
  } catch {
    return "";
  }
}
