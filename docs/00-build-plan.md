# Shapewise build plan

Version 0.1 · 15 October 2026 · Source: *Shapewise Product and Build Specification v1.1*

> **Superseded** by `01-architecture-modules-build-plan.html` (PDF: `Shapewise-Architecture-Modules-Build-Plan.pdf`), which switches the theme to Manufacturing and adds the layered blueprint, engines, modules and build order.

This document turns the spec into a buildable architecture. It keeps the spec's product and principles, and changes the stack to one TypeScript codebase on Next.js, Firebase and Google Cloud.

---

## 1. What we keep from the spec, what we change

| Area | Spec says | Plan | Why |
|---|---|---|---|
| Web | React SPA on Firebase Hosting | **Next.js 16 (App Router) on Firebase App Hosting** | App Hosting runs Next.js on Cloud Run with CDN, SSR, server actions and secrets built in. One framework for UI and BFF. |
| API | NestJS on Cloud Run | **No separate API service.** Domain packages called from Next.js server actions and route handlers | A second HTTP hop adds latency and a deploy unit without adding a seam. The seam is the package boundary, so it can be lifted into a service later. |
| Agents | ADK (Python) | **ADK for TypeScript** (fallback: Python, see open decisions) | Blueprint Zod schema, tool definitions and validators are shared with the runtime instead of duplicated across two languages. |
| MCP | Streamable HTTP on Cloud Run | Same, as its own Cloud Run service | Agent traffic scales and rate limits independently of the web app. |
| Data | Cloud SQL Postgres + RLS + JSONB | **Firestore (Native mode) only**, with native vector search | Fully Firebase-native, schemaless (fits dynamic blueprints), realtime listeners for live screens, no connection pools to exhaust, scales to zero. Ledger safety moves into server-only transactional engines (§4.4). |
| Tenancy | RLS per row | Path isolation `tenants/{tid}/…` + Security Rules on custom claims + server-side tenant guard | |
| Auth | Firebase Auth | Same, with custom claims for tenant memberships | |
| Jobs | Cloud Tasks → Cloud Run | Cloud Tasks for long jobs; Firestore-triggered Cloud Functions (2nd gen) relay the outbox | |
| Models | Gemini family, pinned in config | **Gemini on Vertex AI** through the Google Gen AI SDK (`@google/genai`), service-account auth, no API keys in prod. AI Studio key only for local dev. Model IDs in one config file with per-task fallbacks | Same SDK for both, regional control, enterprise terms. Spec warns IDs change quickly. |
| Gemma | Roadmap | **One live Gemma task in the prototype:** Gemma 4 on Cloud Run (GPU) for bulk column typing and value cleaning during import, with Flash-Lite as fallback. TranslateGemma for the Sinhala UI labels if time allows | Shows both model families the Cup names, and the self-hosted privacy path. |
| Files | Cloud Storage | Cloud Storage for Firebase, per-tenant paths, Storage Rules, signed URLs | |
| Imports | XLSX, CSV, photos, Sheets link | Same; **Google Sheets** via Google Picker + Sheets API (read-only scope) | Native Google Workspace import is a natural demo moment. |
| Security | Secret Manager | Secret Manager + **Firebase App Check** (reCAPTCHA Enterprise) on the web app + per-token rate limits on MCP | |
| Fonts | — | Inter via Google Fonts (`next/font/google`), Noto Sans Sinhala for the local language | |

---

## 2. The one rule that removes bottlenecks

**Every write, from any surface, goes through one command pipeline.**

```
Web UI ─┐
Assistant ─┼─▶ execute(command, actor) ─▶ authorize ─▶ approval policy ─▶ engine ─▶ audit + outbox ─▶ commit
MCP ─────┘                                   (role)       (risky? park it)   (ledger, stock, records)
```

- Humans, the built-in assistant and external agents are just actors with a role and a channel (`web`, `assistant`, `mcp`).
- Tools are **generated from the blueprint once** and served to both MCP and the assistant. One definition, two surfaces.
- Because the pipeline is the only writer, adding a new surface (WhatsApp, mobile, webhooks) is an adapter, not new business logic.

