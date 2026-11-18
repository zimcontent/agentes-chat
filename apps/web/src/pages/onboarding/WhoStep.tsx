import type { DougTemplateMember } from "@agenteschat/client";
import { dougCounts, dougHandles, dougOrder, isRightHandMember, qgOf } from "@agenteschat/client/lib/doug-team";
import { Button, Checkbox, Chip, Icon, Locked } from "@agenteschat/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useDevices } from "@/components/devices/queries";
import "./who-step.css";

/**
 * "Quem entra no seu time?" (docs/adr/doug-0020-time-doug.md): the Doug team's agents, every one checked, the right
 * hand's fixed (it is already here, it only takes its role) and the QG de Tráfego's team opening under its MARK, each
 * one uncheckable. Above the list, what the checked ones bring and "Criar o time"; a row whose agent only works on a
 * computer says so and offers to connect one, until the workspace has a computer.
 *
 * The answers live at the page (`off`), so going back to how the team starts and on to here again keeps them.
 */
export function WhoStep({
  orgId,
  members,
  off,
  onOff,
  pending,
  failed,
  needsComputer,
  onConnectComputer,
  onCreate,
}: {
  orgId: string;
  members: readonly DougTemplateMember[];
  /** The handles unchecked (the right hand's never is). */
  off: ReadonlySet<string>;
  onOff: (next: ReadonlySet<string>) => void;
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
  // The workspace's computers: with one connected, an agent that needs one already has somewhere to work.
  const hasComputer = (useDevices(orgId).data?.devices.length ?? 0) > 0;
  const lead = members.find(isRightHandMember) ?? null;
  const rows = dougOrder(members).filter((m) => !m.rightHand);
  // A QG's team, drawn under its lead and never again below.
  const teamOf = (m: DougTemplateMember) => rows.filter((r) => r.reportsTo === m.handle);
  const under = new Set(rows.flatMap((m) => teamOf(m).map((r) => r.handle)));
  const counts = dougCounts(members, off);
  // A QG's MARK is checked while any of its team is: unchecking it unchecks and switches off the whole team, and the
  // team's own boxes stay off until it is checked again.
  const teamOn = (m: DougTemplateMember) => teamOf(m).some((r) => !off.has(r.handle));
  const checkedOf = (m: DougTemplateMember) => (teamOf(m).length > 0 ? teamOn(m) : !off.has(m.handle));
  const toggle = (m: DougTemplateMember, on: boolean) => {
    const next = new Set(off);
    for (const h of [m.handle, ...teamOf(m).map((r) => r.handle)]) {
      if (on) next.delete(h);
      else next.add(h);
    }
    onOff(next);
  };
  const empty = counts.agents === 0;
  return (
    <>
      <Locked when={pending}>
        <div className="onb__answer onb-who">
          {/* What the checked ones bring, above the list: never behind the step's fixed button. */}
          <aside className="onb-who__side">
            <dl className="onb-who__counts">
              <div>
                <dt>{t("onboarding.flow.who.countAgents", { count: counts.agents })}</dt>
                <dd>{counts.agents}</dd>
              </div>
              <div>
                <dt>{t("onboarding.flow.who.countSkills", { count: counts.skills })}</dt>
                <dd>{counts.skills}</dd>
              </div>
              <div>
                <dt>{t("onboarding.flow.who.countRoutines", { count: counts.routines })}</dt>
                <dd>{counts.routines}</dd>
              </div>
            </dl>
            <p className="onb-who__note ac-iconline">
              <Icon name="lock" size={14} />
              <span>{t("onboarding.flow.who.note")}</span>
            </p>
          </aside>
          <ul className="onb-who__list" aria-label={t("onboarding.flow.who.title")}>
            {lead && (
              <li>
                <WhoRow
                  member={lead}
                  checked
                  fixed
                  needsComputer={needsComputer}
                  hasComputer={hasComputer}
                  onConnectComputer={onConnectComputer}
                />
              </li>
            )}
            {rows
              .filter((m) => !under.has(m.handle))
              .map((m) => {
                const team = teamOf(m);
                const teamId = `onb-who-${m.handle}-team`;
                return (
                  <li key={m.handle} className="onb-who__group">
                    <WhoRow
                      member={m}
                      checked={checkedOf(m)}
                      teamId={team.length > 0 ? teamId : undefined}
                      onToggle={(on) => toggle(m, on)}
                      needsComputer={needsComputer}
                      hasComputer={hasComputer}
                      onConnectComputer={onConnectComputer}
                    />
                    {team.length > 0 && (
                      <ul
                        className="onb-who__team"
                        id={teamId}
                        aria-label={t("onboarding.flow.who.teamOf", { count: team.length })}
                        data-off={teamOn(m) ? undefined : ""}
                      >
                        {team.map((r) => (
                          <li key={r.handle}>
                            <WhoRow
                              member={r}
                              small
                              checked={!off.has(r.handle)}
                              disabled={!teamOn(m)}
                              onToggle={(on) => toggle(r, on)}
                              needsComputer={needsComputer}
                              hasComputer={hasComputer}
                              onConnectComputer={onConnectComputer}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      </Locked>
      <div className="onb__actions">
        {failed && (
          <p className="onb__error" role="alert">
            {failed}
          </p>
        )}
        {/* The button says what it still waits for, never only greyed out. */}
        {empty && !pending && !failed && <p className="onb__help">{t("errors.dougTeam.none")}</p>}
        <Button
          variant="primary"
          block
          kbd={["↵"]}
          data-enter=""
          disabled={pending || empty}
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
 * in, the "needs a computer" notice and its Connect, and, on the right hand, "Stays" in place of a box. The box is
 * named by the agent, so it is read out as its row is.
 */
function WhoRow({
  member,
  checked,
  fixed,
  small,
  disabled,
  teamId,
  onToggle,
  needsComputer,
  hasComputer,
  onConnectComputer,
}: {
  member: DougTemplateMember;
  checked: boolean;
  /** The right hand: no box, it never leaves. */
  fixed?: boolean;
  /** A row under its QG's lead: a smaller face, one line, no skills' chip. */
  small?: boolean;
  /** Its QG's MARK is off: the team's own boxes wait for it to be checked again. */
  disabled?: boolean;
  /** The team list its MARK holds, which describes its box. */
  teamId?: string;
  onToggle?: (checked: boolean) => void;
  needsComputer: readonly { agentId: string; handle: string; name: string }[];
  /** The workspace has a computer: what needs one is not a wait anymore. */
  hasComputer: boolean;
  onConnectComputer: () => void;
}) {
  const { t } = useTranslation();
  // The template says it works on a computer; the answer, once the team is made, names the agent it became.
  const needsOne = member.needsComputer || needsComputer.some((c) => c.handle === member.handle);
  const qg = qgOf(member);
  const id = `onb-who-${member.handle}`;
  const nameId = useId();
  // The face, the name and role on one line, and what the agent brings (`tag`) at the row's end when it's short.
  // Something longer, such as the computer's notice and its button, goes on a line of its own under the words: a button
  // never takes the words' room (rule 4, and `edge`'s 8 from the row's sides).
  const tag =
    needsOne && !hasComputer ? (
      <span className="onb-who__tag ac-iconline">
        <Icon name="computer" size={14} />
        <span>{t("onboarding.flow.who.needsComputer")}</span>
      </span>
    ) : !small && member.skills > 0 ? (
      <Chip className="onb-who__tag">{t("onboarding.flow.who.skillsCount", { count: member.skills })}</Chip>
    ) : null;
  // The face and the name on the first line (`lead`), the role and what the agent brings under them at the row's full
  // width: a square never owns a column while the words beside it take 3 lines or more (rule 4, `squarecol`).
  const inner = (
    <>
      <span className="onb-who__lead">
        {!fixed && (
          <Checkbox
            id={id}
            checked={checked}
            disabled={disabled}
            aria-labelledby={nameId}
            aria-describedby={teamId}
            onCheckedChange={(on) => onToggle?.(on)}
          />
        )}
        <AgentAvatar
          name={member.name}
          agent={{ name: member.name, handle: member.handle, role: member.role }}
          size={small ? "sm" : "md"}
          labelled
        />
        <span className="onb-who__name">
          <b id={nameId}>{member.name}</b>
          {qg && !small && (
            <span className="onb-who__qg">{t("onboarding.flow.who.qg", { channel: `#${member.channel}` })}</span>
          )}
        </span>
        {fixed && <span className="onb-who__fixed">{t("onboarding.flow.who.fixed")}</span>}
      </span>
      <span className="onb-who__under">
        <span className="onb-who__role">{member.role}</span>
        {tag}
        {needsOne && !hasComputer && (
          <Button size="sm" onClick={onConnectComputer}>
            {t("onboarding.flow.who.connectComputer")}
          </Button>
        )}
      </span>
    </>
  );
  // The right hand never leaves: its row presses nothing.
  if (fixed)
    return (
      <span className="onb-who__row" data-fixed="">
        {inner}
      </span>
    );
  return (
    <label
      htmlFor={id}
      className="onb-who__row"
      data-small={small ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
    >
      {inner}
    </label>
  );
}
