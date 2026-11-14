import {
  useReadWhatsAppChat,
  useSendWhatsApp,
  useUpdateWhatsApp,
  useWhatsApp,
  useWhatsAppChatAgent,
  useWhatsAppChats,
  useWhatsAppMessages,
  useWhatsAppTyping,
  type WhatsAppAccount,
  type WhatsAppChat,
  type WhatsAppMessage,
} from "@agenteschat/client";
import { clockAt, dayLabel, formatTime } from "@agenteschat/client/lib/format";
import {
  Avatar,
  Button,
  Chip,
  CountBadge,
  DayDivider,
  EmptyState,
  Icon,
  Menu,
  MenuItem,
  SearchInput,
  Select,
  Spinner,
  Switch,
  Textarea,
} from "@agenteschat/ui";
import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { ConnectDialog, NewChatDialog, NumberDialog, useWhatsAppError } from "@/components/whatsapp/WhatsAppDialogs";
import { WhatsAppMark } from "@/components/whatsapp/WhatsAppMark";
import { showPhone, useWords, type WhatsAppWords } from "@/components/whatsapp/words";
import { useDirectory } from "@/hooks/useDirectory";
import { useToast } from "@/lib/toast";
import "./whatsapp.css";

/** What a conversation is called: the name WhatsApp told, else its number, else what kind it is. */
const chatTitle = (chat: WhatsAppChat, w: WhatsAppWords) =>
  chat.name || showPhone(chat.phone) || (chat.group ? w.group : w.unknown);

/** A message's words for the list: its text, or its kind's name when it has none. */
const preview = (kind: string, text: string, w: WhatsAppWords) =>
  text || (kind in w.kind ? w.kind[kind as keyof WhatsAppWords["kind"]] : kind === "text" ? "" : w.kind.other);

const KIND_ICONS = {
  image: "image",
  video: "video",
  audio: "mic",
  document: "file",
  sticker: "sticker",
  location: "pin",
  contact: "person",
  poll: "list",
  other: "message",
} as const;

function StatusDot({ status }: { status: WhatsAppAccount["status"] }) {
  return <span className="wa-dot" data-status={status} aria-hidden="true" />;
}

/** One conversation in the list. */
function ChatRow({
  chat,
  active,
  onOpen,
  w,
}: {
  chat: WhatsAppChat;
  active: boolean;
  onOpen: () => void;
  w: WhatsAppWords;
}) {
  const { i18n } = useTranslation();
  const title = chatTitle(chat, w);
  const kindIcon = chat.lastKind in KIND_ICONS ? KIND_ICONS[chat.lastKind as keyof typeof KIND_ICONS] : null;
  return (
    <button type="button" className="wa-chat" data-active={active} data-unread={chat.unread > 0} onClick={onOpen}>
      <Avatar name={title} size="md" />
      <span className="wa-chat__text">
        <span className="wa-chat__top">
          <span className="wa-chat__name">{title}</span>
          {chat.lastAt && <time className="wa-chat__time">{clockAt(i18n.language, chat.lastAt)}</time>}
        </span>
        <span className="wa-chat__bottom">
          <span className="wa-chat__last">
            {chat.lastFromMe && <span className="wa-chat__you">{w.you}: </span>}
            {kindIcon && <Icon name={kindIcon} size={14} />}
            <span className="wa-chat__words">{preview(chat.lastKind, chat.lastText, w)}</span>
          </span>
          {chat.agent === "person" && (
            <Chip className="wa-chat__turn" tone="waiting">
              {w.agent.yourTurn}
            </Chip>
          )}
          {chat.unread > 0 && (
            <CountBadge className="wa-chat__count">{chat.unread > 99 ? "99+" : chat.unread}</CountBadge>
          )}
        </span>
      </span>
    </button>
  );
}

