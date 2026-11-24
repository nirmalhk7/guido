import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ToolReadError, type Environment, type Supplier, type Tool } from "./contracts.ts";
import { fixtureTool } from "./fixture.ts";
import { playwrightTool, publicReadUrl } from "./playwright.ts";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const source = z.discriminatedUnion("kind", [
  z.strictObject({ id, kind: z.literal("playwright"), catalogUrl: z.string(), quoteUrl: z.string() }),
  z.strictObject({ id, kind: z.literal("module"), file: z.string().min(1), settings: z.record(z.string(), z.unknown()).default({}) }),
]);
const config = z.array(z.strictObject({
  id, name: z.string().trim().min(1).max(80), sources: z.array(source).min(1).max(3),
})).min(1).max(6).refine((suppliers) => new Set(suppliers.map(({ id }) => id)).size === suppliers.length
  && suppliers.every(({ sources }) => new Set(sources.map(({ id }) => id)).size === sources.length), "Supplier and source IDs must be unique");

export async function loadSuppliers(environment: Environment, filename = process.env.GUIDO_RENTAL_CONFIG): Promise<Supplier[]> {
  if (environment === "fixture") return [{
    id: "sample", name: "Guido Sample Rentals", tools: [{ id: "fixture", environment, create: fixtureTool }],
  }];
  if (!filename) {
    const message = "Configure an authorized Playwright quote source or a rental tool module using GUIDO_RENTAL_CONFIG.";
    return [{
      id: "playwright", name: "Playwright", tools: [{
        id: "playwright", environment, create: () => ({
          async listBranches() { return { branches: [], partialReason: message }; },
          async quote() { return { status: "unavailable", reason: message }; },
        }),
      }],
    }];
  }
  const file = resolve(filename);
  const suppliers = config.parse(JSON.parse(await readFile(file, "utf8")));
  return suppliers.map(({ id, name, sources }) => ({
    id, name, tools: sources.map((source) => {
      if (source.kind === "playwright") {
        publicReadUrl(source.catalogUrl);
        publicReadUrl(source.quoteUrl);
        return { id: source.id, environment, create: () => playwrightTool({
          ...source, executablePath: process.env.GUIDO_CHROMIUM_EXECUTABLE,
        }) };
      }
      const path = isAbsolute(source.file) ? source.file : resolve(dirname(file), source.file);
      const { settings } = source;
      // Modules are trusted deployment code. The client cannot specify a path, URL, or credentials.
      return { id: source.id, environment, create: () => {
        let adapter: Promise<Tool> | undefined;
        function load() {
          adapter ??= import(pathToFileURL(path).href).then(({ createTool }) => {
            if (typeof createTool !== "function") throw new Error();
            return createTool(settings) as Tool;
          }).catch(() => { throw new ToolReadError("The configured tool module could not be loaded."); });
          return adapter;
        }
        return {
          async listBranches(input, signal) { return (await load()).listBranches(input, signal); },
          async quote(input, signal) { return (await load()).quote(input, signal); },
          async close() { await adapter?.then((tool) => tool.close?.()).catch(() => {}); },
        } satisfies Tool;
      } };
    }),
  }));
}
