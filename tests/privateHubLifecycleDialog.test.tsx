import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PrivateHubLifecycleDialog } from "../src/renderer/PrivateHubLifecycleDialog";

describe("PrivateHubLifecycleDialog", () => {
  it("shows an explicit delete warning and disables delete during the visible countdown", () => {
    const markup = renderToStaticMarkup(
      <PrivateHubLifecycleDialog
        intent={{ action: "delete", hub: { id: "hub-1", name: "Testing Hub" } }}
        countdown={3}
        busy={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(markup).toContain("Are you sure?");
    expect(markup).toContain("Delete unlocks in 3 seconds.");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("Delete hub in 3s");
  });

  it("enables the destructive action only after the countdown reaches zero", () => {
    const markup = renderToStaticMarkup(
      <PrivateHubLifecycleDialog
        intent={{ action: "delete", hub: { id: "hub-1", name: "Testing Hub" } }}
        countdown={0}
        busy={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(markup).toContain("Countdown complete");
    expect(markup).toContain(">Permanently delete hub</button>");
  });

  it("gates the match drill-down replay action through the private-hub URL policy", () => {
    const rendererSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

    expect(rendererSource).toContain(
      "const webReplayUrl = privateHubWebReplayUrl(match.source, match.webReplayId);"
    );
    expect(rendererSource).toContain("{webReplayUrl ? (");
    expect(rendererSource).toContain("<ExternalLink size={15} /> Open Web Replay");
  });
});
