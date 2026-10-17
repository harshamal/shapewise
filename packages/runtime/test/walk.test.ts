import { describe, expect, it } from "vitest";
import { Blueprint } from "@shapewise/blueprint";
import { bakery, plasticsFactory } from "@shapewise/blueprint/fixtures";
import { walk } from "./walk";

describe("every document flows end to end", () => {
  for (const [name, input] of [["plastics factory", plasticsFactory], ["bakery", bakery]] as const) {
    it(`in the ${name} template`, async () => {
      const results = await walk(Blueprint.parse(input));
      const failed = results.filter((r) => !r.ok);
      expect(failed.map((r) => `${r.label}: ${r.problem}`), results.map((r) => `${r.label}: ${r.steps.join(" > ")}`).join("\n")).toEqual([]);
    });
  }
});
