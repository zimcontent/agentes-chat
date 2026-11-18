import { useClientLook, useSettings, useUpdateSettings, useWhatsApp } from "@agenteschat/client";
import { can } from "@agenteschat/client/lib/permissions";
import { WORKSPACE_TOOLS, type WorkspaceTool } from "@agenteschat/client/lib/sidebar-items";
import { Card, CardHeader, Icon, Switch } from "@agenteschat/ui";
import { useTranslation } from "react-i18next";
import { useOrg } from "./org-context";
import { SIDEBAR_TOOLS, useMediaOn, usePortalOn } from "./SidebarSetup";
import { useReviewWords } from "./video-review/words";
import { WhatsAppMark } from "./whatsapp/WhatsAppMark";

/**
 * This card's words. The switch is this instance's own (each workspace is its own operation: one business uses the
 * portal, another doesn't), so its words live beside it, in Portuguese and English: any other language reads English.
 */
const WORDS = {
  en: {
    title: "Tools in the sidebar",
    hint: "Turn off what this workspace doesn't use: it leaves the sidebar and More for everyone here. Each person still orders what stays in Customize.",
    readOnly: "Only admins change this.",
  },
  pt: {
    title: "Ferramentas na barra",
    hint: "Desligue o que este workspace não usa: some da barra lateral e do Mais para todo mundo daqui. Cada pessoa continua arrumando o que fica em Personalizar.",
    readOnly: "Só administradores mudam isto.",
  },
};

/**
 * Settings › General: which tools this workspace has in its sidebar, for everyone (`hiddenTools`). Portal shows only
 * in the workspace the approval portal is (ADR 9001 §18), WhatsApp only on a server that has it.
 */
export function WorkspaceToolsCard() {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const words = i18n.language?.toLowerCase().startsWith("pt") ? WORDS.pt : WORDS.en;
  const settings = useSettings(org.id);
  const update = useUpdateSettings(org.id);
  const editable = can(org, "configure");
  const portal = usePortalOn();
  const media = useMediaOn();
  const whatsapp = useWhatsApp(org.id).data?.on === true;
  const review = useReviewWords();
  const hidden =
    (update.isPending ? update.variables?.hiddenTools : undefined) ??
    settings.data?.hiddenTools ??
    org.hiddenTools ??
    [];
  // The tools this server's client turns off for every workspace of its own (ADR doug-0020) aren't this admin's to
  // turn back on: they leave the card, exactly as they left the sidebar.
  const client = useClientLook();
  const tools = (WORKSPACE_TOOLS as readonly WorkspaceTool[]).filter(
    (id) =>
      id !== "threads" &&
      (id !== "portal" || portal) &&
      (id !== "media" || media) &&
      (id !== "whatsapp" || whatsapp) &&
      !client.hiddenTools.includes(id),
  );
  const label = (id: WorkspaceTool) =>
    id === "whatsapp" ? "WhatsApp" : id === "review" ? review.title : t(`shell.${id}`);
  const mark = (id: WorkspaceTool) =>
    id === "whatsapp" ? (
      <WhatsAppMark size={16} />
    ) : (
      <Icon name={id === "review" ? "video" : SIDEBAR_TOOLS[id].icon} size={16} />
    );
  const set = (id: WorkspaceTool, on: boolean) => {
    const next = on ? hidden.filter((x) => x !== id) : [...hidden.filter((x) => x !== id), id];
    update.mutate({ hiddenTools: next });
  };
  return (
    <Card aria-labelledby="sec-workspace-tools">
      <CardHeader
        id="sec-workspace-tools"
        icon="settings"
        title={words.title}
        hint={{ name: t("common.about", { label: words.title }), text: words.hint }}
      />
      {!editable && <p className="page__note">{words.readOnly}</p>}
      <div className="settings-rows">
        {tools.map((id) => (
          <div key={id} className="settings-row ac-actrow">
            <div className="settings-row__text ac-actrow__text">
              <span className="settings-tool">
                {mark(id)}
                <label className="settings-row__label" htmlFor={`set-tool-${id}`}>
                  {label(id)}
                </label>
              </span>
            </div>
            <div className="settings-row__control">
              <Switch
                id={`set-tool-${id}`}
                checked={!hidden.includes(id)}
                onCheckedChange={(on) => set(id, on)}
                disabled={!editable || !settings.data}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
