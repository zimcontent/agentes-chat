import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@dougbot/ui/testing/dom";

setupDom();

import type { TaskQueueMove, TeamAgenda, TeamAgendaTask } from "@dougbot/client";
import { localDay } from "@dougbot/client/lib/team-agenda";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const day = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDay(d);
};

const task = (
  number: number,
  title: string,
  who: string,
  over: Partial<TeamAgendaTask> = {},
  type: "person" | "agent" = "person",
): TeamAgendaTask => ({
  id: `t-${number}`,
  number,
  title,
  status: "todo",
  priority: "normal",
  dueDate: null,
  assignee: { type, id: who },
  project: null,
  blocked: false,
  ...over,
});

/** João is the editor: Leticia's video reached him before Fontes', so it leads, whatever the dates. */
function agendaApi() {
  const state = seedState();
  const api = createFakeApi(state);
  let tasks: TeamAgendaTask[] = [
    task(12, "Vídeo da Leticia: corte de 60 s para os Reels", "u-joao", {
      dueDate: day(2),
      project: { name: "Leticia", color: "green" },
    }),
    task(14, "Vídeo da Fontes", "u-joao", {
      dueDate: day(0),
      priority: "high",
      project: { name: "Fontes", color: "blue" },
    }),
    task(9, "Legendas do episódio 4 com o nome muito comprido do convidado especial da semana", "u-joao", {
      dueDate: day(-2),
      status: "todo",
    }),
    task(15, "Thumb da Leticia", "u-joao", { status: "in_progress", dueDate: day(1), blocked: true }),
    task(16, "Revisar roteiro", "u-joao"),
    task(20, "Agenda de posts", "u-walter", { dueDate: day(3) }),
    task(30, "Relatório da semana", ADA_ID, { status: "in_review", dueDate: day(0) }, "agent"),
  ];
  const moves: TaskQueueMove[] = [];
  api.issues.agenda = async (_orgId, query) => ({ from: query.from, to: day(6), tasks }) satisfies TeamAgenda;
  api.issues.moveInQueue = async (_orgId, move) => {
    moves.push(move);
    const lane = tasks.filter((t) => t.assignee.id === move.assignee.id);
    const moving = lane.find((t) => t.id === move.taskId) as TeamAgendaTask;
    const rest = lane.filter((t) => t.id !== move.taskId);
    rest.splice(move.afterId ? rest.findIndex((t) => t.id === move.afterId) + 1 : 0, 0, moving);
    let k = 0;
    tasks = tasks.map((t) => (t.assignee.id === move.assignee.id ? (rest[k++] as TeamAgendaTask) : t));
    return { order: rest.map((t) => t.id) };
  };
  return { api, moves };
}

const lane = (name: string) => screen().getByRole("list", { name: `Fila de ${name}` });
const titles = (name: string) =>
  within(lane(name))
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".home-tasks__title")?.textContent);

describe("team agenda: each one's queue", () => {
  test("a lane is the queue in arrival order, dates as chips, late ones marked", async () => {
    const { api } = agendaApi();
    await renderApp(`/org/${ORG_ID}/home`, { api });
    await settle(4);
    expect(titles("João")).toEqual([
      "Vídeo da Leticia: corte de 60 s para os Reels",
      "Vídeo da Fontes",
      "Legendas do episódio 4 com o nome muito comprido do convidado especial da semana",
      "Thumb da Leticia",
      "Revisar roteiro",
    ]);
    const rows = within(lane("João")).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("Entrega");
    expect(rows[2]?.querySelector(".ac-chip--waiting")?.textContent).toContain("Era para");
    expect(rows[3]?.textContent).toContain("Em andamento");
    expect(rows[3]?.textContent).toContain("Travada");
    expect(screen().getByRole("list", { name: "Fila de Ada" })).toBeTruthy();
  });

  test("the handle's arrow keys move a task one place, at once and on the server", async () => {
    const { api, moves } = agendaApi();
    await renderApp(`/org/${ORG_ID}/home`, { api });
    await settle(4);
    const handle = within(lane("João")).getByRole("button", { name: /Mover a tarefa #14 na fila/ });
    await act(async () => fireEvent.keyDown(handle, { key: "ArrowUp" }));
    await settle(2);
    expect(moves).toEqual([{ assignee: { type: "person", id: "u-joao" }, taskId: "t-14", afterId: null }]);
    expect(titles("João").slice(0, 2)).toEqual(["Vídeo da Fontes", "Vídeo da Leticia: corte de 60 s para os Reels"]);
    expect(document.querySelector(".team-agenda [aria-live]")?.textContent).toBe("A tarefa #14 agora está em 1 de 5.");

    const last = within(lane("João")).getByRole("button", { name: /Mover a tarefa #9 na fila/ });
    await act(async () => fireEvent.keyDown(last, { key: "ArrowDown" }));
    await settle(2);
    expect(moves.at(-1)).toMatchObject({ taskId: "t-9", afterId: "t-15" });
    // The top can't go higher: nothing is sent.
    const top = within(lane("João")).getByRole("button", { name: /Mover a tarefa #14 na fila/ });
    await act(async () => fireEvent.keyDown(top, { key: "ArrowUp" }));
    expect(moves).toHaveLength(2);
  });

  test("a picked day keeps the queue's order among that day's tasks", async () => {
    const { api, moves } = agendaApi();
    await renderApp(`/org/${ORG_ID}/home`, { api });
    await settle(4);
    await act(async () => fireEvent.click(screen().getByRole("radio", { name: /^Hoje/ })));
    await settle(2);
    // Today: what is under way, late and due today, in queue order.
    expect(titles("João")).toEqual([
      "Vídeo da Fontes",
      "Legendas do episódio 4 com o nome muito comprido do convidado especial da semana",
      "Thumb da Leticia",
    ]);
    // To the top of what shows: right after what the queue has before it, never past Leticia's video.
    const handle = within(lane("João")).getByRole("button", { name: /Mover a tarefa #9 na fila/ });
    await act(async () => fireEvent.keyDown(handle, { key: "ArrowUp" }));
    expect(moves.at(-1)).toMatchObject({ taskId: "t-9", afterId: "t-12" });
  });
});
