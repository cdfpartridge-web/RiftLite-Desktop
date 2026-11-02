import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import type { WebReplayUploadDiagnostics } from "../src/shared/types";

const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!found) throw new Error("Could not find diagnostics refresh boundary in App.tsx");
  return found;
}

function javascript(node: ts.Node): string {
  return ts.transpileModule(`const callback = ${node.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
}

const refreshNode = findNode((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "refreshWebReplayDiagnostics") as ts.VariableDeclaration;
const refreshCallback = (refreshNode.initializer as ts.CallExpression).arguments[0];
const accountEffect = findNode((node) => ts.isCallExpression(node)
  && node.expression.getText(ast) === "useEffect"
  && node.arguments[0]?.getText(ast).includes("communityAccountUidRef.current === accountUid") === true) as ts.CallExpression;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

// Execute the actual refresh callback and account-change effect with a fake IPC
// boundary. No Electron process or real account/profile is opened by these tests.
function harness() {
  const state = { diagnostics: null as WebReplayUploadDiagnostics | null, error: "", refreshing: false };
  const settingsRef = { current: { accountUid: "account-a" } };
  const requestRef = { current: null as Promise<WebReplayUploadDiagnostics | null> | null };
  const automaticRef = { current: false };
  const requests: { automatic: boolean; result: ReturnType<typeof deferred<WebReplayUploadDiagnostics | null>> }[] = [];
  const invoke = vi.fn((automatic: boolean) => {
    const result = deferred<WebReplayUploadDiagnostics | null>();
    requests.push({ automatic, result });
    return result.promise;
  });
  const environment = {
    window: { riftlite: { getWebReplayUploadDiagnostics: invoke } },
    settingsRef,
    webReplayDiagnosticsRequestRef: requestRef,
    webReplayDiagnosticsRequestAutomaticRef: automaticRef,
    setWebReplayDiagnostics: (value: WebReplayUploadDiagnostics | null) => { state.diagnostics = value; },
    setWebReplayDiagnosticsError: (value: string) => { state.error = value; },
    setWebReplayDiagnosticsRefreshing: (value: boolean) => { state.refreshing = value; },
    communityAccountUidRef: { current: "account-a" },
    communityLoadedRef: { current: true },
    communityMatchesLoadedForTrackerRef: { current: true },
    setGameDetailsTarget: vi.fn(),
    setHubMatches: vi.fn(),
    setTeamMatches: vi.fn()
  };
  const refreshJs = javascript(refreshCallback).replace("const callback =", "const refreshWebReplayDiagnostics =");
  const refresh = new Function(...Object.keys(environment), `${refreshJs} return refreshWebReplayDiagnostics;`)(...Object.values(environment)) as
    (afterCurrent?: boolean, automatic?: boolean) => Promise<WebReplayUploadDiagnostics | null>;
  const applyAccountChange = new Function(...Object.keys(environment), "settings", `${javascript(accountEffect.arguments[0])} callback();`);
  const changeAccount = (accountUid: string) => {
    settingsRef.current = { accountUid };
    applyAccountChange(...Object.values(environment), settingsRef.current);
  };
  return { state, requests, invoke, requestRef, settingsRef, refresh, changeAccount };
}

const diagnostics = (label: string) => ({ label }) as unknown as WebReplayUploadDiagnostics;

describe("Web Replay diagnostics refresh", () => {
  it("coalesces automatic event bursts and preserves the valid view on deferred null", async () => {
    const h = harness();
    const previous = diagnostics("previous");
    h.state.diagnostics = previous;
    h.state.error = "Previous read failed";
    const pending = h.refresh(false, true);
    for (let index = 0; index < 60; index++) expect(h.refresh(false, true)).toBe(pending);
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith(true);
    h.requests[0].result.resolve(null);
    expect(await pending).toBeNull();
    expect(h.state).toEqual({ diagnostics: previous, error: "Previous read failed", refreshing: false });
  });

  it("uses a fresh manual read after an in-flight automatic read and coalesces repeated clicks", async () => {
    const h = harness();
    const automatic = h.refresh(false, true);
    const firstClick = h.refresh();
    const secondClick = h.refresh();
    h.requests[0].result.resolve(null);
    await automatic;
    expect(h.requests.map((request) => request.automatic)).toEqual([true, false]);
    const fresh = diagnostics("manual");
    h.requests[1].result.resolve(fresh);
    expect(await firstClick).toBe(fresh);
    expect(await secondClick).toBe(fresh);
    expect(h.state.diagnostics).toBe(fresh);
    expect(h.state.refreshing).toBe(false);
  });

  it("preserves automatic intent when afterCurrent queues a trailing read", async () => {
    const h = harness();
    const first = h.refresh();
    const trailing = h.refresh(true, true);
    h.requests[0].result.resolve(diagnostics("first"));
    await first;
    expect(h.requests.map((request) => request.automatic)).toEqual([false, true]);
    h.requests[1].result.resolve(null);
    await trailing;
    expect(h.state.diagnostics).toEqual(diagnostics("first"));
  });

  it("clears the previous account and ignores its result without clearing the new pending read", async () => {
    const h = harness();
    h.state.diagnostics = diagnostics("account-a");
    h.state.error = "Old error";
    const old = h.refresh();
    h.changeAccount("account-b");
    expect(h.state).toEqual({ diagnostics: null, error: "", refreshing: false });
    const current = h.refresh(false, true);
    h.requests[0].result.resolve(diagnostics("obsolete"));
    expect(await old).toBeNull();
    expect(h.state).toEqual({ diagnostics: null, error: "", refreshing: true });
    expect(h.requestRef.current).toBe(current);
    expect(h.refresh(false, true)).toBe(current);
    const fresh = diagnostics("account-b");
    h.requests[1].result.resolve(fresh);
    await current;
    expect(h.state.diagnostics).toBe(fresh);
  });

  it("ignores an obsolete account error after the replacement read succeeds", async () => {
    const h = harness();
    const old = h.refresh(false, true);
    h.changeAccount("");
    const current = h.refresh(false, true);
    const fresh = diagnostics("signed-out");
    h.requests[1].result.resolve(fresh);
    await current;
    h.requests[0].result.reject(new Error("Previous account failure"));
    await old;
    expect(h.state).toEqual({ diagnostics: fresh, error: "", refreshing: false });
  });

  it("rejects a stale result when settings have advanced before the account reset effect", async () => {
    const h = harness();
    const old = h.refresh();
    h.settingsRef.current = { accountUid: "account-b" };
    h.requests[0].result.resolve(diagnostics("obsolete"));
    expect(await old).toBeNull();
    expect(h.state.diagnostics).toBeNull();
  });

  it("does not accept an old read when the user returns to the same account", async () => {
    const h = harness();
    const old = h.refresh();
    h.changeAccount("");
    h.changeAccount("account-a");
    const current = h.refresh();
    h.requests[1].result.resolve(diagnostics("new-session"));
    await current;
    h.requests[0].result.resolve(diagnostics("old-session"));
    expect(await old).toBeNull();
    expect(h.state.diagnostics).toEqual(diagnostics("new-session"));
  });

  it("reports a current read failure without dropping its previous diagnostics", async () => {
    const h = harness();
    h.state.diagnostics = diagnostics("previous");
    const read = h.refresh();
    h.requests[0].result.reject(new Error("Could not read queue"));
    expect(await read).toBeNull();
    expect(h.state).toEqual({ diagnostics: diagnostics("previous"), error: "Could not read queue", refreshing: false });
    const retry = h.refresh();
    h.requests[1].result.resolve(diagnostics("recovered"));
    await retry;
    expect(h.state.error).toBe("");
    expect(h.state.diagnostics).toEqual(diagnostics("recovered"));
  });
});
