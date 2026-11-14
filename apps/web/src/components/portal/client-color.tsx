import type { PortalClientColor } from "@agenteschat/client";
import { usePortalOverview, useSetPortalClientColor } from "@agenteschat/client";
import { PORTAL_CLIENT_COLORS, portalClientColors, portalErrorText } from "@agenteschat/client/lib/portal";
import { Button, Menu, MenuHeading, MenuItem, MenuSeparator } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/** Each client's colour (ADR 9001 §13), from the overview every portal page already reads. */
export function usePortalClientColors(): ReadonlyMap<string, PortalClientColor> {
  const { org } = useOrg();
  return portalClientColors(usePortalOverview(org.id).data?.clients);
}

/** A client's colour as a dot: before its name wherever several clients' work shows together. */
export function ClientDot({ color }: { color: PortalClientColor | undefined }) {
  return color ? <span className="portal-clientdot" data-client-color={color} aria-hidden="true" /> : null;
}

/**
 * "Client's colour", on the client's own page: the colours as a menu, the chosen one on the button. A choice applies
 * at once, for everyone, wherever the client shows.
 */
export function ClientColorMenu({ client }: { client: string }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const color = usePortalClientColors().get(client);
  const set = useSetPortalClientColor(org.id);
  const pick = (next: PortalClientColor | null) =>
    set.mutate(
      { client, color: next },
      { onError: (error) => toast.show(portalErrorText(t, error, i18n.language), "error") },
    );
  return (
    <Menu
      align="end"
      label={t("portal.clientColor.label")}
      trigger={
        <Button variant="ghost" className="portal-colorbtn" title={t("portal.clientColor.label")}>
          <span className="portal-clientdot portal-clientdot--lg" data-client-color={color} aria-hidden="true" />
          {color ? t(`portal.clientColor.colors.${color}`) : t("portal.clientColor.label")}
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
    </Menu>
  );
}
