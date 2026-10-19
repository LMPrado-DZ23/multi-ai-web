import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChatToResponsesTransform,
  chatJsonToResponsesJson,
  chatRequestToResponses,
  ResponsesToChatTransform,
  responsesJsonToChatJson,
  responsesRequestToChat,
  TranslateError,
} from "../src/translate.mjs";

test("Responses requests become Chat requests with tools and limits", () => {
  const chat = responsesRequestToChat({
    model: "deepseek-web/chat",
    instructions: "Be brief",
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "oi" }] },
      { type: "function_call", call_id: "call_1", name: "get_time", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "12:00" },
    ],
    max_output_tokens: 256,
    tools: [{ type: "function", name: "get_time", parameters: { type: "object" } }],
    tool_choice: "auto",
  }, "deepseek-web");
  assert.equal(chat.model, "deepseek-web");
  assert.equal(chat.max_tokens, 256);
  assert.deepEqual(chat.messages[0], { role: "system", content: "Be brief" });
  assert.deepEqual(chat.messages[1], { role: "user", content: "oi" });
  assert.equal(chat.messages[2].tool_calls[0].function.name, "get_time");
  assert.deepEqual(chat.messages[3], { role: "tool", tool_call_id: "call_1", content: "12:00" });
  assert.deepEqual(chat.tools[0].function.parameters, { type: "object" });
  assert.equal(chat.tool_choice, "auto");
});

test("image input is rejected explicitly instead of dropped", () => {
  assert.throws(
    () => responsesRequestToChat({
      input: [{ type: "message", role: "user", content: [{ type: "input_image", image_url: "x" }] }],
    }, "deepseek-web"),
    error => error instanceof TranslateError && error.type === "unsupported_input",
  );
});

test("Chat JSON becomes a Responses response with usage and calls", () => {
  const translated = chatJsonToResponsesJson({
    choices: [{
      message: {
        content: "olá",
        tool_calls: [{ id: "call_1", function: { name: "get_time", arguments: "{}" } }],
      },
    }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  }, { model: "deepseek-web/chat", id: "resp_test" });
  assert.equal(translated.status, "completed");
  assert.equal(translated.output[0].content[0].text, "olá");
  assert.equal(translated.output[1].type, "function_call");
  assert.equal(translated.output[1].name, "get_time");
  assert.deepEqual(translated.usage, {
    input_tokens: 3,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 2,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 5,
  });
});

test("Chat SSE becomes Responses SSE with the expected event sequence", () => {
  const translator = new ChatToResponsesTransform({ model: "deepseek-web/chat", responseId: "resp_test" });
  const chunks = [];
  translator.setController({ enqueue: text => chunks.push(text) });
  translator.feed('data: {"choices":[{"delta":{"content":"ol"}}]}\n\n');
  translator.feed('data: {"choices":[{"delta":{"content":"á"}}]}\n\n');
  translator.feed('data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n');
  translator.feed("data: [DONE]\n\n");

  const events = chunks.join("");
  const types = [...events.matchAll(/event: ([a-z_.]+)/g)].map(match => match[1]);
  assert.deepEqual(types, [
    "response.created",
    "response.in_progress",
    "response.output_item.added",
    "response.content_part.added",
    "response.output_text.delta",
    "response.output_text.delta",
    "response.output_text.done",
    "response.content_part.done",
    "response.output_item.done",
    "response.completed",
  ]);
  const completed = JSON.parse(events.split("event: response.completed\ndata: ")[1]);
  assert.equal(completed.response.status, "completed");
  assert.equal(completed.response.output[0].content[0].text, "olá");
  assert.equal(completed.response.usage.total_tokens, 5);
});

test("Chat tool-call deltas become Responses function_call events", () => {
  const translator = new ChatToResponsesTransform({ model: "deepseek-web/chat", responseId: "resp_tool" });
  const chunks = [];
  translator.setController({ enqueue: text => chunks.push(text) });
  translator.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_time","arguments":"{\\"tz\\":"}}]}}]}\n\n');
  translator.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"UTC\\"}"}}]}}]}\n\n');
  translator.feed("data: [DONE]\n\n");
  const events = chunks.join("");
  assert.match(events, /response\.function_call_arguments\.delta/);
  assert.match(events, /response\.function_call_arguments\.done/);
  const completed = JSON.parse(events.split("event: response.completed\ndata: ")[1]);
  assert.equal(completed.response.output[0].type, "function_call");
  assert.equal(completed.response.output[0].name, "get_time");
  assert.equal(completed.response.output[0].arguments, '{"tz":"UTC"}');
});

test("Chat requests become Responses requests with instructions and tools", () => {
  const responses = chatRequestToResponses({
    messages: [
      { role: "system", content: "Be brief" },
      { role: "user", content: "oi" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_time", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "12:00" },
    ],
    max_tokens: 256,
    tools: [{ type: "function", function: { name: "get_time", parameters: { type: "object" } } }],
    tool_choice: { type: "function", function: { name: "get_time" } },
  }, "chatgpt-web/gpt-5.6-sol");
  assert.equal(responses.model, "chatgpt-web/gpt-5.6-sol");
  assert.equal(responses.instructions, "Be brief");
  assert.equal(responses.max_output_tokens, 256);
  assert.deepEqual(responses.input[0], { type: "message", role: "user", content: [{ type: "input_text", text: "oi" }] });
  assert.equal(responses.input[1].type, "function_call");
  assert.equal(responses.input[2].type, "function_call_output");
  assert.equal(responses.tools[0].name, "get_time");
  assert.deepEqual(responses.tool_choice, { type: "function", name: "get_time" });
});

test("Responses JSON becomes Chat JSON with tool calls", () => {
  const chat = responsesJsonToChatJson({
    output: [
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "olá" }] },
      { type: "function_call", call_id: "call_1", name: "get_time", arguments: "{}" },
    ],
    usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
  }, { model: "chatgpt-web/sol", id: "chatcmpl_test" });
  assert.equal(chat.choices[0].message.content, "olá");
  assert.equal(chat.choices[0].message.tool_calls[0].function.name, "get_time");
  assert.equal(chat.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(chat.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
});

test("Responses SSE becomes Chat SSE with usage and tool calls", () => {
  const translator = new ResponsesToChatTransform({ model: "chatgpt-web/sol" });
  const chunks = [];
  translator.setController({ enqueue: text => chunks.push(text) });
  translator.feed('data: {"type":"response.output_text.delta","delta":"ol"}\n\n');
  translator.feed('data: {"type":"response.output_text.delta","delta":"á"}\n\n');
  translator.feed('data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"get_time"}}\n\n');
  translator.feed('data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{}"}\n\n');
  translator.feed('data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}\n\n');
  const events = chunks.join("");
  assert.match(events, /"delta":\{"content":"ol"\}/);
  assert.match(events, /"delta":\{"content":"á"\}/);
  assert.match(events, /"tool_calls":\[\{"index":0/);
  assert.match(events, /"finish_reason":"tool_calls"/);
  assert.match(events, /"total_tokens":5/);
  assert.match(events, /data: \[DONE\]/);
});
