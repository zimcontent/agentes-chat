import { ApiError } from "@dougbot/client";
import { errorText } from "@dougbot/client/lib/errors";
import { withHumanCheck } from "@dougbot/client/lib/human-check";
import { isStrictEmail } from "@dougbot/client/lib/text";
import { Button, ChipField, type ChipFieldOption, Field, Input, Locked, Spinner, Textarea } from "@dougbot/ui";
import { Link, useSearch } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { AuthShell } from "@/components/AuthLayout";
import { TYPED_VALUES } from "@/i18n";
import { useDocumentTitle } from "@/lib/desktop";
import { useHumanCheck } from "@/lib/human-check";
import "./companies.css";

/** The six things the form asks a company what it wants to automate (`COMPANY_INTERESTS`, the server's list). */
const INTERESTS = ["design", "video", "ads", "social", "code", "finance"] as const;
/** The size bands, the server's own (`COMPANY_TEAM_SIZES`). */
const TEAM_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;
/** The free field's limit, the server's own (`COMPANY_MESSAGE_MAX`). */
const MESSAGE_MAX = 2000;
const PHONE = /^[\d\s()+.-]{8,40}$/;

/** The form's fields, in the order the page asks them: which one the first error points at. */
type FieldName = "name" | "company" | "email" | "whatsapp";
const FIELD_ORDER: FieldName[] = ["name", "company", "email", "whatsapp"];

type State =
  | { step: "form" }
  | { step: "done" }
  | { step: "confirm" }
  | { step: "delete" }
  | { step: "deleted" }
  | { step: "deleteFailed" };

/**
 * "Quero o DougBot na minha empresa" (`/empresas`): the public form a company fills to ask for DougBot, with a
 * consent to the Privacy Policy and the bot check a public form gets. Answers nowhere in the app; the server keeps
 * the request for the team once the address confirms itself, and the team reads each one. `?confirm=<token>`, the
 * link its email carries, confirms it here (POST from this page, so a scanner that only fetches the link never does);
 * `?delete=<token>` is the person's own erasure, which this page asks about and erases on a POST, never on the open.
 */
export function CompaniesPage() {
  const { t } = useTranslation();
  const { confirm, delete: deleteToken } = useSearch({ strict: false }) as { confirm?: string; delete?: string };
  useDocumentTitle(`${t("companies.page.title")} · DougBot`);
  const [state, setState] = useState<State>(
    confirm ? { step: "confirm" } : deleteToken ? { step: "delete" } : { step: "form" },
  );

  return (
    <AuthShell languages={false}>
      <div className="companies">
        {state.step === "confirm" && confirm ? (
          <ConfirmRequest token={confirm} onDone={() => setState({ step: "done" })} />
        ) : state.step === "delete" && deleteToken ? (
          <DeleteRequest
            token={deleteToken}
            onDeleted={() => setState({ step: "deleted" })}
            onFailed={() => setState({ step: "deleteFailed" })}
          />
        ) : state.step === "deleted" || state.step === "deleteFailed" ? (
          <DeleteOutcome failed={state.step === "deleteFailed"} onAgain={() => setState({ step: "form" })} />
        ) : (
          <>
            <header className="companies__head">
              <h1 className="auth__title">
                {state.step === "done" ? t("companies.page.doneTitle") : t("companies.page.title")}
              </h1>
              <p className="auth__lead">
                {state.step === "done" ? t("companies.page.doneLead") : t("companies.page.lead")}
              </p>
            </header>
            {state.step === "done" ? (
              <div className="companies__done">
                <Button variant="primary" onClick={() => setState({ step: "form" })}>
                  {t("companies.page.again")}
                </Button>
              </div>
            ) : (
              <CompaniesForm onDone={() => setState({ step: "done" })} />
            )}
          </>
        )}
      </div>
    </AuthShell>
  );
}

/**
 * The delete link's page: it asks first, then erases on a POST to `/api/companies/delete` (a scanner that only fetches
 * the link deletes nothing). An unknown or expired link says so, with a way back to the form.
 */
function DeleteRequest({ token, onDeleted, onFailed }: { token: string; onDeleted: () => void; onFailed: () => void }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  const erase = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/companies/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) onDeleted();
      else onFailed();
    } catch {
      onFailed();
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <header className="companies__head">
        <h1 className="auth__title">{t("companies.page.deleteTitle")}</h1>
        <p className="auth__lead">{t("companies.page.deleteLead")}</p>
      </header>
      <div className="companies__done">
        <Button variant="danger" onClick={erase} loading={pending} disabled={pending}>
          {t("companies.page.deleteConfirm")}
        </Button>
      </div>
    </>
  );
}

