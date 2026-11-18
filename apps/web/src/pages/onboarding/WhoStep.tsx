import type { DougTemplateMember } from "@agenteschat/client";
import { dougCounts, dougHandles, dougOrder, isRightHandMember, qgOf } from "@agenteschat/client/lib/doug-team";
import { Button, Checkbox, Chip, Icon, Locked } from "@agenteschat/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import "./who-step.css";

/**
 * "Quem entra no seu time?" (docs/adr/doug-0020-time-doug.md): the Doug team's agents, every one checked, the right
 * hand's fixed (it is already here, it only takes its role) and the QG de Tráfego's team opening under its MARK, each
 * one uncheckable. Beside the list, what the checked ones bring and "Criar o time"; a row whose agent only works on a
 * computer says so and offers to connect one.
 */
export function WhoStep({
  members,
  pending,
  failed,
  needsComputer,
  onConnectComputer,
  onCreate,
}: {
  members: readonly DougTemplateMember[];
  /** The team being made: the list and its button wait. */
  pending: boolean;
  /** The card's failed step, said in place; the same button tries again. */
  failed: string | null;
  /** The agents made that only work on a computer (the answer's, once made). */
  needsComputer: readonly { agentId: string; handle: string; name: string }[];
  /** Opens the app's own computer flow. */
  onConnectComputer: () => void;
  /** "Criar o time": the checked handles, in the template's order. */
  onCreate: (handles: string[]) => void;
}) {
  const { t } = useTranslation();
  // The right hand is never off: only the others' unchecked handles live here.
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  const lead = members.find(isRightHandMember) ?? null;
  const rows = dougOrder(members).filter((m) => !m.rightHand);
  // A QG's team, drawn under its lead and never again below.
  const teamOf = (m: DougTemplateMember) => rows.filter((r) => r.reportsTo === m.handle);
  const under = new Set(rows.flatMap((m) => teamOf(m).map((r) => r.handle)));
  const counts = dougCounts(members, off);
  const toggle = (handle: string, on: boolean) =>
    setOff((was) => {
      const next = new Set(was);
      if (on) next.delete(handle);
      else next.add(handle);
      return next;
    });
  return (
    <>
      <Locked when={pending}>
        <div className="onb__answer onb-who">
          <ul className="onb-who__list" aria-label={t("onboarding.flow.who.title")}>
            {lead && (
              <li>
                <WhoRow
                  member={lead}
                  checked
                  fixed
                  needsComputer={needsComputer}
                  onConnectComputer={onConnectComputer}
                />
              </li>
            )}
            {rows
              .filter((m) => !under.has(m.handle))
              .map((m) => (
                <li key={m.handle} className="onb-who__group">
                  <WhoRow
                    member={m}
                    checked={!off.has(m.handle)}
                    onToggle={(on) => toggle(m.handle, on)}
                    needsComputer={needsComputer}
                    onConnectComputer={onConnectComputer}
                  />
                  {teamOf(m).length > 0 && (
                    <ul
                      className="onb-who__team"
                      aria-label={t("onboarding.flow.who.teamOf", { count: teamOf(m).length })}
                    >
                      {teamOf(m).map((r) => (
                        <li key={r.handle}>
                          <WhoRow
                            member={r}
                            small
                            checked={!off.has(r.handle)}
                            onToggle={(on) => toggle(r.handle, on)}
                            needsComputer={needsComputer}
                            onConnectComputer={onConnectComputer}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
          </ul>
          <aside className="onb-who__side">
            <dl className="onb-who__counts">
              <div>
                <dd>{counts.agents}</dd>
                <dt>{t("onboarding.flow.who.agents", { count: counts.agents })}</dt>
              </div>
              <div>
                <dd>{counts.skills}</dd>
                <dt>{t("onboarding.flow.who.skills", { count: counts.skills })}</dt>
              </div>
              <div>
                <dd>{counts.routines}</dd>
                <dt>{t("onboarding.flow.who.routines", { count: counts.routines })}</dt>
              </div>
            </dl>
            <p className="onb-who__note ac-iconline">
              <Icon name="lock" size={14} />
              <span>{t("onboarding.flow.who.note")}</span>
            </p>
          </aside>
        </div>
      </Locked>
      <div className="onb__actions">
        {failed && (
          <p className="onb__error" role="alert">
            {failed}
          </p>
        )}
        <Button
          variant="primary"
          block
          kbd={["↵"]}
          data-enter=""
          disabled={pending || counts.agents === 0}
          loading={pending}
          onClick={() => onCreate(dougHandles(members, off))}
        >
          {t("onboarding.flow.who.create")}
        </Button>
      </div>
    </>
  );
}

/**
 * One agent's row: its box (the whole row presses), its face, its name and role, its skills' count, the QG it works
 * in, the "needs a computer" notice and its Connect, and, on the right hand, "Stays" in place of a box.
 */
function WhoRow({
  member,
  checked,
  fixed,
  small,
  onToggle,
  needsComputer,
  onConnectComputer,
}: {
  member: DougTemplateMember;
  checked: boolean;
  /** The right hand: no box, it never leaves. */
  fixed?: boolean;
  /** A row under its QG's lead: a smaller face, one line, no skills' chip. */
  small?: boolean;
  onToggle?: (checked: boolean) => void;
  needsComputer: readonly { agentId: string; handle: string; name: string }[];
  onConnectComputer: () => void;
}) {
  const { t } = useTranslation();
  // The template says it works on a computer; the answer, once the team is made, names the agent it became.
  const needsOne = member.needsComputer || needsComputer.some((c) => c.handle === member.handle);
  const qg = qgOf(member);
  const id = `onb-who-${member.handle}`;
  const inner = (
    <>
      {!fixed && <Checkbox id={id} checked={checked} onCheckedChange={(on) => onToggle?.(on)} />}
      <AgentAvatar
        name={member.name}
        agent={{ name: member.name, handle: member.handle, role: member.role }}
        size={small ? "sm" : "md"}
        labelled
      />
      <span className="onb-who__text">
        <span className="onb-who__name">
          <b>{member.name}</b>
          {qg && !small && (
            <span className="onb-who__qg">{t("onboarding.flow.who.qg", { channel: `#${member.channel}` })}</span>
          )}
        </span>
        <span className="onb-who__role">{member.role}</span>
      </span>
      {needsOne ? (
        <span className="onb-who__needs">
          <span className="ac-iconline">
            <Icon name="computer" size={14} />
            <span>{t("onboarding.flow.who.needsComputer")}</span>
          </span>
          <Button size="sm" onClick={onConnectComputer}>
            {t("onboarding.flow.who.connectComputer")}
          </Button>
        </span>
      ) : (
        !small && member.skills > 0 && <Chip>{t("onboarding.flow.who.skills", { count: member.skills })}</Chip>
      )}
      {fixed && <span className="onb-who__fixed">{t("onboarding.flow.who.fixed")}</span>}
    </>
  );
  if (small || fixed || !onToggle)
    return (
      <span className="onb-who__row" data-small={small ? "" : undefined} data-fixed={fixed ? "" : undefined}>
        {inner}
      </span>
    );
  return (
    <label htmlFor={id} className="onb-who__row">
      {inner}
    </label>
  );
}
