import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { sql } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { type Database, EXTRA_COLUMNS, migrateInSteps, migrationsFolder } from "../src/client";
import * as schema from "../src/schema";
import { tracingLogger } from "../src/trace";

/**
 * Fresh database with all migrations applied, for tests.
 *
 * - Default: in-memory PGlite (with pgvector) inside the test process; nothing to install.
 * - With `TEST_DATABASE_URL` set: a throw-away database on a real PostgreSQL
 *   server, created per call and dropped on close (docs/adr/0003-testing-with-pglite.md).
 *
 * `pglite` is exposed for tests that exercise LISTEN/NOTIFY directly.
 */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void>; pglite?: PGlite }> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (serverUrl) return createOnServer(serverUrl);

  const client = new PGlite({ extensions: { vector }, loadDataDir: await migratedTemplate() });
  const db = drizzlePglite(client, { schema, casing: "snake_case", logger: tracingLogger });
  const opened = trackOpen();
  let closing: Promise<void> | undefined;
  return {
    db: db as unknown as Database,
    close: () => (closing ??= client.close().finally(() => closed(opened))),
    pglite: client,
  };
}

/**
 * A PGlite holds about 450 MB while it lives (its WebAssembly memory plus the data directory). A test that leaves
 * one open keeps all of it for the rest of the process, and a few test files did (about 90 databases between them,
 * more than 40 GB). So every open database is counted: past `TEST_MAX_OPEN_DBS` (default 12) in one process the next
 * one fails with the places that opened the oldest ones, instead of eating the machine.
 */
const openDatabases = new Map<symbol, string>();

/** How many test databases this process has open right now, and where the oldest ones were opened. */
export function openTestDatabases(): { count: number; where: string[] } {
  return { count: openDatabases.size, where: [...openDatabases.values()].slice(0, 5) };
}

function trackOpen(): symbol {
  const limit = Number(process.env.TEST_MAX_OPEN_DBS ?? 12);
  if (openDatabases.size >= limit) {
    const where = [...openDatabases.values()].slice(0, 5).join("\n  ");
    throw new Error(
      `${openDatabases.size} test databases are open in this process (limit ${limit}, TEST_MAX_OPEN_DBS): a test opens ` +
        `them without closing. Opened at:\n  ${where}`,
    );
  }
  const id = Symbol("test-database");
  const stack = (new Error().stack ?? "")
    .split("\n")
    .filter((line) => line.includes("/test/") && !line.includes("pglite.ts"));
  openDatabases.set(id, stack.slice(0, 3).join(" < ").trim() || "unknown");
  return id;
}

function closed(id: symbol) {
  openDatabases.delete(id);
}

/**
 * Migrations run into a template database whose data directory is then loaded by every fresh database (much
 * faster than migrating each time). The template is kept in this process and in a file in the system's
 * temporary folder, named after the migrations and the PGlite version: `bun test --parallel` gives every test
 * file modules of its own, so without the file each one would migrate again.
 */
let template: Promise<Blob> | undefined;
function migratedTemplate(): Promise<Blob> {
  template ??= loadTemplate().catch((error) => {
    // A failed build is not kept: the next database tries again.
    template = undefined;
    throw error;
  });
  return template;
}

async function loadTemplate(): Promise<Blob> {
  const file = join(tmpdir(), `agenteschat-test-template-${templateKey()}.tar`);
  if (existsSync(file)) return new Blob([readFileSync(file)]);

  const client = new PGlite({ extensions: { vector } });
  await migrateInSteps(drizzlePglite(client, { schema, casing: "snake_case" }), migrationsFolder);
  const dump = await client.dumpDataDir("none");
  await client.close();
  // Written beside its final name and moved there: a process starting meanwhile never reads half a file.
  const partial = `${file}.${process.pid}.${crypto.randomUUID()}`;
  writeFileSync(partial, Buffer.from(await dump.arrayBuffer()));
  renameSync(partial, file);
  return dump;
}

/** What the template depends on: every migration, their journal and the PGlite version this package pins. */
function templateKey(): string {
  const hash = createHash("sha256");
  const pins = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  hash.update(JSON.stringify([pins.dependencies, pins.devDependencies]));
  hash.update(readFileSync(join(migrationsFolder, "meta", "_journal.json")));
  hash.update(EXTRA_COLUMNS.join(";"));
  for (const name of readdirSync(migrationsFolder).sort()) {
    if (name.endsWith(".sql")) hash.update(name).update(readFileSync(join(migrationsFolder, name)));
  }
  return hash.digest("hex").slice(0, 32);
}

/**
 * Runs one migration's statements again, as the migrator does, on rows a test wrote. It is found by its name,
 * which a renumbering keeps.
 */
export async function runMigration(db: Database, name: string) {
  const file = readdirSync(migrationsFolder).find((f) => f.endsWith(`_${name}.sql`));
  if (!file) throw new Error(`No migration named ${name}`);
  const statements = readFileSync(join(migrationsFolder, file), "utf8").split("--> statement-breakpoint");
  for (const statement of statements) await db.execute(sql.raw(statement));
}

async function createOnServer(serverUrl: string) {
  const name = `agenteschat_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create database ${name}`);

  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 5, onnotice: () => {} });
  const db = drizzlePostgres(client, { schema, casing: "snake_case", logger: tracingLogger });
  await migrateInSteps(db, migrationsFolder);

  return {
    db: db as unknown as Database,
    close: async () => {
      await client.end({ timeout: 5 });
      await admin.unsafe(`drop database if exists ${name} with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}
