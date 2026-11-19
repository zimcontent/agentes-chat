import { describe, expect, test } from "bun:test";
import { createBudget, EXPR_LIMITS, evalExpr, namesIn, parseExpr, type Value } from "../src/blocks/expr";
import {
  type BlockSpec,
  BlockSpecError,
  blockSpecText,
  compileBlock,
  dryRunBlock,
  formatBlockValue,
  inputValue,
  parseBlockSpec,
  specActs,
  viewBlock,
} from "../src/blocks/spec";

const run = (src: string, values: Record<string, Value> = {}) =>
  evalExpr(parseExpr(src), (n) => (Object.hasOwn(values, n) ? values[n] : undefined));

const words = { locale: "pt-BR", thousand: "mil" };

describe("formulas (ADR 0113)", () => {
  test("arithmetic, power, comparisons and the ternary, as a spreadsheet reads them", () => {
    expect(run("(preco - 40) / preco * 100", { preco: 100 })).toBe(60);
    expect(run("2 ^ 3 ^ 2")).toBe(512);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("10 ** 2")).toBe(100);
    expect(run("7 % 3")).toBe(1);
    expect(run("a > 5 ? 'alto' : 'baixo'", { a: 7 })).toBe("alto");
    expect(run("a == '12'", { a: 12 })).toBe(true);
    expect(run("'R$ ' + 12")).toBe("R$ 12");
    expect(run("!x && y || 'z'", { x: false, y: 0 })).toBe("z");
  });

  test("lists, records and the list functions with a step", () => {
    const items = [
      { nome: "A", preco: 10, qtd: 2 },
      { nome: "B", preco: 5, qtd: 4 },
    ];
    expect(run("sum(items, x => x.preco * x.qtd)", { items })).toBe(40);
    expect(run("map(range(3), m => {label: 'M' + (m + 1), value: m * 2})")).toEqual([
      { label: "M1", value: 0 },
      { label: "M2", value: 2 },
      { label: "M3", value: 4 },
    ]);
    expect(run("filter(items, x => x.preco > 6)[0].nome", { items })).toBe("A");
    expect(run("sort(items, x => x.preco)[0].nome", { items })).toBe("B");
    expect(run("map(items, (x, i) => i)", { items })).toEqual([0, 1]);
    expect(run("count(items, x => x.qtd > 1)", { items })).toBe(2);
    expect(run("round(2 / 3, 2)")).toBe(0.67);
    expect(run("max([3, 9, 4])")).toBe(9);
    expect(run("join(['a', 'b'], ' · ')")).toBe("a · b");
    expect(run("items.length", { items })).toBe(2);
  });

  test("names a formula reads, without the ones its own steps bring in", () => {
    expect([...namesIn(parseExpr("sum(items, x => x.v * taxa)"))].sort()).toEqual(["items", "taxa"]);
  });

  test("reaches nothing but the values handed to it", () => {
    const o = { a: 1 };
    expect(run("o.constructor", { o })).toBeNull();
    expect(run("o.__proto__", { o })).toBeNull();
    expect(run("o['toString']", { o })).toBeNull();
    expect(() => run("constructor")).toThrow('There is no value "constructor"');
    expect(() => parseExpr("eval('1')")).toThrow('There is no function "eval"');
    expect(() => parseExpr("o.f()")).toThrow("Only a function name can be called");
    expect(() => parseExpr("a = 1")).toThrow();
    expect(() => parseExpr("`x`")).toThrow();
  });

  test("an endless or huge computation stops with an error, never a hang", () => {
    expect(() => run("range(100000)")).toThrow("too long");
    expect(() => run("map(range(1000), a => map(range(1000), b => a * b))")).toThrow();
    const budget = createBudget();
    expect(() =>
      evalExpr(parseExpr("sum(range(1999), a => sum(range(1999), b => 1))"), () => undefined, budget),
    ).toThrow("computes too much");
    expect(() => parseExpr("(".repeat(EXPR_LIMITS.depth + 2))).toThrow();
    expect(() => parseExpr("1+".repeat(2000))).toThrow("too long");
  });

  test("a wrong formula says where", () => {
    expect(() => parseExpr("a +")).toThrow("ends too soon");
    expect(() => parseExpr("a b")).toThrow('Unexpected "b" at 3');
    expect(() => parseExpr("'aberto")).toThrow("never ends");
  });
});

