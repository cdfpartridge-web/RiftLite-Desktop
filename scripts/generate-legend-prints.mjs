import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(projectRoot, "src/shared/generatedLegendPrints.ts");

/** Keep preload's synchronous legend lookup independent of the full card registry. */
export function generatedLegendPrintsSource(registry) {
  const prints = registry.cards
    .filter(card => card.type?.toLowerCase() === "legend")
    .map(card => [
      card.printId,
      card.name,
      [...new Set([card.imageUrl, ...(card.imageUrlAliases || [])].filter(Boolean))],
      [...new Set([card.imageHash, ...(card.imageHashAliases || [])].filter(Boolean))],
    ])
    .sort((left, right) => left[0].localeCompare(right[0], "en", { numeric: true }));
  return [
    "// Generated from resources/riftbound_card_registry.json.",
    "// Refresh with: node scripts/generate-legend-prints.mjs",
    "export const LEGEND_PRINTS: ReadonlyArray<readonly [",
    "  printId: string, name: string, imageUrls: readonly string[], imageHashes: readonly string[]",
    "]> = [",
    ...prints.map(print => `  ${JSON.stringify(print)},`),
    "];",
    "",
  ].join("\n");
}

async function main() {
  const registry = JSON.parse(await readFile(resolve(projectRoot, "resources/riftbound_card_registry.json"), "utf8"));
  const source = generatedLegendPrintsSource(registry);
  if (process.argv.includes("--check")) {
    if (await readFile(outputPath, "utf8") !== source) {
      throw new Error("Legend print lookup is stale. Run node scripts/generate-legend-prints.mjs.");
    }
    console.log("Legend print lookup matches the packaged registry.");
    return;
  }
  await writeFile(outputPath, source, "utf8");
  console.log(`Generated legend print lookup in ${outputPath}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
