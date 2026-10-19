# Provider order — most favourable first

Admission rule: a provider enters the catalogue only when a local web session can drive it and the
responding model is identifiable. No provider APIs, no local engines.

| # | Provider | Transport | Status | Why this position |
| --- | --- | --- | --- | --- |
| 1 | **DeepSeek Web** | bridge `:8787` | ✅ validated | Existing bridge, chat dialect, no DOM work; validated natively and through the Responses→Chat translator |
| 2 | **ChatGPT Web** | bridge `:17841` | ✅ validated | Existing bridge, Responses dialect; MCP/Full Harness stays exclusive to it |
| 3 | **Qwen Web** | bridge `:8788` | ✅ validated | Native login; `QWEN-ONE`/`QWEN-TWO` + `HUB-QWEN-*` |
| 4 | **Kimi** | bridge `:8788` | ✅ validated | Native login; `KIMI-BRIDGE`/`KIMI-STREAM` + `HUB-KIMI-*` |
| 5 | **Gemini** | bridge `:8788` | ✅ validated | Google native login; `GEMINI-OK`/`GEMINI-STREAM` + `HUB-GEMINI-*` |
| 6 | **Perplexity** | bridge `:8788` | ✅ validated | `PERPLEXITY-OK`/`PERPLEXITY-STREAM` + `HUB-PERPLEXITY-*`; the site-selected model is explicit in `displayName` |
| 7 | **MiMo Studio** | bridge `:8788` | ✅ validated | Xiaomi/Google login; `MIMO-FIX`/`MIMO-STREAM` + `HUB-MIMO-*` |
| 8 | **Meta AI** | bridge `:8788` | ✅ validated | `META-OK` + `HUB-META-CHAT`/`HUB-META-RESP` |
| 9 | **Grok** | bridge `:8788` | ✅ validated | Native login + one-time age confirmation (owner-authorized); `GROK-OK`/`GROK-STREAM` + `HUB-GROK-*` |
| 10 | **Microsoft Copilot** | — | ⛔ excluded | Microsoft sign-in does not persist in the dedicated automation profile |
| 7 | **Mistral Le Chat** | — | ⛔ excluded | Cloudflare bot challenge; never bypassed |
| 8 | **Claude Web** | — | ⛔ excluded | Cloudflare bot challenge; never bypassed |
| 9 | **Z.ai / GLM** | — | ⛔ excluded | Slider CAPTCHA ("drag the slider"); never bypassed |
| 10 | **Grok** | — | 🚫 not admitted | Login wall, anti-bot, low gain |
| 11 | **Copilot** | — | 🚫 not admitted | Sign-in wall, anti-bot |
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
