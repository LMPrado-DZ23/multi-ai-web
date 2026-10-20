# Guia de uso — multi-ai-web 1.0.0

Este é o guia completo para instalar, subir, usar e diagnosticar o hub. Ele cobre os quatro
processos envolvidos, os clientes suportados, o modo `auto`, login/expiração de sessões e os erros
mais comuns.

---

## 1. Visão geral

```
cliente (Codex, DSH, Open WebUI, curl, Python…)
        │  OpenAI-compatible: /v1/chat/completions e /v1/responses
        ▼
hub multi-ai-web  :17900  ── catálogo único + tradução Chat↔Responses + fila serial
        │
        ├── webai-bridge          :8788   Qwen, Kimi, Gemini, Perplexity, MiMo, Meta, Grok (chat)
        ├── deepseek-web-bridge   :8787   DeepSeek Web (chat)
        └── codex-chatgpt-web     :17841  ChatGPT Web (responses / browser-only)
```

- O hub é **loopback** (`127.0.0.1`), sem chaves de API de provedores.
- Cada modelo é uma **sessão web real** dirigida por uma ponte local.
- Provedores com anti-bot (Cloudflare, slider CAPTCHA, CDN block) ficam **fora** e não há bypass.

### 1.1 Dependências — cada modelo vem de uma ponte (outro repositório)

O hub **não fala com sites**. Instale e suba as pontes dos provedores que quiser usar:

| Ponte | Porta | Provedores | Repositório |
| --- | --- | --- | --- |
| **webai-bridge** | `8788` | Qwen, Kimi, Gemini, Perplexity, MiMo, Meta, Grok | https://github.com/LMPrado-DZ23/webai-bridge |
| **deepseek-web-bridge** | `8787` | DeepSeek Web (chat/think) | https://github.com/LMPrado-DZ23/deepseek-web-bridge |
| **codex-chatgpt-web** (fork) | `17841` | ChatGPT Web (Luna, browser-only) | https://github.com/LMPrado-DZ23/codex-chatgpt-web |

- **Mínimo:** `multi-ai-web` + `webai-bridge` → 7 modelos.
- **Completo:** as três pontes + `multi-ai-web` → 10 modelos.
- Só com `multi-ai-web`: o hub sobe, mas **nenhum modelo responde** (`unreachable` no `doctor`).
- As pontes também funcionam sozinhas (endpoint OpenAI próprio); o hub apenas agrega, traduz e
  serializa.

---

## 2. Requisitos

