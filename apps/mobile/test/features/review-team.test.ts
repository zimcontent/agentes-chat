import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reviewWords } from "@agenteschat/client";
import { changesHintOf, sendsNext } from "../../src/features/review/logic";
import {
  checkWork,
  filterRow,
  firstName,
  MAX_WORK_BYTES,
  pickedFile,
  pickInRow,
  type RowState,
  sendableGroups,
  sendableTasks,
  workReady,
} from "../../src/features/review/team-logic";

const src = (path: string) => readFileSync(join(import.meta.dir, "../..", path), "utf8");
const words = { everyone: "Toda a equipe", video: "Vídeos", design: "Peças", open: "Para revisar", all: "Todos" };
const state: RowState = { person: null, medium: "all", status: "open" };
const w = reviewWords("pt-BR");

describe("Revisão's row of filters under the who-tabs (doug-0015)", () => {
  const people = [
    { id: "u1", name: "Rony Souza", waiting: 2 },
    { id: "u2", name: "Ana", waiting: 0 },
  ];

  test("Equipe: Todos, then each person by first name with what waits; then open or all", () => {
    const row = filterRow({ who: "team", people, mixed: false, open: 2, ...state }, words);
    expect(row.items).toEqual([
      { key: "person:all", label: "Toda a equipe" },
      { key: "person:u1", label: "Rony", count: 2 },
      { key: "person:u2", label: "Ana" },
      { key: "status:open", label: "Para revisar", count: 2, divider: true },
      { key: "status:all", label: "Todos" },
    ]);
    expect(row.value).toEqual(["person:all", "status:open"]);
  });

  test("Vídeos and Peças only where the tab holds both; none chosen is both", () => {
    const row = filterRow({ who: "agents", people, mixed: true, open: 0, ...state, status: "all" }, words);
    expect(row.items.map((i) => i.key)).toEqual(["medium:video", "medium:design", "status:open", "status:all"]);
    expect(row.items[0]?.divider).toBe(false);
    expect(row.value).toEqual(["status:all"]);
    const pieces = filterRow({ who: "agents", people, mixed: true, open: 0, ...state, medium: "design" }, words);
    expect(pieces.value).toEqual(["medium:design", "status:open"]);
  });

  test("a person who left the list reads as everyone", () => {
    const row = filterRow({ who: "team", people, mixed: false, open: 0, ...state, person: "gone" }, words);
    expect(row.value[0]).toBe("person:all");
  });

  test("a tap changes its own group; a kind tapped again goes back to both", () => {
    expect(pickInRow(state, "person:u1")).toEqual({ ...state, person: "u1" });
    expect(pickInRow({ ...state, person: "u1" }, "person:all")).toEqual(state);
    const videos = pickInRow(state, "medium:video");
    expect(videos.medium).toBe("video");
    expect(pickInRow(videos, "medium:video").medium).toBe("all");
    expect(pickInRow(state, "status:all").status).toBe("all");
    expect(pickInRow(state, "nonsense")).toEqual(state);
  });

  test("first names", () => {
    expect(firstName("  Rony  Souza ")).toBe("Rony");
    expect(firstName("Ana")).toBe("Ana");
  });
});

