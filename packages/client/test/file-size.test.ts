import { expect, test } from "bun:test";
import { formatBytes } from "../src/lib/files";

test("a size reads rounded: 39 MB, 1.5 MB, 820 bytes", () => {
  expect(formatBytes("en", 38.882 * 1024 * 1024)).toBe("39 MB");
  expect(formatBytes("en", 1.5 * 1024 * 1024)).toBe("1.5 MB");
  expect(formatBytes("en", 820)).toBe("820 bytes");
});

test("rounded before formatting: an engine that drops maximumFractionDigits for a unit (Hermes on iOS) still reads 39 MB", () => {
  const Real = Intl.NumberFormat;
  // Hermes: the unit style ignores maximumFractionDigits and writes every digit it has.
  class Hermes extends Real {
    constructor(locale: string, options: Intl.NumberFormatOptions) {
      const { maximumFractionDigits: _dropped, ...rest } = options;
      super(locale, { ...rest, maximumFractionDigits: 3 });
    }
  }
  Intl.NumberFormat = Hermes as unknown as typeof Intl.NumberFormat;
  try {
    expect(formatBytes("en", 38.882 * 1024 * 1024)).toBe("39 MB");
    expect(formatBytes("en", 1.234 * 1024 * 1024)).toBe("1.2 MB");
  } finally {
    Intl.NumberFormat = Real;
  }
});
