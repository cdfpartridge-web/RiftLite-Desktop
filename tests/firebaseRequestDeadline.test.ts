import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import { GameplayMaintenanceScheduler } from "../src/main/services/gameplayMaintenanceScheduler";
import { AccountCloudSyncQueue } from "../src/main/services/accountCloudSyncQueue";

type RequestService = {
  firestoreRequest(path: string, token: string, options: { method: "GET" }): Promise<unknown>;
  firestoreRunQuery(path: string, token: string, query: Record<string, unknown>): Promise<unknown>;
};
const service = () => new FirebaseSyncService({} as never, () => null) as unknown as RequestService;
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Firestore maintenance deadlines", () => {
  it("releases the shared scheduler after stalled cloud headers and retries the retained backup", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(new Response('{}'));
    const api = service();
    const run = vi.fn(async () => { await api.firestoreRequest("accountSync/test/manifest/current", "test-token", { method: "GET" }); });
    const errors = vi.fn();
    const scheduler = new GameplayMaintenanceScheduler({ ready: () => true });
    const queue = new AccountCloudSyncQueue(run, errors, 20_000, () => scheduler.request("cloud"));
    const postgame = vi.fn(async () => {});
    scheduler.register("cloud", () => queue.flush()); scheduler.register("postgame", postgame);
    queue.queue("Last edit");
    await vi.advanceTimersByTimeAsync(20_000);
    scheduler.request("postgame");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(postgame).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(postgame).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledOnce();
    scheduler.dispose();
  });

  it.each(["document", "query"])("aborts and releases a stalled %s response body", async kind => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream));
    const api = service();
    const request = kind === "document" ? api.firestoreRequest("test/document", "test-token", { method: "GET" }) : api.firestoreRunQuery("", "test-token", {});
    const failure = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(20_000); await failure;
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
