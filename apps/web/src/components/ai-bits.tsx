"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Attachment } from "@shapewise/ai/client";
import { cx } from "@shapewise/ui";

/* ------------------------------------------------------------ streaming */

/** Reads a newline delimited JSON stream from one of the AI routes, event by event. */
export async function readStream(res: Response, onEvent: (e: Record<string, unknown> & { t: string }) => void): Promise<void> {
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Couldn't reach the assistant. Try again.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

/** Removes dashes used as punctuation from text still streaming in (the server does the same to the final text). */
export function undash(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ").replace(/\s+-\s+/g, ", ").replace(/,\s*,/g, ",");
}

/* ------------------------------------------------------------- motion */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reveals `target` like typing, at a steady pace that speeds up when it
 * falls behind, so text that arrives in bursts still reads smoothly. The
 * target may keep growing while it types (a streamed answer). With
 * `enabled` false the text shows at once.
 */
export function useTypewriter(target: string, enabled = true): { text: string; done: boolean } {
  const instant = !enabled || reducedMotion();
  const [count, setCount] = useState(instant ? target.length : 0);
  const shown = useRef(instant ? target.length : 0);
  const goal = useRef(target);
  goal.current = target;

  useEffect(() => {
    if (instant) {
      shown.current = goal.current.length;
      setCount(goal.current.length);
      return;
    }
    // A timer rather than animation frames: frames stop in background or minimised windows, timers only slow down,
    // and the time since the last tick makes up for any slowdown.
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const len = goal.current.length;
      if (document.hidden) shown.current = len;
      if (shown.current < len) {
        const backlog = len - shown.current;
        // About 60 characters a second, faster the further behind it is.
        const perSecond = 60 + backlog * 5;
        shown.current = Math.min(len, shown.current + Math.max(0.6, (perSecond * dt) / 1000));
      } else if (shown.current > len) shown.current = len;
      const next = Math.floor(shown.current);
      setCount((c) => (c === next ? c : next));
    };
    const timer = setInterval(tick, 16);
    return () => clearInterval(timer);
  }, [instant]);

  const n = Math.min(count, target.length);
  return { text: target.slice(0, n), done: n >= target.length };
}

/**
 * Keeps a conversation pinned to its newest line while it grows, but only
 * while the person is at the bottom: scrolling up to read stops it. Uses an
 * instant jump per frame of growth (smooth scrolling on every chunk is what
 * makes the scrollbar jitter). Returns a function that pins it again, for
 * when the person sends a message.
 */
export function useStickToBottom(content: React.RefObject<HTMLElement | null>, scroller?: React.RefObject<HTMLElement | null>) {
  const stuck = useRef(true);
  const pin = useCallback(() => {
    stuck.current = true;
    const el = scroller?.current ?? document.scrollingElement;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scroller]);

  useEffect(() => {
    const body = content.current;
    if (!body) return;
    const el = () => scroller?.current ?? document.scrollingElement!;
    const source: HTMLElement | Window = scroller?.current ?? window;
    const atBottom = () => {
      const s = el();
      return s.scrollHeight - s.scrollTop - s.clientHeight < 96;
    };
    // Only the person unpins it (wheel or drag up, keys, the scrollbar). The page moving
    // itself (content shrinking, scroll anchoring, our own jumps) never does.
    let dragging = false;
    const leave = () => {
      if (!atBottom()) stuck.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) stuck.current = false;
    };
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if ((e.touches[0]?.clientY ?? 0) > touchY + 4) stuck.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(e.key) && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) stuck.current = false;
    };
    const onDown = () => (dragging = true);
    const onUp = () => (dragging = false);
    const onScroll = () => {
      if (atBottom()) stuck.current = true;
      else if (dragging) leave();
    };
    const follow = () => {
      if (!stuck.current) return;
      const s = el();
      s.scrollTop = s.scrollHeight;
    };
    const ro = new ResizeObserver(follow);
    ro.observe(body);
    const target = scroller?.current ?? document;
    source.addEventListener("scroll", onScroll, { passive: true });
    target.addEventListener("wheel", onWheel as EventListener, { passive: true });
    target.addEventListener("touchstart", onTouchStart as EventListener, { passive: true });
    target.addEventListener("touchmove", onTouchMove as EventListener, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      ro.disconnect();
      source.removeEventListener("scroll", onScroll);
      target.removeEventListener("wheel", onWheel as EventListener);
      target.removeEventListener("touchstart", onTouchStart as EventListener);
      target.removeEventListener("touchmove", onTouchMove as EventListener);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [content, scroller]);

  return pin;
}

