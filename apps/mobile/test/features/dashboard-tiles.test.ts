import { describe, expect, test } from "bun:test";
import { mixHex } from "../../src/features/dashboards/logic";
import {
  barsWidth,
  bigRoom,
  dotWindow,
  fitSize,
  focusBar,
  idHash,
  labelsFit,
  listShown,
  signedArrow,
  TILE_HEIGHT,
  TILE_HUES,
  tileHue,
  tileSize,
  trendOf,
  trendPath,
  trendPoints,
  trendWidth,
  unitJoins,
} from "../../src/features/dashboards/tile-look";

const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const onWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

describe("tile colors", () => {
  test("a widget keeps its color: the same id, the same hue", () => {
    expect(tileHue("0198a4b2-aaaa")).toBe(tileHue("0198a4b2-aaaa"));
    expect(idHash("abc")).toBe(idHash("abc"));
  });

  test("ids spread over every hue", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(tileHue(`widget-${i}`).key);
    expect(seen.size).toBe(TILE_HUES.length);
  });

  test("no hue reads as an alert: nothing red or orange", () => {
    for (const hue of TILE_HUES) {
      for (const hex of [hue.top, hue.bottom]) {
        const n = Number.parseInt(hex.slice(1), 16);
        const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255] as [number, number, number];
        // Red leads and blue is far behind: a red, an orange or an amber.
        const warm = r > 150 && r > g * 1.25 && b < r * 0.55;
        expect({ hex, warm }).toEqual({ hex, warm: false });
      }
    }
  });

  test("white small text stays readable over the lower half of every tile", () => {
    for (const hue of TILE_HUES) {
      for (const at of [0.5, 0.75, 1]) {
        // `mixHex` weighs its first color: at the middle, half of each; at the bottom, the bottom alone.
        const c = mixHex(hue.top, hue.bottom, 1 - at);
        expect({ key: hue.key, at, ok: onWhite(c) >= 4.5 }).toEqual({ key: hue.key, at, ok: true });
      }
    }
  });
});

describe("tile shapes", () => {
  test("sizes from the board's width and height", () => {
    expect(tileSize(1, 1)).toBe("s");
    expect(tileSize(1, 2)).toBe("s");
    expect(tileSize(2, 1)).toBe("m");
    expect(tileSize(2, 2)).toBe("l");
    expect(TILE_HEIGHT.l).toBe(TILE_HEIGHT.s * 2 + 14);
  });

  test("a sign up front becomes an arrow; anything else stays as written", () => {
    expect(signedArrow("+12%")).toEqual({ arrow: "↑", text: "12%" });
    expect(signedArrow("-2 min")).toEqual({ arrow: "↓", text: "2 min" });
    expect(signedArrow("−R$ 300")).toEqual({ arrow: "↓", text: "R$ 300" });
    expect(signedArrow("▲ 4")).toEqual({ arrow: "↑", text: "4" });
    expect(signedArrow("igual a ontem")).toEqual({ arrow: null, text: "igual a ontem" });
    expect(signedArrow("-")).toEqual({ arrow: null, text: "-" });
  });

  test("the called-out bar: the alert's, else the tallest", () => {
    expect(focusBar([3, 9, 4], 2)).toBe(2);
    expect(focusBar([3, 9, 4])).toBe(1);
    expect(focusBar([5, 5])).toBe(1);
    expect(focusBar([3, 9], 7)).toBe(1);
    expect(focusBar([])).toBe(-1);
  });

  test("a short unit joins the number", () => {
    expect(unitJoins("%")).toBe(true);
    expect(unitJoins("R$")).toBe(true);
    expect(unitJoins("runs per day")).toBe(false);
    expect(unitJoins(undefined)).toBe(false);
  });

  test("a trend fills its box from edge to edge, highs on top", () => {
    const p = trendPoints([0, 10, 5], 110, 50, 5);
    expect(p).toEqual([
      [5, 45],
      [55, 5],
      [105, 25],
    ]);
    expect(trendPath(p)).toBe("M5 45 L55 5 L105 25");
    expect(trendPoints([4], 100, 40)).toEqual([]);
    // A flat series draws a flat line through the middle.
    expect(trendPoints([2, 2], 20, 20, 0)).toEqual([
      [0, 10],
      [20, 10],
    ]);
  });

  test("what a tile draws as its trend", () => {
    expect(trendOf({ kind: "kpi", value: 1, spark: [1, 2] })).toEqual([1, 2]);
    expect(trendOf({ kind: "kpi", value: 1 })).toBeNull();
    expect(trendOf({ kind: "line", labels: ["a", "b"], values: [3, 4] })).toEqual([3, 4]);
    expect(trendOf({ kind: "goal", pct: 3, line: "x" })).toBeNull();
    expect(trendOf(null)).toBeNull();
  });

  test("a long list leaves a row's room for 'more N'", () => {
    expect(listShown([1, 2, 3], "s")).toEqual({ shown: [1, 2, 3], hidden: 0 });
    expect(listShown([1, 2, 3, 4, 5], "s")).toEqual({ shown: [1, 2], hidden: 3 });
    expect(listShown([1, 2, 3, 4, 5], "l")).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 0 });
  });

  test("the dots keep the shown page inside their window", () => {
    expect(dotWindow(3, 1)).toEqual({ first: 0, count: 3 });
    expect(dotWindow(20, 0)).toEqual({ first: 0, count: 9 });
    expect(dotWindow(20, 10)).toEqual({ first: 6, count: 9 });
    expect(dotWindow(20, 19)).toEqual({ first: 11, count: 9 });
  });

  test("a long number gets smaller to stay whole, never under the floor", () => {
    expect(fitSize("23", 46, 166)).toBe(46);
    expect(fitSize("R$ 18.420", 40, 142)).toBe(26);
    expect(fitSize("R$ 1.234.567.890", 40, 142)).toBe(22);
    expect(fitSize("", 40, 142)).toBe(40);
  });

  test("columns keep the iPhone's 12 and 6 until they run out of room", () => {
    expect(barsWidth(7)).toBe(120);
    expect(barsWidth(14)).toBe(152);
    expect(barsWidth(1)).toBe(12);
  });

  test("the labels all show only when they fit", () => {
    const week = ["seg", "ter", "qua", "qui", "sex", "sáb", "hoje"];
    expect(labelsFit(week, 170)).toBe(true);
    expect(labelsFit(week, 100)).toBe(false);
    expect(labelsFit(["S1", "S2"], 0, { slot: 30 })).toBe(true);
    expect(labelsFit(["janeiro", "fevereiro"], 0, { slot: 20 })).toBe(false);
  });

  test("the number's room follows the tile's measured inside", () => {
    expect(bigRoom("s", 0)).toBe(142);
    expect(bigRoom("l", 258)).toBe(258);
    // A 320-point phone's M tile: the chart beside it keeps its 152.
    expect(bigRoom("m", 258)).toBe(94);
    expect(trendWidth(258)).toBe(103);
    expect(trendWidth(0)).toBe(150);
  });
});