---

## 3. Repository layout (pnpm + Turborepo monorepo)

```
apps/
  web/            Next.js 16: landing, onboarding, workspace, change studio, approvals, settings
  mcp/            MCP Streamable HTTP server, /mcp/{tenant}, token auth, rate limits
  agents/         ADK architect agent (interview, files, blueprint, change planning) + operator agent
  worker/         Cloud Tasks handlers + Firestore-triggered functions: imports, PDFs, embeddings, outbox relay, backfills

packages/
  blueprint/      Zod schema, validator with precise errors, diff, migration planner, expression language
  engines/        ledger, inventory, numbering, permissions + approvals, audit (pure domain, no I/O vendors)
  runtime/        command pipeline, query planner over JSONB, compiled-blueprint cache
  tools/          blueprint → tool definitions (JSON Schema), shared by MCP and assistant
  db/             Firestore path builders, typed converters, tenant-scoped transaction helper, rules + index definitions
  ai/             model router, task → model config, structured output + repair loop, prompt templates
  ui/             design system: tokens, primitives, data table, form renderer, kanban, calendar
  config/         eslint, tsconfig, tailwind preset
```

Dependency direction is one way: `apps → runtime/tools/ai → engines/blueprint → db`. `engines` and `blueprint` import no framework and no vendor SDK, so they are unit tested in isolation.

---

## 4. Data architecture (Firestore)

### 4.1 Layout

```
tenants/{tid}                                   name, currency, locale, timezone, activeBlueprintVersion
tenants/{tid}/members/{uid}                     roleKey
tenants/{tid}/blueprints/{version}              immutable blueprint body + compiled metadata
tenants/{tid}/records/{rid}                     entityKey, data, idx, status, version, links[], searchTokens[], embedding
tenants/{tid}/accounts/{aid}                    chart of accounts
tenants/{tid}/journal/{jid}                     balanced entry with lines embedded (append only)
tenants/{tid}/stockMoves/{mid}                  append only
tenants/{tid}/stockLevels/{itemId}              on-hand projection, updated in the same transaction
tenants/{tid}/sequences/{docKey}                gap-free counters
tenants/{tid}/approvals/{id}                    parked commands
tenants/{tid}/audit/{id}                        append only
tenants/{tid}/rollups/{metric_yyyymmdd}         dashboard aggregates, updated in the command transaction
tenants/{tid}/changes/{id}                      change requests: diff, preview, status, undo pointer
tenants/{tid}/jobs/{id}                         import / generation progress (clients listen live)
mcpTokens/{hash}                                tenantId, roleKey, label, revoked  (lookup by hash)
```

One `records` collection per tenant (with `entityKey`) rather than one per entity, so a blueprint change never needs a new collection and every query hits the same indexed collection ID.

### 4.2 Dynamic fields that stay queryable at any scale

Firestore needs composite indexes for filter + sort, and indexes are per database, not per tenant. Generating indexes per tenant blueprint would hit the index limit. So:

- **Fields are stored by stable field ID, not by label or key** (`data.f_7k2`). Renaming a field is a blueprint-only change: no data rewrite, instant and reversible.
- **Typed index slots.** The blueprint compiler assigns each filterable or sortable field to a slot: `idx.s1..s8` (text), `idx.n1..n6` (number), `idx.d1..d6` (date), `idx.r1..r4` (reference). A fixed catalogue of composite indexes over `(entityKey, status, slot)` is deployed once and serves every tenant and every blueprint.
- **Computed fields are materialised on write.** The compiler builds a dependency graph (`customer.orderCount` depends on `order.customer`) and the command pipeline updates dependents in the same transaction. No read-time fan-out.
- **References** are stored as IDs plus a `links[]` array for reverse lookups (`array-contains`).
- **Search:** `searchTokens[]` (normalised prefixes) for instant lookups; Firestore native vector search (`findNearest`) on `embedding` for fuzzy matching and the assistant.
- **Dashboards** read `rollups` documents (one per metric per day), never scan records. Firestore `count/sum` aggregation queries cover ad-hoc questions.

