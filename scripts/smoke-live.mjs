#!/usr/bin/env node
/**
 * Opt-in live smoke: requires a running hub plus at least one healthy chat-dialect bridge.
 * Never prints cookies or prompt bodies; only status, model ids and the assistant reply length.
 */
import { loadConfigFile } from "../src/config.mjs";

const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const configPath = configIndex >= 0 ? args[configIndex + 1] : (process.env.HUB_CONFIG ?? "config.json");
const config = loadConfigFile(configPath);
const base = `http://${config.host}:${config.port}`;
const headers = config.authToken ? { authorization: `Bearer ${config.authToken}` } : {};

const health = await (await fetch(`${base}/health`)).json();
console.log("health:", JSON.stringify(health));
if (!health.ok) {
  console.log("some providers are down; the smoke continues with the healthy ones");
}

const models = await (await fetch(`${base}/v1/models`, { headers })).json();
console.log("catalogue:", models.data.map(model => model.id).join(", "));

let checked = 0;
let failed = 0;
for (const provider of config.providers) {
  const status = health.providers.find(candidate => candidate.id === provider.id);
  if (!status?.ok) {
    console.log(`skip ${provider.id}: provider is not healthy`);
    continue;
  }
  if (provider.dialect !== "chat") {
    console.log(`skip ${provider.id}: live smoke currently exercises the chat frontend only`);
    continue;
  }
  const model = provider.models[0];
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      model: model.hubId,
      stream: false,
      messages: [{ role: "user", content: "Reply with exactly: HUB-OK" }],
    }),
  });
  checked += 1;
  if (!response.ok) {
    failed += 1;
    console.log(`FAIL ${provider.id}: HTTP ${response.status}`);
    continue;
  }
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content ?? "";
  console.log(`${text.includes("HUB-OK") ? "PASS" : "FAIL"} ${provider.id}: replyLength=${text.length} exactMatch=${text.trim() === "HUB-OK"}`);
  if (text.trim() !== "HUB-OK") failed += 1;
}

console.log(`smoke: ${checked - failed}/${checked} checked turn(s) passed`);
if (checked === 0) {
  console.log("no healthy chat-dialect provider was available; start a bridge and retry");
  process.exitCode = 2;
} else if (failed > 0) {
  process.exitCode = 1;
}