const SIMULATOR: BlockSpec = {
  data: { custo: 40 },
  compute: { margem: "(preco - custo) / preco * 100", alerta: "margem < 50" },
  parts: [
    { type: "slider", name: "preco", label: "Preço", min: 50, max: 200, step: 10, value: 100, format: "brl" },
    { type: "stat", label: "Margem", value: "margem", format: "pct", tone: "alerta ? 'down' : 'up'" },
    { type: "note", text: "Margem baixa", when: "alerta" },
  ],
  send: { label: "Usar este preço", text: "Usar {preco:brl}." },
};

describe("a block's spec", () => {
  test("checks names and formulas up front, and says where something is wrong", () => {
    expect(parseBlockSpec(SIMULATOR)).toEqual(SIMULATOR);
    expect(parseBlockSpec(JSON.stringify(SIMULATOR))).toEqual(SIMULATOR);
    const wrong = (spec: unknown, message: string) => expect(() => parseBlockSpec(spec)).toThrow(message);
    wrong({ parts: [] }, "parts must be a list of parts");
    wrong({ parts: [{ type: "iframe" }] }, 'parts[0]: type "iframe" is not a part');
    wrong({ parts: [{ type: "stat", label: "X", value: "nada" }] }, 'parts[0].value: there is no value "nada"');
    wrong({ parts: [{ type: "text", text: "Oi {quem}" }] }, 'parts[0].text: there is no value "quem"');
    wrong(
      {
        parts: [
          { type: "slider", name: "a", label: "A", min: 0, max: 1 },
          { type: "switch", name: "a", label: "B" },
        ],
      },
      'the name "a" is used twice',
    );
    wrong(
      { compute: { b: "a + 1", a: "1" }, parts: [{ type: "text", text: "x" }] },
      'compute.b: there is no value "a"',
    );
    wrong({ parts: [{ type: "slider", name: "a", label: "A", min: 5, max: 1 }] }, "max must be more than min");
    wrong({ parts: [{ type: "actions", buttons: [{ label: "Nada" }] }] }, "needs set, draw, say, act or open");
    expect(() => parseBlockSpec({ parts: [{ type: "stat", label: "X", value: "a +" }] })).toThrow(BlockSpecError);
  });

  test("a value a button sets or a draw picks needs no declaring", () => {
    const spec = parseBlockSpec({
      parts: [
        { type: "result", label: "Sorteado", value: "nome" },
        { type: "actions", buttons: [{ label: "Sortear", draw: { name: "nome", options: ["Ana", "Bia"] } }] },
      ],
    });
    const view = viewBlock(compileBlock(spec), {}, words);
    expect(view.parts[0]).toMatchObject({ kind: "result", text: "–", name: "nome" });
    expect(view.parts[1]).toMatchObject({
      kind: "actions",
      buttons: [{ label: "Sortear", draw: { name: "nome", options: ["Ana", "Bia"] }, lead: true }],
    });
    expect(viewBlock(compileBlock(spec), { nome: "Bia" }, words).parts[0]).toMatchObject({ text: "Bia" });
  });

  test("drawn from everyone's state: inputs, results, hidden parts and the text to send", () => {
    const compiled = compileBlock(parseBlockSpec(SIMULATOR));
    const start = viewBlock(compiled, {}, words);
    expect(start.parts.map((p) => p.kind)).toEqual(["slider", "stats"]);
    expect(start.parts[0]).toMatchObject({ value: 100, shown: "R$ 100" });
    expect(start.parts[1]).toMatchObject({ items: [{ label: "Margem", text: "60%", tone: "up" }] });
    expect(start.send).toEqual({ label: "Usar este preço", text: "Usar R$ 100.", ready: true, hint: "" });
    expect(start.values.margem).toBe(60);

    const low = viewBlock(compiled, { preco: 70 }, words);
    expect(low.parts.map((p) => p.kind)).toEqual(["slider", "stats", "note"]);
    expect(low.parts[1]).toMatchObject({ items: [{ text: "42,9%", tone: "down" }] });
    // A value out of the slider's range is brought into it.
    expect(viewBlock(compiled, { preco: 999 }, words).parts[0]).toMatchObject({ value: 200 });
    expect(start.errors).toEqual([]);
  });

  test("charts, tables and cards that are choices", () => {
    const spec = parseBlockSpec({
      data: {
        lojas: [
          { nome: "Centro", venda: 120 },
          { nome: "Batel", venda: 80 },
        ],
      },
      parts: [
        { type: "choice", name: "plano", options: ["A", "B"] },
        { type: "chart", chart: "bar", label: "Vendas", data: "map(lojas, l => {label: l.nome, value: l.venda})" },
        {
          type: "table",
          columns: [
            { label: "Loja", key: "nome" },
            { label: "Venda", key: "venda", format: "brl" },
          ],
          rows: "lojas",
        },
        { type: "card", label: "Plano B", name: "plano", value: "B", parts: [{ type: "note", text: "Mais caro" }] },
      ],
    });
    const view = viewBlock(compileBlock(spec), {}, words);
    expect(view.parts[0]).toMatchObject({ kind: "choice", value: "A" });
    expect(view.parts[1]).toMatchObject({ kind: "chart", labels: ["Centro", "Batel"], values: [120, 80] });
    expect(view.parts[2]).toMatchObject({
      kind: "table",
      rows: [
        ["Centro", "R$ 120"],
        ["Batel", "R$ 80"],
      ],
    });
    expect(view.parts[3]).toMatchObject({ kind: "card", pick: { name: "plano", value: "B" }, selected: false });
    expect(viewBlock(compileBlock(spec), { plano: "B" }, words).parts[3]).toMatchObject({ selected: true });
  });

  test("a formula that fails on the block's own data is caught before it is shown", () => {
    expect(dryRunBlock(parseBlockSpec(SIMULATOR))).toEqual([]);
    const bad = parseBlockSpec({ data: { n: 3 }, parts: [{ type: "stat", label: "X", value: "sum(n)" }] });
    expect(dryRunBlock(bad)[0]).toContain("parts.0.value: sum() needs a list");
  });

  test("what a person types is taken as the part allows", () => {
    const view = viewBlock(compileBlock(parseBlockSpec(SIMULATOR)), {}, words);
    const slider = view.parts[0];
    if (!slider) throw new Error("no slider");
    expect(inputValue(slider, "137")).toBe(140);
    expect(inputValue({ key: "k", kind: "choice", name: "c", label: "", options: ["A"], value: null }, "Z")).toBe(
      undefined,
    );
  });

  test("values written like the kit wrote them", () => {
    expect(formatBlockValue(1200, "brl", undefined, words)).toBe("R$ 1.200");
    expect(formatBlockValue(12, "mil", undefined, words)).toBe("R$ 12 mil");
    expect(formatBlockValue(12.34, "pct", undefined, words)).toBe("12,3%");
    expect(formatBlockValue(3, undefined, "h", words)).toBe("3 h");
    expect(formatBlockValue(Number.NaN, "brl", undefined, words)).toBe("–");
    expect(formatBlockValue(null, undefined, undefined, words)).toBe("–");
  });

  test("its words are what search finds", () => {
    expect(blockSpecText(SIMULATOR)).toContain("Preço");
    expect(blockSpecText(SIMULATOR)).toContain("Usar este preço");
  });
});

