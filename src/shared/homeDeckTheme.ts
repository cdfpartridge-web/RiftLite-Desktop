import { normalizeLegendName } from "./legendNames.js";

export type HomeDeckDomain = "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order";
export type HomeDeckThemeId =
  | "calm-mind"
  | "fury-calm"
  | "body-order"
  | "fury-chaos"
  | "calm-order"
  | "fury-order"
  | "mind-chaos"
  | "calm-chaos"
  | "body-calm"
  | "body-mind"
  | "fury-mind"
  | "order-chaos"
  | "mind-order"
  | "fury-body"
  | "body-chaos";

export interface HomeDeckDomainColor {
  hex: string;
  rgb: string;
}

export interface HomeDeckTheme {
  id: HomeDeckThemeId;
  label: string;
  domains: readonly [HomeDeckDomain, HomeDeckDomain];
  primary: string;
  secondary: string;
  primaryRgb: string;
  secondaryRgb: string;
  buttonStart: string;
  buttonEnd: string;
  buttonText: string;
}

export const HOME_DECK_DOMAIN_COLORS: Record<HomeDeckDomain, HomeDeckDomainColor> = {
  Fury: { hex: "#e85a5a", rgb: "232 90 90" },
  Calm: { hex: "#4fd19a", rgb: "79 209 154" },
  Mind: { hex: "#53b7e8", rgb: "83 183 232" },
  Body: { hex: "#e69a55", rgb: "230 154 85" },
  Chaos: { hex: "#9a72ff", rgb: "154 114 255" },
  Order: { hex: "#e4c85f", rgb: "228 200 95" }
};

// These pairs mirror classification.domain on the upstream card records used to
// build RiftLite's packaged registry. Variants share their champion's pairing.
const HOME_DECK_LEGENDS_BY_THEME: Record<HomeDeckThemeId, readonly string[]> = {
  "calm-mind": ["Ahri", "Lillia", "Nasus", "Ornn"],
  "fury-calm": ["Akali"],
  "body-order": ["Ambessa", "Fiora", "Garen", "Poppy", "Sett"],
  "fury-chaos": ["Annie", "Draven", "Jinx", "Pyke", "Zed"],
  "calm-order": ["Azir", "Ivern", "Leona", "Shen"],
  "fury-order": ["Darius", "Rek'Sai", "Vi"],
  "mind-chaos": ["Diana", "Ezreal", "Mel", "Teemo"],
  "calm-chaos": ["Irelia", "Vex", "Yasuo"],
  "body-calm": ["Jax", "Lee Sin", "Master Yi", "Master Yi, Wuju Master", "Master Yi, Wuju Bladesman"],
  "body-mind": ["Jayce"],
  "fury-mind": ["Jhin", "Kai'Sa", "Rumble"],
  "order-chaos": ["Kennen"],
  "mind-order": ["LeBlanc", "Lux", "Renata Glasc", "Viktor"],
  "fury-body": ["Lucian", "Renekton", "Rengar", "Volibear"],
  "body-chaos": ["Kha'Zix", "Miss Fortune", "Sivir"]
};

function mixHex(first: string, second: string, firstWeight: number): string {
  const read = (value: string, offset: number) => Number.parseInt(value.slice(offset, offset + 2), 16);
  const weight = Math.max(0, Math.min(1, firstWeight));
  const channel = (offset: number) => Math.round(read(first, offset) * weight + read(second, offset) * (1 - weight))
    .toString(16)
    .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function createTheme(
  id: HomeDeckThemeId,
  domains: readonly [HomeDeckDomain, HomeDeckDomain],
  buttonOverride?: { start: string; end: string }
): HomeDeckTheme {
  const primary = HOME_DECK_DOMAIN_COLORS[domains[0]];
  const secondary = HOME_DECK_DOMAIN_COLORS[domains[1]];
  const darkSurface = "#111827";
  const blendedStart = mixHex(mixHex(primary.hex, secondary.hex, 0.75), darkSurface, 0.72);
  const blendedEnd = mixHex(mixHex(secondary.hex, primary.hex, 0.78), darkSurface, 0.62);
  return {
    id,
    label: `${domains[0]} and ${domains[1]}`,
    domains,
    primary: primary.hex,
    secondary: secondary.hex,
    primaryRgb: primary.rgb,
    secondaryRgb: secondary.rgb,
    buttonStart: buttonOverride?.start ?? blendedStart,
    buttonEnd: buttonOverride?.end ?? blendedEnd,
    buttonText: "#fff7fb"
  };
}

export const HOME_DECK_THEMES: Record<HomeDeckThemeId, HomeDeckTheme> = {
  "calm-mind": createTheme("calm-mind", ["Calm", "Mind"]),
  "fury-calm": createTheme("fury-calm", ["Fury", "Calm"]),
  "body-order": createTheme("body-order", ["Body", "Order"]),
  "fury-chaos": createTheme("fury-chaos", ["Fury", "Chaos"], { start: "#994d67", end: "#665084" }),
  "calm-order": createTheme("calm-order", ["Calm", "Order"]),
  "fury-order": createTheme("fury-order", ["Fury", "Order"]),
  "mind-chaos": createTheme("mind-chaos", ["Mind", "Chaos"]),
  "calm-chaos": createTheme("calm-chaos", ["Calm", "Chaos"]),
  "body-calm": createTheme("body-calm", ["Body", "Calm"]),
  "body-mind": createTheme("body-mind", ["Body", "Mind"]),
  "fury-mind": createTheme("fury-mind", ["Fury", "Mind"]),
  "order-chaos": createTheme("order-chaos", ["Order", "Chaos"]),
  "mind-order": createTheme("mind-order", ["Mind", "Order"]),
  "fury-body": createTheme("fury-body", ["Fury", "Body"]),
  "body-chaos": createTheme("body-chaos", ["Body", "Chaos"])
};

const HOME_DECK_THEME_BY_LEGEND = new Map<string, HomeDeckThemeId>();
for (const [themeId, legends] of Object.entries(HOME_DECK_LEGENDS_BY_THEME)) {
  for (const legend of legends) {
    HOME_DECK_THEME_BY_LEGEND.set(legend.toLowerCase(), themeId as HomeDeckThemeId);
  }
}

export function homeDeckThemeForLegend(value: unknown): HomeDeckTheme | null {
  const legend = normalizeLegendName(value).toLowerCase();
  const themeId = HOME_DECK_THEME_BY_LEGEND.get(legend);
  return themeId ? HOME_DECK_THEMES[themeId] : null;
}
