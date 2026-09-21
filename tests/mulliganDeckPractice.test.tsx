import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MulliganDeckPractice, type MulliganDeckPracticeProps } from "../src/renderer/MulliganDeckPractice";
import type { MulliganLabRegistryCard } from "../src/shared/mulliganLab";
import type { SavedDeck } from "../src/shared/types";

function card(code: string, name: string, overrides: Partial<MulliganLabRegistryCard> = {}): MulliganLabRegistryCard {
  return { code, name, type: "Unit", supertype: null, champion: null, imageUrl: `https://example.test/${code}.png`, costEnergy: 2, costPower: 0, ...overrides };
}
const legend = card("OGN-200", "LeBlanc, Deceiver", { type: "Legend", champion: "LeBlanc" });
const champion = card("OGN-201", "LeBlanc, Illusionist", { supertype: "Champion", champion: "LeBlanc" });
const opponent = card("OGN-202", "Ahri, Nine-Tailed Fox", { type: "Legend", champion: "Ahri" });
const mainCards = Array.from({ length: 13 }, (_, index) => card(`OGN-${String(index + 1).padStart(3, "0")}`, `Exact saved card ${index + 1}`));
const registry = { byCode: new Map([legend, champion, opponent, ...mainCards].map((entry) => [entry.code, entry])) };
const snapshot = { legendCode: legend.code, chosenChampionCode: champion.code, mainDeck: [
  ...mainCards.map((entry) => ({ cardId: entry.code, qty: 3 })), { cardId: champion.code, qty: 1 },
] };
function savedDeck(value: unknown = snapshot): SavedDeck {
  return { id: "my-deck", title: "My actual list", legend: legend.name, snapshotJson: JSON.stringify(value), sourceUrl: "", sourceKey: "local", lastImportedAt: "", lastRefreshStatus: "ok", lastRefreshError: "" };
}
const props: MulliganDeckPracticeProps = { deck: savedDeck(), registry, opponent, initiative: "1st", onChooseDeck: () => undefined };

afterEach(() => vi.restoreAllMocks());

describe("exact-deck Mulligan practice", () => {
  it("offers deck selection when no saved deck is active", () => {
    const html = renderToStaticMarkup(<MulliganDeckPractice {...props} deck={null} />);
    expect(html).toContain("Choose a deck to practise with");
    expect(html).toContain("Choose deck");
    expect(html).not.toContain('aria-label="Opening hand"');
  });

  it("shows an actionable invalid-deck state rather than another deck's cards", () => {
    const html = renderToStaticMarkup(<MulliganDeckPractice {...props} deck={savedDeck({ mainDeck: [] })} />);
    expect(html).toContain("This deck needs a quick check");
    expect(html).toContain("Open decks");
    expect(html).not.toContain('aria-label="Opening hand"');
  });

  it("requires a matching Chosen Champion before dealing when the import omitted that choice", () => {
    const { chosenChampionCode: _chosen, ...missingChoice } = snapshot;
    const html = renderToStaticMarkup(<MulliganDeckPractice {...props} deck={savedDeck(missingChoice)} />);
    expect(html).toContain("Choose your champion");
    expect(html).toContain(`Choose ${champion.name} as your champion`);
    expect(html).not.toContain('aria-label="Opening hand"');
  });

  it("deals four exact-deck cards with contextual opponent and no invented verdict or score", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const html = renderToStaticMarkup(<MulliganDeckPractice {...props} />);
    expect(html.match(/aria-label="Card [1-4]:/g)).toHaveLength(4);
    expect(html).toContain("My actual list");
    expect(html).toContain("Exact saved card 1");
    expect(html).toContain("Exact saved card 2");
    expect(html).toContain("Ahri, Nine-Tailed Fox");
    expect(html).toContain("Going first");
    expect(html).toContain("Ungraded");
    expect(html).toContain("Keep hand");
    expect(html).toContain("Your choices stay out of training reviews");
    expect(html).not.toContain("evidence hands");
    expect(html).not.toContain("Matchup mastery");
    expect(html).not.toContain(`aria-label="Card 1: ${champion.name}`);
  });

  it("escapes saved titles and gives image-free cards a usable text fallback", () => {
    const textRegistry = { byCode: new Map([...registry.byCode].map(([code, entry]) => [code, { ...entry, imageUrl: "" }])) };
    const html = renderToStaticMarkup(<MulliganDeckPractice {...props} registry={textRegistry} deck={{ ...savedDeck(), title: "<script>deck</script>" }} opponent={null} initiative="all" />);
    expect(html).toContain("&lt;script&gt;deck&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Artwork unavailable");
    expect(html).toContain("Either initiative");
    expect(html).toContain("Any opponent");
  });
});
