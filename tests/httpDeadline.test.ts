import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBufferedResponse, HttpStatusError, isTransientRequestError } from "../src/main/services/httpDeadline";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("complete HTTP request deadlines", () => {
  it("reads split UTF-8 correctly, preserves metadata and releases resources", async () => {
    vi.useFakeTimers();
    const bytes = new TextEncoder().encode('{"name":"Kai’Sa"}');
    const stream = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(bytes.slice(0, 13)); c.enqueue(bytes.slice(13)); c.close();
    } });
    const response = new Response(stream, { status: 201, headers: { "retry-after": "3" } });
    const upstream = new AbortController();
    const remove = vi.spyOn(upstream.signal, "removeEventListener");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    const result = await fetchBufferedResponse("https://example.test", { signal: upstream.signal }, { timeoutMs: 1000, label: "Upload" });
    expect(result.bodyText).toBe('{"name":"Kai’Sa"}');
    expect(result.status).toBe(201);
    expect(result.headers.get("retry-after")).toBe("3");
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    upstream.abort();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });

  it("aborts a stalled request even if fetch never rejects on its own", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const request = fetchBufferedResponse("https://example.test", {}, { timeoutMs: 1000, label: "Upload" });
    const failure = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled body and aborts the network when its body deadline expires", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream));
    const request = fetchBufferedResponse("https://example.test", {}, { timeoutMs: 60_000, bodyTimeoutMs: 30_000, label: "Upload" });
    const failure = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(stream.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the total deadline through delayed headers and body reads", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
      return new Response(new ReadableStream({ cancel }));
    });
    const request = fetchBufferedResponse("https://example.test", {}, { timeoutMs: 1000, label: "Firestore" });
    const failure = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1000);
    await failure;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("propagates upstream cancellation after headers and before a body deadline", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(stream));
    const upstream = new AbortController();
    const request = fetchBufferedResponse("https://example.test", { signal: upstream.signal }, { timeoutMs: 1000, label: "Upload" });
    const failure = expect(request).rejects.toMatchObject({ name: "AbortError" });
    while (!stream.locked) await Promise.resolve();
    upstream.abort();
    await failure;
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it("does not start an already-cancelled request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const upstream = new AbortController(); upstream.abort();
    await expect(fetchBufferedResponse("https://example.test", { signal: upstream.signal }, { timeoutMs: 1000, label: "Upload" })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels a late response if a fetch implementation ignores abort", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const request = fetchBufferedResponse("https://example.test", {}, { timeoutMs: 1000, label: "Upload" });
    const failure = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(1000); await failure;
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("transient request classification", () => {
  it("retries transport/timeouts/temporary HTTP failures only", () => {
    expect(isTransientRequestError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientRequestError(new Error("terminated", { cause: Object.assign(new Error("socket closed"), { code: "UND_ERR_SOCKET" }) }))).toBe(true);
    expect(isTransientRequestError(Object.assign(new Error("deadline"), { name: "TimeoutError" }))).toBe(true);
    for (const status of [408, 429, 500, 503]) expect(isTransientRequestError(new HttpStatusError("HTTP error", status))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 412]) expect(isTransientRequestError(new HttpStatusError("HTTP error", status))).toBe(false);
    expect(isTransientRequestError(Object.assign(new Error("terminal server response"), { status: 503, retryable: false }))).toBe(false);
    expect(isTransientRequestError(new Error("Linked account changed"))).toBe(false);
    expect(isTransientRequestError(new DOMException("Cancelled", "AbortError"))).toBe(false);
    const cycle = new Error("unknown"); cycle.cause = cycle;
    expect(isTransientRequestError(cycle)).toBe(false);
  });
});
