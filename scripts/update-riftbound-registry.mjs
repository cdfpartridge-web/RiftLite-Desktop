import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistry } from "./riftbound-registry-lib.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  endpoint: "https://api.riftcodex.com/cards",
  expectations: resolve(projectRoot, "resources", "riftbound_card_registry_expectations.json"),
  output: resolve(projectRoot, "resources", "riftbound_card_registry.json"),
  overlay: resolve(projectRoot, "resources", "riftbound_card_registry_overlay.json"),
  sets: ["OGN", "OGS", "SFD", "UNL", "VEN"],
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [expectations, overlay] = await Promise.all([
    readJson(options.expectations),
    readJson(options.overlay),
  ]);

  const registry = await buildRegistry({
    endpoint: options.endpoint,
    setCodes: options.sets,
    expectations,
    overlay,
  });

  if (options.dryRun) {
    console.log(summary(registry, "validated (dry run)"));
    return;
  }

  await atomicWriteJson(options.output, registry);
  console.log(summary(registry, `written to ${options.output}`));
}

function parseArgs(args) {
  const options = { ...defaults, dryRun: false, sets: [...defaults.sets] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run" || arg === "--check") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    index += 1;
    if (arg === "--endpoint") options.endpoint = value;
    else if (arg === "--expectations") options.expectations = resolve(value);
    else if (arg === "--output") options.output = resolve(value);
    else if (arg === "--overlay") options.overlay = resolve(value);
    else if (arg === "--sets") options.sets = value.split(",").map((entry) => entry.trim()).filter(Boolean);
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function readJson(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function atomicWriteJson(outputPath, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(serialized);
  const tempPath = resolve(dirname(outputPath), `.${basename(outputPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, serialized, { encoding: "utf8", flag: "wx" });
    const written = JSON.parse(await readFile(tempPath, "utf8"));
    if (written.schemaVersion !== value.schemaVersion || written.cards?.length !== value.cards.length) {
      throw new Error("Temporary registry verification failed");
    }
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function summary(registry, action) {
  const sets = Object.entries(registry.stats.bySet)
    .map(([setCode, stats]) => `${setCode} ${stats.uniquePrints}`)
    .join(", ");
  return [
    `Riftbound registry ${action}.`,
    `${registry.stats.uniquePrints} unique prints from ${registry.stats.rawRecords} API rows (${sets}).`,
    `${registry.stats.uniqueImageHashes} Riot image hashes and ${registry.specialBattlefields.length} local special battlefields validated.`,
  ].join("\n");
}

function printHelp() {
  console.log(`Usage: node scripts/update-riftbound-registry.mjs [options]\n\nOptions:\n  --dry-run, --check       Fetch and validate without writing\n  --sets OGN,SFD           Override the default set list\n  --endpoint URL           Override the RiftCodex cards endpoint\n  --expectations PATH      Validation expectations JSON\n  --overlay PATH           Local overlay JSON\n  --output PATH            Registry output JSON`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Existing registry was not replaced.");
  process.exitCode = 1;
});