/* --------------------------------------------------------------- status */

/** A shimmering label while the model works, e.g. "Looking at invoices". */
export function Thinking({ label = "Thinking" }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 py-1.5 text-sm animate-fade">
      <span className="relative flex size-3.5 items-center justify-center" aria-hidden="true">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/25" />
        <span className="size-1.5 rounded-full bg-accent" />
      </span>
      <span className="animate-shimmer">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------- choices */

const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:opacity-50";

/**
 * Tappable answers under a question. `single`/`confirm` send on tap; `multi`
 * toggles and sends with Continue, starting from `preselected`. `lead`
 * renders before the options (e.g. a primary action the page adds).
 */
export function Choices({
  kind,
  options,
  preselected,
  disabled,
  onAnswer,
  lead,
}: {
  kind: "single" | "multi" | "confirm";
  options: string[];
  preselected?: string[];
  disabled?: boolean;
  onAnswer: (answer: string) => void;
  lead?: React.ReactNode;
}) {
  const [picked, setPicked] = useState<string[]>(preselected ?? []);
  const stagger = (i: number) => ({ animationDelay: `${60 + i * 35}ms` });

  if (kind !== "multi") {
    return (
      <div className="flex flex-wrap gap-2">
        {lead}
        {options.map((o, i) => (
          <button key={o} type="button" disabled={disabled} onClick={() => onAnswer(o)} style={stagger(i)} className={cx(chip, "animate-pop border-border-strong bg-surface hover:border-ink-faint hover:bg-surface-sunken")}>
            {o}
          </button>
        ))}
      </div>
    );
  }

  const none = (o: string) => /^(none|not registered|no )/i.test(o);
  const toggle = (o: string) =>
    setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : none(o) ? [o] : [...p.filter((x) => !none(x)), o]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Pick any that apply">
        {lead}
        {options.map((o, i) => {
          const on = picked.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(o)}
              style={stagger(i)}
              className={cx(chip, "animate-pop", on ? "border-accent bg-accent-soft text-ink" : "border-border-strong bg-surface hover:border-ink-faint hover:bg-surface-sunken")}
            >
              <span aria-hidden="true" className={cx("flex size-3.5 items-center justify-center rounded-full border transition-colors", on ? "border-accent bg-accent text-accent-ink" : "border-border-strong")}>
                {on && (
                  <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m2.5 6.5 2.2 2.2L9.5 3.8" />
                  </svg>
                )}
              </span>
              {o}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3 animate-fade" style={{ animationDelay: `${120 + options.length * 35}ms` }}>
        <button
          type="button"
          disabled={disabled || picked.length === 0}
          onClick={() => onAnswer(joinList(picked))}
          className={cx(chip, "border-ink bg-ink text-canvas hover:opacity-90 disabled:border-border-strong disabled:bg-transparent disabled:text-ink-faint")}
        >
          Continue{picked.length > 0 && <span className="tabular opacity-70">· {picked.length}</span>}
        </button>
        <span className="text-xs text-ink-faint">{preselected?.length ? "Ticked from what you told me. Change anything that's wrong." : "Pick any that apply, or type below"}</span>
      </div>
    </div>
  );
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/* ---------------------------------------------------------- attachments */

export type PendingAttachment = Attachment & { id: string; status: "reading" | "ready" | "failed"; error?: string; preview?: string };

const IMAGE_MAX = 1600;

/** Downscales a photo in the browser so it travels fast and the model still reads it clearly. */
async function imageToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export const ACCEPT = ".pdf,.xlsx,.csv,.txt,.md,.json,image/png,image/jpeg,image/webp,image/gif";

/**
 * Files the person attaches to their next message. Photos are read in the
 * browser; documents are sent to /api/attachments for their text.
 */
export function useAttachments(max = 6) {
  const [items, setItems] = useState<PendingAttachment[]>([]);

  const add = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files].slice(0, Math.max(0, max - items.length));
      const entries = list.map((f) => ({ file: f, id: crypto.randomUUID() }));
      setItems((cur) => [...cur, ...entries.map(({ file, id }) => ({ id, name: file.name, mime: file.type, kind: file.type.startsWith("image/") ? ("image" as const) : ("text" as const), status: "reading" as const }))]);
      const update = (id: string, patch: Partial<PendingAttachment>) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      await Promise.all(
        entries.map(async ({ file, id }) => {
          try {
            if (file.type.startsWith("image/")) {
              if (file.size > 15 * 1024 * 1024) return update(id, { status: "failed", error: "Over 15 MB" });
              const dataUrl = await imageToDataUrl(file);
              return update(id, { status: "ready", kind: "image", mime: "image/jpeg", dataUrl, preview: dataUrl });
            }
            const form = new FormData();
            form.append("file", file);
            const res = await fetch("/api/attachments", { method: "POST", body: form });
            const body = (await res.json().catch(() => ({}))) as { attachments?: Attachment[]; errors?: { message: string }[]; message?: string };
            const a = body.attachments?.[0];
            if (!a) return update(id, { status: "failed", error: body.errors?.[0]?.message ?? body.message ?? "Couldn't read it" });
            update(id, { ...a, status: "ready" });
          } catch {
            update(id, { status: "failed", error: "Couldn't read it" });
          }
        }),
      );
    },
    [items.length, max],
  );

  const remove = (id: string) => setItems((cur) => cur.filter((x) => x.id !== id));
  const clear = () => setItems([]);
  /** The ready attachments, in the shape the routes take. */
  const ready = (): Attachment[] => items.filter((x) => x.status === "ready").map(({ id: _i, status: _s, error: _e, preview: _p, ...a }) => a);
  return { items, add, remove, clear, ready, busy: items.some((x) => x.status === "reading") };
}

