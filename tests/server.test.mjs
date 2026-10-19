import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { validateConfig } from "../src/config.mjs";
import { createHubServer } from "../src/server.mjs";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

function createMockUpstream() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    requests.push({ path: request.url, body });
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    if (request.url?.startsWith("/v1/chat/completions")) {
      if (body?.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "olá" } }] })}\n\n`);
        response.end("data: [DONE]\n\n");
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "chatcmpl-test", choices: [{ message: { role: "assistant", content: "olá" } }] }));
      }
      return;
    }
    if (request.url?.startsWith("/v1/responses")) {
      if (body?.stream === true) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "olá" })}\n\n`);
        response.end(`data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } })}\n\n`);
      } else {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          id: "resp_mock",
          object: "response",
          status: "completed",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "olá" }] }],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        }));
      }
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  return { server, requests };
}

function providers(chatUrl, responsesUrl) {
  return [
    {
      id: "deepseek-web",
      baseUrl: chatUrl,
      dialect: "chat",
      models: [{ id: "chat", hubId: "deepseek-web/chat", upstreamModel: "deepseek-web" }],
    },
    {
      id: "chatgpt-web",
      baseUrl: responsesUrl,
      dialect: "responses",
      models: [{ id: "sol", hubId: "chatgpt-web/sol", upstreamModel: "chatgpt-web/gpt-5.6-sol" }],
    },
  ];
}

async function startHub(providerList, options = {}) {
  const config = validateConfig({
    version: 1,
    host: "127.0.0.1",
    port: 17900,
    authToken: options.authToken ?? null,
    providers: providerList,
  });
  const server = createHubServer(config, options);
  const port = await listen(server);
  return { server, config, base: `http://127.0.0.1:${port}` };
}

async function withUpstreams(run) {
  const chat = createMockUpstream();
  const responses = createMockUpstream();
  const chatUrl = `http://127.0.0.1:${await listen(chat.server)}`;
  const responsesUrl = `http://127.0.0.1:${await listen(responses.server)}`;
  try {
    await run({ chat, responses, chatUrl, responsesUrl });
  } finally {
    await close(chat.server);
    await close(responses.server);
  }
}

test("catalogue and health expose both providers in order", async () => {
  await withUpstreams(async ({ chatUrl, responsesUrl }) => {
    const hub = await startHub(providers(chatUrl, responsesUrl));
    try {
      const models = await (await fetch(`${hub.base}/v1/models`)).json();
      assert.deepEqual(models.data.map(model => model.id), ["deepseek-web/chat", "chatgpt-web/sol"]);
      const health = await (await fetch(`${hub.base}/health`)).json();
      assert.equal(health.ok, true);
      assert.deepEqual(health.providers.map(provider => provider.id), ["deepseek-web", "chatgpt-web"]);
    } finally {
      await close(hub.server);
    }
  });
});

test("chat completions are proxied byte-faithfully and the model is rewritten", async () => {
  await withUpstreams(async ({ chat, chatUrl, responsesUrl }) => {
    const hub = await startHub(providers(chatUrl, responsesUrl));
    try {
      const response = await fetch(`${hub.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-web/chat", stream: true, messages: [{ role: "user", content: "oi" }] }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/event-stream");
      const text = await response.text();
      assert.match(text, /"delta":\{"content":"olá"\}/);
      assert.match(text, /data: \[DONE\]/);
      const upstreamCall = chat.requests.find(request => request.path?.startsWith("/v1/chat/completions"));
      assert.equal(upstreamCall.body.model, "deepseek-web");
      assert.equal(upstreamCall.body.stream, true);
    } finally {
      await close(hub.server);
    }
  });
});

test("responses are proxied to the Responses bridge with the upstream model", async () => {
  await withUpstreams(async ({ responses, chatUrl, responsesUrl }) => {
    const hub = await startHub(providers(chatUrl, responsesUrl));
    try {
      const response = await fetch(`${hub.base}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "chatgpt-web/sol", stream: true, input: "oi" }),
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.match(text, /response\.output_text\.delta/);
      const upstreamCall = responses.requests.find(request => request.path?.startsWith("/v1/responses"));
      assert.equal(upstreamCall.body.model, "chatgpt-web/gpt-5.6-sol");
    } finally {
      await close(hub.server);
    }
  });
});

test("a Chat frontend reaches a Responses bridge through the translator", async () => {
  await withUpstreams(async ({ responses, chatUrl, responsesUrl }) => {
    const hub = await startHub(providers(chatUrl, responsesUrl));
    try {
      const nonStream = await fetch(`${hub.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "chatgpt-web/sol", messages: [{ role: "user", content: "oi" }] }),
      });
      assert.equal(nonStream.status, 200);
      const body = await nonStream.json();
      assert.equal(body.choices[0].message.content, "olá");
      assert.deepEqual(body.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });

      const upstreamCall = responses.requests.find(request => request.path?.startsWith("/v1/responses"));
      assert.equal(upstreamCall.body.model, "chatgpt-web/gpt-5.6-sol");
      assert.deepEqual(upstreamCall.body.input, [
        { type: "message", role: "user", content: [{ type: "input_text", text: "oi" }] },
      ]);

      const streamed = await fetch(`${hub.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "chatgpt-web/sol", stream: true, messages: [{ role: "user", content: "oi" }] }),
      });
      assert.equal(streamed.status, 200);
      assert.match(streamed.headers.get("content-type"), /text\/event-stream/);
      const text = await streamed.text();
      assert.match(text, /"delta":\{"content":"olá"\}/);
      assert.match(text, /"finish_reason":"stop"/);
      assert.match(text, /data: \[DONE\]/);
    } finally {
      await close(hub.server);
    }
  });
});

