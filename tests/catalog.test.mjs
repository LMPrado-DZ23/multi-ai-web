import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModelsResponse } from "../src/catalog.mjs";
import { validateConfig } from "../src/config.mjs";

const config = validateConfig({
  version: 1,
  host: "127.0.0.1",
  port: 17900,
  authToken: null,
  providers: [
    {
      id: "deepseek-web",
      label: "DeepSeek Web",
      baseUrl: "http://127.0.0.1:8787",
      dialect: "chat",
      models: [
        { id: "chat", hubId: "deepseek-web/chat", upstreamModel: "deepseek-web", displayName: "DeepSeek Web (Chat)", contextWindow: 131072 },
        { id: "think", hubId: "deepseek-web/think", upstreamModel: "deepseek-web-think", displayName: "DeepSeek Web (Think)", contextWindow: 131072, thinking: true },
      ],
    },
    {
      id: "chatgpt-web",
      label: "ChatGPT Web",
      baseUrl: "http://127.0.0.1:17841",
      dialect: "responses",
      models: [{ id: "gpt-5.6-sol", hubId: "chatgpt-web/gpt-5.6-sol", upstreamModel: "chatgpt-web/gpt-5.6-sol", displayName: "ChatGPT Web (Sol)", contextWindow: 256000 }],
    },
  ],
});

test("the catalogue preserves provider order and prefixes every model", () => {
  const models = buildModelsResponse(config);
  assert.deepEqual(models.data.map(model => model.id), [
    "deepseek-web/chat",
    "deepseek-web/think",
    "chatgpt-web/gpt-5.6-sol",
  ]);
  assert.deepEqual(models.data.map(model => model.provider), ["deepseek-web", "deepseek-web", "chatgpt-web"]);
  assert.equal(models.data[1].capabilities.thinking, true);
  assert.equal(models.data[2].dialect, "responses");
  assert.equal(models.data[2].context_window, 256000);
});
