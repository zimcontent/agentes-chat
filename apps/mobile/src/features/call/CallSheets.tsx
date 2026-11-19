import { useLiveVoice, useRoster } from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, GroupedFooter, GroupedHeader, GroupedList, GroupedRow, SheetScreen, Text } from "@/ui";
import { AgentFace, Face } from "../shared/Face";
import { useDirectory, useMeId, useOrgId } from "../shared/hooks";
import { goBack } from "../shared/parts";
import { TextArea } from "../shared/TextArea";
import { useCalls, useRoomState } from "./CallProvider";
import type { PhoneRoom } from "./phone-room";

const MAX_AGENTS = 5;
const MAX_PEOPLE = 10;

/** The workspace's people to call, but those left out (oneself, who's already on the call). */
function PeopleRows({
  except,
  picked,
  onChange,
}: {
  except: string[];
  picked: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const dir = useDirectory();
  const people = [...dir.memberById.values()].filter((m) => !except.includes(m.userId));
  if (!people.length)
    return (
      <Text variant="footnote" tone="faint">
        {t("liveVoice.invite.none")}
      </Text>
    );
  return (
    <GroupedList>
      {people.map((person) => {
        const on = picked.includes(person.userId);
        return (
          <GroupedRow
            key={person.userId}
            label={person.name ?? ""}
            leading={<Face who={{ type: "person", id: person.userId }} size={28} live={false} />}
            checked={on}
            disabled={!on && picked.length >= MAX_PEOPLE}
            onPress={() => onChange(on ? picked.filter((id) => id !== person.userId) : [...picked, person.userId])}
          />
        );
      })}
    </GroupedList>
  );
}

/**
 * "Chamada de voz" from a conversation's header (docs/adr/doug-0006-live-voice.md, the phone app): the agents on the
 * call (up to 5, the first three picked), a topic they open on, and people to call too. Without the workspace's
 * GPT-Live key the agents wait: the call is between people.
 */
export function StartCallSheet({ channelId, title }: { channelId: string; title: string }) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const me = useMeId() ?? "";
  const dir = useDirectory();
  const calls = useCalls();
  const status = useLiveVoice(orgId);
  const roster = useRoster(orgId, channelId);
  const available = status.data?.state === "ok";
  const agents = (roster.data ?? [])
    .filter((r) => r.type === "agent")
    .flatMap((r) => {
      const a = dir.agentById.get(r.id);
      return a ? [a] : [];
    });
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = available ? (picked ?? agents.slice(0, 3).map((a) => a.id)) : [];
  const [topic, setTopic] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  return (
    <SheetScreen>
      <Text variant="title2">{t("liveVoice.call.title")}</Text>
      <Text variant="footnote" tone="faint">
        {t("liveVoice.call.lead")}
      </Text>
      {agents.length ? (
        <View style={styles.group}>
          <GroupedHeader>{t("liveVoice.phone.agents")}</GroupedHeader>
          <GroupedList>
            {agents.map((agent) => {
              const on = chosen.includes(agent.id);
              return (
                <GroupedRow
                  key={agent.id}
                  label={agent.name}
                  sub={agent.role ?? undefined}
                  leading={<AgentFace agentId={agent.id} size={28} />}
                  checked={on}
                  disabled={!available || (!on && chosen.length >= MAX_AGENTS)}
                  onPress={() => setPicked(on ? chosen.filter((id) => id !== agent.id) : [...chosen, agent.id])}
                />
              );
            })}
          </GroupedList>
          {!available ? <GroupedFooter>{t("liveVoice.call.keyWhere")}</GroupedFooter> : null}
        </View>
      ) : null}
      {chosen.length > 0 ? (
        <View style={styles.group}>
          <GroupedHeader>{t("liveVoice.call.topic")}</GroupedHeader>
          <TextArea
            value={topic}
            onChangeText={setTopic}
            maxLength={500}
            minHeight={64}
            placeholder={t("liveVoice.call.topicHint")}
          />
        </View>
      ) : null}
      <View style={styles.group}>
        <GroupedHeader>{t("liveVoice.call.people")}</GroupedHeader>
        <PeopleRows except={[me]} picked={people} onChange={setPeople} />
      </View>
      <Button
        variant="primary"
        wide
        label={chosen.length ? t("liveVoice.call.startWith", { count: chosen.length }) : t("liveVoice.call.peopleOnly")}
        onPress={() => {
          goBack();
          calls?.startRoom(channelId, title, chosen, { topic: topic.trim() || null, invite: people });
        }}
      />
    </SheetScreen>
  );
}

/** "Chamar pessoa" during a call: they get a mention (a push) and their open app rings. */
export function InviteSheet() {
  const calls = useCalls();
  const current = calls?.current;
  if (current?.kind !== "room") return null;
  return <InviteRows call={current.call} />;
}

function InviteRows({ call }: { call: PhoneRoom }) {
  const { t, i18n } = useTranslation();
  const me = useMeId() ?? "";
  const dir = useDirectory();
  const s = useRoomState(call);
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const here = [me, ...(s.room?.people.map((p) => p.userId) ?? [])];
  return (
    <SheetScreen>
      <Text variant="title2">{t("liveVoice.invite.title")}</Text>
      <Text variant="footnote" tone="faint">
        {t("liveVoice.invite.lead")}
      </Text>
      <PeopleRows except={here} picked={picked} onChange={setPicked} />
      {problem ? (
        <Text variant="footnote" tone="danger" accessibilityRole="alert">
          {problem}
        </Text>
      ) : null}
      <Button
        variant="primary"
        wide
        label={t("liveVoice.invite.send")}
        disabled={!picked.length}
        loading={sending}
        onPress={async () => {
          setSending(true);
          setProblem(null);
          try {
            const out = await call.invite(picked);
            if (out.refused.length) {
              setProblem(
                t("liveVoice.invite.refused", {
                  names: out.refused.map((id) => dir.memberById.get(id)?.name ?? "").join(", "),
                }),
              );
              setPicked([]);
            } else goBack();
          } catch (error) {
            setProblem(errorText(t, error, i18n.language));
          } finally {
            setSending(false);
          }
        }}
      />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  group: { gap: 6 },
});
