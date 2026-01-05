import * as decoding from "lib0/decoding";

export function toUint8Array(update: number[]): Uint8Array {
  return Uint8Array.from(update);
}

export function toNumberArray(update: Uint8Array): number[] {
  return Array.from(update);
}

/**
 * Awareness update format (y-protocols):
 * [nClients][clientId][clock][stateJSON]...
 * where stateJSON == "" means removed.
 */
export function decodeAwarenessUpdate(update: Uint8Array): { changed: number[]; removed: number[] } {
  const dec = decoding.createDecoder(update);
  const n = decoding.readVarUint(dec);

  const changed: number[] = [];
  const removed: number[] = [];

  for (let i = 0; i < n; i++) {
    const clientId = decoding.readVarUint(dec);
    changed.push(clientId);

    // clock (unused here)
    decoding.readVarUint(dec);

    const state = decoding.readVarString(dec);
    if (state.length === 0) removed.push(clientId);
  }

  return { changed, removed };
}
