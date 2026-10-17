import { NextResponse } from "next/server";
import { z } from "zod";
import { BusinessProfile, attachmentText, createLlm, designBlueprint, profileReady, undash } from "@shapewise/ai";
import { suggestWorkspaceId } from "@shapewise/db";
import { getSession } from "@/lib/auth/session";
import { summarise } from "@/lib/blueprint-summary";
import { Attachments, ndjson } from "@/lib/ndjson";

export const runtime = "nodejs";
export const maxDuration = 300;

const Input = z.object({ profile: BusinessProfile, attachments: Attachments });

/**
 * Designs the setup, streaming what is being put together (modules, records,
 * roles) as the model writes it, then the checked result.
 */
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ message: "Please sign in first." }, { status: 401 });
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "The interview answers couldn't be read. Start again." }, { status: 400 });
  if (!profileReady(parsed.data.profile))
    return NextResponse.json({ message: "Tell me a bit more first: the business name, what you sell, who buys, where you are and how many people work there." }, { status: 400 });
  const { profile, attachments } = parsed.data;
  return ndjson(async (send) => {
    const started = Date.now();
    const r = await designBlueprint(createLlm(), profile, {
      onProgress: (p) => send({ t: "progress", ...p }),
      // Documents read during the interview, so the design sees the real price list or job card.
      attachments: attachments?.length ? `\n\nDocuments the owner shared:${attachmentText(attachments.filter((a) => a.kind === "text"))}` : undefined,
    });
    console.info(`start: designed blueprint in ${((Date.now() - started) / 1000).toFixed(1)}s (first pass ${r.firstPassValid ? "valid" : "invalid"}, ${r.repairRounds} repairs, ${r.removed.length} removed)`);
    send({
      t: "done",
      blueprint: r.blueprint,
      summary: summarise(r.blueprint),
      suggestedId: suggestWorkspaceId(r.blueprint.business.name),
      assumptions: r.plan.assumptions.map(undash),
      notes: r.notes,
      removed: r.removed,
      taxReasons: r.taxReasons,
      taxWarnings: r.taxWarnings,
    });
  }, request);
}
