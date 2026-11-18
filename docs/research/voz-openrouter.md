# Voz ao vivo com uma chave OpenRouter

Relatório de pesquisa, 2026-11-18. Não muda código. Responde a uma pergunta só: **a voz ao vivo do DougBot
(ADR [doug-0006](../adr/doug-0006-live-voice.md)) poderia rodar com uma chave OpenRouter no lugar da chave OpenAI?**

Resposta curta: **não**, não como ela está hoje. Não é uma troca de endereço nem de modelo: a voz ao vivo é construída
sobre um transporte de áudio em tempo real (WebRTC com SDP, mais uma conexão de controle) que a OpenRouter não oferece.
O que a OpenRouter tem de áudio é requisição/resposta, sem conversa contínua nem interrupção. Abaixo, o que existe de
cada lado, com as fontes, e o que uma porta custaria.

## 1. Como a voz ao vivo funciona hoje

Tudo isto está no código, não em documentação externa. Arquivos citados por caminho e linha.

### 1.1 Provedor, modelo e preço

- Modelo: `gpt-live-1`, fixo no código (`packages/providers/src/live-voice.ts:9`, `LIVE_VOICE_MODEL`).
- Base da API: `https://api.openai.com/v1`, fixa (`packages/providers/src/live-voice.ts:12`, `LIVE_VOICE_API`).
- Preço: `833_334` nano-USD por segundo, ou US$ 0,05 por minuto, cobrado por segundo, com mínimo de 15 s por sessão
  WebRTC (`live-voice.ts:15,18`, `LIVE_VOICE_NANO_USD_PER_SECOND`, `LIVE_VOICE_MIN_SECONDS`).
- Vozes: um catálogo de 23 vozes da OpenAI (marin, cedar, bossa, tempo…), dado puro em `LIVE_VOICE_CATALOG`
  (`live-voice.ts:35`).
- Nem modelo, nem preço, nem endereço são variável de ambiente: não há `LIVE_VOICE_*` em
  `packages/config/src/schema.ts`. A única configuração por workspace é a própria chave.

### 1.2 Transporte: WebRTC com o SDP trocado no servidor

1. O navegador monta um `RTCPeerConnection`, põe a faixa do microfone, cria o canal de dados `oai-events`, faz a oferta
   e espera o ICE juntar (até 2,5 s) para levar todos os candidatos numa ida só
   (`apps/web/src/live-voice/leg.ts:41,54,55,66-84`).
2. O servidor manda o SDP cru para a OpenAI: `POST https://api.openai.com/v1/live/sessions`
   (`packages/engine/src/live-voice.ts:367`), com corpo
   `{ session: { model, instructions, audio: { output: { voice } }, delegation: { type: "client" } },
   transport: { type: "webrtc", sdp } }` (`live-voice.ts:374-382`), o cabeçalho `Authorization: Bearer <chave>` e um
   `OpenAI-Safety-Identifier` (o hash do id da pessoa, `live-voice.ts:354-357`).
3. A resposta traz `{ session: { id }, transport: { sdp } }` (`live-voice.ts:408-411`); o SDP de resposta volta para o
   app. Daí em diante **o áudio corre direto entre o navegador e a OpenAI**; o servidor nunca vê nem toca o áudio.
4. **Conexão de controle (sideband)**, um WebSocket do servidor para a sessão em curso:
   `ws(s)://api.openai.com/v1/live/sessions/{id}/attach` (`live-voice.ts:311-312`), com a chave no cabeçalho
   (`bunSideband`, `live-voice.ts:339-351`). Por ela chegam `usage.seconds` e `session.closed`, e por ela o servidor
   pede `session.close` (`live-voice.ts:305`).

**Não há token efêmero em lugar nenhum.** A chave do workspace fica no servidor; o navegador só recebe o SDP de
resposta.

### 1.3 Áudio, detecção de fala e eventos

- Formato/codec: **nada é especificado no código**. Não há `sampleRate`, `pcm`, `opus`, `input_audio_format` nem
  `output_audio_format`. Vale o padrão do WebRTC do navegador; as restrições do microfone são só
  `echoCancellation`, `noiseSuppression`, `autoGainControl` (`apps/web/src/live-voice/room.ts:176-178`).
