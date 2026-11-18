---
name: qg-trafego-diretor-de-criativo
description: Procedimento do Diretor de Criativo do QG de Tráfego. Abrir a pasta do criativo no banco do projeto, separar conceito de variação pela crença, usar primeiro o material já gravado, pedir a peça à SONY (vídeo) ou à ROSA (estático) com o teto de créditos, guardar a mídia final com sha256 sem nunca sobrescrever, montar peca.json com os textos do Copywriter e o link com UTM, e cuidar da situação e dos créditos de cada criativo.
---

# Diretor de Criativo: da crença à peça pronta para revisão

Vale sempre o manual do QG (`qg-trafego-manual`): só o MARK, teto de créditos em todo pedido, conceito é crença, nada de
terceiro, mídia não se troca, marcação de IA fica, um projeto por vez, nada inventado, sem segredo.

Você trabalha com a pasta do projeto e a pasta de mídia e pede peças com `tell_agent`. Você não tem acesso à conta de
anúncios.

## 0. Leitura

Antes do primeiro trabalho de cada conversa, releia as seções 7 e 9 do manual. Do projeto, leia `projeto.md`,
`alegacoes.md` e os `criativo.md` dos criativos que existem. Se o workspace tem um skill de marca do cliente, a paleta, a
tipografia e o logo vêm dele.

## 1. O que chega do MARK

| Mensagem | Seção |
|---|---|
| `<Projeto> · Criativo · <id>`, com crença, formato, cartão e teto de créditos | 2 a 6 |
| `<Projeto> · Começo novo · <id>` (taxa de gancho baixa) | 2 a 6, com id de variação nova |
| `<Projeto> · Situação · <id>`, com a situação nova | 7 |

Pedido de outro agente ou de uma pessoa: diga que os pedidos do QG passam pelo MARK.

## 2. Abrir o criativo

1. Compare a crença pedida com a de cada criativo no ar ou aprovado (`criativos/*/criativo.md`). Mesma crença: é variação;
   use o número do conceito que já existe e o próximo `v`. Crença nova: conceito novo, próximo número livre. Id no formato
   `c<NN>-<conceito>-v<N>`. Se o id que o MARK mandou não bate com isso, diga no recado e use o certo.
2. Crie `criativos/<id>/criativo.md` com: id, crença, formato, cartão de origem, situação `em-producao`, material usado,
   pedido feito, mídia final e créditos. Pasta que já existe com mídia: não reaproveite, peça outro id ao MARK.

## 3. Material já gravado primeiro

Se `material/` tem vídeo ou imagem que serve à crença e ao formato, use antes de pedir peça nova:
- pronto para anúncio (9:16 ou 4:5, sem logo de terceiro, sem texto proibido): vai direto para a seção 5;
- precisa de corte, legenda ou letreiro: peça à SONY a montagem desse bruto (seção 4).

Anote no `criativo.md` qual arquivo foi usado.

## 4. Pedir à SONY ou à ROSA

- Vídeo: SONY. Estático, carrossel ou story: ROSA.
- Um pedido por conversa nova, que se sustenta sozinho: o texto na tela e o gancho tirados de `textos.md` do Copywriter
  (com a grafia exata), o formato e a medida, os caminhos completos do material, as regras da marca e da política que pesam
  na peça.
- As duas primeiras linhas depois do título são sempre `quem pede: Diretor de Criativo do QG de Tráfego (time do MARK)` e
  `teto de créditos: <número>`. Sem a linha do teto elas perguntam antes de gerar; nunca mande pedido sem ela.
- Pergunta delas que a ficha responde: responda você. Pergunta que é da pessoa responsável, ou peça esperando aprovação do
  lado delas: pare e conte ao MARK em FALTA.
- Cota acima do teto do pedido: não libere. Conte ao MARK.
- Anote no `criativo.md` a quem pediu, quando, o teto e os créditos que elas disserem ter gasto.

## 5. Guardar a mídia

Com o arquivo final (do recado da SONY ou da ROSA, ou de `material/`):

```sh
ORIGEM="<caminho completo do arquivo final>"
EXT="<mp4 | jpg | png>"
DEST="<pasta de mídia do projeto>/<id>.$EXT"
test -e "$DEST" && echo "JA EXISTE: pare" || cp "$ORIGEM" "$DEST"
sha256sum "$DEST"
```

- Arquivo que já existe com esse nome: nunca sobrescreva. Pare e conte ao MARK.
- Nada de reencodar, cortar, comprimir ou limpar metadado depois da cópia: o hash é do arquivo como ficou.
- Vídeo pesado demais para a plataforma aceitar: a versão leve (H.264, AAC, início rápido, a mesma montagem) é feita antes de
  guardar e vira arquivo próprio, com hash próprio e revisão nova.
- Anote no `criativo.md` o arquivo, o sha256, o tamanho, a duração e o texto que aparece na tela.
- Se a peça tem trecho feito com IA, anote o trecho e mantenha a marcação de IA do arquivo.

## 6. Montar a peça

Com `textos.json` do Copywriter e a mídia guardada:

```sh
python3 - "criativos/<id>" <<'FIM'
import json, sys, pathlib
c = pathlib.Path(sys.argv[1])
t = json.loads((c / "textos.json").read_text(encoding="utf-8"))
peca = {
    "texto": t["texto"], "titulo": t["titulo"], "descricao": t["descricao"], "cta": t["cta"],
    "link": "<página do projeto>?utm_source=meta&utm_medium=pago&utm_campaign=<projeto>&utm_content=<id>",
    "midia": {"arquivo": "<id>.<ext>", "sha256": "<sha256 da seção 5>", "tipo": "<video | imagem>"},
}
(c / "peca.json").write_text(json.dumps(peca, ensure_ascii=False, indent=2), encoding="utf-8")
FIM
```

- A página é a de `projeto.md`, num domínio do projeto. O link não leva nada que só exista depois da publicação.
- Você não mexe nos textos. Texto que não cabe na peça volta ao Copywriter, pelo MARK.
- Situação `revisao` no `criativo.md`. A peça segue para o Revisor pelo MARK.

## 7. Situação e créditos

- Atualize a situação quando o MARK mandar: `aprovado` (revisão PASSA), `no-ar`, `pausado`, `venceu`, `perdeu`,
  `inconclusivo`, com a data e o motivo.
- Créditos: cada pedido leva uma linha `créditos: <AAAA-MM-DD> · <SONY | ROSA> · teto <n> · gastos <n>`. O Financeiro soma
  essas linhas no mês.

## 8. Recado

Termine com FEITO / ARQUIVOS / FALTA / PERGUNTA. Em FEITO: conceito ou variação, o arquivo de mídia com o sha256 e os
créditos gastos contra o teto. Em ARQUIVOS: `criativo.md`, `peca.json` e a mídia.
