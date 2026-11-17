import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { featureKeysEn } from "../../src/features/i18n/keys.en";
import { featureKeysPtBR } from "../../src/features/i18n/keys.pt-BR";

// A personal workspace on the phone (ADR 0159): the same screens and data, only what is in sight and its words change.
const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("the tabs of a personal workspace", () => {
  test("Threads are never a place of their own: their old addresses land on Tarefas (ADR doug-0018)", () => {
    const tabs = read("app/(app)/(tabs)/_layout.tsx");
    expect(tabs).not.toContain('name: "threads"');
    const route = read("app/(app)/conversations/[kind].tsx");
    expect(route).toContain('return <Redirect href={kind === "threads" ? "/issues" : "/"} />;');
    expect(read("app/(app)/threads.tsx")).toContain('<Redirect href="/issues" />');
    expect(read("src/features/issues/MissionsScreen.tsx")).toContain("<PushedLargeTitle");
    const me = read("src/features/me/MeScreen.tsx");
    expect(me).not.toContain('open("/conversations/threads")');
  });

  test("the bar holds DougBot's signature alone: no workspace mark, no photo, no '+' (doug-0014)", () => {
    const header = read("src/features/shared/tabHeader.tsx");
    expect(header).toContain("return { actions: [], brand: true };");
    expect(header).not.toContain("OrgAvatar");
  });
});

describe("Conversas in a personal workspace", () => {
  test("channels are group conversations, and a quiet #general stays out while the person is alone", () => {
    const chats = read("src/features/chats/ChatsScreen.tsx");
    expect(chats).toContain("homeLayout(withoutQuietGeneral(rows, hideGeneral)");
    expect(chats).toContain('t("shell.channelsPersonal")');
    expect(chats).toContain("isPersonal(org) && ![...memberById.keys()].some((id) => id !== meId)");
    const list = read("src/features/chats/ConversationListScreen.tsx");
    expect(list).toContain("withoutQuietGeneral(withRightHand(list.rows, rightHandOf(dir.agents)), hideGeneral)");
    expect(list).toContain('kind === "channels" && personal');
  });
});

describe("You in a personal workspace", () => {
  const me = read("src/features/me/MeScreen.tsx");

  test("no workspace name after the handle, and its own words under the workspace", () => {
    expect(me).toContain("personal ? null : org.org?.name]");
    expect(me).toContain("t(modeKey(org.org, `mobile.me.role.");
    expect(me).toContain("<WorkspaceMark org={org.org} size={36} />");
  });

  test("Work leads with Routines and Drive and ends with Team; a team's keeps its order", () => {
    const list = (name: string) => {
      const from = me.indexOf(`const ${name}: WorkRow[] = [`);
      return me
        .slice(from, me.indexOf("];", from))
        .match(/"(\w+)"/g)
        ?.map((k) => k.replaceAll('"', ""));
    };
    expect(list("PERSONAL_WORK")).toEqual([
      "routines",
      "drive",
      "issues",
      "proposals",
      "wiki",
      "dashboards",
      "memory",
      "team",
    ]);
    expect(list("TEAM_WORK")).toEqual(["issues", "proposals", "routines", "wiki", "drive", "dashboards", "memory"]);
    expect(me).toContain('onPress={() => open("/team")}');
  });

  test("a personal workspace in the lists wears your face and says whose it is", () => {
    const pages = read("src/features/me/WorkspacesPages.tsx");
    expect(pages).toContain('if (isPersonal(org) && org.role === "owner")');
    // From the place it is listed under: a server, or one of its accounts (ADR 0183).
    expect(pages).toContain("<WorkspaceMark org={o} server={g.place} />");
    expect(pages).toContain("label={mine(o) && !several && face.name ? face.name : o.name}");
    expect(pages).toContain("sub={notes.get(o.id) ?? t(modeKey(o, `mobile.me.role.");
    for (const tree of [featureKeysEn, featureKeysPtBR]) {
      expect(typeof tree.me.role.ownerPersonal).toBe("string");
      expect(typeof tree.me.role.memberPersonal).toBe("string");
    }
  });
});
