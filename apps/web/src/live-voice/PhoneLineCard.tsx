import { usePhoneLine, useRemovePhoneLine, useSavePhoneLine } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import {
  Button,
  Card,
  CardFooter,
  CardHeader,
  Chip,
  Dialog,
  DialogFooter,
  Field,
  Input,
  List,
  Locked,
} from "@agenteschat/ui";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";

/*
 * Configurações › Voz, phone calls (docs/adr/doug-0035-phone-calls.md): an owner connects their own calling service (its
 * address and token) once, for every workspace they own; the Doug here calls through an owner's line. Everyone sees
 * whether calls are on and the number they go out from; only the owner sees and changes their own line.
 */

const TOKEN_MIN = 16;

export function PhoneLineCard() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const view = usePhoneLine(org.id).data;
  const save = useSavePhoneLine(org.id);
  const remove = useRemovePhoneLine(org.id);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const id = useId();
  if (!view) return null;
  const on = view.state === "ok";
  const close = () => {
    setOpen(false);
    setUrl("");
    setToken("");
    setError(null);
  };
  const ready = url.trim().startsWith("https://") && token.trim().length >= TOKEN_MIN;
  const submit = () => {
    if (!ready || save.isPending) return;
    save.mutate(
      { url: url.trim(), token: token.trim() },
      { onSuccess: close, onError: (e) => setError(errorText(t, e)) },
    );
  };

  const form = (
    <form
      className="list-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Locked when={save.isPending}>
        <Field label={t("liveVoice.phoneLine.url")} example="https://ligar.exemplo.com">
          <Input
            type="url"
            value={url}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
          />
        </Field>
        <Field
          label={t("liveVoice.phoneLine.token")}
          error={error ?? undefined}
          example={t("liveVoice.phoneLine.sealed")}
        >
          <Input
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
          />
        </Field>
      </Locked>
      <span className="ac-acts">
        <Button type="submit" variant="primary" disabled={!ready} loading={save.isPending}>
          {t("liveVoice.phoneLine.save")}
        </Button>
        <Button variant="ghost" onClick={close}>
          {t("common.cancel")}
        </Button>
      </span>
    </form>
  );

  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader
        id={`${id}-title`}
        icon="phone"
        title={t("liveVoice.phoneLine.title")}
        subtitle={t("liveVoice.phoneLine.lead")}
        action={
          <Chip icon={on ? "check" : undefined} tone={on ? "done" : undefined}>
            {t(on ? "liveVoice.phoneLine.on" : "liveVoice.phoneLine.off")}
          </Chip>
        }
      />
      <List>
        {on && view.fromNumber && (
          <div className="ac-list__row jev__body">
            <span className="small muted">{t("liveVoice.phoneLine.fromHere", { number: view.fromNumber })}</span>
          </div>
        )}
        {view.mine ? (
          <div className="ac-list__row jev__key">
            <span className="list-col">
              <span className="ai-accounts__name">{t("liveVoice.phoneLine.mine")}</span>
              <span className="small muted">
                {t("liveVoice.phoneLine.mineHint", { number: view.mine.fromNumber || "—", hint: view.mine.hint })}
              </span>
            </span>
            {view.editable && (
              <span className="ac-acts">
                <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
                  {t("settings.rotate")}
                </Button>
                <Button size="sm" variant="ghost" className="ac-btn--danger" onClick={() => setRemoving(true)}>
                  {t("settings.remove")}
                </Button>
              </span>
            )}
          </div>
        ) : (
          !open && (
            <div className="ac-list__row jev__body">
              <span className="small muted">
                {t(view.editable ? "liveVoice.phoneLine.without" : "liveVoice.phoneLine.ownerOnly")}
              </span>
              {view.editable && (
                <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                  {t("liveVoice.phoneLine.setUp")}
                </Button>
              )}
            </div>
          )
        )}
        {open && <div className="ac-list__row jev__body">{form}</div>}
      </List>
      {view.editable && <CardFooter>{t("liveVoice.phoneLine.footer")}</CardFooter>}
      <Dialog
        open={removing}
        onOpenChange={setRemoving}
        title={t("liveVoice.phoneLine.removeTitle")}
        description={t("liveVoice.phoneLine.removeText")}
        closeLabel={t("common.close")}
        width={440}
      >
        <DialogFooter>
          <Button onClick={() => setRemoving(false)}>{t("common.cancel")}</Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => setRemoving(false) })}
          >
            {t("settings.remove")}
          </Button>
        </DialogFooter>
      </Dialog>
    </Card>
  );
}