- Detecção de fala (VAD): **nenhuma configuração**. A sessão leva só `model`, `instructions`, `audio.output.voice`,
  `delegation` (`live-voice.ts:374-382`). A vez de falar é decidida **no app**: `packages/client/src/lib/live-floor.ts`
  e `live-host.ts`, mais um modelo pequeno no servidor (`pickLiveSpeaker`, `live-voice.ts:1178-1254`), aplicada com
  nós de ganho de Web Audio (`room.ts:449-470,526-548`).
- Eventos usados, no canal `oai-events`: `session.started`, `session.instructions.append`,
  `session.thinking.append`, `session.commentary.append`, `session.input_audio.mute`/`unmute`,
  `session.input_transcript.delta`/`session.output_transcript.delta`, `session.delegation.created`, `session.close`/
  `session.closed` (`leg.ts:93-153`, `room.ts:631-643`). São nomes da **API Live** da OpenAI (`session.*`), não os da
  Realtime API clássica (`response.audio.delta`, `input_audio_buffer.*`).
- Ferramentas dentro da sessão: **nenhuma**. O que existe é *delegação*: a sessão nasce com
  `delegation: { type: "client" }`; quando o modelo emite `session.delegation.created`, o servidor publica o que a pessoa
  disse como mensagem normal do chat, o agente trabalha com as ferramentas de sempre, e a resposta volta por
  `session.commentary.append` (`live-voice.ts:1349-1420,1064-1109`; `room.ts:739-800`).

### 1.4 Autenticação e cobrança

- A chave OpenAI do workspace, selada com cifra de envelope como as chaves de provedor (ADR 0007), em
  `live_voice_keys` (`live-voice.ts:92,177,206-211`); só os últimos 4 caracteres voltam (`keyHint`, `:178`).
- Antes de abrir: `assertLiveVoiceAllowed` (situação do workspace, limite da pessoa, orçamento do agente)
  (`packages/engine/src/gateway.ts:1108-1116`). Depois: `recordLiveVoiceUsage` grava **uma** linha em `usage_records`
  com `inputTokens: 0`, `outputTokens: 0` e um `costNanoUsd`, **por segundos** (`gateway.ts:1118-1146`). A unidade é
  tempo, não token (`live-voice.ts:235-267`).

## 2. O que a OpenRouter oferece hoje

Checado em 2026-11-18 direto em openrouter.ai e na API pública (sem chave).

### 2.1 Tempo real: não existe

- **Nenhuma página de documentação de realtime.** Testadas, todas 404:
  `https://openrouter.ai/docs/features/realtime`, `/docs/guides/realtime`,
  `/docs/api-reference/realtime`, `/docs/guides/overview/multimodal/realtime.md`,
  `/docs/guides/overview/multimodal/speech-to-speech.md`, `/docs/features/audio`, `/docs/features/speech-to-text`.
- **O índice de documentação não menciona realtime.** `https://openrouter.ai/docs/llms.txt` tem 0 ocorrências de
  "realtime" e 0 de "webrtc". `https://openrouter.ai/sitemaps/docs.xml` lista 557 URLs e nenhuma delas é de
  realtime/webrtc/voice/speech.
- **A especificação OpenAPI não tem caminho de realtime.** `https://openrouter.ai/docs/openapi/openapi.yaml` tem
  `/audio/speech` e `/audio/transcriptions`, e **nenhum** `/realtime*`, `/live*` ou `/ws`; `grep -ic realtime` dá 0.
- **A própria API devolve 404** nesses caminhos (mesmo corpo de um caminho inventado, `{"error":{"message":"Not Found",
  "code":404}}`): `POST /api/v1/realtime`, `/api/v1/realtime/sessions`, `/api/v1/live/sessions`, `/api/v1/ws`,
  `/api/v1/beta/realtime`.
- **Nenhum modelo de voz para conversa em tempo real catalogado.** `https://openrouter.ai/api/v1/models` traz 478
  modelos; `openai/gpt-realtime`, `openai/gpt-live-1` e `openai/gpt-4o-realtime-preview` respondem 404 em
  `GET /api/v1/models/{id}/endpoints`. Com saída de áudio há 4: `google/lyria-3-pro-preview`,
  `google/lyria-3-clip-preview` (música), `openai/gpt-audio` e `openai/gpt-audio-mini`.
- **A OpenRouter não tem segredo efêmero de sessão.** O único caminho para criar chave é a API de gestão `POST /keys`
  (`createKeys` na especificação), que devolve uma chave de conta de vida longa, com `limit` e `expires_at` — não um
  token de curta duração preso a uma sessão de navegador.
