import { expect, it, vi } from "vitest";
import { discordSignInAvailability, LOCAL_ACCOUNT_PROVIDERS_URL } from "../src/main/services/discordSignInAvailability";
import { localReplayTestFetch } from "../src/main/services/localReplayTestIsolation";
import { decisionShortcutLabel } from "../src/shared/decisionShortcutLabel";

it("reads Discord readiness for the matching website and distinguishes an offline check", async () => {
  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(Response.json({ available: true, discordAvailable: true }));
  expect(await discordSignInAvailability(false, request)).toBe("available");
  expect(request.mock.calls[0][0]).toBe("https://www.riftlite.com/api/account/providers");
  request.mockResolvedValueOnce(Response.json({ available: true, discordAvailable: false }));
  expect(await discordSignInAvailability(true, localReplayTestFetch(request))).toBe("unconfigured");
  expect(request.mock.calls[1][0]).toBe(LOCAL_ACCOUNT_PROVIDERS_URL);
  request.mockRejectedValueOnce(new Error("Offline"));
  expect(await discordSignInAvailability(true, request)).toBe("offline");
  await expect(localReplayTestFetch(request)(LOCAL_ACCOUNT_PROVIDERS_URL, {method: "POST"})).rejects.toThrow();
});
it("formats the registered accelerator using the platform's key names", () => {
  expect(decisionShortcutLabel("", "win32")).toBe("");
  expect(decisionShortcutLabel("CommandOrControl+Shift+F", "win32")).toBe("Ctrl+Shift+F");
  expect(decisionShortcutLabel("CmdOrCtrl+Alt+F", "darwin")).toBe("Command+Option+F");
});
