import { describe, expect, it } from "vitest";
import { accountLinkUrlForProvider } from "../src/shared/accountLink";

describe("accountLinkUrlForProvider", () => {
  it("adds the selected provider without changing the link session", () => {
    expect(accountLinkUrlForProvider(
      "https://www.riftlite.com/auth/link?sessionId=session-1&code=RIFT-1234",
      "google"
    )).toBe("https://www.riftlite.com/auth/link?sessionId=session-1&code=RIFT-1234&provider=google");
  });

  it("replaces an untrusted provider hint with the explicit desktop choice", () => {
    expect(accountLinkUrlForProvider(
      "https://www.riftlite.com/auth/link?sessionId=session-1&provider=unknown",
      "email"
    )).toBe("https://www.riftlite.com/auth/link?sessionId=session-1&provider=email");
  });

  it("supports recovering an existing Discord-linked account", () => {
    expect(accountLinkUrlForProvider(
      "https://www.riftlite.com/link-device?session=session-1&code=RIFT-1234",
      "discord"
    )).toBe("https://www.riftlite.com/link-device?session=session-1&code=RIFT-1234&provider=discord");
  });

  it("allows loopback HTTP for local development", () => {
    expect(accountLinkUrlForProvider(
      "http://127.0.0.1:3000/auth/link?sessionId=session-1",
      "email"
    )).toBe("http://127.0.0.1:3000/auth/link?sessionId=session-1&provider=email");
  });

  it("rejects malformed and unsafe links", () => {
    expect(() => accountLinkUrlForProvider("not a URL", "google")).toThrow("invalid account sign-in link");
    expect(() => accountLinkUrlForProvider("riftlite://auth/link?sessionId=session-1", "google")).toThrow("unsafe account sign-in link");
    expect(() => accountLinkUrlForProvider("http://www.riftlite.com/auth/link", "email")).toThrow("unsafe account sign-in link");
  });
});
