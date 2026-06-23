const MASTER_YI_WUJU_BLADESMAN = "Master Yi, Wuju Bladesman";
const MASTER_YI_WUJU_MASTER = "Master Yi, Wuju Master";

export const CANONICAL_LEGEND_NAMES = [
  "Ahri",
  "Annie",
  "Azir",
  "Darius",
  "Diana",
  "Draven",
  "Ezreal",
  "Fiora",
  "Garen",
  "Irelia",
  "Ivern",
  "Jax",
  "Jhin",
  "Jinx",
  "Kai'Sa",
  "Kha'Zix",
  "LeBlanc",
  "Lee Sin",
  "Leona",
  "Lillia",
  "Lucian",
  "Lux",
  "Master Yi",
  MASTER_YI_WUJU_MASTER,
  MASTER_YI_WUJU_BLADESMAN,
  "Miss Fortune",
  "Ornn",
  "Poppy",
  "Pyke",
  "Rek'Sai",
  "Renata Glasc",
  "Rengar",
  "Sett",
  "Sivir",
  "Teemo",
  "Vex",
  "Vi",
  "Viktor",
  "Volibear",
  "Yasuo"
];

const LEGEND_ALIAS_MAP: Record<string, string> = {
  "alluring": "Ahri",
  "inquisitive": "Ahri",
  "nine-tailed fox": "Ahri",
  "dark child": "Annie",
  "emperor of the sands": "Azir",
  "trifarian": "Darius",
  "hand of noxus": "Darius",
  "lunari": "Diana",
  "scorn of the moon": "Diana",
  "showboat": "Draven",
  "audacious": "Draven",
  "vanquisher": "Draven",
  "glorious executioner": "Draven",
  "dashing": "Ezreal",
  "prodigy": "Ezreal",
  "prodigal explorer": "Ezreal",
  "victorious": "Fiora",
  "grand duelist": "Fiora",
  "might of demacia": "Garen",
  "fervent": "Irelia",
  "blade dancer": "Irelia",
  "green father": "Ivern",
  "grandmaster at arms": "Jax",
  "virtuoso": "Jhin",
  "demolitionist": "Jinx",
  "rebel": "Jinx",
  "loose cannon": "Jinx",
  "survivor": "Kai'Sa",
  "evolutionary": "Kai'Sa",
  "daughter of the void": "Kai'Sa",
  "evolving hunter": "Kha'Zix",
  "voidreaver": "Kha'Zix",
  "everywhere at once": "LeBlanc",
  "deceiver": "LeBlanc",
  "ascetic": "Lee Sin",
  "blind monk": "Lee Sin",
  "zealot": "Leona",
  "determined": "Leona",
  "radiant dawn": "Leona",
  "protector of dreams": "Lillia",
  "bashful bloom": "Lillia",
  "gunslinger": "Lucian",
  "merciless": "Lucian",
  "purifier": "Lucian",
  "lady of luminosity": "Lux",
  "wuju bladesman": MASTER_YI_WUJU_BLADESMAN,
  "wuju master": MASTER_YI_WUJU_MASTER,
  "wuji master": MASTER_YI_WUJU_MASTER,
  "unstoppable": "Master Yi",
  "tempered": "Master Yi",
  "captain": "Miss Fortune",
  "bounty hunter": "Miss Fortune",
  "blacksmith": "Ornn",
  "fire below the mountain": "Ornn",
  "keeper of the hammer": "Poppy",
  "dockside butcher": "Pyke",
  "bloodharbor ripper": "Pyke",
  "breacher": "Rek'Sai",
  "swarm queen": "Rek'Sai",
  "void burrower": "Rek'Sai",
  "chem-baroness": "Renata Glasc",
  "mastermind": "Renata Glasc",
  "pouncing": "Rengar",
  "pridestalker": "Rengar",
  "brawler": "Sett",
  "kingpin": "Sett",
  "the boss": "Sett",
  "ambitious": "Sivir",
  "battle mistress": "Sivir",
  "strategist": "Teemo",
  "swift scout": "Teemo",
  "gloomist": "Vex",
  "cheerless": "Vex",
  "apathetic": "Vex",
  "mocking": "Vex",
  "piltover enforcer": "Vi",
  "innovator": "Viktor",
  "herald of the arcane": "Viktor",
  "furious": "Volibear",
  "relentless storm": "Volibear",
  "stormbringer": "Volibear",
  "remorseful": "Yasuo",
  "unforgiven": "Yasuo"
};

export function normalizeLegendName(value: unknown): string {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }

  const lower = cleaned.toLowerCase();
  if (lower.startsWith("master yi")) {
    if (lower.includes("wuju bladesman")) {
      return MASTER_YI_WUJU_BLADESMAN;
    }
    if (lower.includes("wuji master") || lower.includes("wuju master")) {
      return MASTER_YI_WUJU_MASTER;
    }
    return "Master Yi";
  }

  const alias = legendAlias(cleaned);
  if (alias) {
    return alias;
  }
  const canonical = canonicalLegend(cleaned);
  if (canonical) {
    return canonical;
  }

  const primary = cleaned.split(",")[0]?.trim() || cleaned;
  return legendAlias(primary) ?? canonicalLegend(primary) ?? primary;
}

export function canonicalLegendName(value: unknown): string {
  return canonicalLegend(normalizeLegendName(value)) ?? "";
}

export function isCanonicalLegendName(value: unknown): boolean {
  return Boolean(canonicalLegendName(value));
}

export function legendAliasesFor(value: unknown): string[] {
  const canonical = canonicalLegendName(value);
  if (!canonical) {
    return [];
  }
  return Object.entries(LEGEND_ALIAS_MAP)
    .filter(([, legend]) => legend === canonical)
    .map(([alias]) => alias)
    .sort((a, b) => a.localeCompare(b));
}

export function normalizeLegendFields<T extends { myChampion: string; opponentChampion: string }>(match: T): T {
  return {
    ...match,
    myChampion: normalizeLegendName(match.myChampion),
    opponentChampion: normalizeLegendName(match.opponentChampion)
  };
}

function normalizeAliasKey(value: string): string {
  return value
    .replace(/\s+-\s+starter$/i, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function legendAlias(value: string): string | undefined {
  const key = normalizeAliasKey(value);
  const exact = LEGEND_ALIAS_MAP[key];
  if (exact) {
    return exact;
  }
  const padded = ` ${key.replace(/[^a-z0-9']/g, " ")} `.replace(/\s+/g, " ");
  for (const [alias, legend] of Object.entries(LEGEND_ALIAS_MAP).sort((a, b) => b[0].length - a[0].length)) {
    const needle = ` ${alias.replace(/[^a-z0-9']/g, " ")} `.replace(/\s+/g, " ");
    if (needle.trim().length > 5 && padded.includes(needle)) {
      return legend;
    }
  }
  return undefined;
}

function canonicalLegend(value: string): string | undefined {
  const key = canonicalKey(value);
  return CANONICAL_LEGEND_NAMES.find((legend) => canonicalKey(legend) === key);
}

function canonicalKey(value: string): string {
  return normalizeAliasKey(value).replace(/[^a-z0-9]/g, "");
}
