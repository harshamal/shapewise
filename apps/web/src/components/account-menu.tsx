"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export interface AccountMenuProps {
  viewer: { name: string; role: string | null } | null;
  here: string;
  onOpenSettings?: () => void;
  hasSettings?: boolean;
}

/**
 * Topbar account menu: displays user initials, name, role badge,
 * and a modern dropdown menu with workspace actions and sign out.
 */
export function AccountMenu({ viewer, here, onOpenSettings, hasSettings }: AccountMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!viewer) {
    return (
      <Link
        href={`/sign-in?next=${encodeURIComponent(here)}` as never}
        title="Sign in to Shapewise"
        className="flex size-8 items-center justify-center rounded-full border border-border-strong/60 bg-surface text-ink-muted hover:text-ink hover:bg-surface-sunken hover:border-focus transition-colors shadow-2xs"
      >
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      </Link>
    );
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/sign-in");
    router.refresh();
  }

  // Get initial for avatar
  const initial = (viewer.name.trim().charAt(0) || "U").toUpperCase();
  const roleDisplay = viewer.role ? viewer.role.replaceAll("_", " ") : null;

  return (
    <div className="relative" ref={menuRef}>
      {/* Profile Icon Button Trigger */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={viewer ? `${viewer.name}${viewer.role ? ` · ${viewer.role}` : ""}` : "Account"}
        className="flex size-8 items-center justify-center rounded-full border border-border-strong/60 bg-surface hover:bg-surface-sunken hover:border-focus transition-colors focus:outline-focus/40 focus:outline-2 shadow-2xs"
      >
        <div className="flex size-6 items-center justify-center rounded-full bg-accent/15 text-accent font-semibold text-xs">
          {initial}
        </div>
      </button>

      {/* Dropdown Popover */}
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-sw border border-border-strong bg-surface p-1 shadow-overlay z-50 text-xs animate-in fade-in-50 zoom-in-95 duration-100"
        >
          {/* Header Info */}
          <div className="px-2.5 py-2 border-b border-border-strong/50">
            <p className="font-medium text-ink truncate">{viewer.name}</p>
            {roleDisplay && (
              <span className="inline-block mt-0.5 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent capitalize">
                {roleDisplay}
              </span>
            )}
          </div>

          <div className="py-1">
            {hasSettings && onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-2 rounded-sw-sm px-2.5 py-1.5 text-ink hover:bg-surface-sunken text-left transition-colors"
              >
                <svg className="size-3.5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
                </svg>
                <span>Workspace Settings</span>
                <kbd className="ml-auto text-[10px] text-ink-faint">Ctrl ,</kbd>
              </button>
            )}

            <Link
              href={"/workspaces" as never}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-sw-sm px-2.5 py-1.5 text-ink hover:bg-surface-sunken transition-colors"
            >
              <svg className="size-3.5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              <span>Switch workspace</span>
            </Link>

            <Link
              href="/start"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-sw-sm px-2.5 py-1.5 text-ink hover:bg-surface-sunken transition-colors"
            >
              <svg className="size-3.5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              <span>Set up new business</span>
            </Link>

            <Link
              href="/w/demo"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-sw-sm px-2.5 py-1.5 text-ink hover:bg-surface-sunken transition-colors"
            >
              <svg className="size-3.5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5" />
              </svg>
              <span>Explore demo workspace</span>
            </Link>
          </div>

          <div className="border-t border-border-strong/50 pt-1">
            <button
              type="button"
              onClick={signOut}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-sw-sm px-2.5 py-1.5 text-danger-fg hover:bg-danger-bg text-left transition-colors"
            >
              <svg className="size-3.5 text-danger-fg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
              </svg>
              <span>{busy ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
