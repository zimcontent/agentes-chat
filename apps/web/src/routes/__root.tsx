import { instanceQuery, meQuery, useApi, useClientLook, useMe } from "@agenteschat/client";
import { Button, EmptyState, setClientProductName } from "@agenteschat/ui";
import { useQuery } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { RouterContext } from "@/app/router-context";
import { ContextMenuHost } from "@/components/DesktopMenus";
import { DesktopDragStrip } from "@/components/DesktopTitleBar";
import { ErrorScreen } from "@/components/ErrorScreen";
import { AccountDeletingScreen } from "@/components/Standing";
import { useBackCloses } from "@/hooks/useBackCloses";
import { switchAccount } from "@/lib/accounts";
import { askForPhone, asksForPhone, inDesktopApp, pageReadyAfterPaint, routeNewWindowLinks } from "@/lib/desktop";
import { dispatchPushOpen } from "@/lib/push-open";
import { listenForPushOpens } from "@/lib/web-push";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
  notFoundComponent: NotFound,
  errorComponent: ErrorScreen,
});

function Root() {
  // agentes for Mac: the workspace has its title bar (org.$orgId.tsx); every other page drags from the top.
  const inWorkspace = useRouterState({ select: (s) => s.location.pathname.startsWith("/org/") });
  const router = useRouter();
  const me = useMe().data;
  const deletion = me?.user.deletion;
  const api = useApi();
  const myId = me?.user.id ?? null;
  useBackCloses();
  // In the app: once this first screen is on the glass, the app's cover over the window goes.
  useEffect(pageReadyAfterPaint, []);
  // In the app: a link to another site opens in the browser, one to this server in the window (main_window.rs).
  useEffect(() => (inDesktopApp() ? routeNewWindowLinks() : undefined), []);
  // The app opens a page of the site that is already open (the tray, a notification, ⌘-click) without
  // loading it again: the route moves (main_window.rs). Downloads and the API go as a plain load.
  useEffect(() => {
    if (!inDesktopApp()) return;
    const w = window as { __agentesNavigate?: (path: string) => void };
    w.__agentesNavigate = (path) => {
      if (!path.startsWith("/") || path.startsWith("//")) return;
      // "Show QR code" in the app: the dialog over the page the person is on.
      if (asksForPhone(new URL(path, window.location.origin).search)) askForPhone();
      else if (path.startsWith("/api/")) window.location.assign(path);
      else router.history.push(path);
    };
    return () => {
      delete w.__agentesNavigate;
    };
  }, [router]);
  // A click on a browser notification while the app is open in a tab (ADR 0071): the open workspace opens it
  // where its inbox would (`PushOpens`); on any other page the tab moves to its address.
  // One for another account signed in on this browser (ADR 0183): the browser moves to it, then opens it.
  useEffect(
    () =>
      listenForPushOpens((click) => {
        const theirs = click.data?.user;
        if (theirs && myId && theirs !== myId) return void switchAccount(api, theirs, click.path).catch(() => {});
        dispatchPushOpen(click, (path) => router.history.push(path));
      }),
    [router, api, myId],
  );
  return (
    <>
      <ClientBrand />
      {inDesktopApp() && !inWorkspace && <DesktopDragStrip />}
      <ContextMenuHost />
      {deletion ? <AccountDeletingScreen dueAt={deletion.dueAt} /> : <Outlet />}
    </>
  );
}

/**
 * This server's client customizations (ADR doug-0023), applied once they arrive: the product's name everywhere the app
 * signs it (the signature, the tab's title, the strings it builds from then on: `setClientProductName`) and the
 * highlight's color on the app's own `--db-verde-acento`-fed tokens. A server with no client draws nothing and changes
 * nothing. Draws nothing at all: a side effect, kept in a component so it re-runs when `me` or the instance change.
 */
function ClientBrand() {
  const { t } = useTranslation();
  const api = useApi();
  const client = useClientLook();
  // Both answers decide the look, and both start out empty: until they are here, a null name or color means "not
  // read yet", not "none", and clearing the name the boot already set (main.tsx) would flash the build's own on the
  // signature. The color set on `<html>` is the boot's too, so a cleared one also waits for the answers.
  const instance = useQuery(instanceQuery(api));
  const me = useQuery(meQuery(api));
  const known = instance.isSuccess || me.isSuccess;
  useEffect(() => {
    if (!known) return;
    setClientProductName(client.name);
    const root = document.documentElement;
    // The variable paints the highlight; the attribute lets it reach a part of the page that themes itself
    // (doug.css), and is absent on a server with no client, which keeps the identity's green everywhere.
    if (client.accent) {
      root.style.setProperty("--client-accent", client.accent);
      root.dataset.clientAccent = "";
    } else {
      root.style.removeProperty("--client-accent");
      delete root.dataset.clientAccent;
    }
    // The tab's title was built before the name arrived (index.html's, English): a client's server rebuilds it in the
    // language in use. A server with no client writes nothing: its title is the build's own, already the one
    // `index.html` and `translateTabTitle` set, and writing it here would be a second pass that could put the name's
    // own words over a page's. `t` already gives it under the client's name (the language files are branded when they
    // load), so it is written as it is: `brandText` here would grow a name that holds the build's own.
    if (client.name) document.title = t("app.tabTitle");
  }, [known, client.name, client.accent, t]);
  return null;
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="page page--mid">
      <header className="page__header">
        <h1 className="page-title">{t("empty.notFoundTitle")}</h1>
      </header>
      <EmptyState
        icon="search"
        actions={
          <Button asChild>
            <Link to="/">{t("empty.goHome")}</Link>
          </Button>
        }
      >
        {t("empty.notFoundText")}
      </EmptyState>
    </div>
  );
}
