import { describe, expect, it } from "vitest";
import { accountOverview } from "../src/shared/accountOverview";

const connected = { connected: true, verified: true, migrationState: "ready" as const };

describe("account overview next action", () => {
  it.each(["local", "reconnect"] as const)("requires sign-in for %s state even when an older connection was verified", (state) => {
    expect(accountOverview(state, connected)).toMatchObject({ action: "sign-in", tone: state === "local" ? "neutral" : "attention" });
  });

  it("waits for the current browser sign-in instead of offering a second sign-in", () => {
    expect(accountOverview("linking", connected)).toMatchObject({ status: "Signing in", action: null });
  });

  it("asks for the missing name before declaring a verified connection ready", () => {
    expect(accountOverview("needs-profile", connected)).toMatchObject({ status: "Name needed", action: "finish-profile", tone: "attention" });
  });

  it("asks for sign-in before profile completion when the server reports a disconnected session", () => {
    expect(accountOverview("needs-profile", { ...connected, connected: false, verified: false })).toMatchObject({ action: "sign-in", tone: "attention" });
  });

  it.each([null, { ...connected, verified: false }])("does not declare an unchecked account ready", (connection) => {
    expect(accountOverview("ready", connection)).toMatchObject({ action: "check-connection", tone: "attention" });
  });

  it("offers troubleshooting when verified older data needs attention", () => {
    expect(accountOverview("ready", { ...connected, migrationState: "attention" })).toMatchObject({ action: "troubleshooting", tone: "attention" });
  });

  it.each(["ready", "pending"] as const)("does not demand unnecessary setup when the account is connected and migration is %s", (migrationState) => {
    expect(accountOverview("ready", { ...connected, migrationState })).toMatchObject({ status: "Connected", action: null, tone: "ready" });
  });
});
