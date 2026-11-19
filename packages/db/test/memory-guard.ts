import { afterEach } from "bun:test";
import { openTestDatabases } from "./pglite";

/**
 * Stops a test process that eats memory, with a message that says so, before the kernel does it without one
 * (a `bun test` once reached 68 GB on a server and took the machine down).
 *
 * - `TEST_MAX_RSS_MB` (default 8192): the most this process may hold. Past it the collector runs once; if the
 *   process is still over, it prints what it knows and exits with 137. A value of 0 turns the guard off.
 * - It looks after every test and once a second (a single test can also run away).
 *
 * The databases of the tests are the usual cause: see `createTestDatabase` (`pglite.ts`).
 */
const limitMb = Number(process.env.TEST_MAX_RSS_MB ?? 8192);
const mb = (bytes: number) => Math.round(bytes / 1048576);

let tests = 0;

function check(where: string) {
  if (!limitMb) return;
  let rss = process.memoryUsage.rss();
  if (mb(rss) <= limitMb) return;
  Bun.gc(true);
  rss = process.memoryUsage.rss();
  if (mb(rss) <= limitMb) return;
  const open = openTestDatabases();
  process.stderr.write(
    `\nTEST MEMORY LIMIT: this test process holds ${mb(rss)} MB (limit ${limitMb} MB, TEST_MAX_RSS_MB), ` +
      `${where}, after ${tests} tests, with ${open.count} test databases open` +
      `${open.count ? `, opened at:\n  ${open.where.join("\n  ")}` : ""}.\n` +
      "Usually a test opens databases or servers and does not close them. Stopped so the machine is not.\n",
  );
  process.exit(137);
}

afterEach(() => {
  tests++;
  check("after a test");
});

if (limitMb) setInterval(() => check("while a test ran"), 1000).unref();