- **O próprio tutorial de voz da OpenRouter manda trazer a camada de tempo real.** Em
  `https://openrouter.ai/blog/tutorials/build-voice-ai-agent/`: "*We can use LiveKit Agents for this. It handles the
  real-time audio connection and conversation flow while letting us continue using the same three models through
  OpenRouter*" e "*real-time playback and interruptions need additional orchestration*".

### 2.2 O que existe de áudio: três superfícies de HTTP

Base `https://openrouter.ai/api/v1`, conforme `https://openrouter.ai/docs/api-reference/overview`.

**(a) Áudio de entrada numa requisição normal** (`https://openrouter.ai/docs/guides/overview/multimodal/audio`):
requisição à Responses API (`/api/v1/responses`) com o tipo de conteúdo `input_audio`, base64 com o formato
(`{ "type": "input_audio", "input_audio": { "data": "<base64>", "format": "wav" } }`). URLs diretas não valem para
áudio. É **um arquivo inteiro**, não um fluxo incremental.

**(b) Áudio de saída estilo TTS pela Chat Completions** (mesma página): `modalities: ["text","audio"]` e
`audio: { voice, format }`; exige `stream: true`; os pedaços chegam como base64 em `choices[0].delta.audio.data`. É
SSE sobre HTTP: uma requisição e uma resposta, **sem duplex, sem interrupção, sem VAD no servidor**. Modelos:
`openai/gpt-audio` e `openai/gpt-audio-mini` (texto+áudio → texto+áudio; `supported_parameters` inclui `tools`).

**(c) Endpoints dedicados de transcrição e síntese**
(`https://openrouter.ai/docs/guides/overview/multimodal/stt.md`, `…/tts.md`, e
`https://openrouter.ai/blog/announcements/announcing-audio-apis/`):
`POST /api/v1/audio/transcriptions` (json ou `verbose_json`, limite de 25 MB, timeout de 60 s) e
`POST /api/v1/audio/speech` (`mp3` ou `pcm`, pcm 16 bits little-endian). São requisição/resposta, sem variante
WebSocket nem WebRTC (`grep -ic websocket openapi.yaml` dá 0).

### 2.3 O que não deu para verificar

- Não achei página dizendo "não oferecemos realtime": a conclusão é ausência de evidência em docs, índice, sitemap,
  OpenAPI, changelog, blog e API viva, não uma negativa escrita pela OpenRouter.
- A busca na web (WebSearch) não funcionou neste ambiente; as conclusões acima vêm de busca direta em openrouter.ai.
- Codec, taxa de amostragem e bitrate reais de uma sessão GPT-Live: o código não diz e não confirmei a especificação de
  transporte da OpenAI, então o relatório diz "o padrão do WebRTC", não "Opus" nem "PCM16".
