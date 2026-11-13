import { describe, expect, test } from "bun:test";
import { botDoAgente, CORES_LIVRES, corDoBot } from "../src/brand/dougbot-time";

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
});
