export const TCGA_REPLAY_RAW_SCHEMA = "riftlite-tcga-raw-capture" as const;
export const TCGA_REPLAY_RAW_VERSION = 1 as const;

export type TcgaReplayJsonPrimitive = string | number | boolean | null;
export type TcgaReplayJsonValue = TcgaReplayJsonPrimitive | TcgaReplayJsonValue[] | TcgaReplayJsonObject;
export type TcgaReplayJsonObject = { [key: string]: TcgaReplayJsonValue };

export type TcgaReplayRawDirection = "in" | "out";

export interface TcgaReplayRawMessageV1 {
  seq: number;
  ts: number;
  dir: TcgaReplayRawDirection;
  firstTransportSequence: number;
  completedTransportSequence: number;
  parsed: TcgaReplayJsonObject & {
    type: string;
    gameId?: string;
    payload?: TcgaReplayJsonValue;
  };
}

export interface TcgaReplayRawCaptureV1 {
  schema: typeof TCGA_REPLAY_RAW_SCHEMA;
  version: typeof TCGA_REPLAY_RAW_VERSION;
  exportedAt: string;
  capture: {
    captureSessionId: string;
    identity: {
      perspectivePlayerId: string;
      firstSeenAt: number;
      lastSeenAt: number;
    };
    lifecycle: {
      channelKey: string;
      openedAt: number | null;
      closedAt: number | null;
      endedByLeaving: boolean;
    };
    source: {
      schema: "riftlite-tcga-research-session";
      version: 1;
      sha256: string;
    };
  };
  transport: {
    frames: number;
    decodedFrames: number;
    logicalMessages: number;
    chunkGroups: number;
    completeChunkGroups: number;
    incompleteChunkGroups: number;
    incompleteChunkCount: number;
    duplicateChunks: number;
    issueCounts: Record<string, number>;
  };
  messages: TcgaReplayRawMessageV1[];
}
