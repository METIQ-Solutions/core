import { createHash } from 'node:crypto';

export function generateQueueId(): string {
  return Math.random().toString(16).slice(2, 14);
}

/**
 * The queue id an item with this identity would have, derived rather than drawn.
 *
 * Twelve hex characters, the shape `generateQueueId()` produces, so nothing that reads a `qid`
 * can tell the two apart.
 *
 * Derived, not random, because the value has to survive everything that is not a change of item:
 * a seek, a pause and resume, a volume change, new artwork. Drawing a fresh id per event would
 * make each of those look like a new item to a client that keys its per-item state on this field.
 * The same identity therefore always yields the same id, and only a different identity yields a
 * different one.
 */
export function deriveQueueId(seed: string): string {
  return createHash('sha1').update(seed, 'utf8').digest('hex').slice(0, 12);
}
