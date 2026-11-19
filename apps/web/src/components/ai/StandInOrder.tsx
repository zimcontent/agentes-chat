import type { AiAccounts } from "@dougbot/client";
import { keys, useAiAccounts, useApi } from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import { brandOf } from "@dougbot/client/lib/plan-usage";
import { Button, Card, CardHeader, EmptyState, Menu, MenuItem } from "@dougbot/ui";
import { planState } from "@dougbot/ui/plan-state";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import "./stand-in-order.css";

type Account = AiAccounts["accounts"][number];

/**
 * The viewer's backup accounts (ADR doug-0003, addendum 2026-11-14): from 90% of a window the account an agent thinks
 * with gives way to the first of these still under that line, of any brain. Each change saves at once.
 */
export function StandInOrderCard() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const ai = useAiAccounts(org.id);
  const [busy, setBusy] = useState(false);
  const mine = (ai.data?.accounts ?? []).filter((a) => a.mine);
  if (mine.length < 2) return null;
  const order = mine
    .filter((a) => typeof a.standInRank === "number")
    .sort((a, b) => (a.standInRank ?? 0) - (b.standInRank ?? 0));
  const rest = mine.filter((a) => !order.includes(a));

  const save = async (next: Account[]) => {
    setBusy(true);
    try {
      await api.machines.setStandInOrder(
        org.id,
        next.map((a) => a.id),
      );
      toast.show(t("usageViews.standIn.saved"), "success");
      await qc.invalidateQueries({ queryKey: keys.aiAccounts(org.id) });
    } catch (error) {
      toast.show(errorText(t, error), "error");
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...order];
    const [row] = next.splice(i, 1);
    if (!row) return;
    next.splice(i + by, 0, row);
    void save(next);
  };
  const used = (a: Account) => (a.usage ? planState(a.usage).used : null);
  const line = (a: Account) =>
    [brandOf(a), a.computer, used(a) === null ? null : `${used(a)}%`].filter(Boolean).join(" · ");

  return (
    <Card aria-labelledby="sec-stand-in">
      <CardHeader
        id="sec-stand-in"
        icon="repeat"
        title={t("usageViews.standIn.title")}
        hint={{
          name: t("common.about", { label: t("usageViews.standIn.title") }),
          text: t("usageViews.standIn.about"),
        }}
        action={
          rest.length > 0 && (
            <Menu
              label={t("usageViews.standIn.add")}
              trigger={
                <Button size="sm" icon="plus" disabled={busy}>
                  {t("usageViews.standIn.add")}
                </Button>
              }
            >
              {rest.map((a) => (
                <MenuItem key={a.id} onSelect={() => void save([...order, a])}>
                  {`${a.label} · ${brandOf(a)}`}
                </MenuItem>
              ))}
            </Menu>
          )
        }
      />
      {order.length === 0 ? (
        <EmptyState size="inline">{t("usageViews.standIn.empty")}</EmptyState>
      ) : (
        <ol className="stand-in">
          {order.map((a, i) => (
            <li key={a.id} className="stand-in__row">
              <span className="stand-in__rank">{i + 1}</span>
              <span className="stand-in__text">
                <span className="stand-in__name">{a.label}</span>
                <span className="small muted">{line(a)}</span>
              </span>
              <span className="stand-in__acts">
                <Button
                  size="sm"
                  variant="ghost"
                  icon="chevronUp"
                  iconOnly
                  aria-label={t("usageViews.standIn.up", { label: a.label })}
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon="chevronDown"
                  iconOnly
                  aria-label={t("usageViews.standIn.down", { label: a.label })}
                  disabled={busy || i === order.length - 1}
                  onClick={() => move(i, 1)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  icon="close"
                  iconOnly
                  aria-label={t("usageViews.standIn.remove", { label: a.label })}
                  disabled={busy}
                  onClick={() => void save(order.filter((o) => o.id !== a.id))}
                />
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="small muted stand-in__last">{t("usageViews.standIn.last")}</p>
    </Card>
  );
}
