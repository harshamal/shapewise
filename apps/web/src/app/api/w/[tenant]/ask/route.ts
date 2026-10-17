import { NextResponse } from "next/server";
import { z } from "zod";
import { createLlm, runAssistant, type Message } from "@shapewise/ai";
import { businessToday } from "@/lib/records";
import { loadWorkspace } from "@/lib/workspace";
import { Attachments, ndjson } from "@/lib/ndjson";

export const runtime = "nodejs";
export const maxDuration = 180;

const Input = z.object({ history: z.array(z.unknown()).max(80), question: z.string().trim().min(1).max(4000), attachments: Attachments });

/**
 * One question to the workspace assistant, streamed: `tool` events as it
 * looks things up, `text` as the answer is written, then `done`. The history
 * comes from the browser; it can only affect this person's own conversation,
 * because every read goes through their role and every change is a proposal
 * the pipeline checks again when they confirm.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const ws = await loadWorkspace(tenant);
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "That question couldn't be sent." }, { status: 400 });
  const { history, question, attachments } = parsed.data;
  return ndjson(async (send) => {
    const r = await runAssistant(
      createLlm(),
      { compiled: ws.compiled, store: ws.store, tenant, roleKey: ws.actor.roleKey, actorId: ws.actor.id, today: businessToday(ws), now: new Date().toISOString() },
      history as Message[],
      question,
      { attachments, onEvent: (e) => send({ t: e.type, ...e }) },
    );
    send({ t: "done", reply: r.reply, suggestions: r.suggestions, history: r.messages, proposals: r.proposals, toolsUsed: r.toolsUsed });
  }, request);
}
