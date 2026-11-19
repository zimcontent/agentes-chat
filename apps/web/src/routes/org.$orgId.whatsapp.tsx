import { isUuid } from "@dougbot/client/lib/format";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { WhatsAppPage } from "@/pages/WhatsAppPage";

type Search = { account?: string; chat?: string };
const id = (value: unknown) => (typeof value === "string" && isUuid(value) ? value : undefined);

function WhatsAppRoute() {
  const { account, chat } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <main className="shell__main shell__main--chat">
      <WhatsAppPage
        accountId={account}
        chatId={chat}
        // Picking a number or a conversation is a place of its own: Back returns to the list.
        onPick={(next) => void navigate({ search: { account: next.account, chat: next.chat } })}
      />
    </main>
  );
}

/** WhatsApp; `?account={id}&chat={id}` opens a number on one of its conversations. */
export const Route = createFileRoute("/org/$orgId/whatsapp")({
  validateSearch: (search: Record<string, unknown>): Search => ({ account: id(search.account), chat: id(search.chat) }),
  component: WhatsAppRoute,
});
