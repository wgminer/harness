export type ClippingKind = "text" | "url" | "image";

export interface ClippingItem {
  id: string;
  kind: ClippingKind;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ClippingsPayload {
  clippings: ClippingItem[];
  lastAction?: string;
  affectedIds?: string[];
  error?: string;
}

export const CLIPPING_KINDS: ClippingKind[] = ["text", "url", "image"];

export function isClippingKind(value: unknown): value is ClippingKind {
  return typeof value === "string" && (CLIPPING_KINDS as string[]).includes(value);
}
