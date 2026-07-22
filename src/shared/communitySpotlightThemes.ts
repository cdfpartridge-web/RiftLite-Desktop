export const COMMUNITY_SPOTLIGHT_IDS = [
  "riftlab",
  "runesandrift",
  "challengertcg",
  "noveggies",
  "dunc",
  "ritualtcg",
  "winthepanda",
  "maskedswan",
  "agitoswiftly",
  "mrtoolshed",
  "daemonxgg",
  "arg0ntcg"
] as const;

export type CommunitySpotlightId = typeof COMMUNITY_SPOTLIGHT_IDS[number];
export type CssHexColor = `#${string}`;

export interface CommunitySpotlightTheme {
  readonly primary: CssHexColor;
  readonly secondary: CssHexColor;
}

export const DEFAULT_COMMUNITY_SPOTLIGHT_THEME: CommunitySpotlightTheme = {
  primary: "#28D7FF",
  secondary: "#6B7D99"
};

export const COMMUNITY_SPOTLIGHT_THEMES = {
  riftlab: { primary: "#0F7AF2", secondary: "#DB2629" },
  runesandrift: { primary: "#F3550F", secondary: "#1D2F43" },
  challengertcg: { primary: "#D52826", secondary: "#8FA0AF" },
  noveggies: { primary: "#D72700", secondary: "#7A3518" },
  dunc: { primary: "#37D9FF", secondary: "#8A55FF" },
  ritualtcg: { primary: "#FF7A1A", secondary: "#58E7FF" },
  winthepanda: { primary: "#44506D", secondary: "#B89B6C" },
  maskedswan: { primary: "#D65A2E", secondary: "#315B73" },
  agitoswiftly: { primary: "#EF7C00", secondary: "#C83A52" },
  mrtoolshed: { primary: "#356BFF", secondary: "#D94B80" },
  daemonxgg: { primary: "#E37B0E", secondary: "#45A66E" },
  arg0ntcg: { primary: "#3D8FB8", secondary: "#D2DEE8" }
} as const satisfies Record<CommunitySpotlightId, CommunitySpotlightTheme>;

export function communitySpotlightTheme(value: unknown): CommunitySpotlightTheme {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return COMMUNITY_SPOTLIGHT_THEMES[id as CommunitySpotlightId] ?? DEFAULT_COMMUNITY_SPOTLIGHT_THEME;
}
