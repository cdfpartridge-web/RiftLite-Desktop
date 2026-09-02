export interface ReplayMp4OverlayImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export interface ReplayMp4OverlayWindow {
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  webContents: {
    invalidate(): void;
    capturePage(
      rect: { x: number; y: number; width: number; height: number },
      options: { stayHidden: boolean }
    ): Promise<ReplayMp4OverlayImage>;
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
  const rect = { x: 0, y: 0, width, height };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      rasterWindow.webContents.invalidate();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      if (rasterWindow.isDestroyed()) {
        throw new Error("Replay export overlay renderer closed unexpectedly.");
      }
    }
    const image = await rasterWindow.webContents.capturePage(rect, { stayHidden: true });
    if (!image.isEmpty()) {
      const png = image.toPNG();
      if (png.byteLength > 0) {
        return png;
      }
    }
  }
  throw new Error("Replay export overlay could not be rendered.");
}
