import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function runCli(args) {
  const child = spawn(process.execPath, [join(root, "src/index.mjs"), ...args], { cwd: root });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  return new Promise(resolvePromise => {
    child.on("close", code => resolvePromise({ code, stdout, stderr }));
  });
}

test("doctor validates configuration and reports a stopped hub", async () => {
  const directory = mkdtempSync(join(tmpdir(), "multi-ai-web-doctor-"));
  const configPath = join(directory, "config.json");
  const example = JSON.parse(readFileSync(join(root, "config.example.json"), "utf8"));
  example.port = 9;
  writeFileSync(configPath, JSON.stringify(example));
  try {
    const result = await runCli(["doctor", "--config", configPath]);
    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.config.ok, true);
    assert.equal(report.hub.running, false);
    assert.match(result.stderr, /not running/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("check accepts the shipped example configuration", async () => {
  const result = await runCli(["check", "--config", "config.example.json"]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).ok, true);
});
