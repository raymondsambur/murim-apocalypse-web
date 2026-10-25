import type { WorldPayload } from '@murim/shared';
import type { DecodedWorld } from '../render/api';

/** Decode a base64 string into bytes (works in browsers and in Node >= 16). */
export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes as base64 (chunked so large grids do not overflow the call stack). */
export function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

export function decodeWorld(payload: WorldPayload): DecodedWorld {
  const terrain = decodeBase64(payload.terrain);
  const objects = decodeBase64(payload.objects);
  const n = payload.w * payload.h;
  if (terrain.length !== n || objects.length !== n) {
    throw new Error(`world payload size mismatch: expected ${n} tiles, got terrain ${terrain.length} / objects ${objects.length}`);
  }
  return { payload, terrain, objects };
}