describe("copy parts: a carousel, a static post, a reel", () => {
  const CAROUSEL = {
    state: { versao: 1 },
    parts: [
      { type: "tags", items: ["Carrossel", "Topo de funil"] },
      { type: "hook", label: "Gancho", text: "Cobrar por hora faz ganhar menos.", mark: "ganhar menos" },
      {
        type: "slides",
        items: [
          { tag: "Capa", title: "Você cobra por hora?" },
          { title: "O cliente não compra horas.", text: "Compra o vídeo pronto." },
          { tag: "CTA", title: "Comenta PREÇO" },
        ],
      },
      {
        type: "row",
        parts: [
          { type: "poster", eyebrow: "Black Friday", title: "Editado em 48h.", mark: "48h", button: "Garantir" },
          { type: "fields", items: [{ label: "Headline", value: "Editado em 48h." }] },
        ],
      },
      {
        type: "timeline",
        items: [{ time: "00–02", text: "Se o vídeo perde gente…", note: "close", screen: "O CORTE" }],
      },
      { type: "copy", label: "Legenda", text: "Salva pra lembrar.\n#edicao" },
      {
        type: "actions",
        buttons: [
          { label: "Outra versão", say: "Faz outra versão ({versao})." },
          { label: "Aprovar", say: "Aprovado." },
        ],
      },
    ],
  };

  test("they check and draw: marks split out, slides and beats in order, buttons that speak", () => {
    const view = viewBlock(compileBlock(parseBlockSpec(CAROUSEL)), {}, words);
    expect(view.errors).toEqual([]);
    const [tags, hook, slides, row, timeline, copy, actions] = view.parts;
    expect(tags).toMatchObject({ kind: "tags", items: ["Carrossel", "Topo de funil"] });
    expect(hook).toMatchObject({
      kind: "hook",
      text: { before: "Cobrar por hora faz ", mark: "ganhar menos", after: "." },
    });
    expect(slides).toMatchObject({
      kind: "slides",
      items: [{ tag: "Capa" }, { tag: "", text: "Compra o vídeo pronto." }, { tag: "CTA" }],
    });
    expect(row?.kind === "row" && row.parts[0]).toMatchObject({
      kind: "poster",
      title: { before: "Editado em ", mark: "48h", after: "." },
      button: "Garantir",
    });
    expect(timeline).toMatchObject({ kind: "timeline", items: [{ time: "00–02", screen: "O CORTE", note: "close" }] });
    expect(copy).toMatchObject({ kind: "copy", label: "Legenda", text: "Salva pra lembrar.\n#edicao" });
    expect(actions?.kind === "actions" && actions.buttons.map((b) => b.say)).toEqual([
      "Faz outra versão (1).",
      "Aprovado.",
    ]);
  });

  test("a mark must be words of its text, and a button must do something", () => {
    expect(() => parseBlockSpec({ parts: [{ type: "hook", text: "Um gancho", mark: "outro" }] })).toThrow(
      BlockSpecError,
    );
    expect(() => parseBlockSpec({ parts: [{ type: "actions", buttons: [{ label: "Nada" }] }] })).toThrow(
      /set, draw, say, act or open/,
    );
    expect(() => parseBlockSpec({ parts: [{ type: "slides", items: [] }] })).toThrow(/1 to 20 slides/);
    expect(() => parseBlockSpec({ parts: [{ type: "copy", text: "{nada}" }] })).toThrow(/no value "nada"/);
  });

  test("their words are what search finds", () => {
    const text = blockSpecText(parseBlockSpec(CAROUSEL));
    for (const w of ["Carrossel", "Comenta PREÇO", "Editado em 48h.", "O CORTE", "#edicao", "Aprovar"])
      expect(text).toContain(w);
  });
});

