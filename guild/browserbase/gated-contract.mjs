import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const schemaResponse = (description, schema) => ({
  description,
  content: { "application/json": { schema } },
});

export function gatedBrowserbaseContract(origin) {
  const server = new URL(origin);
  if (server.protocol !== "https:" || server.username || server.password ||
      server.pathname !== "/" || server.search || server.hash) {
    throw new Error("Provide the HTTPS origin of the deployed Guido gateway.");
  }

  const contract = JSON.parse(readFileSync(new URL("./openapi.json", import.meta.url), "utf8"));
  const { post } = contract.paths["/v1/agents/runs"];
  const { get } = contract.paths["/v1/agents/runs/{runId}"];
  const start = post.requestBody.content["application/json"].schema;
  delete start.properties.resultSchema;
  start.required = start.required.filter((field) => field !== "resultSchema");
  const vehicleClass = { type: "string", enum: ["sedan", "premium sedan", "SUV", "premium SUV", "pickup truck"] };
  const traceId = { type: "string", format: "uuid", description: "Copy rental_trace_id from Guido's input when supplied." };
  start.properties.provider = { type: "string", enum: ["browserbase", "firedrill"] };
  start.properties.traceId = traceId;
  start.properties.rentalRequirements = {
    type: "object",
    additionalProperties: false,
    required: ["pickupLocation", "returnLocation", "pickupAt", "returnAt"],
    properties: {
      pickupLocation: { type: "string", maxLength: 120 },
      returnLocation: { type: "string", maxLength: 120 },
      pickupAt: { type: "string", format: "date-time" },
      returnAt: { type: "string", format: "date-time" },
      vehicleClasses: { type: "array", minItems: 1, maxItems: 5, items: vehicleClass },
      maxTotalUsd: { type: "number", minimum: 0 },
    },
  };
  post.description = "Start a live Browserbase search or return simulated Firedrill quotes using the selected provider.";
  get.parameters[0].in = "query";
  get.parameters.push({ name: "traceId", in: "query", schema: traceId });
  const disabled = { $ref: "#/components/schemas/GateDisabled" };
  post.responses["200"] = schemaResponse("Firedrill simulated quotes or rental search disabled", {
    oneOf: [{ $ref: "#/components/schemas/SimulatedQuotes" }, disabled],
  });
  get.responses["200"] = schemaResponse("Run status or rental search disabled", {
    oneOf: [{ $ref: "#/components/schemas/Run" }, disabled],
  });
  contract.info.title = "Guido Browserbase with Statsig";
  contract.paths = { "/api/browserbase": { post, get } };
  contract.servers = [{ url: server.origin }];
  contract.security = [{ guidoGatewayKey: [] }];
  contract.components.securitySchemes = {
    guidoGatewayKey: { type: "apiKey", in: "header", name: "X-Guido-Tool-Key" },
  };
  contract.components.schemas.SimulatedQuotes = {
    type: "object",
    required: ["status", "source", "simulated", "quotes"],
    properties: {
      status: { type: "string", enum: ["SIMULATED"] },
      source: { type: "string", enum: ["Firedrill"] },
      simulated: { type: "boolean", enum: [true] },
      quotes: {
        type: "array",
        items: {
          type: "object",
          required: ["vendor", "vehicleClass", "currency", "totalCents"],
          properties: {
            vendor: { type: "string", enum: ["Hertz", "Avis", "Enterprise"] },
            vehicleClass,
            currency: { type: "string", enum: ["USD"] },
            totalCents: { type: "integer", minimum: 0 },
          },
        },
      },
    },
  };
  contract.components.schemas.GateDisabled = {
    type: "object",
    required: ["status", "reason"],
    properties: {
      status: { type: "string", enum: ["DISABLED"] },
      reason: { type: "string", enum: ["feature_gate_off", "feature_gate_unavailable", "provider_changed", "simulation_unavailable", "browserbase_quota_exhausted"] },
    },
  };
  return contract;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(gatedBrowserbaseContract(process.argv[2]), null, 2));
}
