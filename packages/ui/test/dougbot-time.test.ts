import { describe, expect, test } from "bun:test";
import { botDoAgente, CORES_LIVRES, corDoBot, lookDoBot } from "../src/brand/dougbot-time";

describe("which DougBot an agent is (brand/dougbot-time.ts)", () => {
  test("the team's names and handles are the identity's bots; the Doug BOSS is the Doug", () => {
    expect(botDoAgente({ name: "Doug BOSS", handle: "doug" })).toEqual({ bot: "doug" });
    expect(botDoAgente({ name: "Doug Boss", handle: "boss" })).toEqual({ bot: "doug" });
    for (const h of ["rosa", "sony", "mark", "chess", "kiara", "junin"])
      expect(botDoAgente({ name: h.toUpperCase(), handle: h })).toEqual({ bot: h as never });
  });
  test("a free bot: its form from its trade, a free color (never green), eyes from its handle, no mouth", () => {
    const cases: [string, string, string][] = [
      ["editorzim", "Cortes para Reels", "monitor"],
      ["diretor-criativo", "Direção de arte", "petala"],
      ["financeiro-trafego", "Financeiro do tráfego", "moeda"],
      ["suporte-zimstudio", "Suporte técnico", "hexagono"],
      ["estrategista-midia", "Estratégia de mídia", "torre"],
      ["socialmedialexeer", "Social media", "quadrado"],
      ["humanizador", "Revisão de textos", "squircle"],
    ];
    for (const [handle, role, forma] of cases) {
      const bot = botDoAgente({ name: handle, handle, role });
      expect(bot.forma).toBe(forma as never);
      expect(CORES_LIVRES).toContain(bot.cor as never);
      expect(corDoBot(bot).toUpperCase()).not.toBe("#9CFA05");
      expect(bot.sorriso).toBe(false);
      // The same agent, the same bot, every time.
      expect(botDoAgente({ name: handle, handle, role })).toEqual(bot);
    }
  });
  test("a look with a form draws as picked: form, color, eyes and accessory; the Doug stays the Doug", () => {
    const who = { name: "Mila", handle: "mila", role: "Social media" };
    expect(botDoAgente({ ...who, look: { shape: "torre", color: "#ff0000", eyes: "dots", accessory: "tie" } })).toEqual(
      {
        forma: "torre",
        cor: "#ff0000",
        olhos: "ponto",
        acessorio: "gravata",
        sorriso: false,
      },
    );
    // A preset color is one tone of its gradient; an accessory the bot doesn't draw is left off.
    const indigo = botDoAgente({ ...who, look: { shape: "moeda", color: "indigo", eyes: "wide", accessory: "crown" } });
    expect(indigo.forma).toBe("moeda");
    expect(indigo.cor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(indigo.acessorio).toBeUndefined();
    // Without a form the old look is ignored: the bot still comes from the trade.
    expect(botDoAgente({ ...who, look: { color: "rose", eyes: "dots" } })).toEqual(botDoAgente(who));
    expect(botDoAgente({ name: "Doug", handle: "doug", look: { shape: "torre", color: "#ff0000" } })).toEqual({
      bot: "doug",
    });
  });
  test("the picker starts from the bot the agent already is", () => {
    const who = { name: "Mila", handle: "mila", role: "Social media" };
    const start = lookDoBot(who);
    expect(start.shape).toBe("quadrado");
    const before = botDoAgente(who);
    const after = botDoAgente({ ...who, look: start });
    expect({ ...after, cor: after.cor?.toLowerCase() }).toEqual({ ...before, cor: before.cor?.toLowerCase() });
  });
});
