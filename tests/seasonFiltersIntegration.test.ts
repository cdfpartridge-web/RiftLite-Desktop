import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

describe("Vendetta season filters", () => {
  it("makes the officially launched Vendetta season the current default", () => {
    expect(appSource).toContain('const CURRENT_COMMUNITY_SEASON: CommunitySeasonId = "vendetta-launch";');
    expect(appSource).toContain('{ id: "vendetta-launch", label: "Vendetta season" }');
    expect(appSource).toContain("useState<CommunitySeasonId>(CURRENT_COMMUNITY_SEASON)");
    expect(appSource).not.toContain('useState<(typeof COMMUNITY_SEASONS)[number]["id"]>("vendetta-preview")');
  });

  it("defaults personal history and analytics filters to Vendetta while preserving all season choices", () => {
    expect(appSource).toContain("const DEFAULT_MATCH_HISTORY_FILTERS: MatchHistoryFilters = {\n  season: CURRENT_COMMUNITY_SEASON,");
    expect(appSource).toContain("const DEFAULT_MATRIX_FILTERS: MatrixFilters = {\n  season: CURRENT_COMMUNITY_SEASON,");
    expect(appSource).toContain("const DEFAULT_PERSONAL_MATRIX_FILTERS: MatrixFilters = {");
    expect(appSource).toContain("setPersonalFilters(DEFAULT_PERSONAL_MATRIX_FILTERS)");
    expect(appSource.match(/<label>Season<select/g)).toHaveLength(3);
    expect(appSource).toContain('setFilter("season", event.target.value)');
    expect(appSource).toContain('onChange("season", event.target.value)');
  });

  it("applies the season boundary to local history and personal matrix data", () => {
    expect(appSource.match(/if \(!matchInCommunitySeason\(match, filters\.season\)\) return false;/g)).toHaveLength(2);
    expect(appSource).toContain("showSeason={showSeason}");
  });

  it("exposes the shared season filter in personal, team, private-hub, and deck analytics", () => {
    expect(appSource).toMatch(/title={`\$\{detail\.team\.name\} stats`}[\s\S]*?emptyText="No team matches synced yet\."\s+showSeason/);
    expect(appSource).toContain('emptyText="Private hub match data appears here after joined hubs sync." showFlags={false} showSeason');
    expect(appSource).toContain('emptyText="Deck matchups appear after this deck has completed matches with both legends recorded." showFlags={false} showSeason');
  });
});