| Item | Versão/observação |
| --- | --- |
| Node.js | 20+ (testado com 24) |
| Google Chrome | instalado em `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Bun (só para o ChatGPT bridge) | 1.4.x — instale local: `npm install bun --no-save` |
| Windows | comandos abaixo em PowerShell; `start.cmd` funciona no duplo clique |

Portas usadas: **8790? não** — apenas `8787`, `8788`, `17841`, `17900`. Todas em loopback.

---

## 3. Instalação

```powershell
git clone https://github.com/LMPrado-DZ23/multi-ai-web
cd multi-ai-web
npm install
Copy-Item config.example.json config.json
node src/index.mjs check --config config.json   # valida o config
npm test                                        # 23/23
```

O `start.cmd` cria `config.json` na primeira execução e sobe o hub.

---

## 4. Subir os processos

### 4.1 Hub (obrigatório)

```powershell
cd multi-ai-web
.\start.cmd
# ou: node src/index.mjs serve --config config.json
```

### 4.2 Provedores web (Qwen, Kimi, Gemini, Perplexity, MiMo, Meta, Grok)

```powershell
cd webai-bridge
npm install
.\start.cmd          # node src/index.mjs serve  →  http://127.0.0.1:8788
```

### 4.3 DeepSeek Web

```powershell
cd deepseek-web-bridge     # repositório separado
.\start.cmd                # http://127.0.0.1:8787
```

### 4.4 ChatGPT Web (browser-only)

```powershell
cd _review-codex-chatgpt-web      # checkout local do codex-chatgpt-web
npm install bun --no-save         # uma vez
node_modules\.bin\bun.cmd run src/cli.ts login
# faça login na janela do Chrome, espere a caixa de mensagem do ChatGPT, feche a janela
$env:CODEX_CHATGPT_WEB_HOME="$env:USERPROFILE\.codex-chatgpt-web"
node_modules\.bin\bun.cmd run src/cli.ts serve
# http://127.0.0.1:17841  (modo browser-only)
```

> O launcher **DEV** (`--dev-profile`) não serve Responses; use o `serve` acima com o login salvo.
> Se a conta for “Luna-only”, o modelo disponível é `chatgpt-web/luna`.

---

## 5. Login e expiração de sessões

Cada provedor tem um perfil Chrome dedicado (nunca o seu perfil pessoal).

```powershell
cd webai-bridge
.\login.cmd qwen          # abre o Chrome normal → faça login → feche a janela
.\login.cmd kimi
.\login.cmd gemini
.\login.cmd perplexity
.\login.cmd mimo
.\login.cmd meta
.\login.cmd grok
```

Depois do login, valide:

```powershell
node src/index.mjs diagnose qwen
```

Sessões expiram de tempos em tempos. Quando um provedor parar de responder, repita o `login.cmd`
correspondente. O ChatGPT se renova com o `login` do Bun mostrado em 4.4.

---

## 6. Catálogo atual

| Modelo no hub | Provedor | Observação |
| --- | --- | --- |
| `auto-web/auto` | hub | tenta os provedores na ordem do catálogo e cai no próximo |
| `chatgpt-web/luna` | ChatGPT Web | browser-only; sem ferramentas locais; conta Luna — orçamento real de ~28k tokens por turno (use `contextWindow: 24000` no cliente) |
| `deepseek-web/chat` | DeepSeek Web | chat |
| `deepseek-web/think` | DeepSeek Web | raciocínio em `reasoning_content` |
| `qwen-web/qwen3.7-plus` | Qwen | |
| `kimi-web/kimi-k2` | Kimi | respostas longas |
| `gemini-web/gemini-pro` | Gemini | |
| `perplexity-web/perplexity-web` | Perplexity | modelo escolhido pelo site |
| `mimo-web/mimo-v2.6` | MiMo Studio | Xiaomi |
| `meta-web/meta-ai` | Meta AI | |
| `grok-web/grok-web` | Grok | exigiu confirmação de idade única |

`GET http://127.0.0.1:17900/v1/models` devolve a lista viva.

### Modo auto

`auto-web/auto` percorre os provedores na ordem do `config.json`, usando o primeiro modelo de cada:

```
deepseek-web/chat → qwen → kimi → gemini → perplexity → mimo → meta → grok → chatgpt-web/luna
```

- Se um provedor falhar **antes** do primeiro byte, tenta o próximo.
- Falha no meio do stream não é refeita (não dá para reiniciar sem perder texto).
- Não é roteamento por qualidade/custo: é fallback por ordem.

---

## 7. Usar de clientes

### 7.1 curl / PowerShell

```powershell
$body = @{
  model = "qwen-web/qwen3.7-plus"
  messages = @(@{ role = "user"; content = "Olá!" })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://127.0.0.1:17900/v1/chat/completions `
  -Method POST -ContentType application/json -Body $body
```

### 7.2 Python (SDK OpenAI)

```python
from openai import OpenAI
client = OpenAI(base_url="http://127.0.0.1:17900/v1", api_key="nao-precisa")

r = client.chat.completions.create(
    model="kimi-web/kimi-k2",
    messages=[{"role": "user", "content": "Resuma em 3 linhas"}],
)
print(r.choices[0].message.content)
```

### 7.3 Codex (dialeto Responses)

`~/.codex/config.toml`:

```toml
[model_providers.multi-ai-web]
name = "Multi AI Web"
base_url = "http://127.0.0.1:17900/v1"
wire_api = "responses"
```

Depois escolha um modelo do catálogo (ex.: `chatgpt-web/luna`).

### 7.4 DeepSeek Harness (DSH)

No arquivo de perfil (`~/.dsh/profiles/desktop/cordis.patch.yml`, entrada `llm-pi-ai`):

```yaml
      multi-ai-web:
        displayName: Multi AI Web (hub local)
        api: openai-completions
        apiKeyEnv: MULTI_AI_WEB_KEY
        baseURL: http://127.0.0.1:17900/v1
        defaultContextWindow: 131072
        defaultMaxTokens: 8192
        models:
          - id: auto-web/auto
            name: Auto (melhor provedor disponível)
            contextWindow: 131072
            maxTokens: 8192
```

A chave `MULTI_AI_WEB_KEY` é uma **referência falsa** exigida pelo DSH; o hub não valida
Authorization. Ela precisa estar no serviço de credenciais do DSH:

```yaml
# ~/.dsh/.credentials.yaml
version: 1
refs:
  MULTI_AI_WEB_KEY: hub-local-sem-chave
