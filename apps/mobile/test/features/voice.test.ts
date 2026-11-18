import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hidesBody } from "../../src/features/chat/logic";
import {
  handleAt,
  hasWords,
  levelOf,
  localVoiceMessage,
  nextSpeed,
  playedColumns,
  retryDelayMs,
  spokenWords,
  uploadVerdict,
  voiceFields,
  WAVE_CELL,
  WAVE_HANDLE,
  WAVE_PITCH,
  waveAt,
} from "../../src/features/voice/logic";
import { spliceWords } from "../../src/ui/splice-words";

describe("voice wave", () => {
  test("levels stay in range, and silence still draws a bar", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(-160)).toBe(0.04);
    expect(levelOf(undefined)).toBe(0.04);
  });
  test("speed goes round", () => {
    expect([nextSpeed(1), nextSpeed(1.5), nextSpeed(2)]).toEqual([1.5, 2, 1]);
  });
  test("a played wave's handle stands flush with its left end before the first column at 0:00, and flush with its right end after the last at the end, as WhatsApp's dot", () => {
    // Every room the columns leave over (0 to 5), a width between whole points, and the phones' own.
    for (const width of [180, 181, 182, 183, 184, 185, 233.5, 300]) {
      const { count, start } = playedColumns(width);
      const end = start + count * WAVE_PITCH - (WAVE_PITCH - WAVE_CELL);
      expect([width, handleAt(0, width), handleAt(1, width) + WAVE_HANDLE]).toEqual([width, 0, width]);
      // Never on a column: 2 or more between the handle and the first column, and the last column and the handle.
      expect(start - WAVE_HANDLE).toBeGreaterThanOrEqual(2);
      expect(handleAt(1, width) - end).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(start)).toBe(true);
      // A finger on the handle's middle keeps it there; past the ends it holds there.
      expect(waveAt(handleAt(0.5, width) + WAVE_HANDLE / 2, width)).toBeCloseTo(0.5, 9);
      expect([waveAt(0, width), waveAt(WAVE_HANDLE / 2, width)]).toEqual([0, 0]);
      expect([waveAt(width - WAVE_HANDLE / 2, width), waveAt(width, width)]).toEqual([0.999, 0.999]);
    }
    // The drawing goes through the same numbers: the columns where `playedColumns` puts them, the handle at
    // `handleAt`, the played tones up to its middle.
    const bars = readFileSync(join(import.meta.dir, "../../src/features/voice/VoiceBars.tsx"), "utf8");
    expect(bars).toContain("const spread = tail ? null : playedColumns(width);");
    expect(bars).toContain("handleAt(progress.value, width) + HANDLE / 2");
    expect(bars).toContain("const handleX = useDerivedValue(() => at.value - HANDLE / 2);");
  });
});

describe("voice upload", () => {
  test("a server that took it, can't now, or never will", () => {
    expect(uploadVerdict(202)).toBe("done");
    expect(uploadVerdict(503)).toBe("retry");
    expect(uploadVerdict(422)).toBe("refused");
  });
  test("waits grow and stop growing", () => {
    expect(retryDelayMs(0)).toBeLessThan(retryDelayMs(2));
    expect(retryDelayMs(99)).toBe(30_000);
  });
});

describe("voice messages hold no text", () => {
  const voice = { clipId: "c", durationMs: 1200, peaks: [] };
  test("the normal body is hidden", () => {
    expect(hidesBody({ body: "palavras", meta: { voice } } as never)).toBe(true);
  });
  test("words open only when there are any", () => {
    expect(hasWords({ body: "palavras", meta: { voice } })).toBe(true);
    expect(hasWords({ body: "(sem palavras)", meta: { voice: { ...voice, noWords: true } } })).toBe(false);
    expect(hasWords({ body: "", meta: { voice }, local: "pending" })).toBe(false);
  });
});

