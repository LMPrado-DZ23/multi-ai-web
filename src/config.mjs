import { readFileSync } from "node:fs";

export const HUB_VERSION = "0.1.0";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 17900;

const RESERVED_PROVIDER_IDS = new Set(["hub"]);
const ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const HUB_MODEL_ID_PATTERN = /^[a-z][a-z0-9-]{1,30}\/[a-z0-9][a-z0-9._-]{0,80}$/;

/** Config is deliberately strict: an invalid file must stop the hub instead of failing a turn later. */
export function validateConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("config must be a JSON object");
  if (raw.version !== 1) throw new Error("config.version must be 1");
  const host = raw.host ?? DEFAULT_HOST;
  if (host !== "127.0.0.1") throw new Error("config.host must be 127.0.0.1 (loopback only)");
  const port = raw.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("config.port must be 1..65535");
  let authToken = null;
  if (raw.authToken !== undefined && raw.authToken !== null) {
    if (typeof raw.authToken !== "string" || raw.authToken.length < 32) {
      throw new Error("config.authToken must be null or at least 32 characters");
    }
    authToken = raw.authToken;
  }
  if (!Array.isArray(raw.providers)) throw new Error("config.providers must be an array");
  if (raw.providers.length === 0) throw new Error("config.providers must not be empty");
  const seenProviders = new Set();
  const seenHubIds = new Set();
  const providers = raw.providers.map((entry, index) => {
    const label = `providers[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} must be an object`);
    if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) throw new Error(`${label}.id is invalid`);
    if (RESERVED_PROVIDER_IDS.has(entry.id)) throw new Error(`${label}.id is reserved`);
    if (seenProviders.has(entry.id)) throw new Error(`providers id ${entry.id} is duplicated`);
    seenProviders.add(entry.id);
    if (typeof entry.baseUrl !== "string" || !isHttpUrl(entry.baseUrl)) {
      throw new Error(`${label}.baseUrl must be an absolute http(s) URL`);
    }
    const baseUrl = normalizeBaseUrl(entry.baseUrl);
    if (entry.dialect !== "chat" && entry.dialect !== "responses") {
      throw new Error(`${label}.dialect must be "chat" or "responses"`);
    }
    const healthPath = entry.healthPath ?? "/health";
    if (typeof healthPath !== "string" || !healthPath.startsWith("/")) {
      throw new Error(`${label}.healthPath must start with /`);
    }
    if (entry.codexTurnMetadata !== undefined && typeof entry.codexTurnMetadata !== "boolean") {
      throw new Error(`${label}.codexTurnMetadata must be a boolean`);
    }
    if (!Array.isArray(entry.models) || entry.models.length === 0) {
      throw new Error(`${label}.models must be a non-empty array`);
    }
    const seenModels = new Set();
    const models = entry.models.map((modelEntry, modelIndex) => {
      const modelLabel = `${label}.models[${modelIndex}]`;
      if (!modelEntry || typeof modelEntry !== "object" || Array.isArray(modelEntry)) {
        throw new Error(`${modelLabel} must be an object`);
      }
      if (typeof modelEntry.id !== "string" || !MODEL_ID_PATTERN.test(modelEntry.id)) {
        throw new Error(`${modelLabel}.id is invalid`);
      }
      const hubId = modelEntry.hubId ?? `${entry.id}/${modelEntry.id}`;
      if (typeof hubId !== "string" || !HUB_MODEL_ID_PATTERN.test(hubId)) {
        throw new Error(`${modelLabel}.hubId is invalid`);
      }
      if (!hubId.startsWith(`${entry.id}/`)) {
        throw new Error(`${modelLabel}.hubId must start with "${entry.id}/"`);
      }
      if (seenHubIds.has(hubId)) throw new Error(`hub model id ${hubId} is duplicated`);
      seenHubIds.add(hubId);
      if (seenModels.has(modelEntry.id)) throw new Error(`${modelLabel}.id is duplicated`);
      seenModels.add(modelEntry.id);
      const upstreamModel = modelEntry.upstreamModel ?? modelEntry.id;
      if (typeof upstreamModel !== "string" || !upstreamModel.trim() || upstreamModel.length > 120) {
        throw new Error(`${modelLabel}.upstreamModel is invalid`);
      }
      const contextWindow = modelEntry.contextWindow ?? null;
      if (contextWindow !== null && (!Number.isSafeInteger(contextWindow) || contextWindow <= 0)) {
        throw new Error(`${modelLabel}.contextWindow is invalid`);
      }
      if (modelEntry.thinking !== undefined && typeof modelEntry.thinking !== "boolean") {
        throw new Error(`${modelLabel}.thinking must be a boolean`);
      }
      const displayName = modelEntry.displayName;
      if (displayName !== undefined
        && (typeof displayName !== "string" || !displayName.trim() || displayName.length > 80)) {
        throw new Error(`${modelLabel}.displayName is invalid`);
      }
      return {
        id: modelEntry.id,
        hubId,
        upstreamModel,
        displayName: displayName ?? `${entry.label ?? entry.id} (${modelEntry.id})`,
        contextWindow,
        thinking: modelEntry.thinking === true,
      };
    });
    return {
      id: entry.id,
      label: entry.label ?? entry.id,
      baseUrl,
      dialect: entry.dialect,
      healthPath,
      codexTurnMetadata: entry.codexTurnMetadata === true,
      models,
    };
  });
  return { version: 1, host, port, authToken, providers };
}

export function loadConfigFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read config ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateConfig(raw);
}

/** Resolve a hub model id ("provider/model") to its provider and upstream model. */
export function findModel(config, hubModelId) {
  if (typeof hubModelId !== "string") return undefined;
  const separator = hubModelId.indexOf("/");
  if (separator <= 0) return undefined;
  const providerId = hubModelId.slice(0, separator);
  const provider = config.providers.find(candidate => candidate.id === providerId);
  if (!provider) return undefined;
  const model = provider.models.find(candidate => candidate.hubId === hubModelId);
  if (!model) return undefined;
  return { provider, model };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value.trim());
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
