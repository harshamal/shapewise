import { describe, expect, it } from "vitest";
import { decideTax, sizeClass } from "@shapewise/blueprint";
import { bakeryPlan } from "./fixtures";
import { applyFact, assemble, checkDraft, contextFor, draftApproval, suggestReports, withAnalytics, type BusinessProfile, factPrompt, interviewTurn, mergeProfile, nextFact, parsePartialJson, progress, undash, profileGaps, type BlueprintPlan, type Llm } from "../src";

describe("tax rules (Sri Lanka)", () => {
  it("requires VAT and SSCL above their thresholds when nothing is confirmed", () => {
    const d = decideTax({ country: "LK", turnover: "60_250m" });
    expect(d.settings).toEqual({ vatRegistered: true, ssclRegistered: true, wht: false, irdTaxInvoice: true });
    expect(d.taxCodes.map((t) => t.name)).toEqual(["VAT 18%", "Zero rated", "VAT exempt", "SSCL 2.5%"]);
    expect(d.reasons.join(" ")).toMatch(/Rs 60 million/);
  });

  it("puts SSCL on before VAT between Rs 36 and 60 million", () => {
    expect(decideTax({ country: "LK", turnover: "36_60m" }).settings).toMatchObject({ vatRegistered: false, ssclRegistered: true });
    expect(decideTax({ country: "LK", turnover: "15_36m" }).settings).toMatchObject({ vatRegistered: false, ssclRegistered: false });
  });

  it("follows what the person confirmed, and warns when it doesn't match the rules", () => {
    const d = decideTax({ country: "LK", turnover: "60_250m", registrations: ["sscl"] });
    expect(d.settings.vatRegistered).toBe(false);
    expect(d.warnings[0]).toMatch(/VAT threshold/);
    expect(decideTax({ country: "LK", turnover: "lt15m", registrations: ["vat", "wht"] }).settings).toMatchObject({ vatRegistered: true, wht: true, irdTaxInvoice: true });
  });

  it("starts taxes off where rules aren't built in", () => {
    const d = decideTax({ country: "AE", turnover: "gt750m" });
    expect(Object.values(d.settings).some(Boolean)).toBe(false);
    expect(d.reasons[0]).toMatch(/United Arab Emirates/);
  });

  it("classes size by the larger of people and turnover", () => {
    expect(sizeClass("2_10", "lt15m")).toBe("micro");
    expect(sizeClass("2_10", "250_750m")).toBe("medium");
    expect(sizeClass("200_plus", "15_36m")).toBe("large");
  });
});

