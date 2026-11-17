// The DougBot identity's drawer (identidade/dougbot-identidade/dougbot-avatar.js, v0.11), with the Doug redrawn as a
// bot (v0.12, 2026-11-14): a bot's head with his quiff and two eyes stands where his portrait stood, inside the same
// piece of green glass. The other bots are the package's, untouched; the package takes the same change.
// The last lines differ from the package's: the module exports the API (ESM) instead of setting window.DougBot or
// module.exports. packages/ui and apps/mobile each keep a copy: a change to one is a change to both.
// Biome skips this file (biome.json), so it keeps the package's own hand.
const __alvo = {};
/* DougBot: bots 2D desenhados por código (SVG). Sem imagem e sem dependência.
   Cada bot = casca de vidro colorido (a forma diz a função) + tela de vidro fosco + olhos em tinta.
   O Doug é a peça de vidro verde com a cabeça de bot dentro: preta e brilhante, um quadrado macio com o topete em onda (de longe se lê um D) e dois olhos brancos. Nele só os olhos mudam: é com eles que ele diz o estado.
   Uso: DougBot.avatar({ bot: 'doug' }) devolve um SVG; DougBot.montar() preenche [data-dougbot]. */
(function (raiz) {
  'use strict';
  var conta = 0;
  var VERDE = '#9CFA05', TINTA = '#0A0A0A', BRANCO = '#F4F6F2';

  function rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); var v = parseInt(h, 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
  function hex(c) { return '#' + c.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function n(v) { return Math.round(v * 100) / 100; }
  function circ(x, y, r) { return 'M' + n(x - r) + ' ' + n(y) + 'A' + r + ' ' + r + ' 0 1 0 ' + n(x + r) + ' ' + n(y) + 'A' + r + ' ' + r + ' 0 1 0 ' + n(x - r) + ' ' + n(y) + 'Z'; }
  function caixa(x, y, w, h, r) { return 'M' + n(x + r) + ' ' + n(y) + 'H' + n(x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x + w) + ' ' + n(y + r) + 'V' + n(y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x + w - r) + ' ' + n(y + h) + 'H' + n(x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x) + ' ' + n(y + h - r) + 'V' + n(y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x + r) + ' ' + n(y) + 'Z'; }
  // Polígono de cantos arredondados: t é quanto de cada lado vira curva.
  function poli(pts, t) {
    var s = '', i, L = pts.length;
    for (i = 0; i < L; i++) {
      var v = pts[i], a = pts[(i + L - 1) % L], b = pts[(i + 1) % L];
      s += (i ? 'L' : 'M') + n(v[0] + (a[0] - v[0]) * t) + ' ' + n(v[1] + (a[1] - v[1]) * t) + 'Q' + n(v[0]) + ' ' + n(v[1]) + ' ' + n(v[0] + (b[0] - v[0]) * t) + ' ' + n(v[1] + (b[1] - v[1]) * t);
    }
    return s + 'Z';
  }

  // Cascas num quadro de 120 x 120. A forma diz a função.
  var CORPOS = {
    petala:   'M46 20H96Q108 20 108 32V78C108 98 96 112 76 112H44C24 112 12 98 12 78V54C12 34 26 20 46 20Z',
    monitor:  caixa(8, 32, 104, 80, 27),
    quadrado: 'M30 20H90A18 18 0 0 1 108 38V94A18 18 0 0 1 90 112H30A18 18 0 0 1 12 94V38A18 18 0 0 1 30 20Z',
    torre:    'M12 30Q12 14 28 14H33Q38 14 38 19V23Q38 28 43 28Q48 28 48 23V19Q48 14 53 14H67Q72 14 72 19V23Q72 28 77 28Q82 28 82 23V19Q82 14 87 14H92Q108 14 108 30V82C108 101 97 112 78 112H42C23 112 12 101 12 82Z',
    moeda:    'M60 20A46 46 0 0 1 60 112A46 46 0 0 1 60 20Z',
    hexagono: poli([[60, 12], [105, 38], [105, 90], [60, 116], [15, 90], [15, 38]], .27),
    squircle: 'M42 20H78C97 20 108 31 108 50V82C108 101 97 112 78 112H42C23 112 12 101 12 82V50C12 31 23 20 42 20Z'
  };

  // Telas: a placa de vidro fosco onde o rosto mora. Cada uma repete a forma da sua casca.
  var VISORES = {
    petala:   'M48 31H89Q97 31 97 39V77C97 91 88 101 73 101H47C32 101 23 91 23 77V56C23 41 33 31 48 31Z',
    monitor:  caixa(18, 42, 84, 60, 19),
    quadrado: caixa(23, 30, 74, 54, 13),
    torre:    caixa(23, 39, 74, 62, 18),
    moeda:    circ(60, 66, 35),
    hexagono: poli([[60, 25], [93.8, 44.5], [93.8, 83.5], [60, 103], [26.2, 83.5], [26.2, 44.5]], .27),
    squircle: 'M45 31H75C90 31 97 39 97 53V79C97 93 90 101 75 101H45C30 101 23 93 23 79V53C23 39 30 31 45 31Z'
  };

  // Altura dos olhos em cada tela, para montar um bot novo só com a forma.
  var ALTURA = { petala: 66, monitor: 72, quadrado: 57, torre: 70, moeda: 66, hexagono: 64, squircle: 66 };

  // Doug: a peça de vidro e a cabeça que mora nela, no mesmo quadro de 120 x 120.
  var QUADRO = 'M38 10H82C101 10 110 19 110 38V82C110 101 101 110 82 110H38C19 110 10 101 10 82V38C10 19 19 10 38 10Z';
  // A cabeça: um quadrado macio (cabeça de bot) com o topete em onda, quebrando sobre a risca. Nenhum canto vivo.
  var CABECA = 'M24 74C24 92 34 102 52 102H68C86 102 96 92 96 74V52C96 34 86 21.5 70 21C59 20.6 50.5 24.2 45.6 30.2C43.2 33.2 44.6 37.6 48.6 37.8C51.2 37.9 52.9 36.7 54.5 36.3C56.1 35.9 56.9 36.9 56.4 38.4C55 42 50.4 44.1 43.6 44.9C31.8 46.6 24 54.5 24 66Z';
  // Sem a peça, a cabeça ocupa o quadro como as cascas dos outros bots.
  var SOLTA = 'translate(-10.8 -12.57) scale(1.18)';

  var TIME = {
    doug:  { nome: 'DOUG',  papel: 'Chefe do time', cor: VERDE,     forma: 'cabeca' },
    rosa:  { nome: 'ROSA',  papel: 'Design',        cor: '#EC4899', forma: 'petala',   olhos: 'pilula', y: 66 },
    sony:  { nome: 'SONY',  papel: 'Vídeo',         cor: '#22D3EE', forma: 'monitor',  olhos: 'largo',  acessorio: 'fone', y: 72 },
    mark:  { nome: 'MARK',  papel: 'Marketing',     cor: '#FB923C', forma: 'quadrado', olhos: 'pilula', acessorio: 'gravata', y: 57 },
    chess: { nome: 'CHESS', papel: 'Estratégia',    cor: '#A78BFA', forma: 'torre',    olhos: 'meia',   y: 70 },
    kiara: { nome: 'KIARA', papel: 'Financeiro',    cor: '#FACC15', forma: 'moeda',    olhos: 'ponto',  y: 66 },
    junin: { nome: 'JUNIN', papel: 'Código',        cor: '#60A5FA', forma: 'hexagono', olhos: 'ponto',  acessorio: 'chaves', y: 64, dx: 10.5 }
  };
  var ORDEM = ['doug', 'rosa', 'sony', 'mark', 'chess', 'kiara', 'junin'];

  function ficha(o) {
    var p = {}, base = TIME[o.bot] || {}, k;
    for (k in base) p[k] = base[k];
    for (k in o) if (o[k] !== undefined) p[k] = o[k];
    return p;
  }

  // Peça de vidro: cor em profundidade, brilho de cima, luz que atravessa e sai embaixo, filete fino na borda.
  function vidro(d, cor, pid, G, ap, op) {
    op = op || {};
    var leve = op.leve, aro = op.aro, luz = mix(cor, '#ffffff', .6), forca = (ap ? .14 : .72) * (op.luz === undefined ? 1 : op.luz);
    return '<defs><linearGradient id="' + pid + 'a" gradientUnits="userSpaceOnUse" x1="30" y1="8" x2="92" y2="116"><stop offset="0" stop-color="' + mix(cor, '#ffffff', ap ? .05 : .3) + '"/><stop offset=".4" stop-color="' + cor + '"/><stop offset="1" stop-color="' + mix(cor, '#000000', leve ? .2 : ap ? .3 : .4) + '"/></linearGradient>' +
      '<linearGradient id="' + pid + 'k" gradientUnits="userSpaceOnUse" x1="28" y1="22" x2="98" y2="112"><stop offset="0" stop-color="' + luz + '" stop-opacity="0"/><stop offset=".52" stop-color="' + luz + '" stop-opacity="0"/><stop offset="1" stop-color="' + luz + '" stop-opacity="' + n(forca) + '"/></linearGradient>' +
      '<clipPath id="' + pid + 'd"><path d="' + d + '"/></clipPath></defs>' +
      '<path d="' + d + '" fill="url(#' + pid + 'a)"/>' +
      '<g clip-path="url(#' + pid + 'd)"><path d="' + d + '" fill="url(#' + G + 'b)"/>' +
      '<path d="' + d + '" fill="none" stroke="url(#' + pid + 'k)" stroke-width="13" filter="url(#' + G + 'f)"/>' +
      '<path d="' + d + '" fill="none" stroke="url(#' + (aro || G + 'c') + ')" stroke-width="3.4"/></g>';
  }

  // Tela: placa de vidro fosco que flutua sobre a casca. É onde o rosto mora.
  function visor(d, cor, pid, G, ap, casca) {
    var gelo = ap ? '#ffffff' : mix(cor, '#ffffff', .84);
    return '<defs><linearGradient id="' + pid + 'a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + gelo + '" stop-opacity="' + (ap ? .07 : .56) + '"/><stop offset="1" stop-color="' + gelo + '" stop-opacity="' + (ap ? .03 : .2) + '"/></linearGradient>' +
      '<linearGradient id="' + pid + 'c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="' + (ap ? .3 : .95) + '"/><stop offset=".35" stop-color="#fff" stop-opacity=".16"/><stop offset=".7" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="' + (ap ? .12 : .5) + '"/></linearGradient>' +
      '<clipPath id="' + pid + 'd"><path d="' + d + '"/></clipPath></defs>' +
      '<path d="' + d + '" transform="translate(0 2.8)" fill="' + mix(cor, '#000000', .74) + '" opacity="' + (ap ? .3 : .44) + '" filter="url(#' + G + 'f)"/>' +
      '<path d="' + d + '" fill="url(#' + casca + ')"/><path d="' + d + '" fill="url(#' + pid + 'a)"/>' +
      '<g clip-path="url(#' + pid + 'd)"><path d="' + d + '" fill="none" stroke="url(#' + pid + 'c)" stroke-width="2.8"/></g>';
  }

  function traco(d, tinta, w) { return '<path d="' + d + '" stroke="' + tinta + '" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'; }

  function olho(x, y, estilo, estado, tinta, e) {
    e = e || 1;
    if (estado === 'trabalhando') return traco('M' + n(x - 6 * e) + ' ' + n(y + 1) + 'H' + n(x + 6 * e), tinta, n(4.4 * e));
    if (estado === 'terminou') return traco('M' + n(x - 6 * e) + ' ' + n(y + 3 * e) + 'Q' + n(x) + ' ' + n(y - 7 * e) + ' ' + n(x + 6 * e) + ' ' + n(y + 3 * e), tinta, n(4.4 * e));
    if (estado === 'dormindo') return traco('M' + n(x - 6 * e) + ' ' + n(y - 1) + 'Q' + n(x) + ' ' + n(y + 6 * e) + ' ' + n(x + 6 * e) + ' ' + n(y - 1), tinta, n(4 * e));
    if (estado === 'pedindo') y -= 3 * e;
    if (estilo === 'ponto') return '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="' + n(5 * e) + '" fill="' + tinta + '"/>';
    if (estilo === 'largo') return '<rect x="' + n(x - 7) + '" y="' + n(y - 4) + '" width="14" height="8" rx="4" fill="' + tinta + '"/>';
    if (estilo === 'meia') return '<path d="M' + n(x - 6.5) + ' ' + n(y - 3) + 'H' + n(x + 6.5) + 'V' + n(y) + 'A6.5 6.5 0 0 1 ' + n(x - 6.5) + ' ' + n(y) + 'Z" fill="' + tinta + '" stroke="' + tinta + '" stroke-width="1.6" stroke-linejoin="round"/>';
    return '<rect x="' + n(x - 4 * e) + '" y="' + n(y - 7 * e) + '" width="' + n(8 * e) + '" height="' + n(14 * e) + '" rx="' + n(4 * e) + '" fill="' + tinta + '"/>';
  }

  function boca(x, y, estado, tinta) {
    if (estado === 'dormindo') return '';
    if (estado === 'trabalhando') return traco('M' + n(x - 4.5) + ' ' + n(y + 2.5) + 'H' + n(x + 4.5), tinta, 3.4);
    if (estado === 'pedindo') return '<circle cx="' + n(x) + '" cy="' + n(y + 3) + '" r="3.2" fill="' + tinta + '"/>';
    if (estado === 'terminou') return '<path d="M' + n(x - 8) + ' ' + n(y) + 'H' + n(x + 8) + 'A8 8 0 0 1 ' + n(x - 8) + ' ' + n(y) + 'Z" fill="' + tinta + '" stroke="' + tinta + '" stroke-width="2" stroke-linejoin="round"/>';
    return traco('M' + n(x - 6.5) + ' ' + n(y) + 'Q' + n(x) + ' ' + n(y + 6) + ' ' + n(x + 6.5) + ' ' + n(y), tinta, 3.4);
  }

  // Detalhes de ofício: atras (sob a casca), meio (sobre a casca, sob a tela) e frente.
  var ACESSORIOS = {
    fone: function (c) {
      return {
        atras: traco('M8 62V54C8 28 30 9 60 9C90 9 112 28 112 54V62', c.branco, 5.4),
        frente: vidro(caixa(.5, 54, 15, 34, 7.5), c.branco, c.id + 'q', c.id, c.ap, { leve: true }) + vidro(caixa(104.5, 54, 15, 34, 7.5), c.branco, c.id + 'r', c.id, c.ap, { leve: true })
      };
    },
    gravata: function (c) {
      return {
        // Camisa em V dentro do paletó, com a gravata por cima.
        frente: '<g clip-path="url(#' + c.id + 'kd)"><path d="M37 86.5H83L60 114Z" fill="' + c.branco + '"/>' +
          '<path d="M37 86.5L60 114L83 86.5" fill="none" stroke="' + mix(c.cor, '#000000', .55) + '" stroke-opacity=".55" stroke-width="2"/></g>' +
          '<path d="M55.8 88H64.2L62.5 94.4L65.6 104.6L60 110.4L54.4 104.6L57.5 94.4Z" fill="' + c.tinta + '" stroke="' + c.tinta + '" stroke-width="1.4" stroke-linejoin="round"/>'
      };
    },
    chaves: function (c) {
      return { frente: traco('M38.5 ' + n(c.cy - 5.6) + 'L34 ' + n(c.cy) + 'L38.5 ' + n(c.cy + 5.6) + 'M81.5 ' + n(c.cy - 5.6) + 'L86 ' + n(c.cy) + 'L81.5 ' + n(c.cy + 5.6), c.tinta, 3.2) };
    }
  };

  // Os olhos do Doug: duas pílulas. É o jeito delas que diz o estado, e olho fechado é um traço. `rosto` é o estado
  // ou um olhar (a opção `olhar`): as carinhas que ele faz parado, num ícone ou num adesivo. Só os olhos mudam.
  function olhosDoDoug(rosto, cor) {
    var y = 69.6;
    function pilula(x, yy, w, h, giro) { return '<rect x="' + n(x - w / 2) + '" y="' + n(yy - h / 2) + '" width="' + w + '" height="' + h + '" rx="' + n(Math.min(w, h) / 2) + '" fill="' + cor + '"' + (giro ? ' transform="rotate(' + giro + ' ' + x + ' ' + n(yy) + ')"' : '') + '/>'; }
    function sorri(x) { return traco('M' + n(x - 7.4) + ' ' + n(y + 4.4) + 'Q' + x + ' ' + n(y - 10.8) + ' ' + n(x + 7.4) + ' ' + n(y + 4.4), cor, 5.8); }
    // Pálpebra: a pílula cortada por cima numa reta que vai de `fora` a `dentro` (o lado do nariz), em y. Desenhada
    // para o olho esquerdo; o direito é o espelho dela.
    function palpebra(x, lado, dentro, fora) {
      var w = 5.9, fundo = y + 5.6;
      return '<path d="M' + n(x - w) + ' ' + n(y + fora) + 'L' + n(x + w) + ' ' + n(y + dentro) + 'V' + n(fundo) + 'A' + w + ' ' + w + ' 0 0 1 ' + n(x - w) + ' ' + n(fundo) + 'Z" fill="' + cor + '" stroke="' + cor + '" stroke-width="1.6" stroke-linejoin="round"' + (lado < 0 ? ' transform="translate(' + n(2 * x) + ' 0) scale(-1 1)"' : '') + '/>';
    }
    // Rindo: os olhos apertados em setas, apontando um para o outro.
    function aperta(x, lado) { return traco('M' + n(x - 4.6 * lado) + ' ' + n(y - 7) + 'L' + n(x + 4.6 * lado) + ' ' + n(y) + 'L' + n(x - 4.6 * lado) + ' ' + n(y + 7), cor, 5.2); }
    return [46.6, 73.2].map(function (x, i) {
      var lado = i ? -1 : 1; // para onde fica o nariz: à direita do olho esquerdo, à esquerda do direito
      // Terminou (feliz): os olhos sorriem. Dormindo: fechados. Pedindo (pra cima): para cima, para quem ele chama.
      if (rosto === 'terminou' || rosto === 'feliz') return sorri(x);
      if (rosto === 'dormindo') return pilula(x, y + 1.3, 18, 6.8);
      if (rosto === 'pedindo' || rosto === 'pra-cima') return pilula(x, y - 4.4, 11, 20.8);
      // Trabalhando (de lado): abertos, um pouco apertados, de lado, olhando o trabalho.
      if (rosto === 'trabalhando' || rosto === 'de-lado') return pilula(x + 4.4, y + 1.2, 11, 14.6);
      // Piscando: um olho aberto, o outro sorri.
      if (rosto === 'piscando') return i ? sorri(x) : pilula(x, y, 11, 20.8, -5);
      if (rosto === 'rindo') return aperta(x, lado);
      // Surpreso: redondos e maiores.
      if (rosto === 'surpreso') return '<ellipse cx="' + x + '" cy="' + n(y - 1) + '" rx="8.4" ry="10.6" fill="' + cor + '"/>';
      // Desconfiado: meio fechados, a pálpebra reta.
      if (rosto === 'desconfiado') return palpebra(x, lado, -0.6, -0.6);
      // Triste: a pálpebra sobe para o meio. Bravo: desce para o meio.
      if (rosto === 'triste') return palpebra(x, lado, -9.4, -1.2);
      if (rosto === 'bravo') return palpebra(x, lado, -1.6, -10.4);
      return pilula(x, y, 11, 20.8, -5);
    }).join('');
  }

  // A cabeça do Doug: preta e brilhante, a luz vindo de cima e a cor da peça voltando por baixo e pela borda.
  function cabecaPreta(id, ap, estado, cor, olhos) {
    function u(x) { return 'url(#' + id + x + ')'; }
    function grad(x, x1, y1, x2, y2, paradas) {
      return '<linearGradient id="' + id + x + '" gradientUnits="userSpaceOnUse" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
        paradas.map(function (q) { return '<stop offset="' + q[0] + '" stop-color="' + q[1] + '"' + (q[2] === undefined ? '' : ' stop-opacity="' + q[2] + '"') + '/>'; }).join('') + '</linearGradient>';
    }
    function fio(x, w, f) { return '<path d="' + CABECA + '" fill="none" stroke="' + u(x) + '" stroke-width="' + w + '" filter="' + u(f) + '"/>'; }
    var s = '<defs>' + grad('hp', 0, 21, 0, 102, ap ? [[0, '#121315'], [1, '#08080A']] : [[0, '#0D0D0F'], [.55, '#09090A'], [.82, mix(mix(cor, '#000000', .8), '#09090A', .4)], [1, mix(cor, '#000000', .64)]]) +
      '<clipPath id="' + id + 'hc"><path d="' + CABECA + '"/></clipPath>';
    if (!ap) s += '<filter id="' + id + 'h0" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".55"/></filter>' +
      '<filter id="' + id + 'h1" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.3"/></filter>' +
      '<radialGradient id="' + id + 'hb" gradientUnits="userSpaceOnUse" cx="58" cy="27" r="34"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      grad('ht', 0, 20, 0, 40, [[0, '#ffffff', .34], [1, '#ffffff', 0]]) +
      grad('hr', 0, 88, 0, 103, [[0, cor, 0], [1, mix(cor, '#ffffff', .35), .6]]) +
      grad('hv', 70, 0, 97, 0, [[0, cor, 0], [1, mix(cor, '#ffffff', .25), .36]]);
    s += '</defs><path d="' + CABECA + '" fill="' + u('hp') + '"/>';
    if (!ap) s += '<g clip-path="' + u('hc') + '"><rect x="10" y="10" width="100" height="70" fill="' + u('hb') + '"/>' + fio('ht', 1.2, 'h0') + fio('hr', 3, 'h0') + fio('hv', 2.6, 'h1') + '</g>';
    return s + olhosDoDoug(estado, olhos);
  }

  // Onde a cabeça fica dentro da peça. perto = ela enche a peça, para tamanhos pequenos.
  function lugar(perto) {
    var k = perto ? .96 : .806;
    return 'translate(' + n(60 - 60 * k) + ' ' + n((perto ? 60.4 : 58.6) - 61.5 * k) + ') scale(' + k + ')';
  }

  // O Doug na sua peça: a cabeça por dentro do vidro.
  function naPeca(id, ap, estado, perto, cor, olhos) {
    function u(x) { return 'url(#' + id + x + ')'; }
    var sombra = mix(cor, '#000000', .72);
    return '<g clip-path="' + u('kd') + '"><g transform="' + lugar(perto) + '">' +
      // De longe ele flutua sobre o vidro e deixa a sombra nele.
      (perto || ap ? '' : '<path d="' + CABECA + '" transform="translate(0 6)" fill="' + sombra + '" opacity=".17" filter="' + u('f') + '"/><ellipse cx="60" cy="108" rx="28" ry="3.6" fill="' + sombra + '" opacity=".5" filter="' + u('f') + '"/>') +
      cabecaPreta(id, ap, estado, cor, olhos) + '</g></g>' +
      // O filete do vidro passa por cima da cabeça, para a peça continuar inteira.
      '<g clip-path="' + u('kd') + '"><path d="' + QUADRO + '" fill="none" stroke="' + u('c') + '" stroke-width="3.4"/></g>';
  }

  function avatar(o) {
    o = o || {};
    var p = ficha(o);
    var id = o.id || ('db' + (++conta));
    var estado = p.estado || 'ok';
    // O que os olhos fazem: o olhar pedido ou, sem ele, o estado.
    var rosto = p.olhar || estado;
    var ap = estado === 'dormindo';
    var corBase = p.cor || VERDE;
    var cor = ap ? mix(corBase, '#1A1A1A', .84) : corBase;
    var tinta = ap ? mix(corBase, '#1A1A1A', .42) : TINTA;
    var nome = p.titulo || p.nome || 'Bot';
    var eDoug = p.forma === 'cabeca';
    // peca: false = a cabeça solta, sem a peça em volta, para quem monta o próprio chão. material diz do que ela é:
    // 'vidro' (verde, olhos em tinta), 'preto' (olhos brancos) ou 'chapado' (uma cor só, os olhos vazados).
    var solto = eDoug && p.peca === false;
    var d = eDoug ? QUADRO : (CORPOS[p.forma] || CORPOS.squircle);
    var cy = p.y || ALTURA[p.forma] || 66, dx = p.dx || (p.acessorio === 'chaves' ? 10.5 : 14.5);
    var dv = VISORES[p.forma] || VISORES.squircle;
    var c = { cor: cor, id: id, ap: ap, cy: cy, tinta: tinta, branco: ap ? '#5F6367' : BRANCO };
    var ac = (!eDoug && p.acessorio && ACESSORIOS[p.acessorio]) ? ACESSORIOS[p.acessorio](c) : {};
    // Em tamanho pequeno a cabeça enche a peça.
    var perto = p.perto === undefined ? (+o.tamanho > 0 && +o.tamanho < 60) : !!p.perto;

    var abre = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" overflow="visible"' + (o.tamanho ? ' width="' + o.tamanho + '" height="' + o.tamanho + '"' : '') + ' role="img" aria-label="' + nome + '"><title>' + nome + '</title>';
    var chama = estado === 'pedindo' ? '<circle cx="103" cy="17" r="11" fill="' + TINTA + '"/><circle cx="103" cy="17" r="7.4" fill="#fff"/>' : '';
    // A peça chapada: as mesmas formas em cores cheias, sem luz nem filtro. Para onde o peso conta (uma página que
    // viaja inteira dentro de outro arquivo): algumas centenas de bytes no lugar de alguns milhares.
    if (eDoug && !solto && p.material === 'chapado') {
      return abre + '<path d="' + QUADRO + '" fill="' + cor + '"/><g transform="' + lugar(perto) + '"><path d="' + CABECA + '" fill="' + TINTA + '"/>' + olhosDoDoug(rosto, ap ? tinta : '#fff') + '</g>' + chama + '</svg>';
    }

    var s = abre + '<defs>' +
      '<filter id="' + id + 'f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.4"/></filter>' +
      '<filter id="' + id + 'g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>' +
      '<radialGradient id="' + id + 'b" gradientUnits="userSpaceOnUse" cx="38" cy="22" r="62"><stop offset="0" stop-color="#fff" stop-opacity="' + (ap ? .06 : .32) + '"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'c" gradientUnits="userSpaceOnUse" x1="18" y1="10" x2="102" y2="112"><stop offset="0" stop-color="#fff" stop-opacity="' + (ap ? .3 : .98) + '"/><stop offset=".28" stop-color="#fff" stop-opacity=".2"/><stop offset=".62" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity="' + (ap ? .14 : .6) + '"/></linearGradient>' +
      '</defs>';

    // Luz da cor no chão: o bot acende o que está embaixo dele.
    if (p.brilho !== false && !ap && p.material !== 'chapado') s += '<path d="' + (solto ? CABECA : d) + '" transform="translate(6 15) scale(.9)' + (solto ? ' ' + SOLTA : '') + '" fill="' + cor + '" opacity=".36" filter="url(#' + id + 'g)"/>';

    if (solto) {
      s += '<g transform="' + SOLTA + '">' + (p.material === 'preto' ? cabecaPreta(id, ap, rosto, corBase, ap ? tinta : '#fff')
        : p.material === 'chapado' ? '<defs><mask id="' + id + 'hm" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><path d="' + CABECA + '" fill="#fff"/>' + olhosDoDoug(rosto, '#000') + '</mask></defs><rect width="120" height="120" fill="' + corBase + '" mask="url(#' + id + 'hm)"/>'
        : vidro(CABECA, cor, id + 'k', id, ap) + olhosDoDoug(rosto, tinta)) + '</g>';
    } else if (eDoug) {
      s += vidro(d, cor, id + 'k', id, ap) + naPeca(id, ap, rosto, perto, corBase, ap ? tinta : '#fff');
    } else {
      s += (ac.atras || '') + vidro(d, cor, id + 'k', id, ap) + (ac.meio || '') + visor(dv, cor, id + 'v', id, ap, id + 'ka');
      var ey = p.sorriso ? cy - 5 : cy;
      s += olho(60 - dx, ey, p.olhos, estado, tinta) + olho(60 + dx, ey, p.olhos, estado, tinta);
      if (p.sorriso) s += boca(60, cy + 7, estado, tinta);
      s += (ac.frente || '');
    }

    return s + chama + '</svg>';
  }

  function montar(onde) {
    var nos = (onde || document).querySelectorAll('[data-dougbot]');
    Array.prototype.forEach.call(nos, function (el) {
      var dt = el.dataset, o = { bot: dt.dougbot || undefined };
      ['estado', 'forma', 'olhos', 'acessorio', 'cor'].forEach(function (k) { if (dt[k]) o[k] = dt[k]; });
      if (dt.sorriso) o.sorriso = dt.sorriso !== 'nao';
      if (dt.brilho) o.brilho = dt.brilho !== 'nao';
      if (dt.y) o.y = +dt.y;
      // O Doug: abaixo de 60 px a cabeça enche a peça sozinha; data-perto="sim" ou "nao" decide à mão.
      if (dt.perto) o.perto = dt.perto !== 'nao';
      else if (ficha(o).forma === 'cabeca' && el.clientWidth && el.clientWidth < 60) o.perto = true;
      el.innerHTML = avatar(o);
      el.style.setProperty('--c', ficha(o).cor || VERDE);
    });
  }

  var api = { avatar: avatar, montar: montar, ficha: ficha, mix: mix, TIME: TIME, ORDEM: ORDEM, CORPOS: CORPOS, VISORES: VISORES, QUADRO: QUADRO, CABECA: CABECA, ACESSORIOS: ACESSORIOS, versao: '0.13' };
  raiz.DougBot = api;
})(__alvo);
export default __alvo.DougBot;
