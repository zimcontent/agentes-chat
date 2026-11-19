import type { CarrySource, CarrySourceConnection, ConnectorDef } from "@dougbot/client";
import { useCarry, useCarrySources, useCatalog } from "@dougbot/client";
import { sameServer } from "@dougbot/client/lib/custom-tools";
import { joinNames } from "@dougbot/client/lib/format";
import { providerLabel } from "@dougbot/client/lib/providers";
import {
  Button,
  type ButtonProps,
  Checkbox,
  Chip,
  Dialog,
  DialogBody,
  DialogFooter,
  GroupHeading,
  Locked,
  ProviderLogo,
} from "@dougbot/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { ConnectorIcon } from "@/components/ConnectorCatalog";
import { lookOf } from "@/lib/look";
import { useToast } from "@/lib/toast";
import "./bring-over.css";

/**
 * "Trazer de outro workspace" (ADR 9002): the button, shown only to someone with something to bring from another
 * workspace of theirs, and its dialog. `variant="link"` is the onboarding's, under how the team starts. With `ask`
 * (a workspace being set up) the dialog opens by itself the first time, so the person is asked before they build
 * anything again. Once per workspace and browser: closed, it stays behind its button.
 */
export function BringOver({
  orgId,
  allowed,
  label,
  ask = false,
  ...button
}: { orgId: string; allowed: boolean; label?: string; ask?: boolean } & Pick<
  ButtonProps,
  "variant" | "size" | "icon"
>) {
  const { t } = useTranslation();
  const sources = useCarrySources(orgId, allowed);
  const [open, setOpen] = useState(false);
  // Something that can still come: a workspace whose every item is here already has nothing to ask about.
  const fresh = (sources.data ?? []).some(
    (s) =>
      s.agents.some((a) => !a.here) ||
      s.connections.some((c) => !c.here && !c.blocked) ||
      (s.keys ?? []).some((k) => !k.here),
  );
  useEffect(() => {
    if (!ask || !allowed || !fresh) return;
    const key = `carry-asked:${orgId}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // No storage (private mode): asked once per visit of the step.
    }
    setOpen(true);
  }, [ask, allowed, fresh, orgId]);
  if (!allowed || !sources.data || sources.data.length === 0) return null;
  return (
    <>
      <Button {...button} onClick={() => setOpen(true)}>
        {label ?? t("carry.open")}
      </Button>
      {open && <BringOverDialog orgId={orgId} sources={sources.data} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * What the person picks to bring: each of their other workspaces, its agents (each with its skills and the
 * connections that come with it) and its connections. Picking an agent takes its connections along, so their rows
 * show checked and locked. What is here already, or can't come, says why and can't be picked.
 */
function BringOverDialog({ orgId, sources, onClose }: { orgId: string; sources: CarrySource[]; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const catalog = useCatalog();
  const carry = useCarry(orgId);
  const [agents, setAgents] = useState<ReadonlySet<string>>(new Set());
  const [connections, setConnections] = useState<ReadonlySet<string>>(new Set());
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const toggle = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  // The connections the picked agents take along.
  const along = new Set(
    sources.flatMap((s) => s.agents.filter((a) => agents.has(a.id)).flatMap((a) => a.connectionIds)),
  );
  const count = agents.size + [...connections].filter((id) => !along.has(id)).length + keys.size;
  const defOf = (c: CarrySourceConnection): ConnectorDef | null =>
    catalog.data?.connectors.find((d) =>
      c.connector.startsWith("custom:")
        ? d.kind === "remote_mcp" && sameServer(d.serverUrl, c.serverUrl)
        : d.id === c.connector,
    ) ?? null;
  const bring = () =>
    carry.mutate(
      {
        agentIds: [...agents],
        connectionIds: [...connections],
        ...(keys.size > 0 ? { credentialIds: [...keys] } : {}),
      },
      {
        onSuccess: (out) => {
          const came =
            out.agents.length +
            out.connections.filter((c) => c.outcome === "brought").length +
            (out.keys ?? []).filter((k) => k.outcome === "brought").length;
          if (came > 0) toast.show(t("carry.done", { count: came }));
          if (out.skipped.length > 0) toast.show(t("carry.skipped", { count: out.skipped.length }), "error");
          if (came === 0 && out.skipped.length === 0) toast.show(t("carry.nothingNew"));
          onClose();
        },
        onError: () => toast.show(t("carry.failed"), "error"),
      },
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !carry.isPending && onClose()}
      title={t("carry.open")}
      description={t("carry.text")}
      closeLabel={t("common.close")}
      width={520}
      className="bring-over"
    >
      <Locked when={carry.isPending}>
        <DialogBody className="bring-over__body ac-groups">
          {sources.map((source) => (
            <section key={source.id} className="bring-over__source">
              <GroupHeading title={source.name} level={3} />
              {source.agents.length > 0 && (
                <div className="bring-over__list">
                  <h4 className="ac-eyebrow">{t("permissions.areas.agents")}</h4>
                  {source.agents.map((a) => {
                    const id = `bring-a-${a.id}`;
                    const names = source.connections.filter((c) => a.connectionIds.includes(c.id)).map((c) => c.label);
                    const facts = [
                      a.role,
                      a.skills.length > 0 && t("onboarding.import.report.kinds.skill", { count: a.skills.length }),
                      names.length > 0 && t("carry.with", { names: joinNames(names, t) }),
                    ].filter((x): x is string => Boolean(x));
                    return (
                      <label key={a.id} htmlFor={id} className="scope-row" data-off={a.here ? "" : undefined}>
                        <Checkbox
                          id={id}
                          checked={agents.has(a.id)}
                          disabled={a.here}
                          onCheckedChange={(on) => setAgents(toggle(agents, a.id, on))}
                        />
                        <AgentAvatar name={a.name} appearance={lookOf(a)} size="sm" />
                        <span className="scope-row__text">
                          <span>{a.name}</span>
                          {facts.map((fact) => (
                            <span key={fact} className="small muted">
                              {fact}
                            </span>
                          ))}
                          {a.here && <Chip>{t("carry.here")}</Chip>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {source.connections.length > 0 && (
                <div className="bring-over__list">
                  <h4 className="ac-eyebrow">{t("carry.connections")}</h4>
                  {source.connections.map((c) => {
                    const id = `bring-c-${c.id}`;
                    const off = c.here || c.blocked !== null;
                    const taken = along.has(c.id) && !off;
                    return (
                      <label key={c.id} htmlFor={id} className="scope-row" data-off={off ? "" : undefined}>
                        <Checkbox
                          id={id}
                          checked={taken || connections.has(c.id)}
                          disabled={off || taken}
                          onCheckedChange={(on) => setConnections(toggle(connections, c.id, on))}
                        />
                        <ConnectorIcon def={defOf(c)} label={c.label} image={c.icon} />
                        <span className="scope-row__text">
                          <span>{c.label}</span>
                          {c.accountLabel && <span className="small muted">{c.accountLabel}</span>}
                          {c.here ? (
                            <Chip>{t("carry.here")}</Chip>
                          ) : c.blocked === "needs_reconnect" ? (
                            <Chip tone="waiting">{t("carry.needsReconnect")}</Chip>
                          ) : c.blocked === "github_app" ? (
                            <Chip>{t("carry.githubApp")}</Chip>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {(source.keys ?? []).length > 0 && (
                <div className="bring-over__list">
                  <h4 className="ac-eyebrow">{t("carry.keys")}</h4>
                  {(source.keys ?? []).map((k) => {
                    const id = `bring-k-${k.id}`;
                    return (
                      <label key={k.id} htmlFor={id} className="scope-row" data-off={k.here ? "" : undefined}>
                        <Checkbox
                          id={id}
                          checked={keys.has(k.id)}
                          disabled={k.here}
                          onCheckedChange={(on) => setKeys(toggle(keys, k.id, on))}
                        />
                        <ProviderLogo id={k.provider} size="sm" />
                        <span className="scope-row__text">
                          <span>{k.label}</span>
                          <span className="small muted">{`${providerLabel(k.provider)} · …${k.hint}`}</span>
                          {k.here && <Chip>{t("carry.here")}</Chip>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </DialogBody>
      </Locked>
      <DialogFooter>
        <Button onClick={onClose} disabled={carry.isPending}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" disabled={count === 0} loading={carry.isPending} onClick={bring}>
          {count === 0 ? t("carry.bring") : t("carry.bringCount", { count })}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