describe("fact questions", () => {
  const basics = { businessName: "Ruhunu Bakers", whatTheyDo: "Bakes bread" };

  it("asks country, people, sales and taxes once the basics are known, in that order", () => {
    expect(nextFact({})).toBeUndefined();
    let p: BusinessProfile = { ...basics };
    const seen: string[] = [];
    for (const [fact, answer] of [["country", "Sri Lanka"], ["teamSize", "11 to 50 people"], ["turnover", "Rs 60 to 250 million"], ["taxes", "VAT and SSCL"]] as const) {
      expect(nextFact(p)).toBe(fact);
      seen.push(fact);
      p = applyFact(fact, answer, p).profile;
    }
    expect(nextFact(p)).toBeUndefined();
    expect(p).toMatchObject({ country: "LK", teamSize: "11_50", turnover: "60_250m", taxRegistrations: ["vat", "sscl"], taxConfirmed: true });
  });

  it("skips sales and taxes where there are no built in tax rules", () => {
    const p = applyFact("country", "Singapore", basics).profile;
    expect(nextFact(applyFact("teamSize", "Just me", p).profile)).toBeUndefined();
  });

  it("reads typed answers, not just taps", () => {
    expect(applyFact("teamSize", "about 25 of us", basics).profile.teamSize).toBe("11_50");
    expect(applyFact("turnover", "around Rs 80m", basics).profile.turnover).toBe("60_250m");
    expect(applyFact("turnover", "5 crore", basics).profile.turnover).toBe("36_60m");
    expect(applyFact("taxes", "Not registered for any", basics).profile).toMatchObject({ taxRegistrations: [], taxConfirmed: true });
    expect(applyFact("country", "Narnia", basics).problem).toMatch(/closest/);
  });

  it("ticks the taxes the rules require and says why", () => {
    const q = factPrompt("taxes", { ...basics, country: "LK", turnover: "60_250m" });
    expect(q.preselected).toEqual(["VAT", "SSCL"]);
    expect(q.note).toMatch(/VAT threshold \(Rs 60 million\)/);
  });

  it("answers fact questions without calling the model and then shows the held back question", async () => {
    let calls = 0;
    const llm: Llm = {
      provider: "azure-openai",
      turn: async () => {
        throw new Error("unused");
      },
      json: async () => {
        calls++;
        return {
          value: {
            note: "Hotels on credit means each invoice carries a due date.",
            question: "What do you bake most?",
            topic: "products",
            input: { kind: "multi", options: ["Bread", "Cakes"], placeholder: "e.g. buns" },
            profile: { businessName: "Ruhunu Bakers", whatTheyDo: "Bakes for hotels", country: "LK" },
            enoughToDesign: false,
          },
          usage: { input: 1, output: 1, model: "fake" },
        } as never;
      },
    };
    const first = await interviewTurn(llm, { history: [], profile: {} }, { message: "Ruhunu Bakers in Galle, we bake for hotels" });
    expect(calls).toBe(1);
    expect(first.prompt.fact).toBe("teamSize"); // country came from the message
    expect(first.prompt.note).toMatch(/Hotels on credit/);
    expect(first.deferred?.question).toBe("What do you bake most?");

    let s = { history: first.history, profile: first.profile, deferred: first.deferred };
    for (const [answering, message] of [["teamSize", "2 to 10 people"], ["turnover", "Rs 15 to 36 million"], ["taxes", "Not registered for any"]] as const) {
      const r = await interviewTurn(llm, s, { message, answering });
      expect(r.instant).toBe(true);
      s = { history: r.history, profile: r.profile, deferred: r.deferred };
      if (answering === "taxes") {
        expect(r.prompt.question).toBe("What do you bake most?");
        expect(r.prompt.note).toMatch(/Small business in Sri Lanka, no tax registrations/);
      }
    }
    expect(calls).toBe(1);
  });
});

describe("profile", () => {
  it("adds list items rather than replacing them, and removes what the person corrects", () => {
    const p = mergeProfile({ products: ["Bread", "Cakes"] }, { products: ["cakes", "Buns"] });
    expect(p.products).toEqual(["Bread", "Cakes", "Buns"]);
    expect(mergeProfile(p, { remove: ["bread"] }).products).toEqual(["Cakes", "Buns"]);
  });

  it("trims lists that run over their limit instead of failing", () => {
    expect(mergeProfile({}, { taxRegistrations: undefined, products: Array.from({ length: 60 }, (_, i) => `P${i}`) }).products).toHaveLength(40);
  });

  it("tracks progress by section, leaving out making for traders", () => {
    const keys = progress({ makesThings: false }).map((s) => s.key);
    expect(keys).not.toContain("making");
    expect(progress({ businessName: "x", whatTheyDo: "y" })[0]).toMatchObject({ key: "basics", done: 2, total: 2 });
  });
});

describe("text", () => {
  it("removes dashes used as punctuation but keeps hyphenated words", () => {
    expect(undash("Each order carries a date — so nothing slips.")).toBe("Each order carries a date, so nothing slips.");
    expect(undash("Walk-in customers – cash only")).toBe("Walk-in customers, cash only");
    expect(undash("30 - day credit")).toBe("30, day credit");
  });
});

