import type { PortalClientColor } from "@agenteschat/client";
import {
  usePortalAfterApprove,
  usePortalOverview,
  useSetPortalAfterApprove,
  useSetPortalClientColor,
  useSetPortalClientLogo,
} from "@agenteschat/client";
import {
  PORTAL_CLIENT_COLORS,
  portalClientColors,
  portalClientHue,
  portalClientInitials,
  portalClientLogos,
  portalClientName,
  portalErrorText,
} from "@agenteschat/client/lib/portal";
import { Button, Menu, MenuHeading, MenuItem, MenuSeparator } from "@agenteschat/ui";
import { type CSSProperties, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { ChannelPhoto, ImageCropDialog } from "@/components/ProfilePhoto";
import { useReviewWords } from "@/components/video-review/words";
import { useToast } from "@/lib/toast";
import { HideClientDialog, RenameClientDialog } from "./client-edit";

/** Each client's colour (ADR 9001 §13), from the overview every portal page already reads. */
export function usePortalClientColors(): ReadonlyMap<string, PortalClientColor> {
  const { org } = useOrg();
  return portalClientColors(usePortalOverview(org.id).data?.clients);
}

/** Each client's logo (ADR 9001 §16), from the same overview. */
export function usePortalClientLogos(): ReadonlyMap<string, string> {
  const { org } = useOrg();
  return portalClientLogos(usePortalOverview(org.id).data?.clients);
}

/** A client's colour as a dot: before its name wherever several clients' work shows together. */
export function ClientDot({ color }: { color: PortalClientColor | undefined }) {
  return color ? <span className="portal-clientdot" data-client-color={color} aria-hidden="true" /> : null;
}

/**
 * The client's mark: the logo the team gave it, else a picture lent to it (`photo`: the group named after it), else
 * its initials, on its colour when it has one and on a hue of its name when it has none.
 */
export function ClientMark({
  client,
  logo,
  photo,
  color,
  size = 40,
}: {
  client: string;
  logo?: string;
  photo?: string | null;
  color?: PortalClientColor;
  size?: number;
}) {
  const picture = logo ?? photo;
  if (picture) return <ChannelPhoto icon={picture} size={size} className="portal-mark" />;
  return (
    <span
      className="portal-mark"
      data-client-color={color}
      style={{ "--mark-hue": portalClientHue(client) } as CSSProperties}
      aria-hidden="true"
    >
      {portalClientInitials(client)}
    </span>
  );
}

/**
 * How a client is known, on the client's own page: its colour, picked from a menu with the chosen one on the button,
 * its logo, set in the square picture dialog, and its name; and "Remove client", which hides it from every list
 * (ADR 9001, addendum 2026-11-18; `onHidden` once it is). A choice applies at once, for everyone, wherever the client
 * shows.
 */
export function ClientColorMenu({ client, onHidden }: { client: string; onHidden: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const color = usePortalClientColors().get(client);
  const logo = usePortalClientLogos().get(client);
  const set = useSetPortalClientColor(org.id);
  const setLogo = useSetPortalClientLogo(org.id, client);
  const [choosingLogo, setChoosingLogo] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [hiding, setHiding] = useState(false);
  // What "Aprovar" in the Revisor does for this client (docs/adr/doug-0010-design-review.md §8).
  const w = useReviewWords().design.afterApproveMenu;
  const afterApprove = usePortalAfterApprove(org.id).data?.get(client) ?? "portal";
  const setAfter = useSetPortalAfterApprove(org.id);
  const pickAfter = (next: "portal" | "direct") =>
    setAfter.mutate(
      { client, afterApprove: next },
      {
        onSuccess: () => toast.show(w.saved),
        onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error"),
      },
    );
  const pick = (next: PortalClientColor | null) =>
    set.mutate(
      { client, color: next },
      { onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error") },
    );
  return (
    <>
      <Menu
        align="end"
        label={t("portal.clientColor.label")}
        trigger={
          <Button
            variant="ghost"
            className="portal-colorbtn"
            title={t("portal.clientColor.label")}
            aria-label={
              color
                ? `${t("portal.clientColor.label")}: ${t(`portal.clientColor.colors.${color}`)}`
                : t("portal.clientColor.label")
            }
          >
            <span className="portal-clientdot portal-clientdot--lg" data-client-color={color} aria-hidden="true" />
            {/* On a phone the dot says it alone, leaving the row to the other actions. */}
            <span className="portal-colorbtn__name portal-act__words">
              {color ? t(`portal.clientColor.colors.${color}`) : t("portal.clientColor.label")}
            </span>
          </Button>
        }
      >
        <MenuHeading>{t("portal.clientColor.label")}</MenuHeading>
        {PORTAL_CLIENT_COLORS.map((value) => (
          <MenuItem
            key={value}
            leading={<span className="portal-clientdot portal-clientdot--lg" data-client-color={value} />}
            hint={value === color ? "✓" : undefined}
            onSelect={() => pick(value)}
          >
            {t(`portal.clientColor.colors.${value}`)}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem disabled={!color} onSelect={() => pick(null)}>
          {t("portal.clientColor.none")}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon="image" onSelect={() => setChoosingLogo(true)}>
          {t("portal.clientLogo.menu")}
        </MenuItem>
        <MenuItem icon="edit" onSelect={() => setRenaming(true)}>
          {t("portal.clientEdit.rename")}
        </MenuItem>
        <MenuSeparator />
        <MenuHeading>{w.title}</MenuHeading>
        {(["portal", "direct"] as const).map((value) => (
          <MenuItem
            key={value}
            icon={value === "portal" ? "eye" : "send"}
            hint={value === afterApprove ? "✓" : undefined}
            onSelect={() => pickAfter(value)}
          >
            {w[value]}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon="trash" danger onSelect={() => setHiding(true)}>
          {t("portal.clientEdit.hide")}
        </MenuItem>
      </Menu>
      {/* Mounted while open, so the name field starts from the name shown now. */}
      {renaming && <RenameClientDialog open client={client} onClose={() => setRenaming(false)} />}
      <HideClientDialog
        open={hiding}
        client={client}
        onClose={() => setHiding(false)}
        onHidden={() => {
          setHiding(false);
          onHidden();
        }}
      />
      <ImageCropDialog
        open={choosingLogo}
        onClose={() => setChoosingLogo(false)}
        title={t("portal.clientLogo.title", { name: portalClientName(client) })}
        help={t("portal.clientLogo.help")}
        placeholder={<ClientMark client={client} logo={logo} color={color} size={56} />}
        hasImage={Boolean(logo)}
        removeLabel={t("portal.clientLogo.remove")}
        format="image/png"
        save={(image) => setLogo.mutateAsync(image)}
        remove={() => setLogo.mutateAsync(null)}
        onSaved={() => toast.show(t("portal.clientLogo.saved"))}
        onRemoved={() => toast.show(t("portal.clientLogo.removed"))}
      />
    </>
  );
}
