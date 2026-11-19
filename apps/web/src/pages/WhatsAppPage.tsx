import {
  useReadWhatsAppChat,
  useSendWhatsApp,
  useSendWhatsAppFile,
  useSendWhatsAppSticker,
  useUpdateWhatsApp,
  useWhatsApp,
  useWhatsAppChatAgent,
  useWhatsAppChatContact,
  useWhatsAppChats,
  useWhatsAppClients,
  useWhatsAppMessages,
  useWhatsAppOlderHistory,
  useWhatsAppStickers,
  useWhatsAppTyping,
  type WhatsAppAccount,
  type WhatsAppChat,
  type WhatsAppMessage,
  whatsappFileUrl,
  whatsappPhotoUrl,
} from "@dougbot/client";
import { formatBytes } from "@dougbot/client/lib/files";
import { clockAt, dayLabel, formatTime } from "@dougbot/client/lib/format";
import {
  Avatar,
  Button,
  Chip,
  Composer,
  ComposerFile,
  type ComposerVoice,
  CountBadge,
  DayDivider,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Icon,
  Menu,
  MenuItem,
  SearchInput,
  Select,
  Spinner,
  Switch,
  type VoiceNotice,
} from "@dougbot/ui";
import { type DragEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { useEmojiLabels } from "@/components/Reactions";
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

/**
 * Who the contact is (docs/adr/doug-0004-whatsapp-bridge.md, addendum 2026-11-15): a member of the team (their messages
 * go to their conversation with the number's agent, which answers with all it has), a client of the approval portal
 * (the answers read their own work), or someone outside.
 */
function ContactWho({
  account,
  chatId,
  member,
  client,
  w,
}: {
  account: WhatsAppAccount;
  chatId: string;
  member: string | null;
  client: string | null;
  w: WhatsAppWords;
}) {
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const clients = useWhatsAppClients(org.id);
  const set = useWhatsAppChatContact(org.id, account.id);
  const say = useWhatsAppError();
  const toast = useToast();
  const value = member ? `m:${member}` : client ? `c:${client}` : "none";
  const people = [...dir.memberById.values()];
  const options = [
    { value: "none", label: w.who.none },
    ...people.map((m) => ({ value: `m:${m.userId}`, label: w.who.member(m.name) })),
    ...(clients.data?.clients ?? []).map((c) => ({ value: `c:${c}`, label: w.who.client(c) })),
  ];
  // One set before the lists load still shows as itself.
  if (!options.some((o) => o.value === value)) {
    options.push({ value, label: member ? w.who.member(member) : w.who.client(client ?? "") });
  }
  return (
    <Select
      className="wa-conv__who-is"
      size="sm"
      aria-label={w.who.label}
      value={value}
      disabled={set.isPending}
      options={options}
      onValueChange={(next) =>
        set.mutate(
          {
            chatId,
            member: next.startsWith("m:") ? next.slice(2) : null,
            client: next.startsWith("c:") ? next.slice(2) : null,
          },
          { onError: (e) => toast.show(say(e), "error") },
        )
      }
    />
  );
}

/** One conversation in the list. */
function ChatRow({
  chat,
  photo,
  active,
  onOpen,
  w,
}: {
  chat: WhatsAppChat;
  photo: string | null;
  active: boolean;
  onOpen: () => void;
  w: WhatsAppWords;
}) {
  const { i18n } = useTranslation();
  const title = chatTitle(chat, w);
  const kindIcon = chat.lastKind in KIND_ICONS ? KIND_ICONS[chat.lastKind as keyof typeof KIND_ICONS] : null;
  return (
    <button type="button" className="wa-chat" data-active={active} data-unread={chat.unread > 0} onClick={onOpen}>
      <Avatar name={title} size="md" imageUrl={photo ?? undefined} />
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

/**
 * The number's latest stickers, in the picker beside the emoji: one click sends it. Read when the tab opens.
 */
function StickerTab({
  accountId,
  onPick,
  w,
}: {
  accountId: string;
  onPick: (messageId: string) => void;
  w: WhatsAppWords;
}) {
  const { org } = useOrg();
  const stickers = useWhatsAppStickers(org.id, accountId, true);
  if (stickers.isPending) {
    return (
      <span className="wa-stickers__wait" role="status">
        <Spinner />
      </span>
    );
  }
  const list = stickers.data?.stickers ?? [];
  if (list.length === 0) return <p className="wa-stickers__none">{w.stickers.none}</p>;
  return (
    <div className="wa-stickers">
      {list.map((sticker) => (
        <button
          key={sticker.messageId}
          type="button"
          className="wa-stickers__one"
          aria-label={w.stickers.send}
          onClick={() => onPick(sticker.messageId)}
        >
          <img src={whatsappFileUrl(org.id, accountId, sticker.messageId)} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

/** A file waiting in the composer to be sent. */
interface Pending {
  key: string;
  file: File;
  /** A picture's local address, for its thumbnail. */
  preview?: string;
}
/** What the server takes, and how many go in one send. */
const FILE_MAX = 32 * 1024 * 1024;
const FILES_MAX = 10;

/**
 * A message's file: a picture or a sticker drawn, sound and video with their player, anything else a link that
 * downloads it. One we kept nothing to fetch with, or that WhatsApp no longer has, says so.
 */
function FileView({
  message,
  url,
  onOpen,
  w,
}: {
  message: WhatsAppMessage;
  url: string;
  onOpen: () => void;
  w: WhatsAppWords;
}) {
  const [gone, setGone] = useState(false);
  const kind = message.kind as keyof typeof KIND_ICONS;
  const name = message.media?.fileName ?? w.kind[kind as keyof WhatsAppWords["kind"]];
  if (message.file && !gone && (kind === "image" || kind === "sticker")) {
    return (
      <button type="button" className="wa-bubble__pic" data-kind={kind} aria-label={w.openPicture} onClick={onOpen}>
        <img src={url} alt={name} loading="lazy" onError={() => setGone(true)} />
      </button>
    );
  }
  if (message.file && !gone && kind === "audio") {
    // biome-ignore lint/a11y/useMediaCaption: a voice message someone sent has no captions to offer
    return <audio className="wa-bubble__audio" src={url} controls preload="none" onError={() => setGone(true)} />;
  }
  if (message.file && !gone && kind === "video") {
    // biome-ignore lint/a11y/useMediaCaption: a video someone sent has no captions to offer
    return <video className="wa-bubble__video" src={url} controls preload="none" onError={() => setGone(true)} />;
  }
  const words = (
    <>
      <Icon name={KIND_ICONS[kind]} />
      <span>
        <strong>{name}</strong>
        <small>{gone ? w.fileGone : message.file ? w.fileDownload : w.fileSoon}</small>
      </span>
    </>
  );
  return message.file && !gone ? (
    <a className="wa-bubble__file" href={url} download>
      {words}
    </a>
  ) : (
    <span className="wa-bubble__file">{words}</span>
  );
}

/** One message as a bubble: ours on the right with its ticks, theirs on the left. */
function Bubble({
  message,
  fileUrl,
  onOpenFile,
  onReply,
  group,
  answered,
  author,
  w,
}: {
  message: WhatsAppMessage;
  fileUrl: string;
  onOpenFile: () => void;
  onReply: () => void;
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
      <Button
        className="wa-msg__reply"
        variant="ghost"
        size="sm"
        iconOnly
        icon="reply"
        aria-label={w.reply}
        onClick={onReply}
      />
      <div className="wa-bubble">
        {group && !message.fromMe && (
          <span className="wa-bubble__who">{message.senderName || showPhone(message.senderPhone) || w.unknown}</span>
        )}
        {answered && <span className="wa-bubble__reply">{preview(answered.kind, answered.body, w)}</span>}
        {file && message.media && <FileView message={message} url={fileUrl} onOpen={onOpenFile} w={w} />}
        {file && !message.media && (
          <span className="wa-bubble__file">
            <Icon name={KIND_ICONS[message.kind as keyof typeof KIND_ICONS]} />
            <span>
              <strong>{w.kind[message.kind as keyof WhatsAppWords["kind"]]}</strong>
            </span>
          </span>
        )}
        {message.kind === "deleted" && <span className="wa-bubble__gone">{w.kind.deleted}</span>}
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
  const older = useWhatsAppOlderHistory(org.id, account.id);
  const read = useReadWhatsAppChat(org.id, account.id);
  const say = useWhatsAppError();
  const toast = useToast();
  const [text, setText] = useState("");
  const sendFile = useSendWhatsAppFile(org.id, account.id);
  const sendSticker = useSendWhatsAppSticker(org.id, account.id);
  const emoji = useEmojiLabels();
  const [files, setFiles] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [quote, setQuote] = useState<WhatsAppMessage | null>(null);
  const [picture, setPicture] = useState<WhatsAppMessage | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const addFiles = (picked: File[]) => {
    const fit = picked.filter((file) => file.size > 0 && file.size <= FILE_MAX);
    if (fit.length < picked.length) toast.show(w.fileTooLarge, "error");
    setFiles((list) =>
      [
        ...list,
        ...fit.map((file) => ({
          key: `${file.name}:${file.size}:${file.lastModified}:${Math.random()}`,
          file,
          preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        })),
      ].slice(0, FILES_MAX),
    );
  };
  const dropFile = (key: string) =>
    setFiles((list) => {
      const gone = list.find((f) => f.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return list.filter((f) => f.key !== key);
    });
  const typing = useWhatsAppTyping(org.id, account.id, chatId);
  const scroller = useRef<HTMLDivElement>(null);
  /** The person is reading the latest messages (not scrolled up into the past). */
  const stuck = useRef(true);
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
    if (!el) return;
    stuck.current = true;
    el.scrollTop = el.scrollHeight;
  }, [last, chatId]);
  // While the person is at the bottom it stays there through whatever changes the heights after a message is drawn:
  // the composer growing, a picture's box, the window. Scrolling up to read lets go of it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the list is only there once the messages are, so it is watched again then
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const pin = () => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    };
    const watch = new ResizeObserver(pin);
    watch.observe(el);
    if (el.firstElementChild) watch.observe(el.firstElementChild);
    const onScroll = () => {
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      watch.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [chatId, query.isPending]);
  // Opening it, or a message arriving while it is open, is reading it.
  const unread = chat?.unread ?? 0;
  const markRead = read.mutate;
  useEffect(() => {
    if (unread > 0) markRead(chatId);
  }, [unread, chatId, markRead]);

  const connected = account.status === "connected";
  /** The files go one after the other, the words as the first one's caption; with no file, the words alone. */
  const submit = async (body: string) => {
    if (sending || !connected || (!body && files.length === 0)) return;
    setSending(true);
    try {
      if (files.length === 0) {
        await send.mutateAsync({ chatId, text: body, replyToId: quote?.id ?? null });
      } else {
        let caption = body;
        for (const pending of files) {
          await sendFile.mutateAsync({ chatId, file: pending.file, fileName: pending.file.name, caption });
          caption = "";
          dropFile(pending.key);
        }
      }
      setText("");
      setQuote(null);
      typing.stopped();
    } catch (e) {
      toast.show(say(e), "error");
    } finally {
      setSending(false);
    }
  };
  const voice: ComposerVoice | undefined = connected
    ? {
        scope: chatId,
        onTake: ({ blob }) => {
          const fileName = blob.type.startsWith("audio/webm") ? "voice.webm" : "voice.m4a";
          sendFile.mutate(
            { chatId, file: blob, fileName, voice: true },
            { onError: (e) => toast.show(say(e), "error") },
          );
        },
        onNotice: (notice: VoiceNotice) =>
          toast.show(
            t(notice === "blocked" ? "voice.blockedWeb" : `voice.${notice}`),
            notice === "deleted" ? undefined : "error",
          ),
        labels: {
          record: t("voice.record"),
          recording: t("voice.recording"),
          pause: t("voice.pause"),
          resume: t("voice.resume"),
          discard: t("voice.discard"),
          send: t("voice.send"),
          listen: t("voice.listen"),
          stopListening: t("voice.stopListening"),
          keys: t("voice.keys"),
          keysHold: t("voice.keysHold"),
          keysPaused: t("voice.keysPaused"),
          left: (seconds) => t("voice.left", { seconds }),
          askDiscard: t("voice.askDiscard"),
          askDelete: t("voice.askDelete"),
          askKeep: t("voice.askKeep"),
        },
      }
    : undefined;
  /** A file dragged over the conversation, anywhere in it, is one to send. */
  const onDrop = (event: DragEvent) => {
    if (!connected || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    setDropping(false);
    addFiles([...event.dataTransfer.files]);
  };

  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const title = chat ? chatTitle(chat, w) : "";
  let day = "";
  return (
    <section
      className="wa-conv"
      aria-label={title}
      onDragOver={(event) => {
        if (!connected || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={onDrop}
    >
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
        {chat && <Avatar name={title} size="md" imageUrl={whatsappPhotoUrl(org.id, account.id, chat) ?? undefined} />}
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
        {chat && !chat.group && (
          <ContactWho
            account={account}
            chatId={chatId}
            member={chat.member ?? null}
            client={chat.client ?? null}
            w={w}
          />
        )}
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
            {query.hasNextPage ? (
              <Button
                className="wa-conv__older"
                variant="ghost"
                size="sm"
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {w.loadOlder}
              </Button>
            ) : (
              // Everything kept here is on screen: the phone may still have what came before.
              connected &&
              messages.length > 0 && (
                <Button
                  className="wa-conv__older"
                  variant="ghost"
                  size="sm"
                  loading={older.isPending}
                  onClick={() =>
                    older.mutate(chatId, {
                      onSuccess: () => toast.show(w.askedPhone),
                      onError: (e) => toast.show(say(e), "error"),
                    })
                  }
                >
                  {w.askPhone}
                </Button>
              )
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
                    fileUrl={whatsappFileUrl(org.id, account.id, message.id)}
                    onOpenFile={() => setPicture(message)}
                    onReply={() => {
                      setQuote(message);
                      box.current?.focus();
                    }}
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
                : chat.agentNote.startsWith("failed: ")
                  ? w.agent.failedWhy(chat.agentNote.slice(8))
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
        <Composer
          id={`wa-composer-${chatId}`}
          textareaRef={box}
          value={text}
          onChange={(value) => {
            setText(value);
            // The other side sees "typing…" while there are words here, as in WhatsApp's own apps.
            if (value.trim()) typing.typing();
            else typing.stopped();
          }}
          onSend={(body) => void submit(body)}
          label={w.composer.placeholder}
          placeholder={connected ? w.composer.placeholder : w.composer.offline}
          sendLabel={w.composer.send}
          attachLabel={w.composer.attach}
          onFiles={connected ? addFiles : undefined}
          emoji={{ ...emoji, button: w.stickers.button }}
          pickerLabels={{ dialog: w.stickers.button, tabs: w.stickers.tabs }}
          pickerTabs={
            connected
              ? [
                  {
                    id: "wa-stickers",
                    label: w.stickers.tab,
                    render: ({ close }) => (
                      <StickerTab
                        accountId={account.id}
                        w={w}
                        onPick={(messageId) => {
                          close();
                          sendSticker.mutate({ chatId, messageId }, { onError: (e) => toast.show(say(e), "error") });
                        }}
                      />
                    ),
                  },
                ]
              : undefined
          }
          voice={voice}
          disabled={!connected}
          canSendEmpty={files.length > 0}
          sendBlocked={sending}
          header={
            quote ? (
              <div className="wa-quote">
                <Icon name="reply" size={16} />
                <span className="wa-quote__words">{preview(quote.kind, quote.body, w)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  icon="close"
                  aria-label={w.cancelReply}
                  onClick={() => setQuote(null)}
                />
              </div>
            ) : undefined
          }
          attachments={
            files.length > 0
              ? files.map((pending) => (
                  <ComposerFile
                    key={pending.key}
                    name={pending.file.name}
                    preview={pending.preview}
                    detail={formatBytes(i18n.language, pending.file.size)}
                    status={sending ? "uploading" : "done"}
                    removeLabel={w.removeFile(pending.file.name)}
                    onRemove={() => dropFile(pending.key)}
                  />
                ))
              : undefined
          }
        />
      </footer>
      {dropping && (
        <div className="wa-conv__drop" aria-hidden="true">
          <Icon name="attach" size={20} />
          <span>{w.dropHere}</span>
        </div>
      )}
      {picture && (
        <Dialog
          open
          onOpenChange={(open) => !open && setPicture(null)}
          title={picture.body || w.kind.image}
          closeLabel={w.connectDialog.close}
          width={960}
        >
          <DialogBody>
            <img
              className="wa-picture"
              src={whatsappFileUrl(org.id, account.id, picture.id)}
              alt={picture.body || w.kind.image}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="default"
              icon="download"
              onClick={() => {
                const link = document.createElement("a");
                link.href = whatsappFileUrl(org.id, account.id, picture.id);
                link.download = picture.media?.fileName ?? "whatsapp";
                link.click();
              }}
            >
              {w.fileDownload}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
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
                  photo={whatsappPhotoUrl(org.id, account.id, chat)}
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
