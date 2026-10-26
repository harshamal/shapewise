import { describe, expect, it } from "vitest";
import { cleanInput, interviewTurn, profileGaps, type Llm } from "../src";

describe("interview", () => {
  it("falls back to a text answer when there aren't real options, and drops 'Other'", () => {
    expect(cleanInput({ kind: "single", options: ["Yes"], placeholder: "e.g. yes" })).toEqual({ kind: "text", options: [], placeholder: "e.g. yes" });
    expect(cleanInput({ kind: "multi", options: ["Cakes", "cakes", " Bread ", "Other (type it)"], placeholder: "" }).options).toEqual(["Cakes", "Bread"]);
  });

  it("only asks about production for businesses that make things", () => {
    expect(profileGaps({ makesThings: false })).not.toContain("production steps");
    expect(profileGaps({ makesThings: true })).toContain("production steps");
  });

  it("returns a structured prompt and records what was offered in the history", async () => {
    let system = "";
    const llm: Llm = {
      provider: "gemini",
      turn: async () => {
        throw new Error("unused");
      },
      json: async (args) => {
        system = args.system ?? "";
        return {
          value: {
            note: "Since you bake to order, each order will carry a delivery date.",
            question: "What do you bake most?",
            topic: "products",
            input: { kind: "multi", options: ["Birthday cakes", "Bread", "Short eats"], placeholder: "e.g. wedding cakes" },
            profile: { businessName: "Lanka Bakes" },
            enoughToDesign: false,
          },
          usage: { input: 1, output: 1, model: "fake" },
        } as never;
      },
    };
    const r = await interviewTurn(llm, { history: [], profile: {} }, { message: "Lanka Bakes, we bake to order" });
    expect(system).toMatch(/Still unknown: business name/);
    expect(r.prompt).toMatchObject({ topic: "products", topicLabel: "What you sell", input: { kind: "multi" } });
    expect(r.history.at(-1)).toEqual({ role: "assistant", text: expect.stringContaining("(Offered: Birthday cakes · Bread · Short eats)") });
    expect(r.profile.businessName).toBe("Lanka Bakes");
  });

  it("tells the model what's missing and retries once when it wraps up too early", async () => {
    const systems: string[] = [];
    const turns = [
      { note: "All set.", question: "Shall I build it?", topic: "wrap_up", input: { kind: "confirm", options: ["Build it", "One more thing"], placeholder: "" }, profile: {}, enoughToDesign: true },
      { note: "Nearly there.", question: "Who usually buys your containers?", topic: "customers", input: { kind: "text", options: [], placeholder: "e.g. food companies" }, profile: {}, enoughToDesign: false },
    ];
    const llm: Llm = {
      provider: "gemini",
      turn: async () => {
        throw new Error("unused");
      },
      json: async (args) => {
        systems.push(args.system ?? "");
        return { value: turns[systems.length - 1], usage: { input: 1, output: 1, model: "fake" } } as never;
      },
    };
    const profile = { businessName: "Polar Moulds", whatTheyDo: "Injection moulded food containers", products: ["Containers"], makesThings: true };
    const r = await interviewTurn(llm, { history: [], profile }, { message: "Launch now" });
    expect(systems[0]).toMatch(/Still needed before you may wrap up: who buys/);
    expect(systems).toHaveLength(2);
    expect(r.ready).toBe(false);
    expect(r.usage).toHaveLength(2);
  });

  const wrapUp = { note: "Quotes through to billing.", question: "Anything else before I build?", topic: "wrap_up", input: { kind: "confirm", options: ["Launch", "Wait"], placeholder: "" }, profile: {}, enoughToDesign: false };
  const fakeLlm = (value: unknown): Llm => ({
    provider: "gemini",
    turn: async () => {
      throw new Error("unused");
    },
    json: async () => ({ value, usage: { input: 1, output: 1, model: "fake" } }) as never,
  });
  const complete = {
    businessName: "Lanka Bakes", whatTheyDo: "Bakes to order", products: ["Cakes"], customers: ["Cafés"], makesThings: true,
    country: "LK", teamSize: "11_50", turnover: "60_250m", taxRegistrations: ["vat"], taxConfirmed: true,
    team: ["Owner"], reportsConfirmed: true, reportPlaces: ["Dashboard"],
  } as const;

  it("a wrap-up on a ready profile is always ready, with the build answer the app acts on", async () => {
    const { nextFact } = await import("../src");
    expect(nextFact({ ...complete } as never)).toBeUndefined();
    const r = await interviewTurn(fakeLlm(wrapUp), { history: [], profile: { ...complete } as never }, { message: "That's all" });
    expect(r.ready).toBe(true);
    expect(r.prompt.input.options).toEqual(["Build it", "One more thing"]);
  });

  it("a held back wrap-up shown after the last fact is ready", async () => {
    const deferred = { note: "", question: "Anything else before I build?", topic: "wrap_up", section: "paperwork", topicLabel: "Ready to build", input: { kind: "confirm", options: ["Build it", "One more thing"], placeholder: "" } } as const;
    const { reportPlaces: _p, ...almost } = complete;
    const r = await interviewTurn(fakeLlm(wrapUp), { history: [], profile: { ...almost } as never, deferred: deferred as never }, { message: "Dashboard", answering: "reportPlaces" });
    expect(r.instant).toBe(true);
    expect(r.prompt.topic).toBe("wrap_up");
    expect(r.ready).toBe(true);
  });
});
