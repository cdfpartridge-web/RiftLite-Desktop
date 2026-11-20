import { describe, expect, it, vi } from "vitest";
import { TeamSettingsSaveController } from "../src/renderer/teamSettingsSaveController";
import type { SocialTeamProfile } from "../src/shared/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const team = (id = "team-a", updatedAt = 100) => ({ id, name: id, updatedAt }) as SocialTeamProfile;

function fixture() {
  const controller = new TeamSettingsSaveController();
  const scope = { mounted: true, revision: 1 };
  const state = { detail: team(), busy: false, status: "" };
  const update = vi.fn(async () => team("team-a", 200));
  const refresh = vi.fn(async (_current: () => boolean) => undefined);
  function request(id = "team-a") {
    const revision = scope.revision;
    return {
      navigationRevision: revision,
      isCurrent: () => scope.mounted && scope.revision === revision,
      teamId: id, draft: { name: "Edited", visibility: "private" as const }, expectedUpdatedAt: 100,
      update, refresh,
      started: vi.fn(() => { state.busy = true; }),
      saved: vi.fn((value: SocialTeamProfile) => { state.detail = value; state.status = "Saved"; }),
      failed: vi.fn((message: string) => { state.status = message; }),
      finished: vi.fn(() => { state.busy = false; })
    };
  }
  return { controller, scope, state, update, refresh, request };
}

describe("Team settings save lifecycle", () => {
  it("preserves revision-aware edits and successful refresh behavior", async () => {
    const f = fixture(), request = f.request();
    expect(await f.controller.save(request)).toBe(true);
    expect(f.update).toHaveBeenCalledExactlyOnceWith("team-a", {
      name: "Edited", visibility: "private", expectedUpdatedAt: 100
    });
    expect(f.state).toEqual({ detail: team("team-a", 200), busy: false, status: "Saved" });
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect(request.finished).toHaveBeenCalledTimes(1);
  });

  it.each(["back", "different-team", "unmount", "account-change"])("ignores a late save after %s", async boundary => {
    const f = fixture(), result = deferred<SocialTeamProfile>(), request = f.request();
    f.update.mockReturnValueOnce(result.promise);
    const saving = f.controller.save(request);
    if (boundary === "unmount" || boundary === "account-change") f.scope.mounted = false;
    else f.scope.revision++;
    f.state.detail = team("new-screen");
    f.state.status = "New screen";
    f.state.busy = true;
    result.resolve(team("team-a", 200));
    expect(await saving).toBe(false);
    expect(f.state).toEqual({ detail: team("new-screen"), busy: true, status: "New screen" });
    expect(request.saved).not.toHaveBeenCalled();
    expect(request.finished).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it("does not put an old error on the new team's screen", async () => {
    const f = fixture(), result = deferred<SocialTeamProfile>(), request = f.request();
    f.update.mockReturnValueOnce(result.promise);
    const saving = f.controller.save(request);
    f.scope.revision++;
    f.state.status = "Team B loading"; f.state.busy = true;
    result.reject(new Error("Team A request failed"));
    await saving;
    expect(f.state.status).toBe("Team B loading");
    expect(f.state.busy).toBe(true);
    expect(request.failed).not.toHaveBeenCalled();
    expect(request.finished).not.toHaveBeenCalled();
  });

  it("blocks double submission before rendering and allows retry after a current error", async () => {
    const f = fixture(), result = deferred<SocialTeamProfile>(), request = f.request();
    f.update.mockReturnValueOnce(result.promise);
    const saving = f.controller.save(request);
    expect(await f.controller.save(f.request())).toBe(false);
    expect(f.update).toHaveBeenCalledTimes(1);
    result.reject(new Error("This team changed. Reload it before saving again."));
    await saving;
    expect(f.state.busy).toBe(false);
    expect(f.state.status).toContain("This team changed");
    expect(await f.controller.save(f.request())).toBe(true);
    expect(f.update).toHaveBeenCalledTimes(2);
  });

  it("lets the new team save while an older team's request finishes", async () => {
    const f = fixture(), old = deferred<SocialTeamProfile>(), newer = deferred<SocialTeamProfile>();
    f.update.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    const oldRequest = f.request(), first = f.controller.save(oldRequest);
    f.scope.revision++;
    const newRequest = f.request("team-b"), second = f.controller.save(newRequest);
    old.resolve(team("team-a", 200)); await first;
    expect(oldRequest.finished).not.toHaveBeenCalled();
    expect(f.state.busy).toBe(true);
    newer.resolve(team("team-b", 300)); await second;
    expect(f.state.detail).toEqual(team("team-b", 300));
    expect(f.state.busy).toBe(false);
  });

  it("invalidates a save-triggered refresh and its final busy update after navigation", async () => {
    const f = fixture(), waiting = deferred<void>(), request = f.request();
    f.refresh.mockImplementation(async current => {
      await waiting.promise;
      if (current()) f.state.status = "Old directory refreshed";
    });
    const saving = f.controller.save(request);
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledTimes(1));
    f.scope.revision++; f.state.status = "Team B loading"; f.state.busy = true;
    waiting.resolve(); await saving;
    expect(f.state.status).toBe("Team B loading");
    expect(f.state.busy).toBe(true);
    expect(request.finished).not.toHaveBeenCalled();
  });

  it("does not start an operation for an already stale team view", async () => {
    const f = fixture(), request = f.request();
    f.scope.revision++;
    expect(await f.controller.save(request)).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
    expect(request.started).not.toHaveBeenCalled();
  });
});