function FileGlyph({ name }: { name: string }) {
  const ext = name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "";
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-[9px] font-medium tracking-wide text-ink-muted">{ext}</span>;
}

/** Attachment cards above the composer, or under a sent message. */
export function AttachmentList({ items, onRemove, compact }: { items: (Attachment & { id?: string; status?: string; error?: string; preview?: string })[]; onRemove?: (id: string) => void; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={cx("flex flex-wrap gap-2", compact && "justify-end")}>
      {items.map((a, i) => (
        <li
          key={a.id ?? `${a.name}${i}`}
          className={cx("group relative flex max-w-60 items-center gap-2.5 rounded-xl border bg-surface py-1.5 pr-3 pl-1.5 text-xs animate-pop", a.status === "failed" && "border-danger-fg/40")}
          title={a.error ?? a.name}
        >
          {a.kind === "image" && (a.preview || a.dataUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={a.preview ?? a.dataUrl} alt="" className="size-8 shrink-0 rounded-md object-cover" />
          ) : (
            <FileGlyph name={a.name} />
          )}
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">{a.name}</span>
            <span className={cx("block truncate", a.status === "failed" ? "text-danger-fg" : "text-ink-faint")}>
              {a.status === "reading" ? <span className="animate-shimmer">Reading…</span> : a.status === "failed" ? a.error : a.kind === "image" ? "Photo" : a.pages ? `${a.pages} ${a.mime.includes("sheet") ? (a.pages === 1 ? "sheet" : "sheets") : a.pages === 1 ? "page" : "pages"}` : "Document"}
            </span>
          </span>
          {onRemove && a.id && (
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              onClick={() => onRemove(a.id!)}
              className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full border bg-surface text-ink-muted shadow-sm group-hover:flex focus-visible:flex"
            >
              <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                <path d="m3 3 6 6M9 3 3 9" />
              </svg>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------- composer */

/**
 * The message box: grows with its text, Enter sends, Shift+Enter breaks a
 * line. Files can be attached with the clip, dropped on it or pasted.
 * `hero` is the large centred version for an empty conversation.
 */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
  label,
  inputRef,
  attachments,
  hero,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  label: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  attachments?: ReturnType<typeof useAttachments>;
  hero?: boolean;
  hint?: React.ReactNode;
}) {
  const file = useRef<HTMLInputElement>(null);
  const own = useRef<HTMLTextAreaElement>(null);
  const area = inputRef ?? own;
  const [dragging, setDragging] = useState(false);
  const maxHeight = hero ? 240 : 200;

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, area, maxHeight]);
  const canSend = !disabled && !attachments?.busy && (value.trim().length > 0 || (attachments?.items.some((a) => a.status === "ready") ?? false));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      onDragOver={(e) => {
        if (!attachments || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!attachments) return;
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) attachments.add(e.dataTransfer.files);
      }}
      className={cx(
        "relative rounded-[20px] border bg-surface transition-[border-color,box-shadow] duration-200 composer-glow",
        dragging ? "border-accent" : "border-border-strong focus-within:border-ink-faint",
        hero ? "p-3" : "p-2",
      )}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[20px] bg-accent-soft/80 text-sm text-ink animate-fade">Drop to attach</div>
      )}
      {attachments && attachments.items.length > 0 && (
        <div className="px-1.5 pt-1.5 pb-2">
          <AttachmentList items={attachments.items} onRemove={attachments.remove} />
        </div>
      )}
      <textarea
        ref={area}
        aria-label={label}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          if (!attachments) return;
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            attachments.add(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
        }}
        className={cx(
          "block w-full resize-none bg-transparent px-2.5 text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none",
          hero ? "min-h-14 py-1.5 text-[15px] leading-relaxed" : "min-h-9 py-2 text-sm leading-normal",
        )}
      />
      <div className="flex items-center gap-1.5 pt-1">
        {attachments && (
          <>
            <input
              ref={file}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) attachments.add(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => file.current?.click()}
              aria-label="Attach files"
              title="Attach a PDF, Excel sheet, CSV or photo"
              className="flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <svg viewBox="0 0 20 20" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m16.5 9.5-6.4 6.4a4 4 0 0 1-5.7-5.7l6.8-6.8a2.7 2.7 0 0 1 3.8 3.8l-6.8 6.8a1.3 1.3 0 0 1-1.9-1.9l6.2-6.2" />
              </svg>
            </button>
          </>
        )}
        {hint && <span className="min-w-0 truncate px-1 text-xs text-ink-faint">{hint}</span>}
        <button
          type="submit"
          aria-label="Send"
          disabled={!canSend}
          className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-canvas transition-[opacity,transform,background-color] duration-150 hover:opacity-90 active:scale-95 disabled:bg-surface-sunken disabled:text-ink-faint"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ rich text */