describe("a voice note with typed text and files (sent before dictation, or from the web)", () => {
  const voice = { clipId: "c", durationMs: 1200, peaks: [] };
  const typed = "Veja a captura, por favor.";
  const sent = { body: `${typed}\n\nOlá Atlas, revise o painel.`, meta: { voice: { ...voice, text: typed } } };
  const src = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");

  test("the typed part is the row's text; the player opens only the words said", () => {
    expect(hidesBody(sent as never)).toBe(false);
    expect(spokenWords(sent)).toBe("Olá Atlas, revise o painel.");
    expect(spokenWords({ body: typed, meta: sent.meta })).toBeNull();
    expect(hasWords({ body: typed, meta: sent.meta })).toBe(false);
    // From before typed text could go with a take: all of it is words.
    expect(spokenWords({ body: "palavras", meta: { voice } })).toBe("palavras");
  });

  const item = {
    clientId: "k1",
    orgId: "o",
    channelId: "ch",
    threadId: null,
    replyTo: null,
    authorId: "u1",
    file: "k1.m4a",
    durationMs: 1200,
    peaks: [0.5],
    language: "pt",
    createdAt: "2026-11-15T10:00:00.000Z",
  };
  const files = [
    { id: "a1", version: 1, title: "captura.png" },
    { id: "a2", version: 1, title: "relatorio.pdf" },
  ];

  test("the upload carries the text and the files' ids, and nothing new when there are none", () => {
    const fields = Object.fromEntries(voiceFields({ ...item, text: typed, artifacts: files }));
    expect(fields.text).toBe(typed);
    expect(JSON.parse(fields.attachments ?? "")).toEqual(["a1", "a2"]);
    const plain = Object.fromEntries(voiceFields({ ...item, text: "  " }));
    expect(plain).toEqual({ durationMs: "1200", peaks: "[0.5]", clientId: "k1", language: "pt" });
  });

  test("the bubble until the server answers shows the typed text, the take and the files", () => {
    const local = localVoiceMessage({ ...item, text: typed, artifacts: files });
    expect(local.body).toBe(typed);
    expect(local.meta?.voice).toMatchObject({ clipId: "local:k1", text: typed });
    expect(local.meta?.artifacts).toEqual(files);
    expect(hidesBody(local)).toBe(false);
    expect(localVoiceMessage(item).body).toBe("");
    expect(localVoiceMessage(item).meta?.artifacts).toBeUndefined();
  });

  test("the sent message: the typed words above the player, the words said alone in it; lists show the typed part", () => {
    const row = src("features/chat/MessageRow.tsx");
    expect(row).toContain("serverBody(t, listedText(m.body, meta), meta, i18n.language, names)");
    expect(row).toMatch(/\{lead\}\s*\{body \? player : null\}/);
    expect(src("features/voice/VoiceMessage.tsx")).toContain(
      "const words = useMemo(() => spokenWords(message), [message]);",
    );
    expect(src("features/chat/sheets.tsx")).toContain("const text = previewOf(listedText(m.body, m.meta));");
  });
});

describe("dictation", () => {
  const src = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");

  test("the words go in at the caret, a space where they touch a word", () => {
    expect(spliceWords("", 0, "oi Ada")).toEqual({ text: "oi Ada", caret: 6 });
    expect(spliceWords("Bom dia", 7, "tudo bem?")).toEqual({ text: "Bom dia tudo bem?", caret: 17 });
    expect(spliceWords("Bom dia ", 8, "Ada")).toEqual({ text: "Bom dia Ada", caret: 11 });
    expect(spliceWords("olá mundo", 3, "querido")).toEqual({ text: "olá querido mundo", caret: 11 });
    expect(spliceWords("a\n", 2, "b")).toEqual({ text: "a\nb", caret: 3 });
  });

  test("one tap records, the same button stops, the × throws it away; nothing is held or dragged", () => {
    const d = src("features/voice/useDictation.tsx");
    expect(d).toContain('onPress={caught("dictation.press", () => void (recording ? stop() : start()))}');
    expect(d).toContain("onPress={() => void cancel()}");
    expect(d).not.toMatch(/Gesture|onLongPress|activateAfterLongPress/);
    // A tap while the recorder starts ends it as soon as it records, never leaving it on.
    expect(d).toMatch(/if \(starting\.current\) \{\s*ending\.current = "stop";/);
    expect(d).toMatch(
      /if \(ending\.current === "cancel"\) await cancel\(\);\s*else if \(ending\.current === "stop"\) await stop\(\);/,
    );
    // The words come from the server's engine and go into the field; the file never stays.
    expect(d).toContain("/voice/dictate`");
    expect(d).toMatch(/if \(body\.text\.trim\(\)\) put\(body\.text\.trim\(\)\);/);
    expect(d).toMatch(/finally \{\s*removeFile\(uri\);\s*reset\(\);/);
  });

  test("the field puts the words at the caret and steps its buttons aside while dictating", () => {
    const composer = src("ui/Composer.tsx");
    expect(composer).toContain("const next = spliceWords(text, at, words);");
    expect(composer).toContain("const button = (has || stopMode) && !dictating;");
    expect(composer).toContain("const mediaButton = media && !has && !dictating ? media : null;");
    // The microphone is there with words too, before the send.
    expect(composer.indexOf("{mic ? <View style={styles.micBox}>{mic}</View> : null}")).toBeLessThan(
      composer.indexOf("<SendButton"),
    );
    const screen = src("features/chat/ChatScreen.tsx");
    expect(screen).toContain("const onWords = useCallback((text: string) => setInsert({ text, at: Date.now() }), []);");
    expect(screen).toContain("<Composer {...composer} dictation={dictation} insert={insert} />");
  });
});

test("a tap that throws never closes the app: send and the microphone stop it (expo/expo#51880)", () => {
  const read = (path: string) => readFileSync(join(import.meta.dir, "../../src", path), "utf8");
  expect(read("ui/Composer.tsx")).toMatch(
    /try \{\s*onSend\(value[\s\S]*?showCaught\("composer\.send", error\);\s*return;/,
  );
  const d = read("features/voice/useDictation.tsx");
  expect(d).toMatch(/try \{\s*tickNow\(\);\s*\} catch \(error\) \{\s*stopTimer\(\);\s*showCaught\("dictation\.tick"/);
});
