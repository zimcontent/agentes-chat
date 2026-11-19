import { useSeparateOperation, useSetSeparateOperation } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { Card, CardHeader, Field, InfoHint, SettingNote, Switch, Textarea } from "@agenteschat/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/** The names as the field shows them, and back: one list, separated by commas or lines. */
const namesText = (names: string[]) => names.join(", ");
const namesOf = (text: string) =>
  text
    .split(/[,\n]/)
    .map((n) => n.trim())
    .filter(Boolean);

/**
 * Configurações › Geral, a team workspace: whether it is a separate operation (docs/adr/doug-0035-separate-operation.md).
 * Its agents' copies in the owner's other workspaces then carry only their craft, both ways. Read by who configures the
 * workspace, changed by its owners. Connections signed in with an account another workspace also uses are named here:
 * they reach that account's things whatever this says.
 */
export function SeparateOperationCard() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const view = useSeparateOperation(org.id, can(org, "configure")).data;
  const set = useSetSeparateOperation(org.id);
  const toast = useToast();
  const [names, setNames] = useState("");
  const saved = view ? namesText(view.names) : "";
  useEffect(() => setNames(saved), [saved]);
  if (!view) return null;
  const save = (input: { on?: boolean; names?: string[] }) =>
    set.mutate(input, { onError: () => toast.show(t("separateOperation.failed"), "error") });
  const flushNames = () => {
    if (names.trim() === saved) return;
    save({ names: namesOf(names) });
  };
  const title = t("separateOperation.title");
  return (
    <Card aria-labelledby="sec-separate">
      <CardHeader
        id="sec-separate"
        icon="lock"
        title={title}
        hint={{ name: t("common.about", { label: title }), text: t("separateOperation.help") }}
      />
      <div className="settings-rows">
        <div className="settings-row ac-actrow">
          <div className="settings-row__text ac-actrow__text">
            <span className="ac-hintline">
              <label className="settings-row__label" htmlFor="set-separate">
                {t("separateOperation.switch")}
              </label>
              <InfoHint name={t("common.about", { label: t("separateOperation.switch") })}>
                {t("separateOperation.switchHelp")}
              </InfoHint>
            </span>
          </div>
          <div className="settings-row__control">
            <Switch
              id="set-separate"
              checked={view.on}
              onCheckedChange={(on) => save({ on })}
              disabled={!view.canEdit || set.isPending}
            />
          </div>
        </div>
      </div>
      <Field
        label={t("separateOperation.names")}
        hint={{
          name: t("common.about", { label: t("separateOperation.names") }),
          text: t("separateOperation.namesHelp"),
        }}
        example={t("separateOperation.namesExample")}
      >
        <Textarea
          rows={2}
          value={names}
          onChange={(e) => setNames(e.target.value)}
          onBlur={flushNames}
          readOnly={!view.canEdit}
        />
      </Field>
      {!view.canEdit && (
        <SettingNote icon="lock" quiet>
          {t("separateOperation.ownersOnly")}
        </SettingNote>
      )}
      {view.sharedSignIns.map((c) => (
        <SettingNote key={c.id} icon="alert">
          {t("separateOperation.sharedSignIn", { label: c.label, workspaces: c.workspaces.join(", ") })}
        </SettingNote>
      ))}
    </Card>
  );
}