describe("Mandar para revisão on the phone", () => {
  test("the copy's own ending names the file: a HEIC photo handed over as a JPEG goes as .jpg", () => {
    expect(
      pickedFile({ uri: "file:///cache/ABC.jpg", fileName: "IMG_0001.HEIC", mimeType: "image/jpeg" }, "slide-1"),
    ).toEqual({ uri: "file:///cache/ABC.jpg", name: "IMG_0001.jpg", type: "image/jpeg", size: null });
    expect(pickedFile({ uri: "file:///cache/XYZ.MOV", fileName: null, fileSize: 10 }, "video")).toEqual({
      uri: "file:///cache/XYZ.MOV",
      name: "XYZ.mov",
      type: "video/quicktime",
      size: 10,
    });
    expect(pickedFile({ uri: "content://media/42", mimeType: "video/mp4" }, "video").name).toBe("42.mp4");
  });

  const file = (name: string, size: number | null = 1) => ({ uri: `file:///${name}`, name, type: "", size });

  test("kinds, counts and sizes are checked before anything uploads", () => {
    expect(checkWork("video", [file("cut.mp4")], w.team)).toBeNull();
    expect(checkWork("video", [file("cut.avi")], w.team)).toBe(w.team.notVideo);
    expect(checkWork("design", [file("1.png"), file("2.JPG"), file("3.webp")], w.team)).toBeNull();
    expect(checkWork("design", [file("1.png"), file("2.heic")], w.team)).toBe(w.team.notPicture("2.heic"));
    expect(
      checkWork(
        "design",
        Array.from({ length: 61 }, (_, i) => file(`${i}.png`)),
        w.team,
      ),
    ).toBe(w.team.tooMany);
    expect(checkWork("video", [file("big.mov", MAX_WORK_BYTES + 1)], w.team)).toBe(w.team.tooBig("big.mov"));
  });

  test("ready: files, a place, and a title unless it goes to a task or is a next version", () => {
    const base = { files: 1, next: false, title: "Reels", where: "group" as const, place: "c1" };
    expect(workReady(base)).toBe(true);
    expect(workReady({ ...base, files: 0 })).toBe(false);
    expect(workReady({ ...base, place: null })).toBe(false);
    expect(workReady({ ...base, title: " " })).toBe(false);
    expect(workReady({ ...base, title: "", where: "task", place: "i1" })).toBe(true);
    expect(workReady({ ...base, title: "", next: true, place: null })).toBe(true);
  });

  test("groups I'm in and may write in, open tasks", () => {
    const groups = [
      { id: "a", isMember: true },
      { id: "b", isMember: false },
      { id: "c", isMember: true, seenAsAdmin: true },
      { id: "d", isMember: true, can: { post: false } },
    ];
    expect(sendableGroups(groups).map((g) => g.id)).toEqual(["a"]);
    const tasks = [
      { id: "1", status: "todo" },
      { id: "2", status: "done" },
      { id: "3", status: "canceled" },
      { id: "4", status: "in_review" },
    ];
    expect(sendableTasks(tasks).map((x) => x.id)).toEqual(["1", "4"]);
  });

  test("only who sent it sends the next version, until it is approved", () => {
    const mine = { sender: { id: "me" }, status: "changes" as const };
    expect(sendsNext(mine, "me")).toBe(true);
    expect(sendsNext({ ...mine, status: "in_review" }, "me")).toBe(true);
    expect(sendsNext({ ...mine, status: "approved" }, "me")).toBe(false);
    expect(sendsNext(mine, "other")).toBe(false);
    expect(sendsNext({ sender: null, status: "changes" }, "me")).toBe(false);
    expect(sendsNext(mine, null)).toBe(false);
  });

  test("the decider is told where the notes go: the agent, a task's editor, or the person here", () => {
    expect(changesHintOf({ sender: null }, w)).toBe(w.changesHint);
    expect(changesHintOf({ sender: { name: "Rony" }, taskId: "t1" }, w)).toBe(w.editor.changesHint("Rony"));
    expect(changesHintOf({ sender: { name: "Rony" }, taskId: null }, w)).toBe(w.team.changesHint("Rony"));
  });

  test("wiring: the route, its pushed form, the row of groups, uploads with progress", () => {
    expect(src("app/(app)/_layout.tsx")).toContain(
      '<Stack.Screen name="review/send" options={{ ...pushed, ...scrollUnder }} />',
    );
    const screen = src("src/features/review/ReviewsScreen.tsx");
    expect(screen).toContain("reviewTabsByWho(everything, meId)");
    expect(screen).toContain("firstTab(tabs)");
    expect(screen).toContain("value={filters.value}");
    const form = src("src/features/review/SendWorkScreen.tsx");
    expect(form).toContain("onProgress: (sent) =>");
    expect(form).toContain("api.issues.conversation(orgId, taskId)");
    expect(form).toContain("reviewId: next.id");
    expect(form).toContain("router.replace(`/review/");
    expect(form).toContain("sent.review.id");
    for (const file of ["ReviewScreen.tsx", "DesignReview.tsx"])
      expect(src(`src/features/review/${file}`)).toContain("<SendNext review={review} />");
    expect(src("src/features/review/Decision.tsx")).toContain("changesHintOf(review, w)");
  });
});
