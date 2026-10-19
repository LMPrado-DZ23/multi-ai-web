# Third-party notices

`multi-ai-web` is a local **proxy/orchestrator**. It does not vendor or modify the projects below;
it connects to them over loopback when they run.

| Component | License | Role |
| --- | --- | --- |
| [codex-chatgpt-web](https://github.com/LMPrado-DZ23/codex-chatgpt-web) | MIT | ChatGPT Web bridge upstream (`:17841`, Responses dialect) |
| [deepseek-web-bridge](https://github.com/LMPrado-DZ23/deepseek-web-bridge) | MIT | DeepSeek Web bridge upstream (`:8787`, Chat Completions dialect) |
| Node.js built-in modules | MIT | Runtime (no third-party npm dependencies) |

## Provenance

- Architecture and provider admission rules: `PLANO-HUB-MULTI-AI-CONSOLIDADO.md` (v7, local plan,
  bridges-as-upstream, web-only).
- Wire contracts were derived from the public READMEs and code of the two MIT bridges above.
- No provider SDK, API client or model weights are included.

## Trademarks

ChatGPT, DeepSeek, Qwen, Mistral, Claude, Gemini, Grok, Copilot, Perplexity and other names are
trademarks of their respective owners. This project is unofficial and not affiliated with them.
