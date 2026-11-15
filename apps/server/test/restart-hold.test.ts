import { expect, test } from "bun:test";
import { createLogger } from "../src/logger";
import { createRestartHold } from "../src/restart-hold";

const log = createLogger("error");

test("a restart announced ahead holds the runs, says ready once nothing long runs here, and lets go by itself (ADR doug-0005)", async () => {
  let long = 1;
  let runs = 1;
  const held: boolean[] = [];
  const hold = createRestartHold({
    longInFlight: () => long,
    runsHere: () => runs,
    holdRuns: (on) => held.push(on),
    log,
    maxMs: 50,
  });
  expect(hold.state()).toBeNull();
  expect(hold.held()).toBe(false);

  hold.hold();
  hold.hold();
  expect(held).toEqual([true]);
  expect(hold.held()).toBe(true);
  expect(hold.state()).toBe("waiting");
  runs = 0;
  // A routine's job still runs: not yet.
  expect(hold.state()).toBe("waiting");
  long = 0;
  expect(hold.state()).toBe("ready");

  // Nobody restarted it: it lets go, and agents' work starts here again.
  await Bun.sleep(80);
  expect(hold.held()).toBe(false);
  expect(hold.state()).toBeNull();
  expect(held).toEqual([true, false]);
});
