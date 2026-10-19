import { createServer } from "node:http";
import { Readable, Transform } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import { buildModelsResponse, errorBody } from "./catalog.mjs";
import { findModel, HUB_VERSION } from "./config.mjs";
import { ProviderQueues } from "./serial-queue.mjs";
import {
  ChatToResponsesTransform,
  chatJsonToResponsesJson,
  chatRequestToResponses,
  newResponseId,
  ResponsesToChatTransform,
  responsesJsonToChatJson,
  responsesRequestToChat,
  TranslateError,
} from "./translate.mjs";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const TURN_PATHS = new Map([
  ["/v1/chat/completions", "chat"],
  ["/v1/responses", "responses"],
]);

class HttpError extends Error {
  constructor(status, type, message) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

/**
 * The beta hub proxies each bridge's native dialect and exposes one catalogue.
 *
 * Cross-dialect turns are rejected explicitly instead of silently replying in the wrong wire
 * format; the normalized-event translators land in the next phase.
 */
export function createHubServer(config, { fetchImpl = fetch, providerHealthTimeoutMs = 1500, queues = new ProviderQueues() } = {}) {
  const server = createServer((request, response) => {
    handleRequest(request, response, config, { fetchImpl, providerHealthTimeoutMs, queues }).catch(error => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      const type = error instanceof HttpError ? error.type : "hub_error";
      sendJson(response, status, errorBody(type, error instanceof Error ? error.message : String(error)));
    });
  });
  server.hubConfig = config;
  server.hubQueues = queues;
  return server;
}

