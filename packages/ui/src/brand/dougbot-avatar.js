// Copied verbatim from the approved DougBot identity package (identidade/dougbot-identidade/dougbot-avatar.js, v0.11).
// Only the last lines change: the module exports the API (ESM) instead of setting window.DougBot or module.exports.
// Keep the drawings and the logic identical to the package: change them there first, then copy again.
// Biome skips this file (biome.json): it stays byte for byte the package's.
const __alvo = {};
/* DougBot: bots 2D desenhados por código (SVG). Sem imagem e sem dependência.
   Cada bot = casca de vidro colorido (a forma diz a função) + tela de vidro fosco + olhos em tinta.
   O Doug é o único retrato: topete, barba curta, óculos de aro fino e moletom preto de capuz com camiseta verde, dentro de uma peça de vidro verde. Só ele sorri, e no estado normal ele pisca.
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

  // Doug: a peça de vidro e as partes do retrato, no mesmo quadro de 120 x 120.
  var QUADRO = 'M38 10H82C101 10 110 19 110 38V82C110 101 101 110 82 110H38C19 110 10 101 10 82V38C10 19 19 10 38 10Z';
  var RETRATO = {
    capuz:   'M23 93C20 75 36 61 60 61C84 61 100 75 97 93Z',
    corpo:   'M0 128V101C0 89.5 13.5 83.6 31.5 80.4L46.5 77H73.5L88.5 80.4C106.5 83.6 120 89.5 120 101V128Z',
    decote:  'M46.5 77H73.5C71.4 83.4 66.4 89 60 92C53.6 89 48.6 83.4 46.5 77Z',
    barra:   'M46.5 77C48.6 83.4 53.6 89 60 92C66.4 89 71.4 83.4 73.5 77',
    pescoco: 'M51.6 66H68.4V79.4C68.4 83.2 64.6 85.6 60 85.6C55.4 85.6 51.6 83.2 51.6 79.4Z',
    cabeca:  'M60 28C74.5 28 84 37.5 84 51V55C84 68.6 74.4 78 60 78C45.6 78 36 68.6 36 55V51C36 37.5 45.5 28 60 28Z',
    cabelo:  'M35.4 54C34.4 45 35.6 35.5 41.8 28.5C45.4 24 49.2 21.6 53 20.8C57.4 16.4 67.8 14.6 74.6 18.2C78.6 20.2 81.2 23 82.4 26.6C84.4 32 85.6 44 84.6 54H81.4V48.5C81.2 45 80.6 42 79.2 39.6C73.2 38.4 66.4 37.6 59 36.4C53.8 35.4 49.6 34.4 46.6 32.6C42.8 34.6 39.9 39.6 38.9 45C38.7 46.2 38.6 47.4 38.6 48.5V54Z',
    barba:   'M35.6 52V55.1C35.6 69 45.8 78.5 60 78.5C74.2 78.5 84.4 69 84.4 55.1V52H81.4C81.4 58.6 80.2 63.6 76.8 66.8C74.4 69 71.2 68.6 69 67C66.4 65.2 63.4 64.4 60 64.4C56.6 64.4 53.6 65.2 51 67C48.8 68.6 45.6 69 43.2 66.8C39.8 63.6 38.6 58.6 38.6 52Z'
  };

  var TIME = {
    doug:  { nome: 'DOUG',  papel: 'Chefe do time', cor: VERDE,     forma: 'retrato' },
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
    // Trabalhando: olhos abertos, um pouco apertados de concentração, que varrem de um lado a outro (doug.css
    // anima `.db-varre`): não pode ler como dormindo.
    if (estado === 'trabalhando') return '<g class="db-varre"><rect x="' + n(x - 4 * e) + '" y="' + n(y - 5 * e) + '" width="' + n(8 * e) + '" height="' + n(10 * e) + '" rx="' + n(4 * e) + '" fill="' + tinta + '"/></g>';
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

  // Retrato do Doug, desenhado por dentro da peça de vidro. perto = recorte fechado no rosto, para tamanhos pequenos.
  function retrato(id, ap, estado, perto) {
    var R = RETRATO, luz = ap ? .25 : 1;
    function esc(cor) { return ap ? mix(cor, '#161616', .64) : cor; }
    function u(x) { return 'url(#' + id + x + ')'; }
    function grad(x, x1, y1, x2, y2, paradas) {
      return '<linearGradient id="' + id + x + '" gradientUnits="userSpaceOnUse" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '">' +
        paradas.map(function (q) { return '<stop offset="' + q[0] + '" stop-color="' + q[1] + '"' + (q[2] === undefined ? '' : ' stop-opacity="' + n(q[2]) + '"') + '/>'; }).join('') + '</linearGradient>';
    }
    function recorte(x, d) { return '<clipPath id="' + id + x + '"><path d="' + d + '"/></clipPath>'; }
    var pele = esc('#FBF8F3'), orelha = esc('#E3DBCF');
    var lentes = caixa(40.9, 47.3, 16, 11.3, 4.8) + caixa(63.1, 47.3, 16, 11.3, 4.8);
    var armacao = caixa(39.4, 45.4, 19, 14.6, 6.2) + caixa(61.6, 45.4, 19, 14.6, 6.2) + lentes;
    // Olhos em ponto, em tinta. O jeito do olho diz o estado.
    function ol(x, jeito) {
      var y = 52.95;
      if (jeito === 'traco') return traco('M' + n(x - 3) + ' ' + n(y + .6) + 'H' + n(x + 3), TINTA, 2.1);
      if (jeito === 'arco') return traco('M' + n(x - 3.1) + ' ' + n(y + 1.4) + 'Q' + n(x) + ' ' + n(y - 3.6) + ' ' + n(x + 3.1) + ' ' + n(y + 1.4), TINTA, 2.1);
      if (jeito === 'sono') return traco('M' + n(x - 3) + ' ' + n(y - .2) + 'Q' + n(x) + ' ' + n(y + 2.8) + ' ' + n(x + 3) + ' ' + n(y - .2), TINTA, 1.9);
      return '<circle cx="' + n(x) + '" cy="' + n(jeito === 'cima' ? y - 1.5 : y) + '" r="2.6" fill="' + TINTA + '"/>';
    }
    // Rosto por estado: [olho esquerdo, olho direito, sobrancelhas, boca]. No normal ele pisca o direito e sorri de canto.
    var calma = 'M43.4 42.8Q48.6 40.2 53.6 42.4M66.4 42.4Q71.4 40.2 76.6 42.8';
    var rosto = estado === 'dormindo' ? ['sono', 'sono', calma, traco('M57 70.8H63', esc('#CFC7BA'), 1.8)]
      : estado === 'trabalhando' ? ['traco', 'traco', calma, traco('M56 70.8H64', pele, 2.1)]
      : estado === 'pedindo' ? ['cima', 'cima', 'M43.4 41.8Q48.6 38.8 53.6 41.6M66.4 42.2Q71.4 39.8 76.6 42.4', '<circle cx="60" cy="70.8" r="2.4" fill="' + pele + '"/>']
      : estado === 'terminou' ? ['arco', 'arco', calma, '<path d="M53.4 69.4H66.6A6.6 6.6 0 0 1 53.4 69.4Z" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>']
      : ['ponto', 'arco', 'M43.4 41.8Q48.6 38.8 53.6 41.6M66.6 43Q71.6 41.6 76.6 43.2', traco('M54.6 70.4Q60.6 74.6 65.6 69.4', pele, 2.1)];

    return '<defs>' +
      '<filter id="' + id + 'ps" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.1"/></filter>' +
      '<radialGradient id="' + id + 'ph" gradientUnits="userSpaceOnUse" cx="60" cy="45" r="42"><stop offset="0" stop-color="#F2FFD0" stop-opacity=".55"/><stop offset=".55" stop-color="#F2FFD0" stop-opacity=".16"/><stop offset="1" stop-color="#F2FFD0" stop-opacity="0"/></radialGradient>' +
      grad('pr', 0, 60, 0, 104, [[0, '#F2FFD6', .9 * luz], [.4, '#F2FFD6', .3 * luz], [1, '#F2FFD6', 0]]) +
      grad('pi', 0, 15, 0, 29, [[0, '#ffffff', .5 * luz], [1, '#ffffff', 0]]) +
      grad('pq', 0, 60, 0, 94, [[0, '#2D3035'], [1, '#141517']]) +
      grad('pe', 30, 76, 92, 118, [[0, '#30343A'], [.45, '#1D1F23'], [1, '#0D0E10']]) +
      grad('pn', 0, 76, 0, 87, [[0, esc('#C9C0B3')], [1, esc('#E9E2D7')]]) +
      grad('pa', 0, 28, 0, 78, [[0, esc('#FBF8F3')], [1, esc('#E6DED2')]]) +
      grad('pb', 0, 17, 0, 54, [[0, '#09090A'], [.56, '#121315'], [1, '#2E3035']]) +
      grad('pc', 0, 52, 0, 79, [[0, '#3A3D43'], [.45, '#2A2C30'], [1, '#1D1F22']]) +
      grad('pl', 0, 47.3, 0, 58.6, [[0, '#ffffff', ap ? .06 : .34], [1, '#ffffff', ap ? .02 : .06]]) +
      recorte('pd', R.cabeca) + recorte('pt', R.cabelo) + recorte('pu', R.corpo) + recorte('pv', R.capuz) + '</defs>' +
      '<g clip-path="' + u('kd') + '">' + (ap ? '' : '<circle cx="60" cy="45" r="42" fill="' + u('ph') + '"/>') +
      '<g transform="' + (perto ? 'translate(60 64) scale(1.34) translate(-60 -54)' : 'translate(60 112) scale(.97) translate(-60 -112)') + '">' +
      // Moletom: capuz caído atrás do pescoço, ombros, camiseta verde no decote, cordões e barra.
      '<path d="' + R.capuz + '" fill="' + u('pq') + '"/><g clip-path="' + u('pv') + '"><path d="' + R.capuz + '" fill="none" stroke="' + u('pr') + '" stroke-width="2.6"/></g>' +
      '<path d="' + R.corpo + '" fill="' + u('pe') + '"/><g clip-path="' + u('pu') + '"><path d="' + R.corpo + '" fill="none" stroke="' + u('pr') + '" stroke-width="2.6"/></g>' +
      '<path d="' + R.decote + '" fill="' + esc('#7ED805') + '"/><path d="' + R.pescoco + '" fill="' + u('pn') + '"/>' +
      (perto ? '' : traco('M53.4 89.6V100.4M66.6 89.6V100.4', ap ? '#5F6367' : BRANCO, 3) + traco('M53.4 102.6V103.4M66.6 102.6V103.4', ap ? '#3F4245' : '#A9AEA9', 3)) +
      traco(R.barra, ap ? '#2A2D31' : '#3D4148', 2.6) +
      '<ellipse cx="60" cy="82" rx="20" ry="6" fill="#000" opacity=".4" filter="' + u('f') + '"/>' +
      // Cabeça, um pouco inclinada: orelhas, rosto, sombra da franja e dos óculos, barba e boca.
      '<g transform="rotate(4 60 78)">' +
      '<circle cx="35.4" cy="57" r="4.6" fill="' + orelha + '"/><circle cx="84.6" cy="57" r="4.6" fill="' + orelha + '"/>' +
      '<path d="' + R.cabeca + '" fill="' + u('pa') + '"/>' +
      '<g clip-path="' + u('pd') + '" fill="#000" opacity=".2" filter="' + u('ps') + '"><path d="' + R.cabelo + '" transform="translate(0 2.4)"/><path d="' + armacao + '" transform="translate(0 1.5)" fill-rule="evenodd"/></g>' +
      '<path d="' + R.barba + '" fill="' + u('pc') + '"/>' + rosto[3] +
      // Cabelo com dois fios de brilho e um filete de luz por cima.
      '<path d="' + R.cabelo + '" fill="' + u('pb') + '"/>' +
      traco('M47.2 31C52 25.8 61 22.8 70.8 23.4', '#2C2E33', 1.3) + traco('M52.6 33.4C57 29.8 63.6 28 70.2 28.4', '#202226', 1.1) +
      '<g clip-path="' + u('pt') + '"><path d="' + R.cabelo + '" fill="none" stroke="' + u('pi') + '" stroke-width="1.5"/></g>' +
      // Óculos: lentes de vidro, aro mais firme em cima, ponte e hastes. Sobrancelhas e olhos em tinta, nunca verdes.
      '<path d="' + lentes + '" fill="' + u('pl') + '"/><path d="' + armacao + '" fill="' + TINTA + '" fill-rule="evenodd"/>' +
      traco('M58.4 51.2Q60 49.4 61.6 51.2M39.6 50.8L35.6 49.8M80.4 50.8L84.4 49.8', TINTA, 1.6) +
      traco(rosto[2], TINTA, 1.7) + ol(48.9, rosto[0]) + ol(71.1, rosto[1]) +
      '</g></g></g>' +
      // O filete do vidro passa por cima do retrato, para a peça continuar inteira.
      '<g clip-path="' + u('kd') + '"><path d="' + QUADRO + '" fill="none" stroke="' + u('c') + '" stroke-width="3.4"/></g>';
  }

  function avatar(o) {
    o = o || {};
    var p = ficha(o);
    var id = o.id || ('db' + (++conta));
    var estado = p.estado || 'ok';
    var ap = estado === 'dormindo';
    var corBase = p.cor || VERDE;
    var cor = ap ? mix(corBase, '#1A1A1A', .84) : corBase;
    var tinta = ap ? mix(corBase, '#1A1A1A', .42) : TINTA;
    var nome = p.titulo || p.nome || 'Bot';
    var eRetrato = p.forma === 'retrato';
    var d = eRetrato ? QUADRO : (CORPOS[p.forma] || CORPOS.squircle);
    var cy = p.y || ALTURA[p.forma] || 66, dx = p.dx || (p.acessorio === 'chaves' ? 10.5 : 14.5);
    var dv = VISORES[p.forma] || VISORES.squircle;
    var c = { cor: cor, id: id, ap: ap, cy: cy, tinta: tinta, branco: ap ? '#5F6367' : BRANCO };
    var ac = (!eRetrato && p.acessorio && ACESSORIOS[p.acessorio]) ? ACESSORIOS[p.acessorio](c) : {};
    // Em tamanho pequeno o retrato fecha no rosto.
    var perto = p.perto === undefined ? (+o.tamanho > 0 && +o.tamanho < 60) : !!p.perto;

    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" overflow="visible"' + (o.tamanho ? ' width="' + o.tamanho + '" height="' + o.tamanho + '"' : '') + ' role="img" aria-label="' + nome + '"><title>' + nome + '</title><defs>' +
      '<filter id="' + id + 'f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.4"/></filter>' +
      '<filter id="' + id + 'g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>' +
      '<radialGradient id="' + id + 'b" gradientUnits="userSpaceOnUse" cx="38" cy="22" r="62"><stop offset="0" stop-color="#fff" stop-opacity="' + (ap ? .06 : .32) + '"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + id + 'c" gradientUnits="userSpaceOnUse" x1="18" y1="10" x2="102" y2="112"><stop offset="0" stop-color="#fff" stop-opacity="' + (ap ? .3 : .98) + '"/><stop offset=".28" stop-color="#fff" stop-opacity=".2"/><stop offset=".62" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity="' + (ap ? .14 : .6) + '"/></linearGradient>' +
      '</defs>';

    // Luz da cor no chão: o bot acende o que está embaixo dele.
    if (p.brilho !== false && !ap) s += '<path d="' + d + '" transform="translate(6 15) scale(.9)" fill="' + cor + '" opacity=".36" filter="url(#' + id + 'g)"/>';

    if (eRetrato) {
      s += vidro(d, cor, id + 'k', id, ap) + retrato(id, ap, estado, perto);
    } else {
      s += (ac.atras || '') + vidro(d, cor, id + 'k', id, ap) + (ac.meio || '') + visor(dv, cor, id + 'v', id, ap, id + 'ka');
      var ey = p.sorriso ? cy - 5 : cy;
      s += olho(60 - dx, ey, p.olhos, estado, tinta) + olho(60 + dx, ey, p.olhos, estado, tinta);
      if (p.sorriso) s += boca(60, cy + 7, estado, tinta);
      s += (ac.frente || '');
    }

    if (estado === 'pedindo') s += '<circle cx="103" cy="17" r="11" fill="' + TINTA + '"/><circle cx="103" cy="17" r="7.4" fill="#fff"/>';
    return s + '</svg>';
  }

  function montar(onde) {
    var nos = (onde || document).querySelectorAll('[data-dougbot]');
    Array.prototype.forEach.call(nos, function (el) {
      var dt = el.dataset, o = { bot: dt.dougbot || undefined };
      ['estado', 'forma', 'olhos', 'acessorio', 'cor'].forEach(function (k) { if (dt[k]) o[k] = dt[k]; });
      if (dt.sorriso) o.sorriso = dt.sorriso !== 'nao';
      if (dt.brilho) o.brilho = dt.brilho !== 'nao';
      if (dt.y) o.y = +dt.y;
      // Retrato: abaixo de 60 px ele fecha no rosto sozinho; data-perto="sim" ou "nao" decide à mão.
      if (dt.perto) o.perto = dt.perto !== 'nao';
      else if (ficha(o).forma === 'retrato' && el.clientWidth && el.clientWidth < 60) o.perto = true;
      el.innerHTML = avatar(o);
      el.style.setProperty('--c', ficha(o).cor || VERDE);
    });
  }

  var api = { avatar: avatar, montar: montar, ficha: ficha, mix: mix, TIME: TIME, ORDEM: ORDEM, CORPOS: CORPOS, VISORES: VISORES, QUADRO: QUADRO, ACESSORIOS: ACESSORIOS, versao: '0.11' };
  raiz.DougBot = api;
})(__alvo);
export default __alvo.DougBot;
