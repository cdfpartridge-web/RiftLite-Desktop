export interface ReplayMp4OverlayImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export interface ReplayMp4OverlayWindow {
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  webContents: {
    capturePage(rect: { x: number; y: number; width: number; height: number }): Promise<ReplayMp4OverlayImage>;
  };
}

export function replayMp4SvgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

export async function rasterizeReplayMp4Svg(
  rasterWindow: ReplayMp4OverlayWindow,
  svg: string,
  width: number,
  height: number
): Promise<Buffer> {
  if (rasterWindow.isDestroyed()) {
    throw new Error("Replay export overlay renderer closed unexpectedly.");
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8_192 ||
    height > 8_192
  ) {
    throw new Error("Replay export overlay dimensions are invalid.");
  }

  await rasterWindow.loadURL(replayMp4SvgDataUrl(svg));
  if (rasterWindow.isDestroyed()) {
    throw new Error("Replay export overlay renderer closed unexpectedly.");
  }
  const image = await rasterWindow.webContents.capturePage({ x: 0, y: 0, width, height });
  const png = image.toPNG();
  if (image.isEmpty() || png.byteLength <= 0) {
    throw new Error("Replay export overlay could not be rendered.");
  }
  return png;
}
