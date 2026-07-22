import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TCGA replay monitor lifecycle", () => {
  const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");

  it("finalizes an active local monitor before allowing the app to quit", () => {
    const start = source.indexOf('app.on("before-quit"');
    const end = source.indexOf('app.on("will-quit"', start);
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler).toContain("tcgaReplayResearchCapture.getStatus().active");
    expect(handler).toContain("event.preventDefault()");
    expect(handler).toContain('tcgaReplayResearchCapture.stop("app-quit")');
    expect(handler).toContain("tcgaResearchQuitAllowed = true");
    expect(handler).toContain("app.quit()");
  });

  it("keeps broad CDP network evidence behind separate Research Monitor consent", () => {
    const listenerStart = source.indexOf('const listener = (_event: unknown, method: string, params: unknown) => {');
    const networkStart = source.indexOf('if (method === "Network.requestWillBeSent")', listenerStart);
    const productBoundary = source.lastIndexOf("if (!researchActive) return;", networkStart);

    expect(listenerStart).toBeGreaterThan(-1);
    expect(networkStart).toBeGreaterThan(listenerStart);
    expect(productBoundary).toBeGreaterThan(listenerStart);
    expect(productBoundary).toBeLessThan(networkStart);
  });

  it("passes the page document identity into product replay ingestion and retires destroyed guests", () => {
    const listenerStart = source.indexOf('const listener = (_event: unknown, method: string, params: unknown) => {');
    const listenerEnd = source.indexOf('// Product Web Replay consent covers only', listenerStart);
    const listener = source.slice(listenerStart, listenerEnd);

    expect(listener).toContain("const documentId = tcgaResearchText(decoded.documentId)");
    expect(listener).toContain("kind === \"hook-ready\"");
    expect(listener).toContain("documentId,");
    expect(source).toContain("tcgaWebReplayCaptureService?.discardWebContents(webContents.id)");
  });

  it("reconfigures product capture when the replay directory changes", () => {
    const configureStart = source.indexOf("async function configureTcgaWebReplayProductCapture");
    const configureEnd = source.indexOf("async function finalizeTcgaWebReplayCapture", configureStart);
    const configure = source.slice(configureStart, configureEnd);
    const chooseStart = source.indexOf('handleTrustedAppIpc("replays:choose-directory"');
    const chooseEnd = source.indexOf('handleTrustedAppIpc("replays:open-directory"', chooseStart);
    const choose = source.slice(chooseStart, chooseEnd);

    expect(configure).toContain("activeDiscordReplayHubIds(settings)");
    expect(configure).toContain("tcgaWebReplayCaptureService?.configure(outputDirectory, nextAccountUid, discordShareHubIds)");
    expect(source).toContain('Object.prototype.hasOwnProperty.call(patch, "replayDirectory")');
    expect(choose).toContain("capture.beginDataMaintenance()");
    expect(choose).toContain("configureTcgaWebReplayProductCapture()");
  });

  it("keeps an awaiting-result TCGA capture local until match confirmation", () => {
    const finalizeStart = source.indexOf("async function finalizeTcgaWebReplayCapture");
    const finalizeEnd = source.indexOf("function tcgaMatchCaptureCompletedAt", finalizeStart);
    const finalize = source.slice(finalizeStart, finalizeEnd);

    expect(finalize).toContain('result?.status === "awaiting-result"');
    expect(finalize).toContain('reason: "tcga-web-replay-awaiting-result"');
    expect(finalize).toContain("return replay ?? null");
  });

  it("commits confirmed TCGA replay state locally before queueing remote delivery", () => {
    const localCommitStart = source.indexOf("async function commitConfirmedTcgaReplayLocally");
    const localCommitEnd = source.indexOf("async function deliverConfirmedMatch", localCommitStart);
    const localCommit = source.slice(localCommitStart, localCommitEnd);
    const confirmStart = source.indexOf('handleTrustedAppIpc("matches:confirm"');
    const confirmEnd = source.indexOf('handleTrustedAppIpc("matches:combine-preview"', confirmStart);
    const confirm = source.slice(confirmStart, confirmEnd);

    expect(localCommitStart).toBeGreaterThan(-1);
    expect(localCommit).toContain("await capture.waitForReplayFinalization(saved.id)");
    expect(localCommit).toContain("await finalizeTcgaWebReplayCapture");
    expect(localCommit).toContain("capture.markConfirmedReplayFinalizationPending(latest.id, error)");
    expect(confirmStart).toBeGreaterThan(-1);
    expect(confirm).toContain("confirmMatchLocalFirst(draft");
    expect(confirm).toContain("deferReplayFinalization: confirmedMatchSupportsBackgroundDelivery(candidate)");
    expect(confirm).toContain("commitConfirmedTcgaReplayLocally(saved)");
    expect(confirm).toContain("shouldDeliverInBackground: confirmedMatchSupportsBackgroundDelivery");
    expect(confirm).toContain("queueBackgroundDelivery: queueConfirmedMatchDelivery");
    expect(source).toContain("{ deferDelivery: true }");
  });

  it("orders deferred automatic replay delivery before match reporting", () => {
    const deliveryStart = source.indexOf("async function deliverConfirmedMatch");
    const deliveryEnd = source.indexOf("function queueConfirmedMatchDelivery", deliveryStart);
    const delivery = source.slice(deliveryStart, deliveryEnd);
    const queueStart = deliveryEnd;
    const queueEnd = source.indexOf("async function takeScreenshot", queueStart);
    const queue = source.slice(queueStart, queueEnd);
    const publishedStart = source.indexOf("rawCaptureService = new RawCaptureService(");
    const publishedEnd = source.indexOf("if (!IS_PACKAGED_SMOKE_TEST)", publishedStart);
    const published = source.slice(publishedStart, publishedEnd);

    expect(deliveryStart).toBeGreaterThan(-1);
    expect(delivery).toContain("await rawCaptureService.deliverRegisteredTcgaCapture(candidate.id)");
    expect(delivery).toContain("await capture.waitForReplayFinalization(candidate.id)");
    expect(delivery).toContain("await uploadPendingRawCapturesWithAccountRefresh()");
    expect(delivery).toContain("deliverConfirmedMatchInBackground(saved");
    expect(published).toContain('if (match?.platform === "tcga")');
    expect(published.indexOf("await syncService.syncMatch")).toBeLessThan(
      published.indexOf("await syncService.attachWebReplayToSyncedHubMatches")
    );
    expect(queue).toContain("capture.markConfirmedReplayDeliveryDeferred(saved.id)");
    expect(queue).not.toContain("capture.markConfirmedReplayFinalizationPending(saved.id");
    expect(source).toContain("retryPendingRawCapturesAndMatchReports");
    expect(source).toContain("retryDeferredConfirmedMatchDeliveries();");
    expect(queue).toContain("job.pending = null");
    expect(source).toContain("selectConfirmedMatchReportRetries(await store.getMatches(), 10)");
  });
});
