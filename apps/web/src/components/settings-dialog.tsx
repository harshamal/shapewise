"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import type { OverlayOp } from "@shapewise/blueprint";
import { Button, Input, Select, StatusPill, cx } from "@shapewise/ui";
import { changeSettings } from "@/app/w/[tenant]/actions";
import type { SettingsData } from "@/lib/settings-data";

/**
 * Settings as a popup, like SyncBooks: sections on the left (searchable),
 * the section on the right. Switches and selects apply as soon as they
 * change; the server validates the whole blueprint and refuses anything that
 * would break it, with the reason shown here.
 */
export function SettingsDialog({ data, open, tab, onTab, onClose }: { data: SettingsData; open: boolean; tab: string; onTab: (t: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const tabs = data.tabs.filter((t) => t.label.toLowerCase().includes(query.toLowerCase()));
  const active = data.tabs.find((t) => t.key === tab) ?? data.tabs[0]!;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="settings-title"
      className="m-auto h-[min(760px,92dvh)] w-[min(1040px,96vw)] max-w-none overflow-hidden rounded-sw border bg-canvas p-0 text-ink shadow-overlay backdrop:bg-black/40"
    >
      {open && (
        <div className="grid h-full grid-cols-1 md:grid-cols-[240px_1fr]">
          <aside className="hidden flex-col border-r bg-surface md:flex">
            <div className="flex h-14 items-center px-4">
              <h2 id="settings-title" className="font-medium">
                Settings
              </h2>
            </div>
            <div className="px-3 pb-2">
              <Input type="search" placeholder="Search settings" aria-label="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8" />
            </div>
            <nav aria-label="Settings sections" className="flex-1 overflow-y-auto px-2 pb-3">
              <ul className="space-y-0.5">
                {tabs.map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => onTab(t.key)}
                      aria-current={t.key === active.key ? "page" : undefined}
                      className={cx("flex h-8 w-full items-center rounded-sw-sm px-2 text-left text-sm", t.key === active.key ? "bg-surface-sunken text-ink" : "text-ink-muted hover:bg-surface-sunken hover:text-ink")}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
                {tabs.length === 0 && <li className="px-2 py-1 text-sm text-ink-muted">No matches.</li>}
              </ul>
            </nav>
          </aside>

          <section className="flex min-h-0 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
              <Select aria-label="Settings section" className="h-8 w-auto md:hidden" value={active.key} onChange={(e) => onTab(e.target.value)}>
                {data.tabs.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <h3 className="hidden font-medium md:block">{active.label}</h3>
              <span className="ml-auto text-xs text-ink-faint">Blueprint version {data.version}</span>
              <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-sw text-ink-muted hover:bg-surface-sunken hover:text-ink" aria-label="Close settings">
                ×
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <Section data={data} tab={active.key} />
            </div>
          </section>
        </div>
      )}
    </dialog>
  );
}

/* ----------------------------------------------------------------- sections */

function Section({ data, tab }: { data: SettingsData; tab: string }) {
  const s = data.settings;
  const ext = new Set(data.extensions.filter((e) => e.on).map((e) => e.key));
  switch (tab) {
    case "organisation":
      return <Organisation data={data} />;
    case "users":
      return <Users data={data} />;
    case "roles":
      return <Roles data={data} />;
    case "extensions":
      return <Extensions data={data} />;
    case "custom_fields":
      return (
        <Table
          empty="No custom fields yet."
          head={["Record", "Where", "Field", "Type", "On documents", "In production"]}
          rows={data.customFields.map((c) => [c.record, c.part === "line" ? "Each line" : "Header", c.label, c.type, c.onDocuments ? "Yes" : "No", c.inProduction ? "Yes" : "No"])}
          note="Add or change custom fields by asking in System changes."
        />
      );
    case "approval_rules":
      return <Approvals data={data} />;
    case "numbering":
      return <Table head={["Record", "Pattern", ""]} rows={data.numbering.map((n) => [n.record, <code key="p" className="text-[13px]">{n.pattern}</code>, n.custom ? "Customised" : ""])} note="{yyyy} year · {mm} month · {seq:5} counter with 5 digits. Counters are gap-free and restart each year when the pattern has a year." />;
    case "document_rules":
      return (
        <Controls
          data={data}
          rows={[
            { path: "sales.defaultPaymentTermsDays", label: "Default payment terms", hint: "Days until an invoice is due when the customer has no terms of their own.", kind: "number", value: s.sales.defaultPaymentTermsDays },
            { path: "sales.quoteValidityDays", label: "Quotes valid for", hint: "Days.", kind: "number", value: s.sales.quoteValidityDays },
            { path: "sales.creditLimitMode", label: "Customer over credit limit", kind: "mode", value: s.sales.creditLimitMode },
            { path: "sales.moqMode", label: "Below minimum order quantity", kind: "mode", value: s.sales.moqMode, show: ext.has("moq") },
            { path: "sales.dispatchInvoiceAs", label: "Invoice made on dispatch is", kind: "select", options: [["draft", "A draft"], ["posted", "Posted"]], value: s.sales.dispatchInvoiceAs, show: ext.has("dispatch_invoicing") },
            { path: "sales.allowBackorders", label: "Allow selling more than is in stock", kind: "toggle", value: s.sales.allowBackorders },
            { path: "purchasing.receiveWithoutPo", label: "Allow goods received without a purchase order", kind: "toggle", value: s.purchasing.receiveWithoutPo },
            { path: "purchasing.unapprovedSupplierMode", label: "Buying from a supplier that isn't approved", kind: "mode", value: s.purchasing.unapprovedSupplierMode, show: ext.has("supplier_qualification") },
            { path: "purchasing.matchTolerancePct", label: "Three-way match tolerance", hint: "Percent difference allowed between order, receipt and bill.", kind: "number", value: s.purchasing.matchTolerancePct, show: ext.has("three_way_match") },
            { path: "general.allowDocDateEdit", label: "Allow back-dating documents", kind: "toggle", value: s.general.allowDocDateEdit },
            { path: "accounting.budgetEnforcement", label: "Spending over budget", kind: "mode", value: s.accounting.budgetEnforcement },
            { path: "accounting.costCentres", label: "Cost centres on journal lines", kind: "toggle", value: s.accounting.costCentres },
          ]}
        />
      );
    case "tax_settings":
      return (
        <Controls
          data={data}
          intro={`Chart of accounts: ${data.chartLabel}.`}
          rows={[
            { path: "tax.vatRegistered", label: "VAT registered", kind: "toggle", value: s.tax.vatRegistered },
            { path: "tax.ssclRegistered", label: "SSCL registered", kind: "toggle", value: s.tax.ssclRegistered },
            { path: "tax.wht", label: "Withholding tax on payments and receipts", kind: "toggle", value: s.tax.wht },
            { path: "tax.irdTaxInvoice", label: "IRD tax invoice format", kind: "toggle", value: s.tax.irdTaxInvoice },
          ]}
        />
      );
    case "inventory_rules":
      return (
        <Controls
          data={data}
          rows={[
            { path: "inventory.costingMethod", label: "Costing method", kind: "select", options: [["weighted_average", "Weighted average"], ["fifo", "First in, first out"]], value: s.inventory.costingMethod },
            { path: "inventory.negativeStock", label: "Stock going below zero", kind: "mode", value: s.inventory.negativeStock },
            { path: "inventory.fifoDispatch", label: "Pick the oldest expiry first", kind: "toggle", value: s.inventory.fifoDispatch, show: ext.has("lots") },
            { path: "inventory.expiryAlertDays", label: "Expiry reminders", hint: "Days before expiry, separated by commas.", kind: "list", value: s.inventory.expiryAlertDays.join(", "), show: ext.has("lots") },
          ]}
        />
      );
    case "units":
      return <Table empty="No units yet." head={["Code", "Name"]} rows={data.seed.units.map((u) => [u.code, u.name])} />;
    case "item_classes":
      return <Table empty="No item classes yet." head={["Code", "Name", "Within"]} rows={data.seed.itemClasses.map((c) => [c.code, c.name, c.parent ?? ""])} />;
    case "production_setup":
      return <Production data={data} />;
    case "agents":
      return (
        <Controls
          data={data}
          intro="External agents connect over MCP with a token and act with that token's role. Every change they make is audited."
          rows={[
            { path: "agents.mcpEnabled", label: "Allow agents to connect (MCP)", kind: "toggle", value: s.agents.mcpEnabled },
            { path: "agents.holdAgentWrites", label: "Hold agent changes for approval", kind: "select", options: [["none", "Only when approval rules say so"], ["posting", "Anything that posts to the ledger or stock"], ["all", "Every change"]], value: s.agents.holdAgentWrites },
          ]}
        />
      );
    default:
      return <p className="text-sm text-ink-muted">Nothing to set here yet.</p>;
  }
}

/* ------------------------------------------------------------------ editing */

function useApply(tenant: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const apply = (ops: OverlayOp[]) =>
    start(async () => {
      const r = await changeSettings(tenant, ops);
      setStatus({ ok: r.ok, message: r.message ?? (r.ok ? "Saved." : "Not saved.") });
      router.refresh();
    });
  return { apply, pending, status };
}

function StatusLine({ status }: { status: { ok: boolean; message: string } | null }) {
  if (!status) return null;
  return (
    <p role={status.ok ? "status" : "alert"} className={cx("rounded-sw px-3 py-2 text-sm", status.ok ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
      {status.message}
    </p>
  );
}

type Row =
  | { path: string; label: string; hint?: string; kind: "toggle"; value: boolean; show?: boolean }
  | { path: string; label: string; hint?: string; kind: "number"; value: number; show?: boolean }
  | { path: string; label: string; hint?: string; kind: "list"; value: string; show?: boolean }
  | { path: string; label: string; hint?: string; kind: "mode"; value: string; show?: boolean }
  | { path: string; label: string; hint?: string; kind: "select"; options: [string, string][]; value: string; show?: boolean };

const MODES: [string, string][] = [
  ["off", "Allow"],
  ["warn", "Warn"],
  ["block", "Refuse"],
];

function Controls({ data, rows, intro }: { data: SettingsData; rows: Row[]; intro?: string }) {
  const { apply, pending, status } = useApply(data.tenant);
  const set = (path: string, value: unknown) => apply([{ op: "set_setting", path, value }]);
  const disabled = pending || !data.canManage;

  return (
    <div className="space-y-4">
      {intro && <p className="text-sm text-ink-muted">{intro}</p>}
      {!data.canManage && <p className="text-sm text-ink-muted">Your role can see these settings but not change them.</p>}
      <StatusLine status={status} />
      <ul className="divide-y rounded-sw border bg-surface">
        {rows
          .filter((r) => r.show !== false)
          .map((r) => (
            <li key={r.path} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{r.label}</p>
                {r.hint && <p className="text-xs text-ink-muted">{r.hint}</p>}
              </div>
              <div className="w-56 max-w-full">
                {r.kind === "toggle" ? (
                  <Switch label={r.label} checked={r.value} disabled={disabled} onChange={(v) => set(r.path, v)} />
                ) : r.kind === "number" ? (
                  <CommitInput label={r.label} value={String(r.value)} disabled={disabled} onCommit={(v) => set(r.path, Number(v))} inputMode="decimal" />
                ) : r.kind === "list" ? (
                  <CommitInput label={r.label} value={r.value} disabled={disabled} onCommit={(v) => set(r.path, v.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)))} />
                ) : (
                  <Select aria-label={r.label} className="h-8" value={r.value} disabled={disabled} onChange={(e) => set(r.path, e.target.value)}>
                    {(r.kind === "mode" ? MODES : r.options).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** A text box that saves when you leave it or press Enter, not on every key. */
function CommitInput({ label, value, onCommit, disabled, inputMode }: { label: string; value: string; onCommit: (v: string) => void; disabled?: boolean; inputMode?: "decimal" }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return <Input aria-label={label} className="h-8" value={v} disabled={disabled} inputMode={inputMode} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-border-strong")}
    >
      <span className={cx("inline-block size-5 rounded-full bg-surface shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

/* ----------------------------------------------------------- content blocks */

function Organisation({ data }: { data: SettingsData }) {
  const { apply, pending, status } = useApply(data.tenant);
  const b = data.business;
  const [form, setForm] = useState({ name: b.name, legalName: b.legalName ?? "", tin: b.tin ?? "", vatNo: b.vatNo ?? "", brNo: b.brNo ?? "", timezone: b.timezone, fiscalYearStartMonth: String(b.fiscalYearStartMonth) });
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const field = (key: keyof typeof form, label: string) => (
    <label className="block">
      <span className="mb-1.5 block text-sm text-ink-muted">{label}</span>
      <Input value={form[key]} disabled={!data.canManage} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
    </label>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        apply([{ op: "set_business", patch: { ...form, legalName: form.legalName || undefined, tin: form.tin || undefined, vatNo: form.vatNo || undefined, brNo: form.brNo || undefined, fiscalYearStartMonth: Number(form.fiscalYearStartMonth) } }]);
      }}
    >
      <StatusLine status={status} />
      <div className="grid gap-4 rounded-sw border bg-surface p-5 sm:grid-cols-2">
        {field("name", "Business name")}
        {field("legalName", "Legal name")}
        {field("tin", "TIN")}
        {field("vatNo", "VAT number")}
        {field("brNo", "Business registration number")}
        {field("timezone", "Timezone")}
        <label className="block">
          <span className="mb-1.5 block text-sm text-ink-muted">Financial year starts</span>
          <Select value={form.fiscalYearStartMonth} disabled={!data.canManage} onChange={(e) => setForm((f) => ({ ...f, fiscalYearStartMonth: e.target.value }))}>
            {months.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </Select>
        </label>
        <div>
          <span className="mb-1.5 block text-sm text-ink-muted">Currency</span>
          <p className="flex h-9 items-center text-sm">{b.currency}</p>
        </div>
      </div>
      {data.canManage && (
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      )}
    </form>
  );
}

function Users({ data }: { data: SettingsData }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="text-ink-muted">People sign in with Google. Each person has one role in this workspace, which decides what they can see and do.</p>
      <Table head={["Role", "What it's for"]} rows={data.roles.map((r) => [r.label, r.owner ? "Full access, approvals and system changes" : (r.description ?? "")])} />
      <p className="text-ink-muted">Inviting people arrives with workspace sign-up.</p>
    </div>
  );
}

function Roles({ data }: { data: SettingsData }) {
  const [open, setOpen] = useState(data.roles[0]?.id);
  return (
    <ul className="space-y-2">
      {data.roles.map((r) => (
        <li key={r.id} className="rounded-sw border bg-surface">
          <button type="button" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? undefined : r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
            <span className="font-medium">{r.label}</span>
            {r.owner && <StatusPill tone="info">Owner</StatusPill>}
            <span className="flex-1 truncate text-sm text-ink-muted">{r.description}</span>
            <span className="text-sm text-ink-muted">{r.grants.length} area{r.grants.length === 1 ? "" : "s"}</span>
          </button>
          {open === r.id && (
            <div className="border-t px-4 py-3">
              <Table head={["Area", "Can", "Which records"]} rows={r.grants.map((g) => [g.label, g.actions.join(", "), g.scope])} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Extensions({ data }: { data: SettingsData }) {
  const { apply, pending, status } = useApply(data.tenant);
  const groups = useMemo(() => {
    const m = new Map<string, SettingsData["extensions"]>();
    for (const e of data.extensions) m.set(e.category, [...(m.get(e.category) ?? []), e]);
    return [...m.entries()];
  }, [data.extensions]);

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">Optional features. Everything is off until you need it; switching one on adds its screens and fields.</p>
      <StatusLine status={status} />
      {groups.map(([category, list]) => (
        <section key={category} aria-labelledby={`ext-${category}`}>
          <h4 id={`ext-${category}`} className="mb-2 text-xs text-ink-muted">
            {category}
          </h4>
          <ul className="divide-y rounded-sw border bg-surface">
            {list.map((e) => (
              <li key={e.key} className="flex items-start gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{e.name}</p>
                  <p className="text-sm text-ink-muted">{e.summary}</p>
                  {e.requires.length > 0 && <p className="mt-0.5 text-xs text-ink-faint">Needs {e.requires.join(", ")}.</p>}
                  {e.blockedBy.length > 0 && <p className="mt-0.5 text-xs text-warning-fg">Needs the {e.blockedBy.join(" and ")} module.</p>}
                </div>
                <Switch label={e.name} checked={e.on} disabled={pending || !data.canManage || (e.blockedBy.length > 0 && !e.on)} onChange={(v) => apply([{ op: "set_extension", key: e.key as never, enabled: v }])} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Approvals({ data }: { data: SettingsData }) {
  if (!data.approvals.length) return <p className="text-sm text-ink-muted">Nothing needs approval.</p>;
  return (
    <ul className="space-y-2">
      {data.approvals.map((a) => (
        <li key={a.id} className="rounded-sw border bg-surface px-4 py-3 text-sm">
          <p className="font-medium">{a.label}</p>
          <p className="text-ink-muted">
            {a.record} · when someone tries to {a.action.replaceAll("_", " ")}
            {a.channels && ` · only from ${a.channels.join(", ")}`}
            {a.when && (
              <>
                {" "}
                · if <code className="text-[13px]">{a.when}</code>
              </>
            )}
          </p>
          <ol className="mt-2 flex flex-wrap items-center gap-1.5">
            {a.stages.map((s, i) => (
              <li key={s.name + i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-ink-faint">then</span>}
                <StatusPill tone="neutral">
                  {s.roles.join(s.requireAll ? " and " : " or ")}
                  {s.minAmount > 0 ? ` from Rs ${s.minAmount.toLocaleString("en-LK")}` : ""}
                </StatusPill>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}

function Production({ data }: { data: SettingsData }) {
  const p = data.settings.production;
  const lib = data.seed.production;
  const ext = new Set(data.extensions.filter((e) => e.on).map((e) => e.key));
  return (
    <div className="space-y-8">
      <Controls
        data={data}
        rows={[
          { path: "production.useOperations", label: "Routing on recipes", hint: "Steps with machines, moulds, labour and process parameters.", kind: "toggle", value: p.useOperations },
          { path: "production.useOutputs", label: "Co-products, by-products and regrind", kind: "toggle", value: p.useOutputs },
          { path: "production.mixModeDefault", label: "New recipes as % of mix", kind: "toggle", value: p.mixModeDefault },
          { path: "production.qcHoldByDefault", label: "Hold new batches for QC", kind: "toggle", value: p.qcHoldByDefault },
          { path: "production.autoNcrOnFail", label: "Open an NCR when QC fails", kind: "toggle", value: p.autoNcrOnFail, show: ext.has("ncr") },
          { path: "production.coaBeforeDispatch", label: "Certificate of analysis before dispatch", kind: "toggle", value: p.coaBeforeDispatch },
          { path: "production.samplePerThousand", label: "Incoming inspection sample", hint: "Units per 1,000 received.", kind: "number", value: p.samplePerThousand, show: ext.has("incoming_qc") },
          { path: "production.publicTrace", label: "Public product verification page", kind: "toggle", value: p.publicTrace },
        ]}
      />
      <Block title={`Machines and resources (${lib.resources.length})`}>
        <Table empty="None yet." head={["Code", "Name", "Type", "Within", "Rs per hour"]} rows={lib.resources.map((r) => [r.code, r.name, r.type.replaceAll("_", " "), r.parent ?? "", r.hourlyRate?.toLocaleString("en-LK") ?? ""])} />
      </Block>
      <Block title={`Parameter library (${lib.parameters.length})`}>
        <Table empty="None yet." head={["Code", "Name", "Kind", "Unit", "Min", "Max"]} rows={lib.parameters.map((x) => [x.code, x.name, x.category, x.unit ?? "", x.min ?? "", x.max ?? ""])} />
      </Block>
      <Block title={`Operation types (${lib.operationTypes.length})`}>
        <Table empty="None yet." head={["Operation", "Parameters"]} rows={lib.operationTypes.map((o) => [o.name, (o.params ?? []).join(", ")])} />
      </Block>
      <Block title={`QC templates (${lib.qcTemplates.length})`}>
        <ul className="space-y-2">
          {lib.qcTemplates.map((q) => (
            <li key={q.name} className="rounded-sw border bg-surface px-4 py-3 text-sm">
              <p className="font-medium">
                {q.name} <span className="font-normal text-ink-muted">· {q.appliesTo === "receipt" ? "receiving" : "batch release"}</span>
              </p>
              <p className="text-ink-muted">{q.params.map((x) => x.name).join(" · ")}</p>
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      {children}
    </section>
  );
}

function Table({ head, rows, empty, note }: { head: string[]; rows: ReactNode[][]; empty?: string; note?: string }) {
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-sw border bg-surface px-4 py-6 text-center text-sm text-ink-muted">{empty ?? "Nothing here."}</p>
      ) : (
        <div className="overflow-x-auto rounded-sw border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-ink-muted">
                {head.map((h, i) => (
                  <th key={i} scope="col" className="h-9 px-4 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className="px-4 py-2">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {note && <p className="text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

