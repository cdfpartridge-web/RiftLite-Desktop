import { describe, expect, it } from "vitest";
import {
  isGeneratedBattlefieldCandidate,
  isGeneratedBattlefieldCode,
  isGeneratedBattlefieldImage,
  isGeneratedBattlefieldName
} from "../src/shared/generatedBattlefields";

describe("generated battlefield identity", () => {
  it.each(["Brush", "baron pit", " Baron  Pit ", "Tap Brush ▲▼"])("recognizes token name %s", (name) => {
    expect(isGeneratedBattlefieldName(name)).toBe(true);
  });

  it.each([
    ["草丛", "https://cdn.imgchest.com/files/1d5125e5af29.jpeg"],
    ["男爵巢穴", "https://cdn.imgchest.com/files/4c3cd4ae3cb7.jpeg"]
  ])("recognizes TCGA's verified Chinese token printing %s", (name, image) => {
    expect(isGeneratedBattlefieldName(name)).toBe(true);
    expect(isGeneratedBattlefieldImage(image)).toBe(true);
    expect(isGeneratedBattlefieldImage(`${image}?width=744#card`)).toBe(true);
    expect(isGeneratedBattlefieldCandidate({ text: "Tap", name })).toBe(true);
    expect(isGeneratedBattlefieldCandidate({ text: "Ping", image })).toBe(true);
  });

  it.each(["草丛斥候", "男爵巢穴巡逻兵"])("does not generalize the Chinese aliases to unrelated text %s", (name) => {
    expect(isGeneratedBattlefieldName(name)).toBe(false);
  });

  it.each([
    "https://cdn.imgchest.com/files/other-1d5125e5af29.jpeg",
    "https://cdn.imgchest.com/files/4c3cd4ae3cb7-other.jpeg",
    "https://cdn.imgchest.com/files/cardBack-black.jpeg"
  ])("does not generalize the Chinese token artwork filenames %s", (image) => {
    expect(isGeneratedBattlefieldImage(image)).toBe(false);
  });

  it.each([
    "UNL-T01",
    "unl-t03",
    "[UNL-T03]",
    "UNL-T01/219",
    "https://cdn.rgpub.io/public/live/map/riftbound/latest/UNL/cards/UNL-T03/full-desktop-2x.avif",
    "https://cards.test/%55NL%2DT01.webp"
  ])("recognizes token collector code %s", (value) => {
    expect(isGeneratedBattlefieldCode(value)).toBe(true);
    expect(isGeneratedBattlefieldImage(value)).toBe(true);
  });

  it.each([
    "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/e44f173629322a4e0c32d3f8902c294d4482ef42-1039x744.png?auto=format&w=744&or=270",
    "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/fad09d6bd9bf38e376f430ecb0b400762420d061-1039x744.png?fm=webp",
    "/battlefields/Baron_Pit.png",
    "/battlefields/baron-pit.webp",
    "/battlefields/Brush.png"
  ])("recognizes token artwork %s", (image) => {
    expect(isGeneratedBattlefieldImage(image)).toBe(true);
  });

  it.each([
    { text: "Tap", name: "Brush" },
    { text: "Ping", code: "UNL-T01" },
    { text: "Tap ▲▼", image: "https://cards.test/UNL-T03.webp" },
    { text: "Add token", image: "https://cards.test/fad09d6bd9bf38e376f430ecb0b400762420d061-1039x744.png" },
    { code: "Baron Pit" }
  ])("recognizes a token despite unrelated UI labels: %j", (candidate) => {
    expect(isGeneratedBattlefieldCandidate(candidate)).toBe(true);
  });

  it.each([
    { text: "Forbidding Waste", code: "UNL-210", image: "https://cards.test/UNL-210.webp" },
    { text: "Rockfall Path", code: "SFD-216", image: "https://cards.test/SFD-216.webp" },
    { text: "Ripper's Bay", code: "UNL-214", image: "https://cards.test/UNL-214.webp" },
    { text: "The Candlelit Sanctum", code: "OGN-291", image: "https://cards.test/OGN-291.webp" },
    { text: "Baron Nashor", code: "UNL-147", image: "https://cards.test/UNL-147.webp" },
    { text: "Tap", image: "https://cards.test/cardBack-black.png", hidden: true },
    { text: "Tap", image: "https://cards.test/card-back.webp", hidden: true },
    { text: "Tap", code: "UNL-T02", image: "https://cards.test/UNL-T02.webp" },
    { text: "Brushfire", code: "UNL-T010" }
  ])("does not discard an ordinary or unidentified card: %j", (candidate) => {
    expect(isGeneratedBattlefieldName(candidate.text)).toBe(false);
    expect(isGeneratedBattlefieldCode(candidate.code)).toBe(false);
    expect(isGeneratedBattlefieldImage(candidate.image)).toBe(false);
    expect(isGeneratedBattlefieldCandidate(candidate)).toBe(false);
  });

  it.each([undefined, null, false, 17, [], {}, { text: false, name: [], code: 17, image: {} }])("tolerates missing or malformed evidence: %j", (value) => {
    expect(isGeneratedBattlefieldName(value)).toBe(false);
    expect(isGeneratedBattlefieldCode(value)).toBe(false);
    expect(isGeneratedBattlefieldImage(value)).toBe(false);
    expect(isGeneratedBattlefieldCandidate(value)).toBe(false);
  });
});
