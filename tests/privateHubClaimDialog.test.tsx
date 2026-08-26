import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PrivateHubClaimDialog } from "../src/renderer/PrivateHubClaimDialog";

const intent = { hub: { id: "tcr", name: "TCR" } };

describe("PrivateHubClaimDialog", () => {
  it("collects the legacy hub password inside the app and blocks an empty submission", () => {
    const markup = renderToStaticMarkup(
      <PrivateHubClaimDialog
        intent={intent}
        password=""
        busy={false}
        onPasswordChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(markup).toContain("Claim TCR");
    expect(markup).toContain('type="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Claim hub");
  });

  it("enables a populated claim and keeps errors inside the visible dialog", () => {
    const markup = renderToStaticMarkup(
      <PrivateHubClaimDialog
        intent={intent}
        password="correct horse battery staple"
        busy={false}
        error="Private hub password did not match"
        onPasswordChange={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Private hub password did not match");
    expect(markup).toMatch(/<button type="submit" class="primary">Claim hub<\/button>/);
  });

  it("wires the hub action to the in-app dialog instead of Electron's unsupported prompt", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("window.prompt(\"Enter this hub's password");
    expect(source).toContain("onClick={() => requestHubClaim(selectedHub)}");
    expect(source).toContain("<PrivateHubClaimDialog");
    expect(source).toContain("await window.riftlite.claimHub(hubId, hubClaimPassword);");
    expect(source).toContain('? { ...hub, role: "owner", claimed: true }');
  });
});