### 4.3 Tenant isolation

1. **Paths:** all tenant data lives under `tenants/{tid}`; no cross-tenant collections except token lookup.
2. **Security Rules:** clients may *read* only under tenants in their custom claims, filtered by role where needed (e.g. a rider reads records where `assigneeUid == request.auth.uid`). **Clients never write.** All writes go through the server with the Admin SDK.
3. **Server guard:** the command pipeline resolves the tenant from the verified token and builds every path through one `tenantRef(tid)` helper, so a path for another tenant cannot be constructed from user input.

Clients use realtime listeners for lists, kanban, approvals and job progress, so the UI updates live without polling.

### 4.4 Keeping money and stock correct without SQL constraints

Firestore transactions are ACID and serialisable, so the guarantees move from DB constraints into server-only engines plus rules:

| Invariant | How it is enforced |
|---|---|
| Debits equal credits | The ledger engine is the only writer of `journal`; it refuses unbalanced entries; lines are embedded in one document so an entry is written atomically or not at all. Rules deny all client writes. |
| Postings are immutable | Rules deny update/delete; engine API has no update. Corrections are reversing entries. |
| Gap-free numbering | Counter document incremented inside the same transaction that issues the document. Small businesses stay far below the ~1 write/s per document contention limit. |
| Stock on hand matches moves | `stockMoves` append and `stockLevels` update happen in one transaction; a scheduled integrity job recomputes and alerts on drift. |
| Money precision | Stored as integer minor units (`amountMinor`, plus currency), never floats. |
| Concurrent edits | `version` field checked inside the transaction (optimistic locking). |

A nightly integrity function re-verifies ledger balance and stock projections per tenant.

### 4.5 Blueprint versions as cache keys

Blueprints are immutable per `(tid, version)`. The compiled form (validators, slot map, tool list, permission matrix, dependency graph) is cached in-process by that key, so no request re-parses a blueprint and invalidation is free: a new version is a new key.

### 4.6 Migrations and undo

Most changes are metadata-only because fields are addressed by stable IDs (add, rename, relabel, new rule, new view, new role permission). Changes that touch data (retype, split, backfill a new computed field) run as a Cloud Tasks job with BulkWriter, write the previous value alongside, and are reversible from the change record. The active version only flips once the backfill completes.

## 5. AI architecture

| Task | Model (configurable) | Pattern |
|---|---|---|
| Interview, file reading, import mapping, change previews, assistant | Gemini Flash (spec: 3.8 Flash) | ADK agent, structured output |
| Full blueprint design, complex changes, repair | Gemini Pro (spec: 3.1 Pro) | Structured output against the blueprint JSON Schema, validator errors fed back, max 3 rounds, then industry template fallback |
| Column typing, value cleaning | Gemma 4 on Cloud Run GPU (fallback Gemini Flash-Lite) | Batched calls |
| Intent routing, short labels | Gemini Flash-Lite | Batched calls |
| Local-language labels | TranslateGemma (optional) | One-off per blueprint version, cached |
| Search, fuzzy matching of names | Gemini Embedding | Firestore vector search |
| Voice | Transcribe / Live | Roadmap |

Guardrails, all enforced in code rather than prompts: the AI writes only blueprints and tool calls; every output is schema validated; file contents and tool results are wrapped as data; risky actions are parked for approval regardless of the caller; every AI change is logged with inputs and the owner's approval.

---

## 6. Platform and operations

