# Provider order — most favourable first

Admission rule: a provider enters the catalogue only when a local web session can drive it and the
responding model is identifiable. No provider APIs, no local engines.

| # | Provider | Transport | Status | Why this position |
| --- | --- | --- | --- | --- |
| 1 | **DeepSeek Web** | bridge `:8787` | ✅ working (validated) | Bridge exists, chat dialect, no DOM work; validated natively and through the Responses→Chat translator; tool protocol disabled in the hub |
| 2 | **ChatGPT Web** | bridge `:17841` | ✅ working (needs launcher session) | Bridge exists, Responses dialect, MCP/Full Harness stays exclusive to it; Chat frontend translated (live validation needs the bridge running) |
| 3 | **Qwen Web** | bridge `:8788` (webai-bridge) | ✅ working (validated) | Guest composer + Google login handled by the native-login flow; validated through the hub on both frontends |
| 4 | **Mistral Le Chat** | embedded-web | planned | Simple chat surface, no MCP; good maintenance/benefit |
| 5 | **Kimi** | embedded-web | planned | Long-context documents; adapter cost similar to Qwen |
| 6 | **Z.ai / GLM** | embedded-web | planned | Alternative code/reasoning; ToS/anti-bot to measure |
| 7 | **Perplexity** | embedded-web (meta) | conditional | Citations are the value; forced model selection, high breakage/ToS risk |
| 8 | **Claude Web** | bridge or embedded | conditional (after spike) | Highest value (remote MCP), but anti-bot/login risk; needs its own bridge first |
| 9 | **Gemini Web** | bridge or embedded | conditional (after spike) | Huge context, no MCP; DOM/anti-bot unstable |
| 10 | **Grok** | embedded | not admitted | Login via X, constant surface changes, low gain |
| 11 | **Copilot** | embedded | not admitted | Microsoft account, anti-bot, enterprise posture |
| 12 | **Manual relay** | client-side copy/paste | universal fallback | No automation, no ToS risk; works for every chat, chat-only |

## Explicitly out of scope

Provider APIs (official SDKs, OpenRouter/Groq/HF APIs), local engines (Ollama, LM Studio, WebLLM)
and product agents (v0/Bolt/Lovable). If a site only offers an API, it does not enter.

## Adding a provider

1. Provide a local bridge that speaks `/v1/models` + its native dialect (`chat` or `responses`).
2. Add it to `config.json` under `providers` with `dialect`, `baseUrl`, `healthPath` and models
   (`id`, `hubId`, `upstreamModel`, optional `contextWindow`/`thinking`).
3. Run `node src/index.mjs check`, start the hub, then `node scripts/smoke-live.mjs`.
4. Record the live evidence (turn, streaming, usage, cancellation) in the PR.
