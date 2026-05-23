import { createConnection, type Socket } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DISCORD_CLIENT_ID = "1507035519916179496";
const RPC_VERSION = 1;
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const CONNECT_TIMEOUT_MS = 750;
const COMMAND_TIMEOUT_MS = 12000;

export interface DiscordVoiceJoinResult {
  ok: boolean;
  attempted: boolean;
  message: string;
  usedFallback: boolean;
}

interface DiscordRpcTokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface RpcPayload {
  cmd?: string;
  evt?: string;
  nonce?: string;
  args?: Record<string, unknown>;
  data?: Record<string, unknown> | null;
  code?: number;
  message?: string;
}

class DiscordRpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
  }
}

class DiscordIpcClient {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending = new Map<string, {
    resolve: (payload: RpcPayload) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  async connect(): Promise<void> {
    const paths = discordIpcPaths();
    let lastError: unknown = null;
    for (const path of paths) {
      try {
        await this.connectPath(path);
        await this.handshake();
        return;
      } catch (error) {
        lastError = error;
        this.close();
      }
    }
    throw new Error(lastError instanceof Error ? lastError.message : "Discord is not running or local RPC is unavailable.");
  }

  command(cmd: string, args: Record<string, unknown> = {}): Promise<RpcPayload> {
    const nonce = randomUUID();
    const payload = { cmd, args, nonce };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Discord RPC timed out while running ${cmd}.`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(nonce, { resolve, reject, timer });
      this.write(OP_FRAME, payload).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(nonce);
        reject(error);
      });
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Discord RPC connection closed."));
    }
    this.pending.clear();
    this.socket?.destroy();
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  private connectPath(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(path);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Could not connect to Discord IPC at ${path}.`));
      }, CONNECT_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        socket.on("data", (chunk) => this.onData(chunk));
        socket.on("error", (error) => this.rejectAll(error));
        socket.on("close", () => this.rejectAll(new Error("Discord RPC connection closed.")));
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  private async handshake(): Promise<void> {
    await this.write(OP_HANDSHAKE, { v: RPC_VERSION, client_id: DISCORD_CLIENT_ID });
    await waitForReady(this);
  }

  private async write(opcode: number, payload: Record<string, unknown>): Promise<void> {
    if (!this.socket) {
      throw new Error("Discord RPC is not connected.");
    }
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode, 0);
    header.writeUInt32LE(body.length, 4);
    await new Promise<void>((resolve, reject) => {
      this.socket?.write(Buffer.concat([header, body]), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + length) return;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      if (opcode !== OP_FRAME) continue;
      let payload: RpcPayload;
      try {
        payload = JSON.parse(body.toString("utf8")) as RpcPayload;
      } catch {
        continue;
      }
      const pending = payload.nonce ? this.pending.get(payload.nonce) : null;
      if (!pending) continue;
      clearTimeout(pending.timer);
      this.pending.delete(payload.nonce ?? "");
      if (payload.evt === "ERROR") {
        pending.reject(new DiscordRpcError(payload.message || "Discord RPC returned an error.", payload.code));
      } else {
        pending.resolve(payload);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function joinDiscordVoiceChannel(options: {
  channelId: string;
  tokenCachePath: string;
  exchangeCode: (code: string) => Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }>;
  refreshToken: (refreshToken: string) => Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }>;
  confirmMoveFromCurrentVoice: () => Promise<boolean>;
}): Promise<DiscordVoiceJoinResult> {
  const client = new DiscordIpcClient();
  try {
    await client.connect();
    await authenticate(client, options);
    try {
      await selectVoiceChannel(client, options.channelId, false);
    } catch (error) {
      if (error instanceof DiscordRpcError && error.code === 5003) {
        const approved = await options.confirmMoveFromCurrentVoice();
        if (!approved) {
          return {
            ok: false,
            attempted: true,
            usedFallback: false,
            message: "Discord says you are already in another voice channel."
          };
        }
        await selectVoiceChannel(client, options.channelId, true);
      } else {
        throw error;
      }
    }
    return {
      ok: true,
      attempted: true,
      usedFallback: false,
      message: "Joined Discord voice channel."
    };
  } finally {
    client.close();
  }
}

async function authenticate(client: DiscordIpcClient, options: {
  tokenCachePath: string;
  exchangeCode: (code: string) => Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }>;
  refreshToken: (refreshToken: string) => Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }>;
}): Promise<void> {
  const cached = await readTokenCache(options.tokenCachePath);
  if (cached?.accessToken && cached.expiresAt > Date.now() + 60_000) {
    try {
      await client.command("AUTHENTICATE", { access_token: cached.accessToken });
      return;
    } catch {
      // Refresh or reauthorize below.
    }
  }

  if (cached?.refreshToken) {
    try {
      const refreshed = await options.refreshToken(cached.refreshToken);
      await writeTokenCache(options.tokenCachePath, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || cached.refreshToken,
        expiresAt: refreshed.expiresAt
      });
      await client.command("AUTHENTICATE", { access_token: refreshed.accessToken });
      return;
    } catch {
      // Reauthorize below.
    }
  }

  const authorize = await client.command("AUTHORIZE", {
    client_id: DISCORD_CLIENT_ID,
    scopes: ["rpc", "identify"]
  });
  const code = typeof authorize.data?.code === "string" ? authorize.data.code : "";
  if (!code) {
    throw new Error("Discord did not return an authorization code.");
  }
  const exchanged = await options.exchangeCode(code);
  await writeTokenCache(options.tokenCachePath, {
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken || "",
    expiresAt: exchanged.expiresAt
  });
  await client.command("AUTHENTICATE", { access_token: exchanged.accessToken });
}

async function selectVoiceChannel(client: DiscordIpcClient, channelId: string, force: boolean): Promise<void> {
  await client.command("SELECT_VOICE_CHANNEL", {
    channel_id: channelId,
    timeout: 10000,
    navigate: true,
    ...(force ? { force: true } : {})
  });
}

function waitForReady(client: DiscordIpcClient): Promise<void> {
  return client.command("GET_SELECTED_VOICE_CHANNEL").then(
    () => undefined,
    (error) => {
      if (error instanceof DiscordRpcError && error.code === 4006) return undefined;
      throw error;
    }
  );
}

function discordIpcPaths(): string[] {
  const paths: string[] = [];
  if (process.platform === "win32") {
    for (let index = 0; index < 10; index += 1) {
      paths.push(`\\\\?\\pipe\\discord-ipc-${index}`);
    }
    return paths;
  }
  const prefixes = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    tmpdir(),
    "/tmp"
  ].filter(Boolean) as string[];
  for (const prefix of prefixes) {
    for (let index = 0; index < 10; index += 1) {
      paths.push(join(prefix, `discord-ipc-${index}`));
    }
  }
  return paths;
}

async function readTokenCache(filePath: string): Promise<DiscordRpcTokenCache | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<DiscordRpcTokenCache>;
    if (typeof parsed.accessToken === "string" && typeof parsed.expiresAt === "number") {
      return {
        accessToken: parsed.accessToken,
        refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
        expiresAt: parsed.expiresAt
      };
    }
  } catch {
    // Missing or corrupt cache simply reauthorizes.
  }
  return null;
}

async function writeTokenCache(filePath: string, token: DiscordRpcTokenCache): Promise<void> {
  await writeFile(filePath, JSON.stringify(token), "utf8").catch(() => undefined);
}
