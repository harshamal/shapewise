"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { NavSection } from "@shapewise/blueprint";
import { cx } from "@shapewise/ui";
import type { SettingsData } from "@/lib/settings-data";
import { AccountMenu } from "./account-menu";
import { LAST_WORKSPACE_COOKIE } from "@/lib/last-workspace";
import { AssistantPanel } from "./assistant-panel";
import { SettingsDialog } from "./settings-dialog";
import { Logo } from "./logo";

/**
 * Modern Workspace Shell:
 * - Superb Topbar: Breadcrumbs, Ask AI Command Pill, Settings, and Profile Menu.
 * - Minimal Modern Sidebar: Clean typography, collapsible groups, and full toggle support.
 */
export function WorkspaceShell({
  base,
  workspaceName,
  viewer,
  sections,
  settings,
  title,
  actions,
  children,
}: {
  /** /w/{tenant} */
  base: string;
  workspaceName: string;
  viewer: { name: string; role: string | null } | null;
  sections: NavSection[];
  settings: SettingsData;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const settingsTab = params.get("settings");

  // Sidebar toggle state (desktop collapse & mobile drawer)
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  // Restore sidebar preference from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sw_sidebar_open");
      if (saved !== null) {
        setSidebarOpen(saved === "true");
      }
    } catch {
      // Ignore localStorage read errors
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sw_sidebar_open", String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const openSettings = useCallback(
    (tab?: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("settings", tab ?? settingsTab ?? settings.tabs[0]?.key ?? "organisation");
      router.replace(`${pathname}?${next}` as never, { scroll: false });
    },
    [params, pathname, router, settings.tabs, settingsTab],
  );

  const closeSettings = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("settings");
    const q = next.toString();
    router.replace(`${pathname}${q ? `?${q}` : ""}` as never, { scroll: false });
  }, [params, pathname, router]);

  // Global keyboard shortcuts: Ctrl+, (Settings), Ctrl+J (Ask AI), Ctrl+B (Toggle Sidebar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "," && settings.tabs.length) {
        e.preventDefault();
        openSettings();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAskOpen((o) => !o);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings, settings.tabs.length, toggleSidebar]);

  // Auto-close mobile drawer when route changes
  useEffect(() => {
    setMobileDrawerOpen(false);
  }, [pathname]);

  const tenant = base.split("/").pop() ?? "";
  // Remember this workspace so it's first on the workspaces page next time.
  useEffect(() => {
    if (tenant) document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(tenant)}; path=/; max-age=31536000; samesite=lax`;
  }, [tenant]);

  return (
    <div className="flex min-h-dvh bg-canvas text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sw focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Mobile Drawer Backdrop */}
      {mobileDrawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs md:hidden animate-in fade-in duration-150"
          onClick={() => setMobileDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Modern Minimal Sidebar */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-rail text-rail-ink border-r border-white/5 transition-[transform,width] duration-200 ease-in-out md:static",
          // Mobile state
          mobileDrawerOpen ? "translate-x-0 w-64 shadow-2xl" : "-translate-x-full md:translate-x-0",
          // Desktop state
          sidebarOpen ? "md:w-55 md:shrink-0" : "md:w-0 md:border-r-0 md:overflow-hidden",
        )}
        aria-label="Workspace Sidebar"
      >
        {/* Sidebar Header */}
        <div className="flex h-14 shrink-0 items-center justify-between px-4 border-b border-white/5">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Logo size={20} />
            <span className="font-medium tracking-tight text-sm text-rail-ink group-hover:text-white transition-colors">
              Shapewise
            </span>
          </Link>

          {/* Collapse Button inside Sidebar Header */}
          <button
            type="button"
            onClick={() => {
              if (mobileDrawerOpen) setMobileDrawerOpen(false);
              else toggleSidebar();
            }}
            aria-label="Collapse sidebar"
            title="Collapse sidebar (Ctrl+B)"
            className="flex size-7 items-center justify-center rounded-md text-rail-muted hover:text-rail-ink hover:bg-rail-active transition-colors"
          >
            <SidebarToggleIcon collapsed={false} />
          </button>
        </div>

        {/* Nav Items Scroll Area */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4" aria-label="Main Navigation">
          {sections.map((section) => (
            <div key={section.key}>
              <p className="px-2 pb-1 text-[10px] font-semibold tracking-wider text-rail-muted/60 uppercase">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.modules.length === 1 && section.modules[0]!.submodules.length > 1
                  ? section.modules[0]!.submodules.map((s) => {
                    const href = `${base}/${section.modules[0]!.key}/${s.key}`;
                    return (
                      <li key={s.key}>
                        <NavLink href={href} active={pathname === href || pathname.startsWith(`${href}/`)}>
                          {s.label}
                        </NavLink>
                      </li>
                    );
                  })
                  : section.modules.map((m) => {
                    const href = `${base}/${m.key}`;
                    if (m.submodules.length === 1) {
                      const only = m.submodules[0]!;
                      const target = m.key === "overview" ? base : `${href}/${only.key}`;
                      const active = m.key === "overview" ? pathname === base : pathname.startsWith(href);
                      return (
                        <li key={m.key}>
                          <NavLink href={target} active={active}>
                            {m.label}
                          </NavLink>
                        </li>
                      );
                    }
                    return (
                      <ModuleGroup
                        key={m.key}
                        href={href}
                        label={m.label}
                        pathname={pathname}
                        items={m.submodules.map((s) => ({ href: `${href}/${s.key}`, label: s.label }))}
                      />
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Minimal Footer */}
        <div className="p-3 border-t border-white/5 flex items-center justify-between text-[11px] text-rail-muted">
          <span className="text-[10px] text-rail-muted/50">Press Ctrl+B to toggle</span>
          <button
            type="button"
            onClick={toggleSidebar}
            className="hover:text-rail-ink transition-colors flex items-center gap-1"
            title="Collapse sidebar"
          >
            <span>Hide</span>
            <SidebarToggleIcon collapsed={false} className="size-3.5" />
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Superb Topbar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border-strong/40 bg-surface/85 px-4 backdrop-blur-md md:px-6">
          {/* Left: Sidebar Toggle + Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Toggle Button for Desktop and Mobile */}
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 768) {
                  setMobileDrawerOpen(true);
                } else {
                  toggleSidebar();
                }
              }}
              aria-label="Toggle sidebar"
              title="Toggle sidebar (Ctrl+B)"
              className="flex size-8 shrink-0 items-center justify-center rounded-sw border border-border-strong/60 bg-surface text-ink-muted hover:text-ink hover:bg-surface-sunken transition-colors shadow-2xs"
            >
              <SidebarToggleIcon collapsed={!sidebarOpen} />
            </button>

            <div className="h-4 w-px bg-border-strong/60 hidden sm:block" />

            {/* Breadcrumb Context */}
            <div className="flex items-center gap-1.5 min-w-0 text-xs sm:text-sm">
              <Link
                href={base as never}
                className="font-medium text-ink-muted hover:text-ink transition-colors truncate max-w-[120px] sm:max-w-[180px]"
                title={workspaceName}
              >
                {workspaceName}
              </Link>
              <span className="text-ink-faint text-xs">/</span>
              <h1 className="font-semibold tracking-tight text-ink truncate max-w-[140px] sm:max-w-[260px] md:max-w-[380px]">
                {title}
              </h1>
            </div>
          </div>

          {/* Center: AI Search / Query Command Pill */}
          <div className="hidden lg:flex items-center justify-center flex-1 max-w-sm mx-4">
            <button
              type="button"
              onClick={() => setAskOpen(true)}
              aria-keyshortcuts="Control+J"
              className="flex w-full items-center justify-between gap-2 h-8 px-3 rounded-full bg-surface-sunken/80 border border-border-strong/60 text-xs text-ink-muted hover:text-ink hover:border-focus hover:bg-surface transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-2 truncate">
                <SparklesIcon className="size-3.5 text-accent shrink-0" />
                <span className="truncate">Ask AI or query numbers...</span>
              </div>
              <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface border border-border-strong/60 text-ink-faint group-hover:text-ink-muted shrink-0">
                Ctrl J
              </kbd>
            </button>
          </div>

          {/* Right: Actions, Ask Button (mobile), Settings, Profile */}
          <div className="flex items-center gap-2 shrink-0">
            {actions}

            {/* Mobile / Tablet Ask Button */}
            <button
              type="button"
              onClick={() => setAskOpen((o) => !o)}
              aria-expanded={askOpen}
              aria-keyshortcuts="Control+J"
              className="lg:hidden inline-flex size-8 items-center justify-center rounded-sw border border-border-strong/60 bg-surface text-ink-muted hover:text-ink hover:bg-surface-sunken transition-colors shadow-2xs"
              title="Ask AI (Ctrl+J)"
            >
              <SparklesIcon className="size-4 text-accent" />
            </button>

            {/* Settings Icon Button in Topbar */}
            {settings.tabs.length > 0 && (
              <button
                type="button"
                onClick={() => openSettings()}
                aria-keyshortcuts="Control+Comma"
                className="flex size-8 items-center justify-center rounded-sw border border-border-strong/60 bg-surface text-ink-muted hover:text-ink hover:bg-surface-sunken hover:border-focus transition-colors shadow-2xs"
                title="Workspace Settings (Ctrl+,)"
              >
                <GearIcon />
              </button>
            )}

            {/* User Profile / Account Menu in Topbar */}
            <AccountMenu
              viewer={viewer}
              here={pathname}
              onOpenSettings={openSettings}
              hasSettings={settings.tabs.length > 0}
            />
          </div>
        </header>

        {/* Main Workspace Canvas */}
        <main id="main" className="flex-1 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>

      {/* Floating Dialogs */}
      <AssistantPanel tenant={tenant} open={askOpen} onClose={() => setAskOpen(false)} />
      <SettingsDialog
        data={settings}
        open={settingsTab !== null}
        tab={settingsTab ?? ""}
        onTab={openSettings}
        onClose={closeSettings}
      />
    </div>
  );
}

function ModuleGroup({
  href,
  label,
  items,
  pathname,
}: {
  href: string;
  label: string;
  items: { href: string; label: string }[];
  pathname: string;
}) {
  const inside = pathname === href || pathname.startsWith(`${href}/`);
  const [open, setOpen] = useState(inside);
  const id = `nav-${href.replaceAll("/", "-")}`;

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-sm transition-colors hover:bg-rail-active hover:text-rail-ink",
          inside ? "text-rail-ink font-medium" : "text-rail-muted",
        )}
      >
        <span className="truncate">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={cx("transition-transform text-rail-muted shrink-0", open && "rotate-90 text-rail-ink")}
        >
          <path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul id={id} className="my-0.5 ml-2 space-y-0.5 border-l border-white/10 pl-2">
          {items.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} active={pathname === item.href || pathname.startsWith(`${item.href}/`)} small>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function NavLink({
  href,
  active,
  small,
  children,
}: {
  href: string;
  active: boolean;
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href as never}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center rounded-md px-2 transition-colors",
        small ? "h-7 text-[11px]" : "h-8 text-[12px]",
        active
          ? "bg-rail-active text-rail-ink font-medium shadow-xs"
          : "text-rail-muted hover:bg-rail-active/60 hover:text-rail-ink",
      )}
    >
      <span className="truncate">{children}</span>
    </Link>
  );
}

function SidebarToggleIcon({ collapsed, className = "size-4" }: { collapsed?: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      {collapsed ? <path d="m14 10 2 2-2 2" /> : <path d="m16 10-2 2 2 2" />}
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function SparklesIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  );
}
