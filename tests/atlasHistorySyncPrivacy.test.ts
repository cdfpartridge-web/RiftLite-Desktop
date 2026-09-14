import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: { getVersion: () => "test" } }));
import { FirebaseSyncService } from "../src/main/services/firebaseSync";
import { createDefaultSettings } from "../src/shared/settingsDefaults";
import { history, savedMatch } from "./fixtures/atlasHistory";
import type { RiftLiteStore } from "../src/main/services/store";

describe("Atlas history sharing boundaries", () => {
  it("omits post-game lists and history markers from community, hub and team uploads", async () => {
    const settings = { ...createDefaultSettings(), username: "Local Player", accountUid: "owner" };
    const match = { ...savedMatch(), atlasHistory: history() };
    const service = new FirebaseSyncService({} as RiftLiteStore, () => null);
    const firestoreRequest = vi.fn(async () => ({ name: "matches/saved" }));
    const websiteRequestWithIdToken = vi.fn(async () => ({ match: { id: "saved" } }));
    Object.assign(service, {
      findPublicMatchDocId: vi.fn(async () => ""),
      firestoreRequest,
      websiteRequestWithIdToken,
      appendCommunityAggregate: vi.fn(async () => undefined),
      updatePrivateHubAggregate: vi.fn(async () => undefined),
    });
    const methods = service as unknown as {
      uploadPublicMatch: (...args: unknown[]) => Promise<string>;
      uploadHubMatch: (...args: unknown[]) => Promise<string>;
      uploadTeamMatch: (...args: unknown[]) => Promise<string>;
    };
    const auth = { uid: "owner", idToken: "test-token", refreshToken: "", expiresAt: 9999999999 };
    await methods.uploadPublicMatch(match, settings, auth);
    await methods.uploadHubMatch("hub", match, settings, auth);
    await methods.uploadTeamMatch("team", match, settings, auth);
    const sent = JSON.stringify([...firestoreRequest.mock.calls, ...websiteRequestWithIdToken.mock.calls]);
    expect(sent).toContain("my_champion");
    for (const privateField of ["atlasHistory", "history-1", "Adaptatron", "ROOM1"])
      expect(sent).not.toContain(privateField);
  });
});
