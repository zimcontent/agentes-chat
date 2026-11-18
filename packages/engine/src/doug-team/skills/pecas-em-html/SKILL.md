---
name: pecas-em-html
description: Como montar e renderizar peças de design em HTML/CSS com Chromium (Playwright) no nível de agência, sem cara de site - carrossel, post, story, capa, apresentação, one-pager e PDF. Use quando a peça sai em HTML, quando a skill de marca pede HTML ou quando não há Figma com escrita.
---
# Peças em HTML, com nível de agência

HTML é o arquivo editável mais seguro: texto real, fonte real, medida exata, e qualquer pessoa ajusta depois no editor de peças. O risco é a peça sair com cara de site. Esta skill evita isso.

**Princípio:** nenhuma página antes de um plano de direção escrito; nada é "pronto" antes de olhar o render de cada página.

## 1. Plano antes do HTML

Em `plano.md`, antes de escrever código:
- conceito em uma frase (o que esta peça tem de específico desta marca e deste assunto);
- as cores com hex e papel, as fontes e papéis, a escala tipográfica, a grade e as margens, tudo tirado da skill de marca (nunca inventados);
- um esboço (wireframe em texto) de cada lâmina ou página, variando a composição;
- o UM elemento ousado da peça;
- a autocrítica: "isto sairia igual para qualquer cliente parecido?" Se sim, revise e anote o que mudou.

Copie o sistema do plano num comentário no topo do HTML e siga-o.

## 2. Partir de um modelo, nunca do zero

Se a marca já tem peças aprovadas em HTML, copie a mais próxima e adapte. Se não tem, meça as peças publicadas da marca (cores, tamanhos de letra, margens, posição do logo e do rodapé) e monte o primeiro modelo a partir dessas medidas. Toda peça aprovada vira modelo para as próximas.

## 3. Estrutura

- Cada lâmina é um `<section class="slide">` no tamanho final (1080 x 1350, 1080 x 1920, 1920 x 1080...), um embaixo do outro.
- Cada camada leva `data-layer="<nome>"`, para a pessoa comentar e pedir ajuste camada por camada.
- Confira que o texto da arte bate com a copy aprovada, letra por letra.
- Tudo embutido no arquivo (fontes, imagens em data URI ou arquivos ao lado com caminho relativo), para o HTML abrir igual em qualquer lugar.
- Fonte local com `@font-face` e arquivo relativo; carregue a fonte antes de medir qualquer texto.

## 4. Receitas que funcionam

- **Vidro fosco:** `backdrop-filter: blur() saturate()` no PRÓPRIO elemento. Se um ancestral tiver `isolation`, `opacity`, `filter` ou `mask`, o fundo não é visto e nada desfoca. Sombra externa no `box-shadow` do mesmo elemento. Borda de luz: um irmão com padding de 1 a 2 px, degradê e `mask-composite: exclude`. Vidro entre 10 e 40% de opacidade, desfoque de 24 a 40 px, contorno em degradê suave, sombra leve. Sobre foto clara, vidro branco não segura texto claro: use o escuro da marca por cima do desfoque.
- **Grão:** SVG `feTurbulence` num `::after` com opacidade baixa. **Brilho diagonal:** `::before`.
- **Posição:** só filhos diretos da lâmina ficam absolutos sozinhos; netos precisam de `position: absolute` explícito.
- **Texto com degradê:** `background-clip: text`.
- **Centralizar pela tinta, não pela caixa:** renderize cada linha sozinha (preto sobre branco), meça a caixa da tinta e compense com padding por linha (`transform` quebra o recorte). Linha de base: um marcador `inline-block` de 0 x 0 e o `getBoundingClientRect().bottom` dele. Para caber, meça com `measureText` do canvas.
- **Palavra de destaque:** uma segunda família (serifa itálica ou script) só numa palavra-conceito, sobreposta às linhas sem serifa; nunca três famílias.

## 5. Render

- Playwright com Chromium (ou o Chrome do sistema, `channel="chrome"`), sem cabeça.
- Viewport do tamanho da lâmina, `device_scale_factor` 2 a 3; recorte cada `section.slide` com `clip`. Para a prévia, reduza com Lanczos e um dither leve.
- PNG de cada lâmina na ordem (`01.png`, `02.png`...); apresentação também em PDF (`page.pdf` com o tamanho da página e fundo impresso).
- Confira cada arquivo: tipo, tamanho em pixels, ordem.

## 6. Verificação, página por página, no render

Abra a folha com todas as lâminas e passe o olho da skill `direcao-de-arte` (seção 0). Além dele:
- texto da arte igual à copy aprovada, letra por letra;
- nada cortado, vazando ou encostando na borda; margens iguais;
- contraste do texto sobre foto e sobre vidro;
- fonte certa carregada (nada caiu na fonte padrão do navegador).

Defeito encontrado: corrija antes de responder. No máximo duas voltas.

**Passe final:** antes de terminar, retire um elemento decorativo.

## Nunca com cara de site

- texto dentro de caixa ou cartão de fundo chapado;
- três ou mais blocos de vidro na mesma lâmina;
- ícone genérico, botão, barra de progresso com cara de aplicativo;
- lâminas todas iguais;
- página vazia resolvida com caixa, ícone ou enfeite em vez de composição e respiro.

## Erros comuns

- Começar pelo HTML sem `plano.md`.
- Repetir o mesmo layout em páginas seguidas.
- Inventar dado, frase institucional ou foto do produto do cliente.
- Declarar pronto sem abrir as imagens renderizadas.
- Ajustar coordenada à mão quando um elemento sobrepõe outro: refaça o layout com auto layout (flex ou grid).