async function handleRequest(request, response, config, deps) {
  const url = new URL(request.url ?? "/", `http://${config.host}:${config.port}`);
  if (request.method === "GET" && url.pathname === "/health") {
    const checked = config.providers.filter(provider => provider.id !== "auto-web");
    const providers = await Promise.all(checked.map(provider => checkProvider(provider, deps)));
    sendJson(response, 200, {
      ok: providers.every(provider => provider.ok),
      version: HUB_VERSION,
      providers,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    requireAuth(request, config);
    sendJson(response, 200, buildModelsResponse(config));
    return;
  }
  const dialect = TURN_PATHS.get(url.pathname);
  if (dialect) {
    if (request.method !== "POST") {
      throw new HttpError(405, "method_not_allowed", `${url.pathname} only accepts POST`);
    }
    requireAuth(request, config);
    const body = await readJsonBody(request);
    const hubModelId = body.model;
    if (typeof hubModelId !== "string" || !hubModelId) {
      throw new HttpError(400, "invalid_request_error", "body.model is required");
    }
    const found = findModel(config, hubModelId);
    if (!found) {
      throw new HttpError(404, "model_not_found", `Unknown model: ${hubModelId}. Call GET /v1/models.`);
    }
    const { provider, model } = found;
    if (provider.id === "auto-web") {
      const targets = autoTargets(config);
      if (targets.length === 0) {
        throw new HttpError(503, "provider_unavailable", "No providers configured for auto mode");
      }
      let lastError;
      for (const target of targets) {
        try {
          await deps.queues.run(target.provider.id, () => proxyTurn(request, response, {
            provider: target.provider,
            model: target.model,
            dialect,
            translates: target.provider.dialect !== dialect,
            body,
            url,
            fetchImpl: deps.fetchImpl,
          }));
          return;
        } catch (error) {
          lastError = error;
          if (response.headersSent) throw error;
        }
      }
      throw lastError instanceof HttpError
        ? lastError
        : new HttpError(502, "provider_unavailable", "Auto mode could not reach any provider");
    }
    // Both directions are translated now: Responses clients reach Chat bridges and vice versa.
    const translates = provider.dialect !== dialect;
    // One in-flight turn per provider: concurrent turns would fight over the bridge's browser.
    await deps.queues.run(provider.id, () => proxyTurn(request, response, {
      provider,
      model,
      dialect,
      translates,
      body,
      url,
      fetchImpl: deps.fetchImpl,
    }));
    return;
  }
  throw new HttpError(404, "not_found", `Unknown route: ${request.method} ${url.pathname}`);
}

/**
 * Targets for the virtual `auto-web/auto` model: every real provider in catalog order, using its
 * first model. The turn is retried on the next provider while no response headers were sent.
 */
function autoTargets(config) {
  const targets = [];
  for (const provider of config.providers) {
    if (provider.id === "auto-web") continue;
    if (provider.models.length > 0) targets.push({ provider, model: provider.models[0] });
  }
  return targets;
}

/**
 * The codex-chatgpt-web bridge routes `chatgpt-web/*` models through its browser adapter, which
 * requires native Codex turn metadata: a turn_id per request plus per-item passthrough metadata.
 * Generic OpenAI clients do not send it, so the hub synthesizes it for providers that opt in.
 */
function decorateCodexWebTurn(body) {
  const random = () => crypto.randomUUID().replaceAll("-", "");
  const turnId = `turn_${random()}`;
  const threadId = typeof body.prompt_cache_key === "string" && body.prompt_cache_key
    ? body.prompt_cache_key
    : `thread_${random()}`;
  const metadata = {
    thread_id: threadId,
    turn_id: turnId,
    request_kind: "turn",
    sandbox: "none",
    workspaces: {},
  };
  const rawInput = Array.isArray(body.input)
    ? body.input
    : [{ type: "message", role: "user", content: [{ type: "input_text", text: String(body.input ?? "") }] }];
  const environment = {
    type: "message",
    role: "user",
    content: [{
      type: "input_text",
      text: "<environment_context>\n  <cwd>hub</cwd>\n  <filesystem><permission_profile type=\"disabled\"><file_system type=\"unrestricted\" /></permission_profile></filesystem>\n</environment_context>",
    }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId },
  };
  const input = [environment, ...rawInput.map(item => (item && typeof item === "object"
    ? { ...item, internal_chat_message_metadata_passthrough: { turn_id: turnId } }
    : item))];
  return {
    body: {
      ...body,
      input,
      client_metadata: {
        ...(body.client_metadata && typeof body.client_metadata === "object" ? body.client_metadata : {}),
        "x-codex-turn-metadata": JSON.stringify(metadata),
      },
    },
    headers: { "x-codex-turn-metadata": JSON.stringify(metadata) },
  };
}

async function proxyTurn(request, response, { provider, model, dialect, translates, body, fetchImpl }) {
  const upstreamPath = provider.dialect === "chat" ? "/v1/chat/completions" : "/v1/responses";
  let upstreamBody;
  if (translates) {
    try {
      upstreamBody = dialect === "responses"
        ? responsesRequestToChat(body, model.upstreamModel)
        : chatRequestToResponses(body, model.upstreamModel);
    } catch (error) {
      throw new HttpError(400, error instanceof TranslateError ? error.type : "invalid_request_error", error instanceof Error ? error.message : String(error));
    }
  } else {
    upstreamBody = { ...body, model: model.upstreamModel };
  }

  let extraHeaders = {};
  if (provider.codexTurnMetadata && provider.dialect === "responses") {
    const decorated = decorateCodexWebTurn(upstreamBody);
    upstreamBody = decorated.body;
    extraHeaders = decorated.headers;
  }

  const controller = new AbortController();
  const onClose = () => {
    if (!response.writableEnded) controller.abort();
  };
  request.on("close", onClose);
  let upstream;
  try {
    upstream = await fetchImpl(new URL(`${provider.baseUrl}${upstreamPath}`), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...extraHeaders,
        ...(typeof request.headers.accept === "string" ? { accept: request.headers.accept } : {}),
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });
  } catch {
    request.off("close", onClose);
    throw new HttpError(
      502,
      "provider_unavailable",
      `Provider ${provider.id} is unreachable at ${provider.baseUrl}. Start its bridge and retry.`,
    );
  }

  if (translates) {
    await respondTranslated(response, upstream, {
      direction: dialect === "responses" ? "responses-to-chat" : "chat-to-responses",
      model: model.hubId,
      stream: body.stream === true,
    });
    return;
  }

  const headers = {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
  };
  response.writeHead(upstream.status, headers);
  if (!upstream.body) {
    response.end();
    await finished(response);
    return;
  }
  const stream = Readable.fromWeb(upstream.body);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
  response.on("close", () => {
    if (typeof stream.destroy === "function") stream.destroy();
  });
  await finished(response);
}

async function respondTranslated(response, upstream, { direction, model, stream }) {
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    throw new HttpError(
      upstream.status,
      "provider_error",
      `Upstream rejected the turn (HTTP ${upstream.status}): ${detail.slice(0, 500)}`,
    );
  }
  if (!stream) {
    let payload;
    try {
      payload = await upstream.json();
    } catch {
      throw new HttpError(502, "provider_error", "Upstream returned a non-JSON body for a non-streaming turn");
    }
    if (direction === "chat-to-responses") {
      sendJson(response, 200, responsesJsonToChatJson(payload, { model, id: newResponseId() }));
    } else {
      sendJson(response, 200, chatJsonToResponsesJson(payload, { model, id: newResponseId() }));
    }
    await finished(response);
    return;
  }
  if (!upstream.body) {
    throw new HttpError(502, "provider_error", "Upstream returned an empty streaming body");
  }
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
  });
  const translator = direction === "chat-to-responses"
    ? new ResponsesToChatTransform({ model })
    : new ChatToResponsesTransform({ model, responseId: newResponseId() });
  const transformer = new Transform({
    transform(chunk, _encoding, callback) {
      translator.setController({ enqueue: text => this.push(text) });
      translator.feed(chunk.toString("utf8"));
      callback();
    },
    flush(callback) {
      translator.finish();
      callback();
    },
  });
  const upstreamStream = Readable.fromWeb(upstream.body);
  upstreamStream.on("error", () => response.destroy());
  transformer.on("error", () => response.destroy());
  upstreamStream.pipe(transformer).pipe(response);
  await finished(response);
}

function finished(response) {
  if (response.writableEnded) return Promise.resolve();
  return new Promise(resolve => {
    response.once("finish", resolve);
    response.once("close", resolve);
  });
}

async function checkProvider(provider, { fetchImpl, providerHealthTimeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), providerHealthTimeoutMs);
  try {
    const response = await fetchImpl(new URL(provider.healthPath, provider.baseUrl), {
      method: "GET",
      signal: controller.signal,
    });
    return { id: provider.id, ok: response.ok, status: response.status };
  } catch (error) {
    const reason = error?.name === "AbortError" ? "timeout" : "unreachable";
    return { id: provider.id, ok: false, status: null, reason };
  } finally {
    clearTimeout(timer);
  }
}

function requireAuth(request, config) {
  if (!config.authToken) return;
  const header = request.headers.authorization;
  const expected = `Bearer ${config.authToken}`;
  if (typeof header !== "string" || !safeEqual(header, expected)) {
    throw new HttpError(401, "invalid_api_key", "Missing or invalid Authorization bearer token");
  }
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "request_too_large", "Request body exceeds 10 MiB");
    chunks.push(chunk);
  }
  if (chunks.length === 0) throw new HttpError(400, "invalid_request_error", "JSON body is required");
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("body must be a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new HttpError(400, "invalid_request_error", error instanceof Error ? error.message : "Invalid JSON body");
  }
}

function sendJson(response, status, body) {
  if (response.headersSent) {
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}
