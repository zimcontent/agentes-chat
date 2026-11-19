import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useStillBusy } from "@/hooks/useStillBusy";

setupDom();
afterEach(cleanup);

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

describe("useStillBusy", () => {
  test("turns on only after busy has lasted the delay, and off when busy ends", async () => {
    const { result, rerender } = renderHook(({ busy }) => useStillBusy(busy, 30), { initialProps: { busy: false } });
    await wait(50);
    expect(result.current).toBe(false);
    rerender({ busy: true });
    await wait(10);
    expect(result.current).toBe(false);
    await wait(50);
    expect(result.current).toBe(true);
    rerender({ busy: false });
    expect(result.current).toBe(false);
  });

  test("a job that ends before the delay never shows it", async () => {
    const { result, rerender } = renderHook(({ busy }) => useStillBusy(busy, 30), { initialProps: { busy: true } });
    rerender({ busy: false });
    await wait(60);
    expect(result.current).toBe(false);
  });
});