```

(ou salve pela página **Models** do DSH). Depois reinicie o DSH e escolha o provedor
“Multi AI Web (hub local)”.

### 7.5 Open WebUI / outros clientes OpenAI

- Base URL: `http://127.0.0.1:17900/v1`
- API key: qualquer valor (ou o `authToken` do hub, se você configurar um)

---

## 8. Segurança e limites

- Hub e pontes escutam apenas em `127.0.0.1`. Não exponha à rede sem `authToken`.
- Sessões ficam em perfis Chrome dedicados (`%LOCALAPPDATA%\dsh-webai\*`, `~/.codex-chatgpt-web`).
- Nunca use o perfil pessoal do Chrome.
- Anti-bot (Cloudflare, slider, CDN) **não** é contornado; provedores bloqueados ficam de fora.
- Modelos web são **chat/texto**: não emitem `tool_calls` nativos. Para agente com ferramentas, use
  um modelo nativo (ex.: Ollama) ou o Full Harness do ChatGPT com conector MCP.
- O ChatGPT browser-only responde `> Local tools unavailable` quando a conversa exige ferramentas.

---

## 9. Diagnóstico

```powershell
# hub: saúde de todos os provedores
node src/index.mjs doctor --config config.json

# config válido
node src/index.mjs check --config config.json

# health direto
Invoke-RestMethod http://127.0.0.1:17900/health
Invoke-RestMethod http://127.0.0.1:8788/health
Invoke-RestMethod http://127.0.0.1:17841/health
```

### Erros comuns

| Sintoma | Causa | Correção |
| --- | --- | --- |
| `unreachable` em um provedor | ponte daquele provedor não está rodando | suba `webai-bridge`, `deepseek-web-bridge` ou o `serve` do ChatGPT |
| `MISSING_CREDENTIAL` no DSH | `MULTI_AI_WEB_KEY` não está no `refs` do `.credentials.yaml` (ou sem indentação) | adicione `  MULTI_AI_WEB_KEY: valor` sob `refs:` ou salve pela página Models |
| `502 model_catalog_failed` no `:17841/v1/models` | catálogo **nativo** do bridge exige token do Codex | ignore: o hub usa os modelos `chatgpt-web/*`; não chame `/v1/models` do bridge |
| `GPT-5.6 Sol (Web) is not available for this Luna-only account` | conta ChatGPT sem o modelo | use `chatgpt-web/luna` |
| `exceeds the measured 28,000-token ChatGPT Free browser transport budget` | a conversa passou do orçamento do Luna (~28k/turno) | abra **nova conversa** e configure `contextWindow: 24000` no cliente |
| `requires native Codex turn_id metadata` | cliente não manda metadados nativos | use o hub (ele injeta quando `codexTurnMetadata: true`) |
| `authentication_error` 401 | hub com `authToken` configurado | envie `Authorization: Bearer <token>` |
| porta ocupada | processo anterior | `Get-NetTCPConnection -LocalPort 17900` e encerre o PID |
| sessão expirada (login wall) | cookie velho | refaça `login.cmd <provedor>` |
| Cloudflare/slider | anti-bot | provedor excluído; não há bypass |

---

## 10. Verificação rápida (checklist)

```powershell
npm test                                   # 23/23
node src/index.mjs doctor --config config.json   # 9/9 ok
Invoke-RestMethod http://127.0.0.1:17900/v1/models
```

Teste um turno real:

```powershell
$body = @{ model="auto-web/auto"; messages=@(@{role="user";content="Reply with exactly: OK"}) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://127.0.0.1:17900/v1/chat/completions -Method POST -ContentType application/json -Body $body
```

---

## 11. Estrutura do repositório

```
src/index.mjs        CLI: serve | check | doctor | models | health
src/server.mjs       HTTP: /v1/models, /v1/chat/completions, /v1/responses, /health
src/config.mjs       validação do config.json (providers, modelos, flags)
src/catalog.mjs      catálogo agregado
src/translate.mjs    tradução Chat ↔ Responses (JSON e SSE)
src/serial-queue.mjs fila serial por provedor
scripts/             smoke-live.mjs e utilitários
docs/                PROVIDERS.md, USAGE.md
```

Mais detalhes de desenho: `docs/PROVIDERS.md`, `README.md` e as notas de fork.
