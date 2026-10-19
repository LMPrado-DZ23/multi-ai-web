#!/usr/bin/env node
import { loadConfigFile, HUB_VERSION } from "./config.mjs";
import { buildModelsResponse } from "./catalog.mjs";
import { createHubServer } from "./server.mjs";

const USAGE = `multi-ai-web ${HUB_VERSION}

Usage:
  multi-ai-web serve [--config path]     Start the loopback hub (default: ./config.json)
  multi-ai-web check [--config path]     Validate the configuration and exit
  multi-ai-web doctor [--config path]    Validate config + report a running hub (exit 1 if stopped)
  multi-ai-web models [--config path]    Print the catalogue as JSON
  multi-ai-web health [--config path]    Ask a running hub for /health

Environment:
  HUB_CONFIG   Default config path (overridden by --config)
`;

const args = process.argv.slice(2);
const command = args.shift() ?? "help";

function takeOption(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

const configPath = takeOption("--config", process.env.HUB_CONFIG ?? "config.json");

try {
  if (command === "help" || command === "-h" || command === "--help") {
    process.stdout.write(USAGE);
  } else if (command === "check") {
    const config = loadConfigFile(configPath);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      version: config.version,
      port: config.port,
      auth: config.authToken ? "bearer" : "none",
      providers: config.providers.map(provider => ({
        id: provider.id,
        dialect: provider.dialect,
        baseUrl: provider.baseUrl,
        models: provider.models.map(model => model.hubId),
      })),
    }, null, 2)}\n`);
  } else if (command === "doctor") {
    const config = loadConfigFile(configPath);
    let hub = { running: false };
    try {
      const response = await fetch(`http://${config.host}:${config.port}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      hub = { running: true, status: response.status, health: await response.json() };
    } catch {
      hub = { running: false };
    }
    process.stdout.write(`${JSON.stringify({
      config: {
        ok: true,
        path: configPath,
        providers: config.providers.map(provider => ({
          id: provider.id,
          dialect: provider.dialect,
          baseUrl: provider.baseUrl,
          models: provider.models.map(model => model.hubId),
        })),
      },
      hub,
    }, null, 2)}\n`);
    if (!hub.running) {
      process.stderr.write("multi-ai-web: the hub is not running; start it with `multi-ai-web serve`\n");
      process.exitCode = 1;
    }
  } else if (command === "models") {
    const config = loadConfigFile(configPath);
    process.stdout.write(`${JSON.stringify(buildModelsResponse(config), null, 2)}\n`);
  } else if (command === "health") {
    const config = loadConfigFile(configPath);
    const response = await fetch(`http://${config.host}:${config.port}/health`);
    process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
    if (!response.ok) process.exitCode = 1;
  } else if (command === "serve") {
    const config = loadConfigFile(configPath);
    const server = createHubServer(config);
    server.listen(config.port, config.host, () => {
      process.stdout.write(
        `multi-ai-web ${HUB_VERSION} listening on http://${config.host}:${config.port}/v1 (`
          + `${config.providers.length} provider(s), auth ${config.authToken ? "on" : "off"})\n`,
      );
    });
    const shutdown = () => server.close(() => process.exit(0));
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
  }
} catch (error) {
  process.stderr.write(`multi-ai-web: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
