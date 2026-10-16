/**
 * Every model Shapewise uses, in one place. Swapping a model is a one-line
 * change here (or an environment variable), never a code change elsewhere.
 * Tested against the project's key on 2026-10-16; Pro needs billing.
 */
export const MODELS = {
  /** Interview, file reading, import mapping, assistant. */
  chat: process.env.SW_MODEL_CHAT ?? "gemini-3.8-flash",
  /** Blueprint design and repair. Set SW_MODEL_DESIGN=gemini-3.1-pro-preview once billing is on. */
  design: process.env.SW_MODEL_DESIGN ?? "gemini-3.8-flash",
  /** Routing, column typing, short labels. */
  fast: process.env.SW_MODEL_FAST ?? "gemini-3.5-flash-lite",
  /** Search and fuzzy matching. */
  embedding: process.env.SW_MODEL_EMBEDDING ?? "gemini-embedding-2",
} as const;

/** Must match the Firestore vector index (packages/db/src/indexes.ts). */
export const EMBEDDING_DIMENSIONS = 768;

export type ModelRole = keyof typeof MODELS;
