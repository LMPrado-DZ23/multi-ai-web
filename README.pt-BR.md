# multi-ai-web (pt-BR)

Hub local que expõe **chats web de IA logados** por um catálogo único para Codex, DSH, Cursor e
Open WebUI. Sem API key de provider e sem motor local: cada modelo é uma sessão web real dirigida
por uma ponte local.

**Beta 0.1.0:** apenas pontes como upstream, cada uma no seu dialeto nativo (sem tradução entre
dialetos ainda). ChatGPT (Responses) e DeepSeek (Chat Completions) funcionam hoje.

## Início rápido

```bash
cp config.example.json config.json
node src/index.mjs check
node src/index.mjs serve      # http://127.0.0.1:17900
# ou: start.cmd / ./start.sh
node src/index.mjs doctor     # valida config e informa hub/providers
```

**Fila serial:** o hub mantém **1 turno por provider**; pedidos concorrentes esperam na fila (outros
providers seguem independentes). A fila libera em sucesso, falha ou cancelamento do cliente.

Subas as pontes configuradas antes: `deepseek-web-bridge` na :8787 e/ou o daemon do
`codex-chatgpt-web` na :17841 com sessão logada.

```bash
curl http://127.0.0.1:17900/health
curl http://127.0.0.1:17900/v1/models
```

## Limites do beta

- Tradução entre dialetos nos dois sentidos (texto, usage e function calls); imagens/arquivos são
  recusados com `unsupported_input`, nunca descartados em silêncio.
- Tools não são expostos (`capabilities.tools: false`); MCP/Full Harness continua exclusivo do
  bridge ChatGPT.
- Contexto é declarado pelo provider, não medido.
- ChatGPT exige sessão válida no launcher; o hub não faz login.

## Segurança

Loopback apenas, token bearer opcional (≥32 caracteres), sem cookies/senhas no hub, logs sem
corpo de prompt/resposta. Automação de chats web pode contrariar o ToS de cada provedor; use suas
contas, localmente, por sua conta e risco.

## Ordem dos provedores

Ver [`docs/PROVIDERS.md`](docs/PROVIDERS.md): DeepSeek ✅, ChatGPT ✅, depois Qwen, Mistral, Kimi,
Z.ai/GLM, Perplexity; Claude/Gemini só após spike de ponte.

Licença MIT.
