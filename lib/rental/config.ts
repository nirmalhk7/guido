import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { supplierLimitsSchema, ToolReadError, type Environment, type Supplier, type Tool } from "./contracts.ts";
import { fixtureTool } from "./fixture.ts";
import { playwrightTool, publicReadUrl } from "./playwright.ts";
import { travelportTool } from "./providers/travelport.ts";

const brands = { hertz: "Hertz", avis: "Avis", enterprise: "Enterprise" } as const;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const source = z.discriminatedUnion("kind", [
  z.strictObject({ id, kind: z.literal("playwright"), catalogUrl: z.string(), quoteUrl: z.string() }),
  z.strictObject({
    id, kind: z.literal("travelport"),
    region: z.enum(["americas", "emea", "apac"]),
    markets: z.record(z.string().trim().min(1).max(160),
      z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).max(20).transform((codes) => [...new Set(codes)])).default({}),
  }),
  z.strictObject({
    id, kind: z.literal("module"), file: z.string().min(1),
    catalogByDate: z.boolean().optional(),
    settings: z.record(z.string(), z.unknown()).default({}),
  }),
]);
const config = z.array(z.strictObject({
  id: z.enum(["hertz", "avis", "enterprise"]),
  name: z.string().trim().min(1).max(80).optional(),
  limits: supplierLimitsSchema.partial().optional(),
  sources: z.array(source).min(1).max(3),
})).max(3).refine((suppliers) => new Set(suppliers.map(({ id }) => id)).size === suppliers.length
  && suppliers.every(({ sources }) => new Set(sources.map(({ id }) => id)).size === sources.length), "Supplier and source IDs must be unique");

function moduleTool(path: string, settings: Record<string, unknown>): Tool {
  // Modules are trusted deployment code. Search requests cannot select paths or credentials.
  let adapter: Promise<Tool> | undefined;
  function load() {
    adapter ??= import(pathToFileURL(path).href).then(({ createTool }) => {
      if (typeof createTool !== "function") throw new Error();
      return createTool(settings) as Tool;
    }).catch(() => { throw new ToolReadError("The configured tool module could not be loaded.", true); });
    return adapter;
  }
  return {
    async listBranches(input, signal) { return (await load()).listBranches(input, signal); },
    async quote(input, signal) { return (await load()).quote(input, signal); },
    async close() { await adapter?.then((tool) => tool.close?.()).catch(() => {}); },
  };
}

export async function loadSuppliers(environment: Environment, filename = process.env.GUIDO_RENTAL_CONFIG): Promise<Supplier[]> {
  if (environment === "fixture") return [{
    id: "sample", name: "Guido Sample Rentals", tools: [{ id: "fixture", environment, create: fixtureTool }],
  }];
  const file = filename ? resolve(filename) : undefined;
  const suppliers = file ? config.parse(JSON.parse(await readFile(file, "utf8"))) : [];
  const configured = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  return (Object.keys(brands) as (keyof typeof brands)[]).map((brand) => {
    const supplier = configured.get(brand);
    return {
      id: brand,
      name: supplier?.name ?? brands[brand],
      limits: supplier ? {
        ...supplier.limits, intervalMs: supplier.limits?.intervalMs ?? (supplier.sources.some(({ kind }) => kind === "travelport") ? 750 : 250),
      } : undefined,
      tools: supplier?.sources.map((source) => {
        if (source.kind === "travelport") {
          return { id: source.id, environment, catalogByDate: true, create: () => travelportTool(brand, source, {
            username: process.env.GUIDO_TRAVELPORT_USERNAME,
            password: process.env.GUIDO_TRAVELPORT_PASSWORD,
            targetBranch: process.env.GUIDO_TRAVELPORT_TARGET_BRANCH,
          }) };
        }
        if (source.kind === "playwright") {
          publicReadUrl(source.catalogUrl);
          publicReadUrl(source.quoteUrl);
          return { id: source.id, environment, create: () => playwrightTool({
            ...source, executablePath: process.env.GUIDO_CHROMIUM_EXECUTABLE,
          }) };
        }
        const path = isAbsolute(source.file) ? source.file : resolve(dirname(file!), source.file);
        return { id: source.id, environment, catalogByDate: source.catalogByDate, create: () => moduleTool(path, source.settings) };
      }) ?? [],
    };
  });
}