describe("partial JSON", () => {
  it("reads what has arrived so far", () => {
    expect(parsePartialJson('{"note":"Each ord')).toEqual({ note: "Each ord" });
    expect(parsePartialJson('{"note":"Done.","question":"What')).toEqual({ note: "Done.", question: "What" });
    expect(parsePartialJson('{"a":[1,2,')).toEqual({ a: [1, 2] });
    expect(parsePartialJson('{"a":tr')).toEqual({});
    expect(parsePartialJson('{"modules":["sales","inv')).toEqual({ modules: ["sales", "inv"] });
    expect(parsePartialJson('{"k')).toEqual({ k: null });
    expect(parsePartialJson("")).toBeUndefined();
  });
});

describe("design context", () => {
  const profile = { businessName: "Lanka Containers", whatTheyDo: "moulding", country: "LK", teamSize: "51_200" as const, turnover: "250_750m" as const, taxRegistrations: ["vat" as const, "sscl" as const], taxConfirmed: true };

  it("applies country, taxes and size controls in code, whatever the plan says", () => {
    const { ctx } = contextFor(profile);
    const plan: BlueprintPlan = { ...bakeryPlan, settings: { ...bakeryPlan.settings, tax: { vatRegistered: false } } };
    const a = assemble(plan, ctx);
    expect(a.blueprint, JSON.stringify(a.issues)).toBeDefined();
    const bp = a.blueprint!;
    expect(bp.business).toMatchObject({ country: "LK", currency: "LKR", fiscalYearStartMonth: 4 });
    expect(bp.settings.tax).toEqual({ vatRegistered: true, ssclRegistered: true, wht: false, irdTaxInvoice: true });
    expect(bp.settings.sales.creditLimitMode).toBe("block");
    expect(bp.settings.accounting.costCentres).toBe(true);
    expect(bp.seed.taxCodes.map((t) => t.kind)).toContain("sscl");
    expect(bp.modules.some((m) => m.key === "tax")).toBe(true);
    expect(a.notes.join(" ")).toMatch(/Taxes follow your registrations/);
  });

  it("uses the country's currency and fiscal year", () => {
    const { ctx } = contextFor({ ...profile, country: "AU", taxRegistrations: [], taxConfirmed: true });
    const bp = assemble(bakeryPlan, ctx).blueprint!;
    expect(bp.business).toMatchObject({ country: "AU", currency: "AUD", timezone: "Australia/Sydney", fiscalYearStartMonth: 7 });
    expect(bp.settings.tax.vatRegistered).toBe(false);
  });

  it("starts AI designs with no approvals, keeping only the ones the plan states", () => {
    const { ctx } = contextFor(profile);
    expect(assemble({ ...bakeryPlan, approvals: [] }, ctx).blueprint!.approvals).toEqual([]);
    const stated = assemble(
      {
        ...bakeryPlan,
        modules: [...bakeryPlan.modules, "purchases"],
        approvals: [{ label: "Owner signs big orders", record: "purchase_order", action: "issue", stages: [{ name: "Owner", minAmount: 500000, roles: ["owner"], requireAll: false }] }],
      },
      ctx,
    ).blueprint!;
    expect(stated.approvals.map((x) => x.label)).toEqual(["Owner signs big orders"]);
  });
});

describe("interview scope", () => {
  it("never treats approvals as something to ask about", () => {
    expect(profileGaps({ teamSize: "51_200" })).not.toContain("approvals");
  });
});

