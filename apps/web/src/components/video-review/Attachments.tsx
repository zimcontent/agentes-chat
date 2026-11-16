import type { VideoReview, VideoReviewAttachment, VideoReviewAttachmentInput } from "@agenteschat/client";
import { Button, Icon, Input, Spinner } from "@agenteschat/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/context";
import { useUploadFailed } from "@/components/Limits";
import { useOrg } from "@/components/org-context";
import type { ReviewWords } from "./words";

/*
 * What a reviewer hands the editor with a note (docs/adr/doug-0007-video-review.md): a photo or a clip dragged onto the
 * player, picked or pasted, and B-roll links. Files go up at once as files of the review's conversation, where the
 * agent reaches them (`import_file`); the note keeps their ids and the links.
 */

type Media = "image" | "video" | "audio" | "other";

function mediaOf(name: string, type: string): Media {
  if (type.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(name)) return "image";
  if (type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv)$/i.test(name)) return "video";
  if (type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name)) return "audio";
  return "other";
}

const ICONS = { image: "image", video: "video", audio: "mic", other: "attach" } as const;

/** A file on its way up, or up; a link as typed. */
type Item =
  | {
      key: string;
      type: "file";
      name: string;
      media: Media;
      preview: string | null;
      artifactId: string | null;
      state: "up" | "done" | "failed";
    }
  | { key: string; type: "link"; url: string };

/** The http(s) addresses in a piece of text: one link each. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((m) => m[0].replace(/[),.;]+$/, ""));
}

/** What a drop carries: files, or the addresses of something dragged from another tab. */
export function dropped(data: DataTransfer): { files: File[]; links: string[] } {
  const files = [...data.files];
  if (files.length > 0) return { files, links: [] };
  return { files: [], links: linksIn(data.getData("text/uri-list") || data.getData("text/plain")) };
}

/** Whether a drag over the player carries something a note can take. */
export const carries = (data: DataTransfer) =>
  [...data.types].some((t) => t === "Files" || t === "text/uri-list" || t === "text/plain");

let next = 0;

/** One note's attachments while it is written. */
export function useAttachments(review: Pick<VideoReview, "id" | "channelId" | "threadId">) {
  const api = useApi();
  const { org } = useOrg();
  const uploadFailed = useUploadFailed();
  const [items, setItems] = useState<Item[]>([]);
  const previews = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const key = `f${++next}`;
        const media = mediaOf(file.name, file.type);
        const preview = media === "image" || media === "video" ? URL.createObjectURL(file) : null;
        if (preview) previews.current.push(preview);
        setItems((all) => [
          ...all,
          { key, type: "file", name: file.name, media, preview, artifactId: null, state: "up" },
        ]);
        api.artifacts
          // Into the review's conversation, for whoever reviews it, reading that conversation or not (doug-0014).
          .upload(org.id, file, { channelId: review.channelId, threadId: review.threadId, reviewId: review.id })
          .then((saved) =>
            setItems((all) =>
              all.map((i) => (i.key === key && i.type === "file" ? { ...i, artifactId: saved.id, state: "done" } : i)),
            ),
          )
          .catch((error: unknown) => {
            setItems((all) => all.map((i) => (i.key === key && i.type === "file" ? { ...i, state: "failed" } : i)));
            uploadFailed(error);
          });
      }
    },
    [api, org.id, review.id, review.channelId, review.threadId, uploadFailed],
  );

  const addLinks = useCallback((urls: string[]) => {
    setItems((all) => [
      ...all,
      ...urls
        .filter((url) => !all.some((i) => i.type === "link" && i.url === url))
        .map((url) => ({ key: `l${++next}`, type: "link" as const, url })),
    ]);
  }, []);

  const remove = (key: string) => setItems((all) => all.filter((i) => i.key !== key));
  const clear = useCallback(() => setItems([]), []);
  const busy = items.some((i) => i.type === "file" && i.state === "up");
  const inputs: VideoReviewAttachmentInput[] = items.flatMap((i): VideoReviewAttachmentInput[] => {
    if (i.type === "link") return [{ url: i.url }];
    return i.state === "done" && i.artifactId ? [{ artifactId: i.artifactId, name: i.name }] : [];
  });
  return { items, addFiles, addLinks, remove, clear, busy, inputs, count: inputs.length };
}