/** What the delete link answered: erased, or a link that no longer works, with a way back to the form. */
function DeleteOutcome({ failed, onAgain }: { failed: boolean; onAgain: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <header className="companies__head">
        <h1 className="auth__title">
          {failed ? t("companies.page.deleteFailedTitle") : t("companies.page.deletedTitle")}
        </h1>
        <p className="auth__lead">{failed ? t("companies.page.deleteFailedLead") : t("companies.page.deletedLead")}</p>
      </header>
      <div className="companies__done">
        <Button variant="primary" onClick={onAgain}>
          {t("companies.page.again")}
        </Button>
      </div>
    </>
  );
}

/**
 * The confirmation link's page: it confirms the address on open (POST, so a scanner that only fetches the URL sends
 * nothing), then says it is with the team. An unknown or expired link says so, with a way back to the form.
 */
function ConfirmRequest({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(true);
  // The confirm runs once per token, whatever renders the parent does (its `onDone` is a new function each time).
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/companies/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!live) return;
        if (res.ok) done.current();
        else setFailed(true);
      } catch {
        if (live) setFailed(true);
      } finally {
        if (live) setPending(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [token]);

  return (
    <>
      <header className="companies__head">
        <h1 className="auth__title">
          {failed ? t("companies.page.confirmFailedTitle") : t("companies.page.confirmTitle")}
        </h1>
        <p className="auth__lead">{failed ? t("companies.page.confirmFailedLead") : t("companies.page.confirmLead")}</p>
      </header>
      {failed ? (
        <div className="companies__done">
          <Button variant="primary" onClick={() => window.location.assign("/empresas")}>
            {t("companies.page.confirmAgain")}
          </Button>
        </div>
      ) : (
        pending && <Spinner />
      )}
    </>
  );
}