describe("assembler fixes common model mistakes itself", () => {
  it("ignores an owner role in the plan, moves line fields to the header and drops rules on system fields", () => {
    const plan: BlueprintPlan = {
      ...bakeryPlan,
      roles: [{ key: "owner", label: "Boss", description: "x", grants: [{ area: "*", actions: ["view"] }] }],
      customFields: [...bakeryPlan.customFields, { key: "oven_no", label: "Oven", type: "text", required: false, record: "batch", part: "line", showOnDocuments: false, showInProduction: false }],
      rules: [{ label: "Force status", record: "invoice", on: ["create"], effect: "set", field: "status", value: "'posted'" }],
    };
    const a = assemble(plan);
    expect(a.blueprint, JSON.stringify(a.issues)).toBeDefined();
    expect(a.blueprint!.roles.find((r) => r.owner)!.label).not.toBe("Boss");
    expect(a.blueprint!.customFields.find((c) => c.field.key === "oven_no")?.part ?? "header").toBe("header");
    expect(a.blueprint!.rules).toHaveLength(0);
    expect(a.notes.join(" ")).toMatch(/worked out by the system/);
  });

  it("moves an approval to the record's approvable step, or leaves it out with a note", () => {
    const plan: BlueprintPlan = {
      ...bakeryPlan,
      modules: [...bakeryPlan.modules, "purchases"],
      approvals: [
        { label: "Big POs", record: "purchase_order", action: "send", stages: [{ name: "Owner", minAmount: 100000, roles: ["owner"], requireAll: false }] },
        { label: "QC pass", record: "batch", action: "pass", stages: [{ name: "QC", minAmount: 0, roles: ["owner"], requireAll: false }] },
      ],
    };
    const a = assemble(plan);
    expect(a.blueprint, JSON.stringify(a.issues)).toBeDefined();
    expect(a.blueprint!.approvals.find((x) => x.label === "Big POs")?.action).toBe("issue");
    expect(a.notes.join(" ")).toMatch(/QC pass/);
  });
});

describe("production seed", () => {
  it("matches step parameters by code or name and leaves unknown ones off", () => {
    const plan: BlueprintPlan = {
      ...bakeryPlan,
      seed: {
        ...bakeryPlan.seed,
        parameters: [{ code: "OVEN_TEMP", name: "Oven temperature", category: "process", dataType: "number" }],
        operationTypes: [{ name: "Baking", params: ["oven_temp", "Oven temperature", "humidity"] }],
      },
    };
    const a = assemble(plan);
    expect(a.blueprint, JSON.stringify(a.issues)).toBeDefined();
    expect(a.blueprint!.seed.production.operationTypes[0]!.params).toEqual(["OVEN_TEMP"]);
    expect(a.notes.join(" ")).toMatch(/process reading/);
  });
});

describe("approvals on records without an amount", () => {
  it("drop the amount thresholds instead of failing", () => {
    const plan: BlueprintPlan = {
      ...bakeryPlan,
      approvals: [{ label: "Big deliveries", record: "delivery_note", action: "dispatch", when: "total > 100000", stages: [{ name: "Owner", minAmount: 100000, roles: ["owner"], requireAll: false }] }],
    };
    const a = assemble(plan);
    expect(a.blueprint, JSON.stringify(a.issues)).toBeDefined();
    expect(a.blueprint!.approvals.find((x) => x.label === "Big deliveries")).toMatchObject({ stages: [{ minAmount: 0 }] });
    expect(a.notes.join(" ")).toMatch(/have no amount/);
  });
});

