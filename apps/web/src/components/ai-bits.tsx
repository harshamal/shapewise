"use client";

import { useState } from "react";
import { cx } from "@shapewise/ui";

/** Three quiet dots while the model works. */
export function Thinking({ label = "Thinking" }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center gap-1 py-2">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-breathe rounded-full bg-ink-faint" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

const chip = "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors disabled:opacity-50";

/**
 * Tappable answers under a question. `single`/`confirm` send on tap; `multi`
 * toggles and sends with Continue. `extra` renders after the options (e.g. a
 * primary action the page adds).
 */
export function Choices({
  kind,
  options,
  disabled,
  onAnswer,
  lead,
}: {
  kind: "single" | "multi" | "confirm";
  options: string[];
  disabled?: boolean;
  onAnswer: (answer: string) => void;
  lead?: React.ReactNode;
}) {
  const [picked, setPicked] = useState<string[]>([]);

  if (kind !== "multi") {
    return (
      <div className="flex flex-wrap gap-2">
        {lead}
        {options.map((o) => (
          <button key={o} type="button" disabled={disabled} onClick={() => onAnswer(o)} className={cx(chip, "border-border-strong bg-surface hover:border-ink-faint hover:bg-surface-sunken")}>
            {o}
          </button>
        ))}
      </div>
    );
  }

  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Pick any that apply">
        {lead}
        {options.map((o) => {
          const on = picked.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(o)}
              className={cx(chip, on ? "border-accent bg-accent-soft text-ink" : "border-border-strong bg-surface hover:border-ink-faint hover:bg-surface-sunken")}
            >
              <span aria-hidden="true" className={cx("flex size-3.5 items-center justify-center rounded-full border text-[9px] leading-none", on ? "border-accent bg-accent text-accent-ink" : "border-border-strong")}>
                {on ? "✓" : ""}
              </span>
              {o}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || picked.length === 0}
          onClick={() => onAnswer(joinList(picked))}
          className={cx(chip, "border-ink bg-ink text-canvas hover:opacity-90 disabled:border-border-strong disabled:bg-transparent disabled:text-ink-faint")}
        >
          Continue{picked.length > 0 && <span className="tabular opacity-70">· {picked.length}</span>}
        </button>
        <span className="text-xs text-ink-faint">Pick any that apply, or type below</span>
      </div>
    </div>
  );
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The message box: grows with its text, Enter sends, Shift+Enter breaks a line. */
export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
  label,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
  label: string;
  inputRef?: React.Ref<HTMLTextAreaElement>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      className="flex items-end gap-2 rounded-2xl border border-border-strong bg-surface p-2 pl-4 transition-colors focus-within:border-ink-faint"
    >
      <textarea
        ref={inputRef}
        aria-label={label}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
        className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none"
      />
      <button
        type="submit"
        aria-label="Send"
        disabled={disabled || !value.trim()}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-canvas transition-opacity hover:opacity-90 disabled:bg-surface-sunken disabled:text-ink-faint"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
        </svg>
      </button>
    </form>
  );
}

/**
 * The small slice of Markdown assistants actually write: paragraphs,
 * bullet and numbered lists, pipe tables and **bold**. Rendered as React
 * nodes, never as HTML.
 */
export function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
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
        <div key={blocks.length} className="-mx-1 overflow-x-auto">
          <table className="w-full text-left text-[13px] tabular">
            {head && (
              <thead>
                <tr className="border-b">
                  {head.map((c, j) => (
                    <th key={j} className="px-1 py-1.5 text-xs font-medium text-ink-muted">
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
                    <td key={j} className="px-1 py-1.5">
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
        <List key={blocks.length} className={cx("space-y-1 pl-5", ordered ? "list-decimal" : "list-disc marker:text-ink-faint")}>
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
  return <div className="space-y-2.5 leading-relaxed">{blocks}</div>;
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
