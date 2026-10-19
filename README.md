# multi-ai-web

Local hub that exposes **logged-in web AI chats** through one catalogue for Codex, DSH, Cursor
and Open WebUI. No provider API keys, no local engines: every model is a real web session driven
by a local bridge (or, later, by an embedded-web adapter owned by this hub).

> **Beta scope (0.1.0):** bridge upstreams with **bidirectional wire translation**. Responses
> clients (Codex) can use Chat bridges (DeepSeek) and Chat clients (DSH/Open WebUI) can use
> Responses bridges (ChatGPT), with text, usage and function calls. Embedded-web providers (Qwen
> first) are the next phase.

## Why

`codex-chatgpt-web` speaks **Responses**; `deepseek-web-bridge` speaks **Chat Completions**.
Instead of teaching each client a different bridge, the hub gives them one catalogue and one
loopback endpoint per dialect:

```
Codex / Responses client ─┐
                          ├─▶ hub :17900 ─┬─▶ chatgpt-web bridge :17841 (Responses)
DSH / OpenAI-compatible ──┘               └─▶ deepseek-web bridge :8787 (Chat Completions)
```

## Quick start

```bash
cp config.example.json config.json
node src/index.mjs check          # validates the config (invalid config refuses to start)
node src/index.mjs serve          # http://127.0.0.1:17900
```

Windows/macOS/Linux shortcuts: `start.cmd` or `./start.sh` (copies the example config once, validates
it, then serves). `node src/index.mjs doctor` validates the config and reports whether the hub and
each provider are reachable (exit 1 when the hub is stopped).

Start the bridges you configured first:

- **DeepSeek:** `deepseek-web-bridge` → `node src/index.mjs serve` (port 8787), login once.
- **ChatGPT:** `codex-chatgpt-web` daemon (port 17841) with a signed-in launcher profile.

Then:

```bash
curl http://127.0.0.1:17900/health
curl http://127.0.0.1:17900/v1/models
```

## Clients

| Client | Endpoint | Models available in beta |
| --- | --- | --- |
| Codex (`wire_api = "responses"`) | `http://127.0.0.1:17900/v1` | `chatgpt-web/*` (native), `deepseek-web/*`, `qwen-web/*`, `kimi-web/*`, `gemini-web/*`, `perplexity-web/*`, `mimo-web/*`, `meta-web/*` and `grok-web/*` (translated) |
| DSH / Open WebUI / OpenAI-compatible | `http://127.0.0.1:17900/v1` | `deepseek-web/*`, `qwen-web/*`, `kimi-web/*`, `gemini-web/*`, `perplexity-web/*`, `mimo-web/*`, `meta-web/*` and `grok-web/*` (native), `chatgpt-web/*` (translated) |

Model ids are `provider/model` and never contain `:`. The hub rewrites the upstream model id
(`upstreamModel`) and preserves the bridge's SSE bytes, usage, errors and cancellation.

## Security

- Loopback only (`127.0.0.1`); a non-loopback host is rejected by the config validator.
- **One in-flight turn per provider.** Concurrent turns fight over the bridge's browser session, so
  the hub queues them per provider (other providers stay independent). The queue is in-process and
  releases on completion, failure, or client abort.
- Optional bearer token (`authToken`, ≥32 chars) protects `/v1/models` and both turn endpoints.
- The hub never stores cookies, passwords or tokens of the web chats; those stay in each bridge's
  isolated browser profile. Logs never include prompt/response bodies.
- One provider never reads another provider's browser profile.

## Beta limitations

- **Translation is text-first.** Messages, instructions, tools, tool calls, usage and streaming
  events are translated; images and files are rejected with `unsupported_input` instead of being
  dropped. Reasoning deltas are forwarded where the dialect has a slot for them.
- Tool calling is not exposed by the hub (`capabilities.tools: false`); the DeepSeek bridge's text
  tool protocol stays off, and MCP/Full Harness remains exclusive to the ChatGPT bridge.
- `maxContextTokens` is provider-declared, not measured; each bridge keeps its own limits.
- ChatGPT must be reachable on port 17841 with a valid launcher session; the hub cannot log in for it.

## Tests

```bash
node --test          # config, catalogue, proxy, auth, failure modes (no accounts needed)
node scripts/smoke-live.mjs   # opt-in: needs a running hub + bridge
```

## Provider order (most feasible first)

See [`docs/PROVIDERS.md`](docs/PROVIDERS.md). Short version: DeepSeek ✅, ChatGPT ✅, then Qwen
(embedded-web), Mistral, Kimi, Z.ai/GLM, Perplexity, and Claude/Gemini only after a bridge spike.

## Provenance and license

MIT. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); the hub proxies, and does not modify,
the MIT `codex-chatgpt-web` and `deepseek-web-bridge` projects.

Web automation can conflict with a provider's Terms of Service and risks account restrictions.
Use your own accounts, at your own risk, locally.