- **Services:** `web` (App Hosting), `mcp`, `agents`, `worker` (Cloud Run). Each has its own least-privilege service account.
- **Region:** one region for all services and Firestore (e.g. `asia-south1`), to keep model, DB and app latency low.
- **No connection bottleneck:** Firestore is HTTP/gRPC with no pool to exhaust, so Cloud Run can autoscale freely. Hot documents (counters, rollups) are per tenant, so contention never crosses tenants.
- **Long work never blocks a request:** blueprint generation, imports, backfills and PDFs run as Cloud Tasks jobs; the UI follows `jobs/{id}` with a realtime listener.
- **Reliability:** each command writes an `outbox` document in the same transaction; a Firestore-triggered function relays it (embeddings, notifications, MCP tool regeneration). All handlers idempotent by event id.
- **Secrets:** Secret Manager. **Observability:** Cloud Logging, Trace, Error Reporting, plus per-tenant AI token metering.
- **Environments:** local (Firebase Emulator Suite: Auth, Firestore, Functions, Storage), staging, production. CI: typecheck, unit tests for engines and blueprint, Security Rules tests, eval suite (spec §18).

---

## 7. UI direction: professional and minimal

The goal is software that looks designed, not generated.

- One neutral palette (warm grey ink on off-white), **one** accent colour used only for the primary action and focus. No gradients, glows, emoji, or decorative illustrations.
- Inter or Geist, two weights (400, 500), sentence case, tabular figures for numbers.
- Hairline borders, 8px radius, almost no shadow. Rows over cards for lists.
- Built on Radix primitives + Tailwind v4 with our own tokens, so generated screens for any blueprint look identical in quality.
- Dense, keyboard-first tables (TanStack Table), command palette, inline validation, skeletons instead of spinners.
- Dark mode from tokens on day one; trilingual-ready font stack (Sinhala, Tamil).

---

## 8. What we reuse from SyncBooks

Ideas and proven rules, not code (SyncBooks is Supabase-specific):

- Ledger invariants: balanced entries, append-only postings, reversing corrections, gap-free numbering (re-implemented as Firestore transactions, §4.4).
- Maker-checker approvals and the audit trail shape.
- Custom fields and extensions concept, which becomes the general blueprint here.
- PDF generation with `@react-pdf/renderer`.
- Design-system discipline from SyncBooks `docs/05-design-system.md` (one action per view, tinted status pills, two weights), with a new brand.

---

## 9. Build sequence

3-day hackathon, following spec §17. Day 1 ends with steps 1–5 deployed; day 2 with 6–8; day 3 is step 9 and submission.

1. **Foundations:** monorepo, design system tokens, Firebase Auth, Firestore layout + Security Rules + index catalogue, deploy skeletons for all four services.
2. **Blueprint core:** Zod schema, validator, field-type and core-binding catalogues, expression language, 3 example blueprints.
3. **Runtime:** command pipeline, generic list/detail/form, query planner, kanban, dashboard.
4. **Onboarding:** interview agent, file reading, blueprint generation with repair loop, blueprint review screen.
5. **Import:** mapping proposal, cleaning, linking, import report.
6. **Engines:** ledger postings, stock moves, numbering, invoice PDF, approvals, audit.
7. **Change by conversation:** diff, preview with data impact, apply, undo.
8. **Agents:** generated tools, MCP server with tokens and approvals, operator assistant, ADK demo agent.
9. **Proof:** eval suite from spec §18, demo bakery data, deck and video.

Never cut: blueprint generation, import, change with preview, MCP with approvals.

---

## 10. Decisions

Decided: Firestore only · ADK TypeScript · 3-day hackathon scope.

Still open:
1. Model access: which Gemini model IDs the API key can reach (spec lists 3.8 Flash, 3.1 Pro, 3.5 Flash-Lite, Embedding 2).
2. Firebase / GCP project ID and region, and whether the project already exists on the Blaze plan.
3. Team size and who owns AI, backend and frontend.
4. Demo local language (Sinhala or Tamil), if any.

---

## 11. Google AI Builder Cup compliance

### 11.1 Google stack inventory