/** The form's fields, in the order the page asks them, and what the request sends. */
function CompaniesForm({ onDone }: { onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const nameId = `${id}-name`;
  const emailId = `${id}-email`;
  const whatsappId = `${id}-whatsapp`;
  const companyId = `${id}-company`;
  const teamId = `${id}-team`;
  const interestsId = `${id}-interests`;
  const messageId = `${id}-message`;
  const consentId = `${id}-consent`;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [company, setCompany] = useState("");
  const [teamSize, setTeamSize] = useState<string>(TEAM_SIZES[1]);
  const [interests, setInterests] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const human = useHumanCheck("waitlist");
  const fields = {
    name: useRef<HTMLInputElement>(null),
    company: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    whatsapp: useRef<HTMLInputElement>(null),
  };

  const digits = whatsapp.replace(/\D/g, "").length;
  const emailOk = isStrictEmail(email);
  const whatsappOk = PHONE.test(whatsapp.trim()) && digits >= 8 && digits <= 15;
  const ready =
    name.trim().length > 0 && company.trim().length > 0 && emailOk && whatsappOk && message.length <= MESSAGE_MAX;

  const interestOptions = useMemo<ChipFieldOption[]>(
    () => INTERESTS.map((i) => ({ value: i, label: t(`companies.interests.${i}` as never) })),
    [t],
  );

  /** The first field a refusal names, so the focus lands where the person has to act. */
  const fieldFor = (code: string): FieldName | null => {
    switch (code) {
      case "invalid_name":
        return "name";
      case "invalid_company":
        return "company";
      case "invalid_email":
        return "email";
      case "invalid_whatsapp":
        return "whatsapp";
      default:
        return null;
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || pending || !consent) {
      if (!consent) setError(t("companies.page.consentRequired"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await withHumanCheck(human.check, (token) =>
        postCompanyRequest(
          {
            name: name.trim(),
            email: email.trim(),
            whatsapp: whatsapp.trim(),
            company: company.trim(),
            teamSize,
            interests,
            message: message.trim(),
            consent,
            // The app's own resolved language, never the browser's raw tag (`en-US` is `en`, `es-MX` is `es`): the
            // server reads `en` and `es` straight.
            locale: i18n.language,
          },
          token,
        ),
      );
      onDone();
    } catch (err) {
      setError(companyErrorText(t, err));
      const target = err instanceof ApiError ? fieldFor(err.code) : null;
      (target ? fields[target] : fields[FIELD_ORDER[0] as FieldName]).current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="ac-form companies__form" onSubmit={submit} noValidate>
      <Locked when={pending}>
        <div className="companies__pair">
          <Field label={t("companies.page.name")} example={t("companies.page.nameExample")} id={nameId}>
            <Input ref={fields.name} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("companies.page.company")} example={t("companies.page.companyExample")} id={companyId}>
            <Input
              ref={fields.company}
              value={company}
              autoComplete="organization"
              onChange={(e) => setCompany(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("companies.page.email")} example={t("companies.page.emailExample")} id={emailId}>
          <Input
            ref={fields.email}
            type="email"
            inputMode="email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t("companies.page.whatsapp")} example={t("companies.page.whatsappExample")} id={whatsappId}>
          <Input
            ref={fields.whatsapp}
            type="tel"
            inputMode="tel"
            value={whatsapp}
            autoComplete="tel"
            onChange={(e) => setWhatsapp(e.target.value)}
          />
        </Field>
        <Field label={t("companies.page.teamSize")} id={teamId} group>
          <div className="companies__sizes" role="radiogroup" aria-labelledby={`${teamId}-label`}>
            {TEAM_SIZES.map((size) => (
              <label key={size} className="companies__size">
                <input
                  type="radio"
                  name={teamId}
                  value={size}
                  checked={teamSize === size}
                  onChange={() => setTeamSize(size)}
                />
                <span>{t(`companies.teamSizes.${size}` as never)}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field
          label={t("companies.page.interests")}
          hint={{ name: t("companies.page.interests"), text: t("companies.page.interestsHint") }}
          id={interestsId}
          group
        >
          <ChipField
            tokens={interests.map((i) => ({ key: i, label: t(`companies.interests.${i}` as never) }))}
            onRemove={(key) => setInterests((picked) => picked.filter((p) => p !== key))}
            placeholder={t("companies.page.interests")}
            options={interestOptions}
            onPick={(o) => setInterests((picked) => (picked.includes(o.value) ? picked : [...picked, o.value]))}
            listLabel={t("companies.page.interests")}
            empty={() => null}
          />
        </Field>
        <Field
          label={t("companies.page.message")}
          labelAside={<span className="small muted">{t("companies.page.messageOptional")}</span>}
          error={message.length > MESSAGE_MAX ? t("companies.page.messageTooLong") : undefined}
          id={messageId}
        >
          <Textarea
            rows={3}
            value={message}
            maxLength={MESSAGE_MAX}
            placeholder={t("companies.page.messageExample")}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        {human.slot}
        <label className="companies__consent" htmlFor={consentId}>
          <input id={consentId} type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            <Trans
              i18nKey="companies.page.consent"
              components={{
                link: <Link className="ac-link" to="/privacidade" target="_blank" rel="noreferrer" />,
              }}
              {...TYPED_VALUES}
            />
          </span>
        </label>
        {error && (
          <p className="ac-field__error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" disabled={!ready} loading={pending}>
          {pending ? t("companies.page.sending") : t("companies.page.submit")}
        </Button>
      </Locked>
    </form>
  );
}

/** Sends the request to the public route, with the bot check's token when the page made one. */
async function postCompanyRequest(body: Record<string, unknown>, token: string | undefined) {
  const res = await fetch("/api/companies", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-captcha-response": token } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, data?.error?.code ?? "request_failed", data?.error?.message ?? res.statusText);
  }
}

/**
 * The message under the form: the one field to fix where the server names it, the check where it refused, else the
 * page's own sentence.
 */
function companyErrorText(t: TFunction, error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "consent_required":
        return t("companies.page.consentRequired") as string;
      case "invalid_name":
      case "invalid_company":
      case "invalid_whatsapp":
        return t("companies.page.invalidField") as string;
      case "invalid_email":
        return t("companies.page.invalidEmail") as string;
      case "invalid_message":
        return t("companies.page.messageTooLong") as string;
      case "human_check":
      case "human_check_blocked":
      case "rate_limited":
      case "bad_origin":
      case "invalid_request":
        return errorText(t as never, error);
      default:
        return t("companies.page.failed") as string;
    }
  }
  return t("companies.page.failed") as string;
}
