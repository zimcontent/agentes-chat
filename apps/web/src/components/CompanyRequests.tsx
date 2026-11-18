import type { CompanyRequest, CompanyRequestStatus } from "@agenteschat/client";
import {
  COMPANY_REQUEST_STATUSES,
  useCompanyRequests,
  useInviteCompany,
  useSaveCompanyClientCode,
  useSaveCompanyNotes,
  useSetCompanyStatus,
} from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { formatShortDate } from "@agenteschat/client/lib/format";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  type ChipTone,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Segmented,
  Spinner,
  Textarea,
} from "@agenteschat/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./company-requests.css";

/** Each step as its chip's colour: a request waits (new), is being talked to, was invited, is a client, or is set aside. */
const STATUS_TONE: Record<CompanyRequestStatus, ChipTone | undefined> = {
  new: "waiting",
  talking: undefined,
  invited: "done",
  deployed: "done",
  discarded: undefined,
};

/**
 * Settings › Company requests (this instance's own): the companies that asked for DougBot on the page, read and moved
 * through their steps by the installation's owner. Each card shows the form, the team's notes, the client's code and
 * the Invite that sends the early-access link. `null` from the API to everyone else: the section isn't offered to them.
 */
export function CompanyRequestsSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  // A typed search waits a moment, so each letter isn't a query.
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearched(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  const list = useCompanyRequests({ status: status || undefined, q: searched || undefined });
  const pages = list.data?.pages ?? [];
  const requests = useMemo(() => pages.flatMap((p) => p?.requests ?? []), [pages]);
  const counts = pages[0]?.counts;
  if (list.isPending) return <Spinner />;
  if (list.data === null || (list.isError && !list.data)) return null;

  return (
    <div className="settings__section company-requests">
      <PageHeader
        level={2}
        title={t("companies.list.title")}
        meta={counts ? t("companies.list.count", { count: counts.all }) : t("companies.list.lead")}
        actions={
          <Input
            className="cr-search"
            type="search"
            value={q}
            placeholder={t("companies.list.search")}
            aria-label={t("companies.list.search")}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />
      <Segmented
        label={t("companies.list.title")}
        value={status}
        onValueChange={setStatus}
        options={[
          { value: "", label: t("companies.list.filterAll") },
          ...COMPANY_REQUEST_STATUSES.map((s) => ({
            value: s,
            label: `${t(`companies.list.status.${s}` as never)}${counts ? ` · ${counts[s]}` : ""}`,
          })),
        ]}
      />
      {requests.length === 0 ? (
        <EmptyState title={searched || status ? t("companies.list.none") : t("companies.list.empty")} />
      ) : (
        <div className="ac-groups">
          {requests.map((r) => (
            <CompanyCard key={r.id} request={r} />
          ))}
          {list.hasNextPage && (
            <Button variant="ghost" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {t("companies.list.more")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** One request: what the person sent, the team's notes, its client's code, and the Invite. */
function CompanyCard({ request: r }: { request: CompanyRequest }) {
  const { t } = useTranslation();
  const setStatus = useSetCompanyStatus();
  const saveNotes = useSaveCompanyNotes();
  const saveCode = useSaveCompanyClientCode();
  const invite = useInviteCompany();
  const [notes, setNotes] = useState(r.notes);
  const [code, setCode] = useState(r.clientCode ?? "");
  const [said, setSaid] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const notesSaved = useRef(r.notes);

  // A changed request (another step, other notes) keeps the fields in step with it.
  useEffect(() => {
    if (r.notes !== notesSaved.current) {
      notesSaved.current = r.notes;
      setNotes(r.notes);
    }
    setCode(r.clientCode ?? "");
  }, [r.notes, r.clientCode]);

  const inviteLine = (outcome: string): string => {
    switch (outcome) {
      case "invited":
      case "resent":
        return t("companies.list.inviteSent");
      case "allowed":
        return t("companies.list.inviteAllowed");
      case "recent":
        return t("companies.list.inviteAlreadySent");
      case "already_invited":
        return t("companies.list.inviteAlreadySent");
      case "signed_up":
        return t("companies.list.inviteSignedUp");
      default:
        return "";
    }
  };

  return (
    <Card>
      <CardHeader
        title={r.company}
        subtitle={r.name}
        action={<Chip tone={STATUS_TONE[r.status]}>{t(`companies.list.status.${r.status}` as never)}</Chip>}
      />
      <div className="cr-body">
        <dl className="cr-facts">
          <div>
            <dt>{t("companies.list.email")}</dt>
            <dd>
              <a className="ac-link" href={`mailto:${r.email}`}>
                {r.email}
              </a>
            </dd>
          </div>
          <div>
            <dt>{t("companies.list.whatsapp")}</dt>
            <dd>
              <a
                className="ac-link"
                href={`https://wa.me/${r.whatsapp.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                {r.whatsapp}
              </a>
            </dd>
          </div>
          <div>
            <dt>{t("companies.list.teamSize")}</dt>
            <dd>{t(`companies.teamSizes.${r.teamSize}` as never)}</dd>
          </div>
          {r.interests.length > 0 && (
            <div>
              <dt>{t("companies.list.interests")}</dt>
              <dd>{r.interests.map((i) => t(`companies.interests.${i}` as never)).join(", ")}</dd>
            </div>
          )}
        </dl>
        {r.message && (
          <div className="cr-message">
            <span className="cr-label">{t("companies.list.message")}</span>
            <p>{r.message}</p>
          </div>
        )}
        <div className="cr-row">
          <span className="cr-label">{t("companies.list.setStatus")}</span>
          <Segmented
            size="sm"
            label={t("companies.list.setStatus")}
            value={r.status}
            onValueChange={(v) => setStatus.mutate({ id: r.id, status: v as CompanyRequestStatus })}
            options={COMPANY_REQUEST_STATUSES.map((s) => ({
              value: s,
              label: t(`companies.list.status.${s}` as never),
            }))}
          />
        </div>
        <Field label={t("companies.list.notes")}>
          <Textarea
            rows={2}
            value={notes}
            placeholder={t("companies.list.notesPlaceholder")}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes.trim() !== r.notes) saveNotes.mutate({ id: r.id, notes });
            }}
          />
        </Field>
        <div className="cr-row cr-row--end">
          <Field label={t("companies.list.clientCode")} example={t("companies.list.clientCodeHint")} error={codeError}>
            <Input
              value={code}
              inputMode="numeric"
              maxLength={3}
              placeholder={t("companies.list.clientCodePlaceholder")}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, "").slice(0, 3));
                setCodeError(null);
              }}
              onBlur={() => {
                const next = code.trim() || null;
                if (next === (r.clientCode ?? null)) return;
                saveCode.mutate(
                  { id: r.id, clientCode: next },
                  {
                    onError: (e) => {
                      const c = (e as { code?: string }).code;
                      setCodeError(
                        c === "client_code_taken" ? t("companies.list.codeTaken") : t("companies.list.codeInvalid"),
                      );
                    },
                  },
                );
              }}
            />
          </Field>
          <div className="cr-actions">
            {r.status !== "deployed" && (
              <Button
                variant="primary"
                loading={invite.isPending}
                onClick={() =>
                  invite.mutate(r.id, {
                    onSuccess: (res) => setSaid(inviteLine(res.outcome)),
                    onError: (e) => setSaid(errorText(t, e)),
                  })
                }
              >
                {invite.isPending ? t("companies.list.inviting") : t("companies.list.invite")}
              </Button>
            )}
          </div>
        </div>
        {(said || r.invitedAt) && (
          <p className="cr-said" role="status">
            {said ??
              t("companies.list.invitedOn", {
                date: formatShortDate(Intl.DateTimeFormat().resolvedOptions().timeZone, r.invitedAt ?? ""),
              })}
          </p>
        )}
      </div>
    </Card>
  );
}