test("a Responses frontend reaches a Chat bridge through the translator", async () => {
  await withUpstreams(async ({ chat, chatUrl, responsesUrl }) => {
    const hub = await startHub(providers(chatUrl, responsesUrl));
    try {
      const nonStream = await fetch(`${hub.base}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-web/chat", stream: false, input: "oi" }),
      });
      assert.equal(nonStream.status, 200);
      const body = await nonStream.json();
      assert.equal(body.object, "response");
      assert.equal(body.status, "completed");
      assert.equal(body.output[0].content[0].text, "olá");
      assert.equal(body.usage.total_tokens, 0);

      const upstreamCall = chat.requests.find(request => request.path?.startsWith("/v1/chat/completions"));
      assert.equal(upstreamCall.body.model, "deepseek-web");
      assert.deepEqual(upstreamCall.body.messages, [{ role: "user", content: "oi" }]);

      const streamed = await fetch(`${hub.base}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "deepseek-web/chat", stream: true, input: "oi" }),
      });
      assert.equal(streamed.status, 200);
      assert.match(streamed.headers.get("content-type"), /text\/event-stream/);
      const text = await streamed.text();
      assert.match(text, /response\.output_text\.delta/);
      assert.match(text, /"delta":"olá"/);
      assert.match(text, /response\.completed/);
    } finally {
      await close(hub.server);
    }
  });
});

test("unknown models and unreachable providers fail closed", async () => {
  const closed = createServer();
  const closedPort = await listen(closed);
  await close(closed);
  const hub = await startHub(providers("http://127.0.0.1:8787", `http://127.0.0.1:${closedPort}`));
  try {
    const unknown = await fetch(`${hub.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "nope/nope", messages: [] }),
    });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.type, "model_not_found");

    const down = await fetch(`${hub.base}/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web/sol", input: "oi" }),
    });
    assert.equal(down.status, 502);
    assert.equal((await down.json()).error.type, "provider_unavailable");
  } finally {
    await close(hub.server);
  }
});

test("the bearer token protects the catalogue and turns", async () => {
  await withUpstreams(async ({ chatUrl, responsesUrl }) => {
    const hub = await startHub(providers(chatUrl, responsesUrl), { authToken: "x".repeat(32) });
    try {
      assert.equal((await fetch(`${hub.base}/v1/models`)).status, 401);
      const authorized = await fetch(`${hub.base}/v1/models`, {
        headers: { authorization: `Bearer ${"x".repeat(32)}` },
      });
      assert.equal(authorized.status, 200);
      const turn = await fetch(`${hub.base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${"x".repeat(32)}` },
        body: JSON.stringify({ model: "deepseek-web/chat", messages: [] }),
      });
      assert.equal(turn.status, 200);
    } finally {
      await close(hub.server);
    }
  });
});

test("health marks a dead provider without failing the whole hub", async () => {
  const closed = createServer();
  const closedPort = await listen(closed);
  await close(closed);
  await withUpstreams(async ({ chatUrl, responsesUrl }) => {
    const hub = await startHub([
      ...providers(chatUrl, responsesUrl),
      {
        id: "dead-web",
        baseUrl: `http://127.0.0.1:${closedPort}`,
        dialect: "chat",
        models: [{ id: "m", hubId: "dead-web/m" }],
      },
    ]);
    try {
      const health = await (await fetch(`${hub.base}/health`)).json();
      assert.equal(health.ok, false);
      const dead = health.providers.find(provider => provider.id === "dead-web");
      assert.equal(dead.ok, false);
      assert.equal(dead.reason, "unreachable");
    } finally {
      await close(hub.server);
    }
  });
});

test("turns to the same provider are serialized", async () => {
  let active = 0;
  let maxActive = 0;
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 60));
    active -= 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }));
  });
  const upstreamUrl = `http://127.0.0.1:${await listen(upstream)}`;
  const hub = await startHub([{
    id: "deepseek-web",
    baseUrl: upstreamUrl,
    dialect: "chat",
    models: [{ id: "chat", hubId: "deepseek-web/chat", upstreamModel: "deepseek-web" }],
  }]);
  try {
    const responses = await Promise.all([1, 2, 3].map(() => fetch(`${hub.base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "deepseek-web/chat", messages: [{ role: "user", content: "oi" }] }),
    })));
    assert.deepEqual(responses.map(response => response.status), [200, 200, 200]);
    assert.equal(maxActive, 1);
  } finally {
    await close(hub.server);
    await close(upstream);
  }
});
