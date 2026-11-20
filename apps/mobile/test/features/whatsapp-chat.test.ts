import { describe, expect, test } from "bun:test";
import { holdAt, linkParts, waveBars, withoutLast } from "../../src/features/whatsapp/rules";

describe("links in a message", () => {
  test("addresses, www and e-mails become links, sentence punctuation stays outside", () => {
    expect(linkParts("olha https://dougbot.app/a?b=1, e www.zim.com.br.")).toEqual([
      { text: "olha " },
      { text: "https://dougbot.app/a?b=1", href: "https://dougbot.app/a?b=1" },
      { text: ", e " },
      { text: "www.zim.com.br", href: "https://www.zim.com.br" },
      { text: "." },
    ]);
    expect(linkParts("escreve pra ana@zim.com")).toEqual([
      { text: "escreve pra " },
      { text: "ana@zim.com", href: "mailto:ana@zim.com" },
    ]);
    expect(linkParts("(https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual([
      { text: "(" },
      { text: "https://en.wikipedia.org/wiki/Foo_(bar)", href: "https://en.wikipedia.org/wiki/Foo_(bar)" },
      { text: ")" },
    ]);
    expect(linkParts("sem link aqui")).toEqual([{ text: "sem link aqui" }]);
    expect(linkParts("")).toEqual([{ text: "" }]);
  });
});

describe("a voice message's bars", () => {
  test("WhatsApp's loudness is taken to the bars drawn, the loudest at full height", () => {
    const bars = waveBars([0, 50, 100, 25], "x", 2);
    expect(bars).toEqual([0.5, 1]);
    expect(waveBars([0, 0], "x", 3).every((b) => b >= 0.12)).toBe(true);
  });
  test("without one, each message keeps a shape of its own", () => {
    expect(waveBars(null, "a", 10)).toEqual(waveBars(undefined, "a", 10));
    expect(waveBars(null, "a", 10)).not.toEqual(waveBars(null, "b", 10));
  });
});

describe("holding the mic", () => {
  test("left far enough drops the take, up far enough locks it", () => {
    expect(holdAt(0, 0)).toBe("hold");
    expect(holdAt(-60, -20)).toBe("hold");
    expect(holdAt(-120, -10)).toBe("cancel");
    expect(holdAt(-10, -90)).toBe("lock");
  });
});

describe("erasing from the emoji panel", () => {
  test("an emoji goes as one, whatever it is made of", () => {
    expect(withoutLast("oi 👍🏽")).toBe("oi ");
    expect(withoutLast("👨‍👩‍👧")).toBe("");
    expect(withoutLast("🇧🇷🇧🇷")).toBe("🇧🇷");
    expect(withoutLast("abc")).toBe("ab");
    expect(withoutLast("")).toBe("");
  });
});
