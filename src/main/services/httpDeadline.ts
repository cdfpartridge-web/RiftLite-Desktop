export type BufferedHttpResponse = Pick<Response, "ok" | "status" | "statusText" | "headers" | "url" | "redirected"> & {
  bodyText: string;
};

export class HttpStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HttpStatusError";
  }
}

/** Only transport failures and retryable HTTP responses may retry automatically. */
export function isTransientRequestError(error: unknown): boolean {
  const seen = new Set<Error>();
  while (error instanceof Error && !seen.has(error) && seen.size < 5) {
    seen.add(error);
    const response = error as Error & { status?: number; retryable?: boolean; code?: string };
    if (typeof response.status === "number") {
      return response.retryable !== false && (response.status === 408 || response.status === 429 || response.status >= 500);
    }
    if (error.name === "TimeoutError") return true;
    if (/fetch failed|network request failed|network-request-failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)/i.test(`${error.message} ${response.code ?? ""}`)) return true;
    error = error.cause;
  }
  return false;
}

/** Owns the connection until its complete body has been read or cancelled. */
export async function fetchBufferedResponse(
  input: string | URL,
  init: RequestInit,
  options: { timeoutMs: number; bodyTimeoutMs?: number; label: string }
): Promise<BufferedHttpResponse> {
  const controller = new AbortController();
  const upstream = init.signal;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAborted!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAborted = reject; });
  // Attach before any synchronous cancellation; the race below also observes it.
  void aborted.catch(() => undefined);
  const cancelReader = () => { void reader?.cancel(controller.signal.reason).catch(() => undefined); };
  const onAbort = () => {
    cancelReader();
    rejectAborted(controller.signal.reason ?? new DOMException("Request aborted", "AbortError"));
  };
  const onUpstreamAbort = () => controller.abort(upstream?.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  upstream?.addEventListener("abort", onUpstreamAbort, { once: true });
  const expiresAt = Date.now() + options.timeoutMs;
  const armDeadline = (timeoutMs: number, label: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
      error.name = "TimeoutError";
      controller.abort(error);
    }, timeoutMs);
    timer.unref?.();
  };
  try {
    if (upstream?.aborted) onUpstreamAbort();
    controller.signal.throwIfAborted();
    armDeadline(options.timeoutMs, options.label);
    const request = fetch(input, { ...init, signal: controller.signal }).then((response) => {
      if (controller.signal.aborted) {
        void response.body?.cancel(controller.signal.reason).catch(() => undefined);
        controller.signal.throwIfAborted();
      }
      return response;
    });
    const response = await Promise.race([request, aborted]);
    armDeadline(Math.max(0, Math.min(expiresAt - Date.now(), options.bodyTimeoutMs ?? options.timeoutMs)), `${options.label} response`);
    reader = response.body?.getReader();
    const readBody = async () => {
      if (!reader) return "";
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return text + decoder.decode();
        text += decoder.decode(chunk.value, { stream: true });
      }
    };
    const bodyText = await Promise.race([readBody(), aborted]);
    controller.signal.throwIfAborted();
    return {
      ok: response.ok, status: response.status, statusText: response.statusText,
      headers: response.headers, url: response.url, redirected: response.redirected, bodyText
    };
  } catch (error) {
    controller.abort(error);
    cancelReader();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    upstream?.removeEventListener("abort", onUpstreamAbort);
    controller.signal.removeEventListener("abort", onAbort);
    reader?.releaseLock();
  }
}
