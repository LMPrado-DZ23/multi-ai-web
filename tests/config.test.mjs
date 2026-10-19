import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConfig, findModel } from "../src/config.mjs";

function base() {
  return {
    version: 1,
    host: "127.0.0.1",
    port: 17900,
    authToken: null,
    providers: [{
      id: "deepseek-web",
      baseUrl: "http://127.0.0.1:8787",
      dialect: "chat",
      models: [{ id: "chat", hubId: "deepseek-web/chat", upstreamModel: "deepseek-web" }],
    }],
  };
}

test("accepts the documented shape and defaults", () => {
  const config = validateConfig(base());
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 17900);
  assert.equal(config.providers[0].label, "deepseek-web");
  assert.equal(config.providers[0].healthPath, "/health");
  assert.deepEqual(config.providers[0].models[0].hubId, "deepseek-web/chat");
  assert.equal(config.providers[0].models[0].contextWindow, null);
});

test("rejects invalid configuration instead of starting", () => {
  const cases = [
    ["non-loopback host", { ...base(), host: "0.0.0.0" }],
    ["bad port", { ...base(), port: 0 }],
    ["short token", { ...base(), authToken: "short" }],
    ["empty providers", { ...base(), providers: [] }],
    ["duplicate providers", { ...base(), providers: [
      { id: "a", baseUrl: "http://127.0.0.1:1", dialect: "chat", models: [{ id: "m" }] },
      { id: "a", baseUrl: "http://127.0.0.1:2", dialect: "chat", models: [{ id: "m" }] },
    ] }],
    ["bad dialect", { ...base(), providers: [{ id: "a", baseUrl: "http://127.0.0.1:1", dialect: "api", models: [{ id: "m" }] }] }],
    ["bad url", { ...base(), providers: [{ id: "a", baseUrl: "ftp://x", dialect: "chat", models: [{ id: "m" }] }] }],
    ["hub id outside provider", { ...base(), providers: [{ id: "a", baseUrl: "http://127.0.0.1:1", dialect: "chat", models: [{ id: "m", hubId: "b/m" }] }] }],
    ["duplicate hub ids", { ...base(), providers: [{
      id: "a",
      baseUrl: "http://127.0.0.1:1",
      dialect: "chat",
      models: [{ id: "m", hubId: "a/m" }, { id: "m2", hubId: "a/m" }],
    }] }],
    ["empty models", { ...base(), providers: [{ id: "a", baseUrl: "http://127.0.0.1:1", dialect: "chat", models: [] }] }],
  ];
  for (const [label, raw] of cases) {
    assert.throws(() => validateConfig(raw), Error, label);
  }
});

test("resolves hub model ids and rewrites to the upstream model", () => {
  const config = validateConfig(base());
  const found = findModel(config, "deepseek-web/chat");
  assert.equal(found.provider.id, "deepseek-web");
  assert.equal(found.model.upstreamModel, "deepseek-web");
  assert.equal(findModel(config, "deepseek-web/unknown"), undefined);
  assert.equal(findModel(config, "unknown/chat"), undefined);
  assert.equal(findModel(config, "no-slash"), undefined);
});
