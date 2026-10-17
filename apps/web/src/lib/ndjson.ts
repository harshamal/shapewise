import "server-only";
import { z } from "zod";
import { LlmError } from "@shapewise/ai";

/**
 * A streamed response of newline separated JSON events, so the browser can
 * show an answer while it is being written. The last event is always
 * `{ t: "done", ... }` or `{ t: "error", message }`.
 */
export function ndjson(run: (send: (event: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>, request: Request): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: Record<string, unknown>) => {
        if (open) controller.enqueue(enc.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await run(send, request.signal);
      } catch (e) {
        if (!(e instanceof LlmError)) console.error("stream failed", e);
        send({ t: "error", message: e instanceof LlmError ? e.message : "Something went wrong. Try again." });
      } finally {
        open = false;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
}

export const MAX_ATTACHMENTS = 6;

/** An attachment as the browser sends it back: text already extracted on upload, or a downscaled image. */
export const AttachmentInput = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().max(120),
  kind: z.enum(["text", "image"]),
  text: z.string().max(40_000).optional(),
  dataUrl: z
    .string()
    .max(4_000_000)
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  pages: z.number().int().min(0).max(10_000).optional(),
});

export const Attachments = z.array(AttachmentInput).max(MAX_ATTACHMENTS).optional();