export type Attachments = ReturnType<typeof useAttachments>;

/** The attachments of the note being written, with a way to add a file and a link. */
export function AttachEditor({ at, w }: { at: Attachments; w: ReviewWords }) {
  const picker = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const addLink = () => {
    const urls = linksIn(link.trim());
    if (urls.length === 0) return;
    at.addLinks(urls);
    setLink("");
  };
  return (
    <div className="vr-attach">
      {at.items.length > 0 && (
        <ul className="vr-attach__list">
          {at.items.map((item) => (
            <li
              key={item.key}
              className="vr-attach__item"
              data-failed={(item.type === "file" && item.state === "failed") || undefined}
            >
              {item.type === "file" && item.media === "image" && item.preview ? (
                <img className="vr-attach__thumb" src={item.preview} alt="" />
              ) : item.type === "file" && item.media === "video" && item.preview ? (
                <video className="vr-attach__thumb" src={item.preview} muted preload="metadata" />
              ) : (
                <span className="vr-attach__icon">
                  <Icon name={item.type === "link" ? "link" : ICONS[item.media]} />
                </span>
              )}
              <span className="vr-attach__name">{item.type === "link" ? item.url : item.name}</span>
              {item.type === "file" && item.state === "up" && <Spinner size={14} />}
              {item.type === "file" && item.state === "failed" && (
                <span className="vr-attach__bad">{w.uploadFailed}</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                iconOnly
                aria-label={w.removeAttachment}
                onClick={() => at.remove(item.key)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="vr-attach__add">
        <Button size="sm" icon="attach" onClick={() => picker.current?.click()}>
          {w.attachFile}
        </Button>
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept="image/*,video/*,audio/*"
          onChange={(e) => {
            at.addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Input
          className="vr-attach__link"
          value={link}
          inputMode="url"
          placeholder={w.linkPlaceholder}
          aria-label={w.linkPlaceholder}
          onChange={(e) => setLink(e.target.value)}
          onBlur={addLink}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
        />
      </div>
    </div>
  );
}

/** A sent or saved note's attachments: photos as thumbnails, the rest as chips that open them. */
export function NoteAttachments({ items, w }: { items: VideoReviewAttachment[]; w: ReviewWords }) {
  const api = useApi();
  const { org } = useOrg();
  if (items.length === 0) return null;
  return (
    <ul className="vr-attach__list vr-attach__list--note" aria-label={w.attachments}>
      {items.map((a) =>
        a.type === "file" ? (
          <li key={a.artifactId}>
            <a
              className="vr-attach__item vr-attach__item--link"
              href={api.artifacts.fileUrl(org.id, a.artifactId)}
              target="_blank"
              rel="noreferrer noopener"
              title={a.name}
            >
              {a.media === "image" ? (
                <img
                  className="vr-attach__thumb"
                  src={api.artifacts.fileUrl(org.id, a.artifactId)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <span className="vr-attach__icon">
                  <Icon name={ICONS[a.media]} />
                </span>
              )}
              <span className="vr-attach__name">{a.name}</span>
            </a>
          </li>
        ) : (
          <li key={a.url}>
            <a
              className="vr-attach__item vr-attach__item--link"
              href={a.url}
              target="_blank"
              rel="noreferrer noopener"
              title={a.url}
            >
              <span className="vr-attach__icon">
                <Icon name="link" />
              </span>
              <span className="vr-attach__name">{a.label && a.label !== a.url ? a.label : a.url}</span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}
