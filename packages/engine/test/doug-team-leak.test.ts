import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Glob } from "bun";

/*
 * The Doug team's material is the house's craft with no client's data (docs/adr/doug-0020-time-doug.md): every file of
 * src/doug-team/ is read and refused when it holds an email address, a phone number, an address outside GitHub, or a
 * name of the house's clients, people, companies and projects. The names are kept here only as SHA-256 hashes of the
 * word, or of two words in a row, in lower case with no accents, so this test publishes none of them.
 */

const DIR = join(import.meta.dir, "../src/doug-team");

const DENIED = new Set([
  "80db4218688d7406fb73c9cb141228ac73fbaa0eaffa559d9187b1c3109a5b15",
  "3e62161cba69d04d91cc6282ce46e6b802846e1de6ec23a4bac36678ab679d80",
  "aa64c844f5ebe0325a40ec57f7637073e1d10613cb0e6f0697e98a36317d39c1",
  "45651f2cb0f1173a7ad64ff37ab8347649aca6dbe3d334b0e930a56c93d68b84",
  "8ce72367c0584ff2376a8e4c2d80d46d47072a2d03e51e7ba5e56f3b986f670b",
  "88ea1e94cbdb9bf92ee52c1e1357d66ed4e07b3fc8df62c4460299a0fbb17c36",
  "6e8091fb3f0a2ba5f77a690917dd331dc7df9d7e7259c312e42c12696761b6a2",
  "a48fdf8507eb98e7b05aa143a93cbad2c6a5db3e18cfd3a51b9dccb7bf364108",
  "6b91a64d33b80830e8a2c803ee43ee171f45f9e0312b200d1235fc9836b30544",
  "a4e0a270f8299cb4951664da78c597320bb14fb51eae275adb7f075e0732e8be",
  "076a89c23179cedfc61171fe400ecf01fb76b9a48a68fb82dd0cd688d684d900",
  "890b17fd1596bd1b92f1f749668df6e689ab86941d0b61eadfdf94079f88a6be",
  "13e2dd0573126987e5e0d45383cc33e5591efc0ac276a6e8e9b6e0b534434aac",
  "72831924521887e6638e686d6d004cd6cefe48168d2d4e2c40d29115b9c611b9",
  "ff06535ac1029cca2fc2b86ac7355a7b4e0b8d839fc76b51d30833f4e1347ddc",
  "061e40feead8e7c95d3bae54ea7a10d2e8afe4b49007ee3db2e507359199dfba",
  "95ffd299ece92304b3e95f4f65e666ba9d1bc6b85e7ea83866f447be0e5fb770",
  "a4e463d7dec930ea7f5a7d92fc3b798a167c7c206438739d4c82d96d5ebf2cfe",
  "110591733245175eeaa72ea403048e6d897758261816730cd5373ce46143d714",
  "1f195f3170be92dfb8982e0ea21948f3fbc05c919c263ebd4d26527bf209f3b3",
  "5afdaeb411a36ca0534a59954c48bb1db71c4aad027c99f9a2a8e25e256002af",
  "2853653e8a327234f669233133e36aca217b2b06585dcacbd26573cdf8a57b6f",
  "8def3bf5d78abb247b4829e87b52b10d79b1cd0e2aec529930ed692ee8d1cd2c",
  "9bcdae8ebc2a970a365103a52da830f3958f4f381fcfd544f7c0452ee09dba00",
  "9eee9ea706f8f1b6aa374fb217f3c1a703fe5509c721df1af37484fad20ce7f5",
  "fd78440895bdd9d7e77e6f07cee9d0e4ff79dbc0fb0854291eeb2c80d15fd925",
  "1dac8da6118ead38d9debbabbff9917383a2eb5a04b2b186abd05f4534939166",
  "b1ac26d3a1e40826c1f94bad52aa1aeb417491c71b5e9e9593c1eb10bb56f0e9",
  "f850d59299f741d6318d2d393edc8ad06a99639430ae44fe7a565c741d837868",
  "9840fd92005ca1ce32a16a401f78ecfae7178592da0b8e23d70eeb53c006881a",
  "ec187a17a1a662a451a5d08f5bcb670f3be7f9fef211cb768d6a4e202b80ec80",
  "fc31b4d727b363a75f6fe3eca421b0c7a5541a868144ebe132038f3d67e0d7d7",
  "915e739b8b9b1971cff99937a02a8a97773f13ba23a102b641f6053137b7b3fd",
  "744fa021c05aef5313e5ea7d3da7dd2915ea05554b44f1a0b7de220f93a39b48",
  "fbe96c8edfbfe0d97d9b4074fb1d8aec7bcd4c13c44f5291d7db0c7b637730eb",
  "bdc1062c265db7321314d9bfab4120e6fe114fbbcd02bd7a4777ebbe6ad3f065",
  "92b6fca4023fb8af2499281e01934a998a22d803a5d648798c10577c0b4114cf",
  "680a57020d94eaa0df1c139aac035b7f53382cd05d31b0b30ae48592fa657b7b",
  "ea91ef2895e43e99a6bdd29642469391dd71665471f09a8fb87a6f36c41c8269",
  "c2a60112db94185301c7b4d772a8200bf13a8e46f43d260d24dd5671d8b4f9dd",
  "216a5c5007c815053d8adeffb643a2f16dd87dbb2ed733b0d9a1979838431750",
  "6d06e35153f4cd71c850cd106d93594019326fae459b82989a357dde73aced2b",
  "b1672099f194fb7d2ac48146fb56f5c6cf80f0c57c6b60e34bd96ae318d3a83b",
  "0bfac83cf67a9d9d6c45c2f204689241868ddc873c4607ccaa1a89f3ea4bea03",
  "3dd2490023f6801aceb57bde6198ef56e81f1485770608af4a7748aa92f84235",
  "82117e0f8b03115fd4521eb6ee1b299e1a23d6b76ed8dc5a84285c436dbe6a19",
  "86ccdd0438c410a59a3318ee851ca27aff2ca97f3db570b00e5a148484d18bdb",
  "919df93652392b73ca6bbc306b0beeb75a94a46c7f55ffc2c67916a123ecaa25",
]);

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]*[a-z]/i;
/** "+55 11 98765-4321", "(11) 3456-7890", "11 98765 4321": a cron, a size or a year doesn't read as one. */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\b\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]\d{4}\b/;
const LINK = /(?:https?:\/\/|www\.)[a-z0-9][^\s)>\]"'`]*/gi;
const ALLOWED_HOSTS = new Set(["github.com", "raw.githubusercontent.com"]);

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** Lower case, no accents, split on anything that isn't a letter or a digit. */
export const wordsOf = (line: string) =>
  line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** What a line holds that the material may not: each finding as `kind: what` (a hashed word by its hash). */
