import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Exercise the actual emitted Electron script, not a different test-only query.
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/main/services/atlasHistoryQuery.ts", import.meta.url), "utf8"),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;
const exports: { atlasHistoryQueryScript?: (path: string, args: Record<string, unknown>) => string } = {};
vm.runInNewContext(compiled, { exports });
function environment(aud = "convex") {
  const token = "header." + Buffer.from(JSON.stringify({ aud })).toString("base64url") + ".signature";
  const session = { id: "session", getToken: vi.fn(async () => token) };
  const Clerk = { session };
  const fetch = vi.fn(async () => ({
    ok: true,
    headers: new Headers(),
    text: async () => JSON.stringify({ status: "success", value: { page: [] } }),
  }));
  return {
    token,
    session,
    Clerk,
    fetch,
    context: {
      location: { origin: "https://play.riftatlas.com" },
      window: { Clerk },
      fetch,
      atob,
      AbortController,
      setTimeout,
      clearTimeout,
    },
  };
}
describe("Atlas main-world history query", () => {
  it("uses only Atlas's read endpoint and never returns the bearer token", async () => {
    const h = environment();
    const result = await vm.runInNewContext(
      exports.atlasHistoryQueryScript!("gameHistory:list", {
        paginationOpts: { numItems: 20, cursor: null },
      }),
      h.context,
    );
    expect(result).toEqual({ sessionId: "session", value: { page: [] } });
    expect(JSON.stringify(result)).not.toContain(h.token);
    const [url, options] = h.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://wary-sturgeon-712.convex.cloud/api/query");
    expect(JSON.parse(String(options.body)).path).toBe("gameHistory:list");
    expect(options.redirect).toBe("error");
  });
  it("falls back to the Clerk Convex template when the session JWT has another audience", async () => {
    const h = environment("other");
    await vm.runInNewContext(
      exports.atlasHistoryQueryScript!("gameHistory:decks", { gameId: "history-1" }),
      h.context,
    );
    expect(h.session.getToken).toHaveBeenLastCalledWith({ template: "convex" });
  });
  it("blocks unsupported methods/origins and detects a switched session before returning data", async () => {
    const h = environment();
    await expect(
      vm.runInNewContext(exports.atlasHistoryQueryScript!("gameHistory:delete", {}), h.context),
    ).rejects.toThrow("Open Atlas");
    h.context.location.origin = "https://example.com";
    await expect(
      vm.runInNewContext(exports.atlasHistoryQueryScript!("gameHistory:list", {}), h.context),
    ).rejects.toThrow("Open Atlas");
    expect(h.fetch).not.toHaveBeenCalled();
    h.context.location.origin = "https://play.riftatlas.com";
    h.fetch.mockImplementationOnce(async () => {
      h.Clerk.session = { ...h.session, id: "different" };
      return {
        ok: true,
        headers: new Headers(),
        text: async () => JSON.stringify({ status: "success", value: [] }),
      };
    });
    await expect(
      vm.runInNewContext(exports.atlasHistoryQueryScript!("gameHistory:list", {}), h.context),
    ).rejects.toThrow("could not be read");
  });
});
