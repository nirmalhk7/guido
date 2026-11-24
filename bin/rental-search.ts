import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { ZodError } from "zod";
import { loadSuppliers } from "../lib/rental/config.ts";
import { tripSchema } from "../lib/rental/contracts.ts";
import { compareRentals } from "../lib/rental/search.ts";

async function main() {
  const { values, positionals } = parseArgs({
    options: { fixture: { type: "boolean" }, config: { type: "string" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  const usage = "Usage: npm run rental:search -- [--fixture] [--config providers.json] <trip.json|->";
  if (values.help) return console.log(usage);
  if (positionals.length !== 1) throw new Error(usage);
  const [file] = positionals;
  const raw = file === "-" ? await text(process.stdin)
    : await readFile(file, "utf8");
  const trip = tripSchema.parse(JSON.parse(raw));
  const environment = values.fixture ? "fixture" : "live";
  const suppliers = await loadSuppliers(environment, values.config);
  const search = await compareRentals(trip, suppliers, environment);
  console.log(JSON.stringify(search, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof ZodError
    ? error.issues.map(({ path, message }) => `${path.join(".")}: ${message}`).join("\n")
    : error instanceof SyntaxError ? "Trip or provider configuration is not valid JSON."
    : error instanceof Error ? error.message : "Rental search failed.";
  console.error(message);
  process.exitCode = 1;
});
