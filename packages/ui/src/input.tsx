import type { ComponentProps } from "react";
import { cx } from "./cx";

/** Shared look for text-like controls: hairline border, accent focus ring, danger when invalid. */
export const controlClass = cx(
  "h-9 w-full rounded-sw border border-border-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint",
  "focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus/30",
  "disabled:bg-surface-sunken disabled:text-ink-muted",
  "aria-[invalid=true]:border-danger-fg",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(controlClass, className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cx(controlClass, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(controlClass, "h-auto min-h-20 py-2", className)} {...props} />;
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return <input type="checkbox" className={cx("size-4 rounded-sw-sm border-border-strong accent-[var(--sw-accent)]", className)} {...props} />;
}