export function leaksIn(line: string, denied: ReadonlySet<string> = DENIED): string[] {
  const found: string[] = [];
  const email = EMAIL.exec(line);
  if (email) found.push(`email: ${email[0]}`);
  const phone = PHONE.exec(line);
  if (phone) found.push(`phone: ${phone[0]}`);
  for (const link of line.match(LINK) ?? []) {
    let host = "";
    try {
      host = new URL(link.startsWith("www.") ? `https://${link}` : link).hostname;
    } catch {}
    if (!ALLOWED_HOSTS.has(host)) found.push(`link: ${link}`);
  }
  const words = wordsOf(line);
  words.forEach((w, i) => {
    if (denied.has(sha(w))) found.push(`word: ${sha(w)}`);
    const next = words[i + 1];
    if (next && denied.has(sha(`${w} ${next}`))) found.push(`words: ${sha(`${w} ${next}`)}`);
  });
  return found;
}

describe("the Doug team's material", () => {
  test("holds no email, phone, outside address or denied name", async () => {
    const files = [...new Glob("**/*").scanSync({ cwd: DIR, onlyFiles: true })].sort();
    expect(files.length).toBeGreaterThan(60);
    const hits: string[] = [];
    for (const file of files) {
      const text = await Bun.file(join(DIR, file)).text();
      text.split("\n").forEach((line, i) => {
        for (const leak of leaksIn(line)) hits.push(`${file}:${i + 1}: ${leak}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test("the check itself finds each kind", () => {
    const denied = new Set([sha("acme"), sha("acme labs")]);
    expect(leaksIn("escreva para ana@acme.com", new Set())).toEqual(["email: ana@acme.com"]);
    expect(leaksIn("ligue (11) 98765-4321", new Set())).toEqual(["phone: (11) 98765-4321"]);
    expect(leaksIn('cron: "0 8-20 * * 1-5", 1080x1920, 2026', new Set())).toEqual([]);
    expect(leaksIn("veja https://exemplo.com.br/x e https://github.com/a/b", new Set())).toEqual([
      "link: https://exemplo.com.br/x",
    ]);
    expect(leaksIn("começando com https://.", new Set())).toEqual([]);
    expect(leaksIn("a ÁCME faz", denied)).toEqual([`word: ${sha("acme")}`]);
    expect(leaksIn("na Acme Labs", denied)).toEqual([`word: ${sha("acme")}`, `words: ${sha("acme labs")}`]);
  });
});
