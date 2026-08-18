/**
 * Encode binary data as base64.
 *
 * The obvious `btoa(String.fromCharCode(...new Uint8Array(buffer)))` spreads
 * every byte as a separate function argument, which overflows the call stack
 * once an image gets large (roughly 100KB, depending on the engine) and throws
 * RangeError mid-sync. Walking the buffer in fixed chunks keeps the argument
 * count bounded regardless of input size.
 */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x2000; // 8192 bytes per fromCharCode call
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
