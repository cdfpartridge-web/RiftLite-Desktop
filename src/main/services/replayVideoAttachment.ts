import type { ReplayRecord, ReplayVideoAsset } from "../../shared/types.js";
import type { RiftLiteStore } from "./store.js";

type ReplayVideoAttachmentStore = Pick<RiftLiteStore, "getReplays" | "updateReplay">;

export type ReplayVideoAttachmentResult = {
  replay: ReplayRecord | null;
  attached: boolean;
};

export type ReplayVideoAttachmentOptions = {
  attempts?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
};

function defaultWait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function attachReplayVideoToStore(
  store: ReplayVideoAttachmentStore,
  matchId: string,
  video: ReplayVideoAsset,
  options: ReplayVideoAttachmentOptions = {}
): Promise<ReplayVideoAttachmentResult> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 40));
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? 125));
  const wait = options.wait ?? defaultWait;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const replay = (await store.getReplays()).find((item) => item.matchId === matchId);
    if (replay) {
      let attached = false;
      const saved = await store.updateReplay(replay.id, (current) => {
        if (
          current.video?.durationMs &&
          video.durationMs &&
          current.video.durationMs > video.durationMs + 10_000
        ) {
          return current;
        }
        attached = true;
        return { ...current, video };
      });
      if (saved) {
        return { replay: saved, attached };
      }
    }
    if (attempt + 1 < attempts) {
      await wait(retryDelayMs);
    }
  }

  return { replay: null, attached: false };
}
