import assert from "node:assert/strict";
import test from "node:test";
import agent from "../agent/agent.ts";

test("Guido sends GPT-5 mini requests directly to OpenAI using OPENAI_API_KEY", async (context) => {
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
  context.mock.method(globalThis, "fetch", async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.headers.get("authorization"), "Bearer test-openai-key");
    assert.equal((await request.json()).model, "gpt-5-mini");
    return Response.json({ error: { message: "Synthetic provider rejection", type: "invalid_request_error" } }, {
      status: 401,
    });
  });

  assert.equal(typeof agent.model?.doGenerate, "function", "Guido needs a direct provider model");
  await assert.rejects(agent.model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: "Hello, Guido." }] }],
  }), /Synthetic provider rejection/);
});
