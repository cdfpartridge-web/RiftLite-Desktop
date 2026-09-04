import { describe, expect, it, vi } from "vitest";

import { AtlasLobbyPlayerFieldRepair } from "../src/main/services/atlasLobbyPlayerFieldRepair.js";

type FieldState = "ready" | "collapsed" | "unavailable" | "blocked";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const isSafe = vi.fn(() => true);
  const readField = vi.fn(async (): Promise<FieldState> => "collapsed");
  const applyCss = vi.fn(async (): Promise<void> => undefined);
  const report = vi.fn((_outcome: "repaired" | "failed") => undefined);
  const delay = vi.fn(async (_milliseconds: number): Promise<void> => undefined);
  const controller = new AtlasLobbyPlayerFieldRepair({ isSafe, readField, applyCss, report, delay });
  return { controller, isSafe, readField, applyCss, report, delay };
}

function successfulReads(readField: ReturnType<typeof fixture>["readField"]) {
  readField.mockResolvedValueOnce("collapsed").mockResolvedValueOnce("collapsed").mockResolvedValueOnce("ready");
}

async function flushMicrotasks() {
  for (let iteration = 0; iteration < 8; iteration += 1) await Promise.resolve();
}

describe("Atlas lobby Player-field CSS repair", () => {
  it("requires stable collapse, applies CSS once, and verifies recovery before reporting success", async () => {
    const { controller, readField, applyCss, report, delay } = fixture();
    const verification = deferred<FieldState>();
    readField.mockResolvedValueOnce("collapsed").mockResolvedValueOnce("collapsed").mockImplementationOnce(() => verification.promise);

    const pending = controller.check();
    await flushMicrotasks();

    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(delay.mock.calls).toEqual([[250], [250]]);
    expect(report).not.toHaveBeenCalled();
    verification.resolve("ready");
    await pending;

    expect(readField).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenCalledExactlyOnceWith("repaired");
  });

  it.each<FieldState>(["ready", "unavailable", "blocked"])("does nothing for an initial %s field", async (state) => {
    const { controller, readField, applyCss, report, delay } = fixture();
    readField.mockResolvedValue(state);

    await controller.check();

    expect(readField).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it.each<FieldState>(["ready", "unavailable", "blocked"])("does not spend the attempt when the stability reread is %s", async (state) => {
    const { controller, readField, applyCss, report } = fixture();
    readField.mockResolvedValueOnce("collapsed").mockResolvedValueOnce(state);

    await controller.check();
    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();

    successfulReads(readField);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith("repaired");
  });

  it("ignores repeat signals after a completed attempt", async () => {
    const { controller, readField, applyCss, report } = fixture();
    successfulReads(readField);

    await controller.check();
    await controller.check();
    await controller.check();

    expect(readField).toHaveBeenCalledTimes(3);
    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent checks while the first measurement is pending", async () => {
    const { controller, readField, applyCss, report } = fixture();
    const initial = deferred<FieldState>();
    readField.mockImplementationOnce(() => initial.promise).mockResolvedValueOnce("collapsed").mockResolvedValueOnce("ready");

    const first = controller.check();
    const duplicate = controller.check();
    expect(readField).toHaveBeenCalledTimes(1);
    initial.resolve("collapsed");
    await Promise.all([first, duplicate]);

    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith("repaired");
  });

  it("ignores concurrent checks while CSS application is pending", async () => {
    const { controller, readField, applyCss, report } = fixture();
    const application = deferred<void>();
    successfulReads(readField);
    applyCss.mockImplementationOnce(() => application.promise);

    const first = controller.check();
    await flushMicrotasks();
    const duplicate = controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(readField).toHaveBeenCalledTimes(2);
    application.resolve();
    await Promise.all([first, duplicate]);

    expect(report).toHaveBeenCalledExactlyOnceWith("repaired");
  });

  it("does not consume the budget when the guest is initially unsafe or replaced", async () => {
    const { controller, isSafe, readField, applyCss, report } = fixture();
    isSafe.mockReturnValue(false);
    await controller.check();
    expect(readField).not.toHaveBeenCalled();
    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();

    isSafe.mockReturnValue(true);
    successfulReads(readField);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
  });

  it("rechecks safety after an asynchronous initial measurement", async () => {
    const { controller, isSafe, readField, applyCss, report, delay } = fixture();
    const initial = deferred<FieldState>();
    readField.mockImplementationOnce(() => initial.promise);

    const pending = controller.check();
    isSafe.mockReturnValue(false);
    initial.resolve("collapsed");
    await pending;

    expect(delay).not.toHaveBeenCalled();
    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    isSafe.mockReturnValue(true);
    successfulReads(readField);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
  });

  it("rechecks protection after the stability delay without spending an attempt", async () => {
    const { controller, isSafe, readField, applyCss, report, delay } = fixture();
    const stability = deferred<void>();
    delay.mockImplementationOnce(() => stability.promise);

    const pending = controller.check();
    await flushMicrotasks();
    isSafe.mockReturnValue(false);
    stability.resolve();
    await pending;

    expect(readField).toHaveBeenCalledTimes(1);
    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    isSafe.mockReturnValue(true);
    successfulReads(readField);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
  });

  it("rechecks safety immediately after the final prerepair measurement", async () => {
    const { controller, isSafe, readField, applyCss, report } = fixture();
    const confirmation = deferred<FieldState>();
    readField.mockResolvedValueOnce("collapsed").mockImplementationOnce(() => confirmation.promise);

    const pending = controller.check();
    await flushMicrotasks();
    isSafe.mockReturnValue(false);
    confirmation.resolve("collapsed");
    await pending;

    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([true, false])("cancels stale pending measurements on navigation (new document: %s)", async (newDocument) => {
    const { controller, readField, applyCss, report } = fixture();
    const initial = deferred<FieldState>();
    readField.mockImplementationOnce(() => initial.promise);

    const pending = controller.check();
    controller.navigationChanged(newDocument);
    initial.resolve("collapsed");
    await pending;

    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    successfulReads(readField);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
  });

  it("does not let an old check release a newer document's concurrent-check lock", async () => {
    const { controller, readField, applyCss, report } = fixture();
    const oldInitial = deferred<FieldState>();
    const newInitial = deferred<FieldState>();
    readField.mockImplementationOnce(() => oldInitial.promise).mockImplementationOnce(() => newInitial.promise)
      .mockResolvedValueOnce("collapsed").mockResolvedValueOnce("ready");

    const oldCheck = controller.check();
    controller.navigationChanged(true);
    const newCheck = controller.check();
    oldInitial.resolve("collapsed");
    await oldCheck;
    const duplicate = controller.check();

    expect(readField).toHaveBeenCalledTimes(2);
    expect(applyCss).not.toHaveBeenCalled();
    newInitial.resolve("collapsed");
    await Promise.all([newCheck, duplicate]);
    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith("repaired");
  });

  it("renews the consumed budget on a new document even when its URL is unchanged", async () => {
    const { controller, readField, applyCss, report } = fixture();
    successfulReads(readField);
    await controller.check();
    controller.navigationChanged(true);
    successfulReads(readField);
    await controller.check();

    expect(applyCss).toHaveBeenCalledTimes(2);
    expect(report.mock.calls).toEqual([["repaired"], ["repaired"]]);
  });

  it("retains the consumed budget across SPA navigation", async () => {
    const { controller, readField, applyCss, report } = fixture();
    successfulReads(readField);
    await controller.check();
    controller.navigationChanged(false);
    await controller.check();

    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(readField).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it.each<FieldState>(["collapsed", "unavailable"])("reports failed verification (%s) once without retrying", async (state) => {
    const { controller, readField, applyCss, report } = fixture();
    readField.mockResolvedValueOnce("collapsed").mockResolvedValueOnce("collapsed").mockResolvedValueOnce(state);

    await controller.check();
    await controller.check();

    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith("failed");
  });

  it("does not report success or failure when verification finds a busy or hidden guest", async () => {
    const { controller, readField, applyCss, report } = fixture();
    readField.mockResolvedValueOnce("collapsed").mockResolvedValueOnce("collapsed").mockResolvedValueOnce("blocked");

    await controller.check();
    await controller.check();

    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a thrown CSS failure once while the same guest remains safe", async () => {
    const { controller, applyCss, report } = fixture();
    applyCss.mockRejectedValueOnce(new Error("CSS insertion rejected"));

    await controller.check();
    await controller.check();

    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith("failed");
  });

  it("does not call a rejected pre-mutation probe a failed repair or spend its budget", async () => {
    const { controller, readField, applyCss, report } = fixture();
    readField.mockRejectedValueOnce(new Error("Guest measurement unavailable"));

    await controller.check();
    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    successfulReads(readField);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith("repaired");
  });

  it("suppresses a stale CSS rejection after navigation and allows the new document's repair", async () => {
    const { controller, readField, applyCss, report } = fixture();
    const application = deferred<void>();
    applyCss.mockImplementationOnce(() => application.promise);
    const pending = controller.check();
    await flushMicrotasks();
    controller.navigationChanged(true);
    application.reject(new Error("Old document disappeared"));
    await pending;

    expect(report).not.toHaveBeenCalled();
    successfulReads(readField);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledExactlyOnceWith("repaired");
  });

  it("suppresses a CSS failure after the guest becomes unsafe", async () => {
    const { controller, isSafe, applyCss, report } = fixture();
    const application = deferred<void>();
    applyCss.mockImplementationOnce(() => application.promise);
    const pending = controller.check();
    await flushMicrotasks();
    isSafe.mockReturnValue(false);
    application.reject(new Error("Navigation interrupted CSS"));
    await pending;

    expect(report).not.toHaveBeenCalled();
    isSafe.mockReturnValue(true);
    await controller.check();
    expect(applyCss).toHaveBeenCalledTimes(1);
  });

  it("does not continue verification after an unsafe CSS completion", async () => {
    const { controller, isSafe, readField, applyCss, report, delay } = fixture();
    const application = deferred<void>();
    applyCss.mockImplementationOnce(() => application.promise);
    const pending = controller.check();
    await flushMicrotasks();
    isSafe.mockReturnValue(false);
    application.resolve();
    await pending;

    expect(readField).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("does not read verification after protection changes during its delay", async () => {
    const { controller, isSafe, readField, report, delay } = fixture();
    const verificationDelay = deferred<void>();
    delay.mockResolvedValueOnce(undefined).mockImplementationOnce(() => verificationDelay.promise);
    const pending = controller.check();
    await flushMicrotasks();
    isSafe.mockReturnValue(false);
    verificationDelay.resolve();
    await pending;

    expect(readField).toHaveBeenCalledTimes(2);
    expect(report).not.toHaveBeenCalled();
  });

  it.each(["unsafe", "navigation", "dispose"] as const)("suppresses late verification success after %s", async (change) => {
    const { controller, isSafe, readField, report } = fixture();
    const verification = deferred<FieldState>();
    readField.mockResolvedValueOnce("collapsed").mockResolvedValueOnce("collapsed").mockImplementationOnce(() => verification.promise);
    const pending = controller.check();
    await flushMicrotasks();
    if (change === "unsafe") isSafe.mockReturnValue(false);
    else if (change === "navigation") controller.navigationChanged(true);
    else controller.dispose();
    verification.resolve("ready");
    await pending;

    expect(report).not.toHaveBeenCalled();
  });

  it("permanently ignores checks after disposal, including a pending pre-mutation check", async () => {
    const { controller, readField, applyCss, report } = fixture();
    const initial = deferred<FieldState>();
    readField.mockImplementationOnce(() => initial.promise);
    const pending = controller.check();
    controller.dispose();
    initial.resolve("collapsed");
    await pending;
    controller.navigationChanged(true);
    await controller.check();

    expect(readField).toHaveBeenCalledTimes(1);
    expect(applyCss).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