/**
 * The small slice of Markdown assistants actually write: paragraphs,
 * bullet and numbered lists, pipe tables and **bold**. Rendered as React
 * nodes, never as HTML. `streaming` adds a caret to the last block.
 */
export function RichText({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks: React.ReactNode[] = [];
  // Close an unfinished **bold** while typing, so asterisks never flash.
  const open = streaming && (text.match(/\*\*/g)?.length ?? 0) % 2 === 1;
  const lines = (open ? `${text}**` : text).replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto rounded-sw border">
          <table className="w-full text-left text-[13px] tabular">
            {head && (
              <thead className="bg-surface-sunken/60">
                <tr className="border-b">
                  {head.map((c, j) => (
                    <th key={j} className="px-2.5 py-1.5 text-xs font-medium text-ink-muted">
                      <Inline text={c} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((r, k) => (
                <tr key={k} className="border-b last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className="px-2.5 py-1.5">
                      <Inline text={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i]!)) items.push(lines[i++]!.replace(bullet, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={blocks.length} className={cx("space-y-1 pl-5", ordered ? "list-decimal marker:text-ink-faint" : "list-disc marker:text-ink-faint")}>
          {items.map((it, j) => (
            <li key={j}>
              <Inline text={it} />
            </li>
          ))}
        </List>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !bullet.test(lines[i]!) && !/^\s*\|/.test(lines[i]!)) para.push(lines[i++]!.replace(/^#+\s*/, ""));
    blocks.push(
      <p key={blocks.length}>
        <Inline text={para.join(" ")} />
      </p>,
    );
  }
  if (streaming && !blocks.length) return <span className="caret" />;
  return <div className={cx("space-y-2.5 leading-relaxed", streaming && "[&>*:last-child]:caret")}>{blocks}</div>;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}
