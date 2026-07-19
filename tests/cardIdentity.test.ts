import { describe, expect, it } from "vitest";
import {
  riftboundBasePrintCode,
  riftboundCardCodeAliases,
  riftboundCardCodeFromValue,
  riftboundCanonicalArtCode
} from "../src/shared/cardIdentity";

describe("Riftbound card print identity", () => {
  it.each([
    ["https://cards.test/UNL-089A.webp", "UNL-089A", "UNL-089"],
    ["[UNL-R03A]", "UNL-R03A", "UNL-R03"],
    ["SFD-R06B", "SFD-R06B", "SFD-R06"],
    ["https://cards.test/UNL-T01.webp", "UNL-T01", "UNL-T01"],
    ["https://cards.test/OGN-SP003B.webp", "OGN-SP003B", "OGN-SP003"],
    ["UNL-226*/219", "UNL-226*", "UNL-226"],
    ["https://cards.test/UNL-226-star.webp", "UNL-226*", "UNL-226"],
    ["https://cards.test/UNL-226%2A.webp", "UNL-226*", "UNL-226"],
    ["UNL-226", "UNL-226", "UNL-226"]
  ])("extracts %s and derives its base printing", (value, expectedCode, expectedBase) => {
    expect(riftboundCardCodeFromValue(value)).toBe(expectedCode);
    expect(riftboundBasePrintCode(value)).toBe(expectedBase);
  });

  it("returns exact and base aliases for signed and overnumbered rune prints", () => {
    expect(riftboundCardCodeAliases("UNL-089A")).toEqual(["UNL-089A", "UNL-089"]);
    expect(riftboundCardCodeAliases("SFD-R06B")).toEqual(["SFD-R06B", "SFD-R06"]);
    expect(riftboundCardCodeAliases("UNL-226*")).toEqual(["UNL-226*", "UNL-226"]);
    expect(riftboundCardCodeAliases("UNL-R03A-star")).toEqual(["UNL-R03A*", "UNL-R03A", "UNL-R03"]);
    expect(riftboundCardCodeAliases("UNL-226")).toEqual(["UNL-226"]);
  });

  it.each([
    "1UNL-226",
    "UNL-226garbage",
    "UNL-nope",
    "card-UNL-R",
    "UNL-SP"
  ])("does not fuzzy-match malformed collector code %s", (value) => {
    expect(riftboundCardCodeFromValue(value)).toBe("");
  });

  it.each([
    ["UNL-R01A", "OGN-007"],
    ["SFD-R03A", "OGN-089"],
    ["SFD-R06B", "OGN-214"],
    ["UNL-R03A-star", "OGN-089"],
    ["UNL-089A", "UNL-089"],
    ["UNL-226", "UNL-226"]
  ])("selects available canonical artwork for %s", (value, expected) => {
    expect(riftboundCanonicalArtCode(value)).toBe(expected);
  });
});