/** One message as a bubble: ours on the right with its ticks, theirs on the left. */
function Bubble({
  message,
  group,
  answered,
  author,
  w,
}: {
  message: WhatsAppMessage;
  group: boolean;
  answered: WhatsAppMessage | undefined;
  author: string | undefined;
  w: WhatsAppWords;
}) {
  const { i18n } = useTranslation();
  const file = message.kind !== "text" && message.kind in KIND_ICONS;
  const tick = message.fromMe ? w.tick[message.status] : "";
  return (
    <div className="wa-msg" data-mine={message.fromMe}>
      <div className="wa-bubble">
        {group && !message.fromMe && (
          <span className="wa-bubble__who">{message.senderName || showPhone(message.senderPhone) || w.unknown}</span>
        )}
        {answered && <span className="wa-bubble__reply">{preview(answered.kind, answered.body, w)}</span>}
        {file && (
          <span className="wa-bubble__file">
            <Icon name={KIND_ICONS[message.kind as keyof typeof KIND_ICONS]} />
            <span>
              <strong>{message.media?.fileName ?? w.kind[message.kind as keyof WhatsAppWords["kind"]]}</strong>
              {message.media && <small>{w.fileSoon}</small>}
            </span>
          </span>
        )}
        {message.body && <span className="wa-bubble__text">{message.body}</span>}
        <span className="wa-bubble__meta">
          {message.fromMe && author && <span className="wa-bubble__by">{w.sentBy(author)}</span>}
          <time>{formatTime(i18n.language, message.at)}</time>
          {message.fromMe && (
            <span className="wa-tick" data-status={message.status} title={tick} role="img" aria-label={tick}>
              <Icon name={message.status === "sent" ? "check" : "checks"} size={16} />
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** A conversation: its header, its messages from the oldest down, and where to write. */
function Conversation({
  account,
  chatId,
  onBack,
  w,
}: {
  account: WhatsAppAccount;
  chatId: string;
  onBack: () => void;
  w: WhatsAppWords;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const query = useWhatsAppMessages(org.id, account.id, chatId);
  const send = useSendWhatsApp(org.id, account.id);
  const setAgent = useWhatsAppChatAgent(org.id, account.id);
  const read = useReadWhatsAppChat(org.id, account.id);
  const say = useWhatsAppError();
  const toast = useToast();
  const [text, setText] = useState("");
  const typing = useWhatsAppTyping(org.id, account.id, chatId);
  const scroller = useRef<HTMLDivElement>(null);
  const chat = query.data?.pages[0]?.chat;
  // Pages come the latest first: the screen reads from the oldest down.
  const messages = useMemo(
    () => (query.data?.pages.flatMap((page) => page.messages) ?? []).slice().reverse(),
    [query.data],
  );
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const last = messages.at(-1)?.id;
  // The latest message stays in sight when the conversation opens and when one arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the newest message's id is what moves the list
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last, chatId]);
  // Opening it, or a message arriving while it is open, is reading it.
  const unread = chat?.unread ?? 0;
  const markRead = read.mutate;
  useEffect(() => {
    if (unread > 0) markRead(chatId);
  }, [unread, chatId, markRead]);

  const connected = account.status === "connected";
  const submit = () => {
    const body = text.trim();
    if (!body || send.isPending || !connected) return;
    send.mutate(
      { chatId, text: body },
      {
        onSuccess: () => {
          setText("");
          typing.stopped();
        },
        onError: (e) => toast.show(say(e), "error"),
      },
    );
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const title = chat ? chatTitle(chat, w) : "";
  let day = "";
  return (
    <section className="wa-conv" aria-label={title}>
      <header className="wa-conv__head">
        <Button
          className="wa-conv__back"
          variant="ghost"
          size="sm"
          iconOnly
          icon="chevronLeft"
          aria-label={w.back}
          onClick={onBack}
        />
        {chat && <Avatar name={title} size="md" />}
        <span className="wa-conv__who">
          <strong className="wa-conv__name">{title}</strong>
          {chat?.agent ? (
            <span className="wa-conv__phone" data-agent={chat.agent}>
              {chat.agent === "quiet" && chat.agentQuietUntil
                ? w.agent.quiet(formatTime(i18n.language, chat.agentQuietUntil))
                : w.agent[chat.agent === "quiet" ? "on" : chat.agent]}
            </span>
          ) : (
            chat?.name && chat.phone && <span className="wa-conv__phone">{showPhone(chat.phone)}</span>
          )}
        </span>
        {chat?.agent && (
          <Switch
            className="wa-conv__agent"
            aria-label={w.agent.label}
            checked={chat.agent === "on"}
            disabled={setAgent.isPending}
            onCheckedChange={(on) => setAgent.mutate({ chatId, on }, { onError: (e) => toast.show(say(e), "error") })}
          />
        )}
      </header>
      <div className="wa-conv__scroll" ref={scroller}>
        {query.isPending ? (
          <span className="wa-conv__wait" role="status">
            <Spinner />
          </span>
        ) : (
          <div className="wa-conv__list">
            {query.hasNextPage && (
              <Button
                className="wa-conv__older"
                variant="ghost"
                size="sm"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {w.loadOlder}
              </Button>
            )}
            {messages.map((message) => {
              const label = dayLabel(t, i18n.language, message.at);
              const divider = label !== day;
              day = label;
              return (
                <div key={message.id} className="wa-conv__item">
                  {divider && <DayDivider day={message.at}>{label}</DayDivider>}
                  <Bubble
                    message={message}
                    group={chat?.group ?? false}
                    answered={message.replyToId ? byId.get(message.replyToId) : undefined}
                    author={
                      message.sentByAgentId
                        ? dir.agentById.get(message.sentByAgentId)?.name
                        : message.sentByUserId
                          ? dir.memberById.get(message.sentByUserId)?.name
                          : undefined
                    }
                    w={w}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {chat?.agent === "person" && (
        <div className="wa-conv__notice" role="status">
          <span>
            {chat.agentNote === "limit"
              ? w.agent.limit
              : chat.agentNote === "failed"
                ? w.agent.failed
                : chat.agentNote && chat.agentNote !== "handoff"
                  ? `${w.agent.handed} ${chat.agentNote}`
                  : w.agent.handed}
          </span>
          <Button
            variant="default"
            size="sm"
            loading={setAgent.isPending}
            onClick={() => setAgent.mutate({ chatId, on: true }, { onError: (e) => toast.show(say(e), "error") })}
          >
            {w.agent.giveBack}
          </Button>
        </div>
      )}
      <footer className="wa-conv__foot">
        <Textarea
          className="wa-conv__input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // The other side sees "typing…" while there are words here, as in WhatsApp's own apps.
            if (e.target.value.trim()) typing.typing();
            else typing.stopped();
          }}
          onBlur={typing.stopped}
          onKeyDown={onKey}
          placeholder={connected ? w.composer.placeholder : w.composer.offline}
          aria-label={w.composer.placeholder}
          disabled={!connected}
          maxLength={4096}
          rows={1}
          autoGrow
        />
        <Button
          variant="primary"
          iconOnly
          icon="send"
          aria-label={w.composer.send}
          loading={send.isPending}
          disabled={!connected || !text.trim()}
          onClick={submit}
        />
      </footer>
    </section>
  );
}

/**
 * WhatsApp: pick a number, see its conversations, read and answer them. `accountId` and `chatId` come from the
 * address, so a number and a conversation can be linked and survive a reload.
 */
export function WhatsAppPage({
  accountId,
  chatId,
  onPick,
}: {
  accountId?: string;
  chatId?: string;
  onPick: (next: { account?: string; chat?: string }) => void;
}) {
  const w = useWords();
  const { org } = useOrg();
  const overview = useWhatsApp(org.id);
  const accounts = overview.data?.accounts ?? [];
  const account = accounts.find((a) => a.id === accountId) ?? accounts.find((a) => a.mine) ?? accounts[0];
  const chats = useWhatsAppChats(org.id, account?.mine ? account.id : null);
  const update = useUpdateWhatsApp(org.id);
  const toast = useToast();
  const say = useWhatsAppError();
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<"connect" | "settings" | "newChat" | "qr" | null>(null);

  const all = chats.data?.pages.flatMap((page) => page.chats) ?? [];
  const needle = filter.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const shown = needle
    ? all.filter(
        (chat) =>
          chat.name.toLowerCase().includes(needle) ||
          chat.lastText.toLowerCase().includes(needle) ||
          (digits.length > 0 && chat.phone?.includes(digits)),
      )
    : all;

  if (overview.isError && !overview.data) {
    return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  }
  if (overview.isPending) {
    return (
      <div className="wa wa--blank" role="status">
        <Spinner />
      </div>
    );
  }
  const manage = overview.data.manage;
  if (!overview.data.on || !account) {
    return (
      <div className="wa wa--blank">
        <EmptyState
          title={overview.data.on ? w.empty.noneTitle : w.empty.offTitle}
          actions={
            overview.data.on && manage ? (
              <Button variant="primary" onClick={() => setDialog("connect")}>
                {w.empty.connect}
              </Button>
            ) : undefined
          }
        >
          {overview.data.on ? (manage ? w.empty.noneText : w.empty.noneAsk) : undefined}
        </EmptyState>
        {dialog === "connect" && (
          <ConnectDialog
            onClose={(id) => {
              setDialog(null);
              if (id) onPick({ account: id });
            }}
          />
        )}
      </div>
    );
  }

  const waiting = account.status !== "connected";
  return (
    <div className="wa" data-open={chatId ? "chat" : "list"}>
      <aside className="wa-side" aria-label={w.title}>
        <header className="wa-side__head">
          <h1 className="wa-side__title">
            <WhatsAppMark size={20} />
            {w.title}
          </h1>
          <Menu
            align="end"
            label={w.more}
            trigger={<Button variant="ghost" size="sm" iconOnly icon="more" aria-label={w.more} />}
          >
            {account.mine && account.status === "connected" && (
              <MenuItem icon="edit" onSelect={() => setDialog("newChat")}>
                {w.newChat}
              </MenuItem>
            )}
            {account.manage && account.agentId && (
              <MenuItem
                icon="agent"
                onSelect={() =>
                  update.mutate(
                    { accountId: account.id, agentOn: !account.agentOn },
                    {
                      onSuccess: (saved) => toast.show(saved.agentOn ? w.agent.turnedOn : w.agent.turnedOff),
                      onError: (e) => toast.show(say(e), "error"),
                    },
                  )
                }
              >
                {account.agentOn ? w.agent.turnOff : w.agent.turnOn}
              </MenuItem>
            )}
            {account.manage && (
              <MenuItem icon="settings" onSelect={() => setDialog("settings")}>
                {w.manage}
              </MenuItem>
            )}
            {manage && (
              <MenuItem icon="plus" onSelect={() => setDialog("connect")}>
                {w.connectAnother}
              </MenuItem>
            )}
          </Menu>
        </header>
        <div className="wa-side__tools">
          <Select
            aria-label={w.account}
            value={account.id}
            onValueChange={(id) => onPick({ account: id })}
            options={accounts.map((a) => ({
              value: a.id,
              label: a.label,
              description: a.status === "connected" ? showPhone(a.phone) : w.status[a.status],
              leading: <StatusDot status={a.status} />,
            }))}
          />
          <SearchInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={w.search}
            aria-label={w.search}
          />
        </div>
        {waiting && (
          <div className="wa-side__notice" role="status">
            <StatusDot status={account.status} />
            <span>{w.status[account.status]}</span>
            {account.manage && (
              <Button variant="link" onClick={() => setDialog("qr")}>
                {w.settings.reconnect}
              </Button>
            )}
          </div>
        )}
        <div className="wa-side__list">
          {!account.mine ? (
            <EmptyState size="inline" title={w.empty.notMineTitle}>
              {w.empty.notMineText}
            </EmptyState>
          ) : chats.isError && !chats.data ? (
            <ErrorState error={chats.error} onRetry={() => void chats.refetch()} />
          ) : chats.isPending ? (
            <span className="wa-side__wait" role="status">
              <Spinner />
            </span>
          ) : shown.length === 0 ? (
            <EmptyState size="inline" title={needle ? w.empty.noMatch : w.empty.noChatsTitle}>
              {needle ? undefined : w.empty.noChatsText}
            </EmptyState>
          ) : (
            <>
              {shown.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === chatId}
                  onOpen={() => onPick({ account: account.id, chat: chat.id })}
                  w={w}
                />
              ))}
              {chats.hasNextPage && !needle && (
                <Button
                  className="wa-side__more"
                  variant="ghost"
                  size="sm"
                  loading={chats.isFetchingNextPage}
                  onClick={() => void chats.fetchNextPage()}
                >
                  {w.loadMoreChats}
                </Button>
              )}
            </>
          )}
        </div>
      </aside>
      <div className="wa-main">
        {chatId && account.mine ? (
          <Conversation
            key={chatId}
            account={account}
            chatId={chatId}
            onBack={() => onPick({ account: account.id })}
            w={w}
          />
        ) : (
          <EmptyState title={w.empty.pickTitle} />
        )}
      </div>
      {dialog === "connect" && (
        <ConnectDialog
          onClose={(id) => {
            setDialog(null);
            if (id) onPick({ account: id });
          }}
        />
      )}
      {dialog === "qr" && <ConnectDialog accountId={account.id} onClose={() => setDialog(null)} />}
      {dialog === "settings" && <NumberDialog account={account} onClose={() => setDialog(null)} />}
      {dialog === "newChat" && (
        <NewChatDialog
          accountId={account.id}
          onClose={(id) => {
            setDialog(null);
            if (id) onPick({ account: account.id, chat: id });
          }}
        />
      )}
    </div>
  );
}
