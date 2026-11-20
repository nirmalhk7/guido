import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("the Guild Cognee integration indexes and recalls notes through scoped JSON operations", () => {
  const url = new URL("../guild/cognee/openapi.json", import.meta.url);
  assert.ok(existsSync(url), "Guido needs a Cognee integration contract for Guild");
  const { paths } = JSON.parse(readFileSync(url, "utf8"));
  assert.deepEqual(Object.keys(paths).sort(), ["/api/v1/add_text", "/api/v1/cognify", "/api/v1/recall"]);

  const save = paths["/api/v1/add_text"].post.requestBody.content["application/json"].schema;
  const index = paths["/api/v1/cognify"].post.requestBody.content["application/json"].schema;
  const recall = paths["/api/v1/recall"].post.requestBody.content["application/json"].schema;
  assert.deepEqual(save.properties.datasetName.enum, ["guido_tokensandhackathon"]);
  assert.deepEqual(recall.properties.datasets.items.enum, ["guido_tokensandhackathon"]);
  assert.equal(recall.properties.datasets.minItems, 1);
  assert.equal(recall.properties.datasets.maxItems, 1);
  assert.deepEqual(index.properties.datasets, recall.properties.datasets);
  assert.equal(index.properties.runInBackground.type, "boolean");
  assert.ok(index.required.includes("runInBackground") && index.required.includes("datasets"));
  assert.deepEqual(recall.properties.topK, { type: "integer", minimum: 5, maximum: 5 });
  assert.equal(JSON.stringify(paths).includes("X-Tenant-Id"), false, "Guild must inject the tenant header server-side");
  assert.ok(save.required.includes("datasetName") && save.required.includes("textData"));
  assert.ok(recall.required.includes("datasets") && recall.required.includes("query"));
  assert.equal(save.additionalProperties, false);
  assert.equal(index.additionalProperties, false);
  assert.equal(recall.additionalProperties, false);
});