describe("approval drafts", () => {
  const choices = {
    currency: "LKR",
    targets: [
      { target: "bill", label: "Bills", hasAmount: true, actions: [{ key: "post", label: "Post" }] },
      { target: "delivery_note", label: "Delivery notes", hasAmount: false, actions: [{ key: "dispatch", label: "Dispatch" }] },
    ],
    roles: [
      { id: "rol_acc", label: "Accountant" },
      { id: "rol_own", label: "Owner" },
    ],
  };
  const fake = (value: unknown): Llm => ({ provider: "azure-openai", turn: async () => ({}) as never, json: async () => ({ value, usage: { input: 1, output: 1, model: "fake" } }) as never });

  it("sorts stages, drops repeated approvers and checks the action belongs to the screen", async () => {
    const r = await draftApproval(
      fake({ understood: true, question: "", label: "Large bills", target: "bill", action: "post", summary: "x", stages: [
        { name: "Both", minAmount: 5_000_000, roles: ["rol_acc", "rol_own"], requireAll: false },
        { name: "Accountant", minAmount: 2_000_000, roles: ["rol_acc"], requireAll: false },
      ] }),
      choices,
      "bills over 2m accountant, over 5m owner too",
    );
    expect(r.ok && r.draft.stages.map((s) => [s.minAmount, s.roles])).toEqual([
      [2_000_000, ["rol_acc"]],
      [5_000_000, ["rol_own"]],
    ]);
    expect(checkDraft({ label: "x", target: "bill", action: "fly", stages: [] }, choices).join(" ")).toMatch(/isn't an action on Bills.*needs at least one stage/);
  });

  it("clears amounts on screens without one, and asks back when unclear", async () => {
    const r = await draftApproval(fake({ understood: true, question: "", label: "Deliveries", target: "delivery_note", action: "dispatch", summary: "x", stages: [{ name: "Owner", minAmount: 100, roles: ["rol_own"], requireAll: false }] }), choices, "deliveries need the owner");
    expect(r.ok && r.draft.stages[0]!.minAmount).toBe(0);
    const q = await draftApproval(fake({ understood: false, question: "Which screen do you mean?", label: "", target: "bill", action: "post", summary: "", stages: [] }), choices, "make it safer");
    expect(q).toMatchObject({ ok: false, question: "Which screen do you mean?" });
  });
});

describe("reports", () => {
  const bakery: BusinessProfile = {
    businessName: "Sunrise",
    whatTheyDo: "Bakery",
    country: "LK",
    teamSize: "11_50",
    turnover: "60_250m",
    taxRegistrations: ["vat"],
    taxConfirmed: true,
    products: ["Bread"],
    customers: ["Cafés"],
    salesChannels: ["Shop counter", "Wholesale"],
    paymentTerms: ["30 days credit"],
    makesThings: true,
    machines: ["Deck oven"],
    stockPractices: ["Flour lots with expiry dates"],
    team: ["Owner", "Sales rep"],
  };

  it("suggests what fits the business, with reasons, and nothing it can't run", () => {
    const s = suggestReports(bakery);
    const keys = s.map((x) => x.key);
    expect(keys.slice(0, 3)).toEqual(["sales_summary", "aged_receivables", "cash_position"]);
    expect(keys).toEqual(expect.arrayContaining(["expiry", "daily_takings", "late_jobs", "scrap_by_machine", "vat_summary", "sales_by_salesperson"]));
    expect(s.find((x) => x.key === "aged_receivables")!.why).toMatch(/credit/);
    expect(suggestReports({ ...bakery, makesThings: false, taxRegistrations: [] }).map((x) => x.key)).not.toContain("late_jobs");
  });

  it("asks which reports and where once the business is understood, and records the answers", () => {
    expect(nextFact(bakery)).toBe("reports");
    const q = factPrompt("reports", bakery);
    expect(q.input.options).toContain("Who owes me money and how late?");
    expect(q.preselected).toHaveLength(5);
    const after = applyFact("reports", "How much did we sell this month? and Who owes me money and how late? and how much each van delivered", bakery).profile;
    expect(after.reports).toEqual(["sales_summary", "aged_receivables"]);
    expect(after.reportWishes?.[0]).toMatch(/van delivered/);
    expect(nextFact(after)).toBe("reportPlaces");
    const placed = applyFact("reportPlaces", "Home dashboard and A morning email", after).profile;
    expect(placed.reportPlaces).toEqual(["dashboard", "email_daily"]);
    expect(nextFact(placed)).toBeUndefined();
  });

  it("puts chosen reports in place and sets the dashboard tiles to their numbers", () => {
    const bp = assemble(bakeryPlan, contextFor(bakery).ctx).blueprint!;
    const { blueprint, notes } = withAnalytics(bp, { ...bakery, reports: ["aged_receivables", "profit_and_loss", "capacity"], reportPlaces: ["dashboard", "module"] });
    expect(blueprint.reports.find((r) => r.key === "aged_receivables")!.places).toEqual(["dashboard", "module", "reports"]);
    // Profit and loss has no single headline number, so it isn't a dashboard tile.
    expect(blueprint.reports.find((r) => r.key === "profit_and_loss")!.places).toEqual(["module", "reports"]);
    expect(blueprint.dashboard.map((w) => (w.source.kind === "builtin" ? w.source.metric : ""))).toEqual(["receivables_overdue"]);
    expect(notes.join(" ")).toMatch(/Machine load/);
    expect(blueprint.version).toBe(bp.version);
  });
});
