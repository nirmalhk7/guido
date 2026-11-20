import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";

test("Guild can start a scoped Browserbase rental search and retrieve the same run", () => {
  const contract = new URL("../guild/browserbase/openapi.json", import.meta.url);
  assert.ok(existsSync(contract), "Guido needs the Browserbase Agents API contract");
  const { paths, servers, components } = JSON.parse(readFileSync(contract, "utf8"));
  assert.equal(servers[0].url, "https://api.browserbase.com");
  assert.equal(components.securitySchemes.browserbaseKey.name, "X-BB-API-Key");
  assert.deepEqual(Object.keys(paths).sort(), ["/v1/agents/runs", "/v1/agents/runs/{runId}"]);

  const start = paths["/v1/agents/runs"].post;
  const input = z.fromJSONSchema(start.requestBody.content["application/json"].schema);
  const request = {
    task: "Compare automatic rentals at SFO for December 8–11, 2026.",
    browserSettings: { allowedDomains: ["hertz.com", "avis.com", "enterprise.com"] },
    resultSchema: { type: "object", properties: { offers: { type: "array" } } },
  };
  assert.deepEqual(input.parse(request), request);
  assert.equal(input.safeParse({
    ...request,
    browserSettings: { allowedDomains: ["hertz.com", "avis.com", "example.com"] },
  }).success, false);
  assert.equal(input.safeParse({ ...request, browserSettings: {} }).success, false);

  const responseSchema = (operation, status) => {
    const { $ref } = operation.responses[status].content["application/json"].schema;
    assert.equal($ref, "#/components/schemas/Run");
    return z.fromJSONSchema(components.schemas.Run);
  };
  const startOutput = responseSchema(start, "201");
  assert.equal(startOutput.parse({ runId: "run-example", status: "PENDING" }).runId, "run-example");
  const get = paths["/v1/agents/runs/{runId}"].get;
  assert.deepEqual(get.parameters.map(({ name, in: location, required }) => [name, location, required]), [
    ["runId", "path", true],
  ]);
  const getOutput = responseSchema(get, "200");
  const result = { offers: [{ vendor: "Hertz", total: 263.05, currency: "USD" }] };
  assert.deepEqual(getOutput.parse({ runId: "run-example", status: "COMPLETED", result }).result, result);
  assert.equal(getOutput.parse({ runId: "run-example", status: "TIMED_OUT" }).status, "TIMED_OUT");
});
