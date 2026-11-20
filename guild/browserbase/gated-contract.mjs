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
  start.properties.resultSchema.properties = {
    type: { type: "string", enum: ["object"] },
    properties: { type: "object", additionalProperties: true },
  };
  start.properties.resultSchema.required = ["type", "properties"];
  get.parameters[0].in = "query";
  const disabled = { $ref: "#/components/schemas/GateDisabled" };
  post.responses["200"] = schemaResponse("Rental search disabled", disabled);
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
  contract.components.schemas.GateDisabled = {
    type: "object",
    required: ["status", "reason"],
    properties: {
      status: { type: "string", enum: ["DISABLED"] },
      reason: { type: "string", enum: ["feature_gate_off", "feature_gate_unavailable"] },
    },
  };
  return contract;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log(JSON.stringify(gatedBrowserbaseContract(process.argv[2]), null, 2));
}
