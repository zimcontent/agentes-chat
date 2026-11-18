import { ApiError } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { withHumanCheck } from "@agenteschat/client/lib/human-check";
import { isEmail } from "@agenteschat/client/lib/text";
import { Button, ChipField, type ChipFieldOption, Field, Input, Locked, Textarea } from "@agenteschat/ui";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";
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

type State = { step: "form" } | { step: "done" };

/**
 * "Quero o DougBot na minha empresa" (`/empresas`): the public form a company fills to ask for DougBot, with a
 * consent to the Privacy Policy and the bot check a public form gets. Answers nowhere in the app; the server keeps
 * the request for the team, which reads each one.
 */
export function CompaniesPage() {
  const { t } = useTranslation();
  useDocumentTitle(`${t("companies.page.title")} · DougBot`);
  const [state, setState] = useState<State>({ step: "form" });

  return (
    <AuthShell languages={false}>
      <div className="companies">
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
      </div>
    </AuthShell>
  );
}

/** The form's fields, in the order the page asks them, and what the request sends. */
function CompaniesForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
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
  const field = useRef<HTMLInputElement>(null);

  const digits = whatsapp.replace(/\D/g, "").length;
  const ready =
    name.trim().length > 0 &&
    isEmail(email.trim()) &&
    /^[\d\s()+.-]{8,40}$/.test(whatsapp.trim()) &&
    digits >= 8 &&
    digits <= 15 &&
    company.trim().length > 0 &&
    consent;

  const interestOptions = useMemo<ChipFieldOption[]>(
    () => INTERESTS.map((i) => ({ value: i, label: t(`companies.interests.${i}` as never) })),
    [t],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || pending) return;
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
            locale: currentLocale(),
          },
          token,
        ),
      );
      onDone();
    } catch (err) {
      setError(companyErrorText(t, err));
      field.current?.focus();
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="ac-form companies__form" onSubmit={submit} noValidate>
      <Locked when={pending}>
        <div className="companies__pair">
          <Field label={t("companies.page.name")} example={t("companies.page.nameExample")}>
            <Input id={nameId} ref={field} value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("companies.page.company")} example={t("companies.page.companyExample")}>
            <Input
              id={companyId}
              value={company}
              autoComplete="organization"
              onChange={(e) => setCompany(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t("companies.page.email")} example={t("companies.page.emailExample")}>
          <Input
            id={emailId}
            type="email"
            inputMode="email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t("companies.page.whatsapp")} example={t("companies.page.whatsappExample")}>
          <Input
            id={whatsappId}
            type="tel"
            inputMode="tel"
            value={whatsapp}
            autoComplete="tel"
            onChange={(e) => setWhatsapp(e.target.value)}
          />
        </Field>
        <Field label={t("companies.page.teamSize")}>
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
        >
          <ChipField
            id={interestsId}
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
        >
          <Textarea
            id={messageId}
            rows={3}
            value={message}
            maxLength={2000}
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

/** The browser's language as a code the server knows, else English. */
function currentLocale(): string {
  const lang = typeof navigator !== "undefined" ? navigator.language : "en";
  return lang.toLowerCase().startsWith("pt") ? "pt-BR" : lang;
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
