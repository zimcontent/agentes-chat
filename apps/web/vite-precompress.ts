import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { Plugin } from "vite";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Text the server may send compressed. Source maps stay as they are: only developer tools ask for them. */
export const COMPRESSED = /\.(?:js|mjs|css|html|svg|json|txt|xml|webmanifest)$/;
/** Under this a compressed copy saves less than its headers cost. */
export const MIN_BYTES = 1024;

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)])),
  );
  return nested.flat();
}

/**
 * A `.br` and a `.gz` copy beside every text file of the build, made once here at the highest level, so the server
 * sends them as they are (`precompressed` in apps/server/src/app.ts) and spends no time compressing per request.
 * A copy that isn't smaller is not written, and the server then sends the file itself.
 */
export function precompress(): Plugin {
  let outDir = "dist";
  return {
    name: "agentes:precompress",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    async closeBundle() {
      const files = (await filesUnder(outDir)).filter((file) => COMPRESSED.test(file));
      await Promise.all(
        files.map(async (file) => {
          const bytes = await readFile(file);
          if (bytes.length < MIN_BYTES) return;
          const [br, gzipped] = await Promise.all([
            brotli(bytes, {
              params: {
                [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
                [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
              },
            }),
            gz(bytes, { level: constants.Z_BEST_COMPRESSION }),
          ]);
          if (br.length < bytes.length) await writeFile(`${file}.br`, br);
          if (gzipped.length < bytes.length) await writeFile(`${file}.gz`, gzipped);
        }),
      );
    },
  };
}