describe("sector cards' parts (docs/adr/doug-0020-doug-sector-cards.md)", () => {
  const card = {
    parts: [
      { type: "source", service: "whatsapp", title: "WhatsApp", count: "4 novas" },
      { type: "text", text: "Um lead novo perguntou preço. Eu respondo?" },
      {
        type: "actions",
        align: "start",
        buttons: [
          { label: "Responder", act: "reply", primary: true },
          { label: "Eu respondo", act: "mine" },
          { label: "Ver conversa", open: { place: "whatsapp", id: "a1", sub: "c1" } },
        ],
      },
    ],
  };

  test("a source, buttons with an action, a place and a primary one", () => {
    const spec = parseBlockSpec(card);
    expect(specActs(spec)).toEqual(["reply", "mine"]);
    const view = viewBlock(compileBlock(spec), {}, words);
    expect(view.errors).toEqual([]);
    expect(view.parts[0]).toEqual({
      key: "parts.0",
      kind: "source",
      service: "whatsapp",
      title: "WhatsApp",
      count: "4 novas",
    });
    const row = view.parts[2];
    if (row?.kind !== "actions") throw new Error("no row");
    expect(row.chosen).toBe(true);
    expect(row.buttons.map((b) => [b.label, b.lead, b.act, b.done, b.open?.place ?? null])).toEqual([
      ["Responder", true, "reply", false, null],
      ["Eu respondo", false, "mine", false, null],
      ["Ver conversa", false, null, false, "whatsapp"],
    ]);
  });

  test("what the server ran shows on its button, for everyone", () => {
    const view = viewBlock(compileBlock(parseBlockSpec(card)), { _acted: { mine: "done" } }, words);
    const row = view.parts[2];
    if (row?.kind !== "actions") throw new Error("no row");
    expect(row.buttons.map((b) => b.done)).toEqual([false, true, false]);
  });

  test("a day's agenda, with its colors and a link", () => {
    const spec = parseBlockSpec({
      parts: [
        { type: "source", service: "calendar", title: "Agenda · quarta, 19" },
        {
          type: "agenda",
          items: [
            { time: "10:00", title: "Call", sub: "10:00 – 10:30 · Google Meet", tone: "blue" },
            { time: "17:00", title: "Entrega" },
          ],
          note: "A pauta da call das 10h está pronta.",
          link: { label: "Abrir pauta", open: { place: "link", href: "https://example.com/pauta" } },
        },
      ],
    });
    const agenda = viewBlock(compileBlock(spec), {}, words).parts[1];
    expect(agenda).toEqual({
      key: "parts.1",
      kind: "agenda",
      items: [
        { time: "10:00", title: "Call", sub: "10:00 – 10:30 · Google Meet", tone: "blue" },
        { time: "17:00", title: "Entrega", sub: "", tone: "blue" },
      ],
      note: "A pauta da call das 10h está pronta.",
      link: { label: "Abrir pauta", open: { place: "link", href: "https://example.com/pauta" } },
    });
    expect(blockSpecText(spec)).toContain("Entrega");
  });

  test("refused: an unknown service, a tone, a place, an address that isn't https, the server's own name", () => {
    const bad = [
      { parts: [{ type: "source", service: "fax", title: "x" }] },
      { parts: [{ type: "agenda", items: [{ time: "1", title: "x", tone: "pink" }] }] },
      { parts: [{ type: "actions", buttons: [{ label: "x", open: { place: "settings" } }] }] },
      { parts: [{ type: "actions", buttons: [{ label: "x", open: { place: "link", href: "javascript:alert(1)" } }] }] },
      { parts: [{ type: "actions", buttons: [{ label: "x", open: { place: "whatsapp", id: "a/b" } }] }] },
      { parts: [{ type: "actions", buttons: [{ label: "x", act: "no way" }] }] },
      { state: { _acted: {} }, parts: [{ type: "actions", buttons: [{ label: "x", act: "go" }] }] },
    ];
    for (const raw of bad) expect(() => parseBlockSpec(raw)).toThrow(BlockSpecError);
  });
});
