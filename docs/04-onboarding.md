# AI onboarding: how it stays fast, complete and correct

This is the analysis behind the onboarding redesign: every way the flow can go wrong, and what stops it. The rule underneath all of it is the same as the rest of Shapewise: **the model proposes, code decides**. Anything with a fixed right answer is decided in code; the model only does what needs judgement.

## 1. The flow

1. **Opening.** One centred box: "Tell me about your business". The person can type, or attach a price list, an invoice or a photo of a job card.
2. **Basics** (model). Name and what the business does, usually from the first message.
3. **Size and tax** (code, instant). Country, number of people, yearly sales and tax registrations. These are taps with fixed options, asked without a model call. Code works out the size class and the taxes, and pre-ticks the registrations the rules require.
4. **How the business runs** (model). Selling, buying and stock, making, people, paperwork. Each question has tap answers specific to the trade.
5. **Build** (model plus code). The design streams in live (modules, records, roles appearing as they're written), then code assembles, checks and repairs it.
6. **Review.** Every module opens to its screens and each screen to its fields (their own extra details highlighted). Screens and modules can be switched off right there, and a live **flow map** shows how documents lead into each other, lane by module, redrawn with every change. Taxes with their reasons, and a "Please check" list written to the owner. Nothing is created until the person approves.

## 2. Speed

| Problem | Measured | Fix |
| --- | --- | --- |
| Requests sit in the Azure queue | The same small request took 3s, 80s, 188s | **Hedging**: if no token has arrived after 5s (chat) or 10s (design), a second identical request goes out and the first to start wins; the others are cancelled. Requests the service refuses (bad key, bad request) are never duplicated. |
| Hidden reasoning time | Default effort was slow and variable | `reasoning_effort: low` for chat and design, `minimal` for fast. Configurable with `AZURE_OPENAI_REASONING_*`. Falls back automatically for models without reasoning. |
| Waiting for the whole answer | 11 to 14s per interview turn before | **Streaming**. The interview schema puts `note` and `question` first and the profile last, so the question appears while the profile is still being written. Assistant answers stream word by word. |
| Questions that don't need a model | Every question was a model call | Fact questions are code: **0.0s**. The model's next question is held back and shown instantly after them. |
| The model returns the whole profile every turn | Long outputs | The model returns only what changed (`ProfileUpdate`); code merges. Lists are added to, never replaced, so a partial answer can't lose earlier facts. |
| Tool calls one at a time | Each lookup waited for the previous one | Independent tool calls run in parallel. |

Result in the live eval: model turns take 2 to 3 seconds, fact turns are instant.

## 3. Country and size decide things in code

`packages/blueprint/src/jurisdiction.ts` holds dated rules with their sources.

**Sri Lanka taxes (2026):**

| Tax | Rate | Registration | Source |
| --- | --- | --- | --- |
| VAT | 18% | Above Rs 60 million a year (Rs 15 million a quarter) | VAT Act as amended; the proposed cut to Rs 36 million was withdrawn |
| SSCL | 2.5% | Above Rs 36 million a year (Rs 9 million a quarter), from 1 July 2026 | SSCL (Amendment) Act No. 10 of 2026 |
| WHT | 5% service fees, 10% rent | When the business deducts it | Inland Revenue Act as amended |

What the person confirms always wins. If they say they're not registered but their turnover is above a threshold, the setup follows them and shows a warning to check with their accountant. Registered taxes switch on the Tax module, the IRD tax invoice format (VAT) and seed the tax rates (VAT 18%, zero rated, exempt, SSCL 2.5%, WHT).

**Other countries** get the right currency, locale, time zone and fiscal year. Taxes start off, with a note, because their rules aren't built in yet.

**Size** uses Sri Lanka's MSME classes (the larger of people and turnover wins):

| Class | People | Turnover | Controls applied |
| --- | --- | --- | --- |
| Micro | up to 10 | up to Rs 15M | Credit limits off, negative stock warns |
| Small | 11 to 50 | up to Rs 250M | Credit limits warn, negative stock refused |
| Medium | 51 to 200 | up to Rs 750M | Credit limits enforced, cost centres |
| Large | over 200 | over Rs 750M | Budgets warned, every assistant change waits for a person |

Size controls fill only what the design leaves unset.

**Approvals are not part of onboarding.** A real approval rule depends on the screen, the action and the amount ("bills over Rs 2 million need the accountant, then the owner from Rs 5 million"), which one interview question can't capture. So the interview never asks, AI setups start with no approvals (only ones the owner volunteered), and the owner sets them in **Settings, Approval rules**: describe a rule in plain words and the AI drafts it against the real screens, actions and roles, checked by code and shown as a sentence before anything changes; or set it up by hand.

## 4. Capturing everything

* **Sections with progress**: Basics, Size and tax, Selling, Buying and stock, Making (only if they make things), People, Paperwork. The rail shows what's done.
* **Gaps steer the model**: each turn lists what is still unknown, so questions go where they change the setup most.
* **Attachments**: PDFs and Excel sheets are read into text on the server; photos are downscaled in the browser and read by the model directly. Products, customers, documents and details are picked out of them, and the documents go to the design step too.
* **Everything is editable**: any value in the side panel can be corrected in place; the next question takes it into account.
* **Nothing is lost on reload**: the conversation is kept in the browser until the workspace is created.

## 5. Making the design flawless

Every failure seen in the evals, and where it is now handled:

| Model mistake | Now |
| --- | --- |
| Restates or changes the owner role | Ignored. The owner always keeps everything. |
| Line fields on records without lines (batches) | Moved to the header, with a note. |
| Rules that set `status` or system totals | Left out, with a note. |
| Approvals on steps that can't wait (batch "pass") | Moved to the record's approvable step if there is exactly one, otherwise left out with a note. |
| Role grants on a module or record key | Resolved to the screens it means. |
| Actions a screen doesn't have | Dropped, with a note. |
| Unknown fields in expressions | Repair round, now with the **valid fields, statuses and actions** for the records involved listed in the prompt. |
| Tax settings that contradict the registrations | Ignored; code sets taxes. |
| Anything still invalid after three repairs | Salvage removes the failing parts and lists them under "Not included". The result is always a valid blueprint. |

The assembler and validator are the safety net; the prompt and schema make mistakes rarer; the eval (`pnpm --filter @shapewise/ai eval`) measures first pass validity on four businesses.

## 6. Writing style

No dashes as punctuation anywhere the person reads. The prompts say so, and `undash()` enforces it on every note, question, option, placeholder and assistant reply, so it holds even when the model forgets.

## 7. Still to do

* Tax rules for other countries (India GST, Maldives GST) as data in `jurisdiction.ts`.
* Scanned PDFs: today the person is asked to attach a photo instead; rendering pages to images would remove that step.
* A threshold check that runs each year against actual sales, warning before the business crosses the VAT or SSCL line.

## 8. Reports, permissions and approvals in the review

* **Reports and dashboards.** `packages/blueprint/src/catalogue/reports.ts` lists every report by the question it answers ("Who owes me money and how late?"), what it needs (modules, features, a tax registration) and its headline dashboard number. Near the end of the interview the app asks, instantly and without the model, which ones to keep an eye on (suggested from the business: credit sales, expiry, a counter, machines, a sales team, VAT, size) and where (home dashboard, each module's page, a morning or weekly email). The design applies them (`Blueprint.reports`, dashboard tiles); the review lets the owner change places, add or remove. Reports that read the ledger or stock show their numbers once those engines run.
* **Permissions.** A table of roles against modules, each cell a level (None, View, Edit, Approve, Full) mapped onto the actions each screen really has; open a module to set screens one by one; add or remove roles. The owner is always Full and can't be edited. The same editor is in Settings, Roles and permissions, where a role still held by people can't be removed.
* **Approvals.** Every screen with an approvable step has a switch: on means the owner approves every one, refined later in Settings, Approval rules (amounts, stages, other approvers, or described to the AI).
