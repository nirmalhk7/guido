import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

export default defineAgent({
  defaultTools: false,
  model: mockModel({
    respond: ({ toolResults }) => {
      const results = toolResults.map(({ output }) => JSON.stringify(output)).join("\n");
      const reference = results.match(/CEDAR-482/)?.[0];
      if (reference) return `Draft reply: Thanks, I received the briefing reference ${reference}.`;
      if (results.includes("briefing@fixture.invalid")) {
        return {
          toolCalls: [{ name: "read_message", input: { messageId: "<briefing@fixture.invalid>" } }],
        };
      }
      return { toolCalls: [{ name: "list_messages", input: {} }] };
    },
  }),
});