| Layer | Google product |
|---|---|
| Hosting | Firebase App Hosting (web, runs on Cloud Run) · Cloud Run (mcp, agents, worker, Gemma GPU) |
| Data | Cloud Firestore (records, ledger, vectors) · Cloud Storage for Firebase |
| Identity and security | Firebase Auth · Firebase App Check · Secret Manager · IAM service accounts |
| Background work | Cloud Tasks · Cloud Functions for Firebase (2nd gen) · Cloud Scheduler (integrity job) |
| AI models | Gemini Flash, Pro, Flash-Lite, Embedding on Vertex AI · Gemma 4 on Cloud Run · TranslateGemma (optional) |
| Agents | Agent Development Kit (TypeScript) · ADK `McpToolset` for the demo agent |
| Dev platforms | Google AI Studio (prompt prototyping, model comparison) · Antigravity (optional, for build speed) |
| Workspace | Google Sheets API + Google Picker for imports |
| Ops | Cloud Logging · Cloud Trace · Error Reporting · Cloud Monitoring |

Non-Google pieces are libraries only (Next.js, React, Tailwind, Radix, Zod, react-pdf) and the open MCP protocol. All of them run inside Google hosting.

### 11.2 Mandatory requirements

| Requirement | Covered by | Status |
|---|---|---|
| Uses Google AI models (Gemini or Gemma) | Gemini for interview, blueprint, import, changes, assistant; Gemma 4 for import cleaning | Planned |
| Or built with agentic platforms (Agent Platform, Antigravity, AI Studio) | ADK agents; AI Studio for prompt work; Antigravity optional | Planned |
| Deployed on Cloud Run or Firebase | App Hosting + 4 Cloud Run services | Planned |
| Working prototype, not a mockup | Public demo bakery workspace, no sign-up needed for judges | Day 3 |
| Proposal deck as PDF: vision, problem, community benefit, feasibility, scalability | Deck built from spec §1–3, §22 and this plan §2–6 | Day 3 |
| Public 3-minute video (YouTube, Vimeo or Drive) | Demo script spec §19 | Day 3 |
| Problem statement named | **Future of Work & Enterprise Productivity** (alt: Retail & Commerce) | Decided |
| All materials in English | Code, README, deck, video | Day 3 |

Theme: **Future of Work & Enterprise Productivity**, from the six official challenge themes. The older "Healthcare, Education, Sustainability, Accessibility, Social Good" line on the submission page is template text and is ignored. Pitch framing: an AI that builds and runs business software, so small-business owners and staff stop doing manual spreadsheet and paper work and can hand routine work to agents. Retail & Commerce stays as a backup only if the form forces it (inventory, orders and customer insight fit that theme too).

### 11.3 Judging criteria

| Criterion | Weight | What judges should see |
|---|---|---|
| Technical merit and Gen AI | 40% | Schema-constrained blueprint generation with validator repair loop; multimodal file understanding; change planning with safe migrations; ADK agents; MCP server generated per business; Gemini + Gemma routing; measured eval results (spec §18) on one slide |
| Problem alignment and impact | 25% | Small businesses on spreadsheets and paper get a fitting system in minutes, no consultants; agent-ready by default; local language |
| Innovation and creativity | 25% | Living blueprint instead of generated code; fixed-core engines; per-business MCP with approvals; learns from real files |
| UX and solution design | 10% | Plain-language setup and changes, previews before anything changes, one consistent design system, keyboard and screen-reader accessible (WCAG 2.2 AA targets), live updates through Firestore listeners, assistant shows which tools it used |

### 11.4 Gaps to watch

1. **Gemma on GPU** needs Cloud Run GPU quota in the chosen region. Request it on day 1; if denied, run Gemma through Vertex AI Model Garden or cut to Flash-Lite and keep Gemma in the deck.
2. **Model IDs** must be confirmed on day 1 against the Vertex AI project.
3. **Accessibility** is named in both UX criteria and the category list: budget an hour on day 3 for a keyboard and contrast pass.
4. **Judge access:** the demo workspace must open from a clean browser with no sign-up; the MCP endpoint needs a public read-only demo token.