- Se a OpenAI roda VAD no servidor por padrão no GPT-Live: é inferência de comportamento (o ADR cita "se o GPT-Live
  espera um som"), não um fato documentado que eu tenha confirmado.
- A unidade exata dos preços `pricing.audio`/`audio_output` da OpenRouter (por token ou por segundo).
- `openai/gpt-4o-audio-preview` aparece no exemplo do guia de áudio da OpenRouter mas não na lista viva de modelos; não
  determinei se foi retirado ou só escondido da lista.

## 3. Veredito e o que uma porta custaria

**Não funciona:** a voz ao vivo não roda com chave OpenRouter, nem como troca de endereço. A OpenRouter não tem
transporte de áudio em tempo real de nenhum tipo — nem WebRTC, nem WebSocket de sessão, nem endpoint de SDP, nem
segredo efêmero, nem modelo fala-para-fala. O que existe é HTTP de requisição/resposta.

O alvo realista, se a meta for "voz numa chave OpenRouter", é um **pipeline por turnos** STT → LLM → TTS
(`/audio/transcriptions` + `/chat/completions` + `/audio/speech`) — que é exatamente o modo que o ADR doug-0006
construiu e depois apagou, porque soava mais lento que o GPT-Live. Retomá-lo é portar uma funcionalidade, não trocar de
provedor.

Mapa do que mudaria, arquivo a arquivo:

| Camada | Arquivo / símbolo | O que aconteceria |
| --- | --- | --- |
| Modelo, preço, vozes | `packages/providers/src/live-voice.ts:9,12,15,20,35` | Reescrever. `gpt-live-1`, `api.openai.com`, nano-USD por segundo e os nomes de voz da OpenAI são fatos do GPT-Live. A OpenRouter não tem `gpt-live-1` (404), tem vozes por modelo e preço por token. |
| Checagem da chave | `packages/engine/src/live-voice.ts:158-169` | Reescrever: `GET /models/gpt-live-1` não existe lá. O equivalente é `GET /api/v1/key` ou a lista de modelos sem chave. |
| Criação da sessão | `live-voice.ts:359-412` (`createAtOpenAI`) | Apagar: não há endpoint de SDP para chamar. |
| Sideband | `live-voice.ts:286-336,339-351`, URL `:311-312` | Apagar: sem `/live/sessions/{id}/attach`, sem `session.closed`, sem `usage.seconds` empurrado. Uso viria do `usage.cost` por chamada. |
| Configuração da sessão | `live-voice.ts:374-382` | Apagar. Só sobrevive `instructions`, que vira mensagem de sistema numa chat completion. |
| Delegação | `live-voice.ts:1349-1420,1064-1109` | Rearquitetar: `session.delegation.created` não tem equivalente; a passagem de bastão vira chamada de ferramenta comum no laço por turnos (mais fácil, aliás). |
| Unidade de cobrança | `gateway.ts:1108-1146`, `providers/live-voice.ts:113` | Reescrever de segundos para `usage.cost` por chamada. `assertLiveVoiceAllowed` sobrevive inteiro. |
| Áudio do navegador | `apps/web/src/live-voice/leg.ts` (arquivo todo), `room.ts:441-548`, `listen.ts` | Reescrever: o canal `oai-events` e os eventos `session.*` não existem; a oferta/resposta não tem servidor para responder. |
| Vez de falar | `packages/client/src/lib/live-floor.ts`, `live-host.ts`, `pickLiveSpeaker` | Em boa parte reaproveitável, mas com transporte por requisição o VAD tem de ir para o aparelho. |
| Salas e P2P entre pessoas | `room.ts:59,313-400`, `live-voice.ts:864-1055`, rotas | Reaproveitável como está: WebRTC entre pessoas, sinalização por `live.signal`, entrar/sair/convidar, notas e resumo são agnósticos ao transporte. |
| Prompts | `packages/engine/src/live-voice-prompt.ts` (todo) | Reaproveitável: texto puro. Só as semânticas de "comece a falar ao conectar" (`listen`, `sample`) não se sustentam num pedido de TTS. |
| Banco | `packages/db/src/schema/live-voice.ts`, `EXTRA_COLUMNS` | Reaproveitável; `providerSessionId`, `seconds` e `endReason` passam a significar menos (ou guardariam ids de geração da OpenRouter). |

Achado menor e positivo: a OpenRouter **pode** fazer as metades não-tempo-real que o DougBot já tem — transcrição para
as mensagens de voz (ADR 0100) e síntese para as notas de voz do WhatsApp — e o `openai/gpt-audio` aceita `tools`, então
um turno "áudio entra → ferramentas + resposta falada" é possível. Só não é conversa ao vivo com interrupção.

## Fontes

- Voz ao vivo no código: `packages/providers/src/live-voice.ts`, `packages/engine/src/live-voice.ts`,
  `apps/web/src/live-voice/*`, `packages/engine/src/gateway.ts`, `docs/adr/doug-0006-live-voice.md`.
- Visão geral da API: https://openrouter.ai/docs/api-reference/overview
- Índice de documentação: https://openrouter.ai/docs/llms.txt · sitemap: https://openrouter.ai/sitemaps/docs.xml
- Especificação OpenAPI: https://openrouter.ai/docs/openapi/openapi.yaml
- Áudio (entrada e saída): https://openrouter.ai/docs/guides/overview/multimodal/audio
- STT: https://openrouter.ai/docs/guides/overview/multimodal/stt.md · TTS:
  https://openrouter.ai/docs/guides/overview/multimodal/tts.md
- Anúncio das APIs de áudio: https://openrouter.ai/blog/announcements/announcing-audio-apis/
- Tutorial de agente de voz: https://openrouter.ai/blog/tutorials/build-voice-ai-agent/
- Modelos: https://openrouter.ai/api/v1/models
- Sondagens (404/401) aos caminhos `/api/v1/realtime`, `/api/v1/live/sessions`, `/api/v1/ws`, `/api/v1/audio/translations`,
  feitas em 2026-11-18.
