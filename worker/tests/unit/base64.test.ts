/**
 * Unit tests for base64 encoding.
 *
 * Regression coverage for the spread-argument overflow: the previous
 * `btoa(String.fromCharCode(...new Uint8Array(buffer)))` passed one argument
 * per byte and threw RangeError partway through a sync once an icon grew past
 * roughly 100KB.
 */
import { describe, it, expect } from "vitest";
import { toBase64 } from "../../src/utils/base64";

/** Reference encoder, used to check the chunked implementation agrees. */
function expectedBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("toBase64", () => {
  it("encodes an empty buffer", () => {
    expect(toBase64(new Uint8Array([]).buffer)).toBe("");
  });

  it("encodes ascii", () => {
    const bytes = new TextEncoder().encode("hello world");
    expect(toBase64(bytes.buffer as ArrayBuffer)).toBe(expectedBase64(bytes));
  });

  it("encodes arbitrary binary, including high bytes and nulls", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 254, 255, 0]);
    expect(toBase64(bytes.buffer)).toBe(expectedBase64(bytes));
  });

  it("encodes across the internal chunk boundary without corruption", () => {
    // 0x2000 is the chunk size; straddle it to catch off-by-one seams.
    for (const size of [0x1fff, 0x2000, 0x2001, 0x4000, 0x4001]) {
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i++) bytes[i] = i % 256;
      expect(toBase64(bytes.buffer), `size ${size}`).toBe(expectedBase64(bytes));
    }
  });

  it("encodes a buffer far larger than the old spread limit", () => {
    // ~1MB. The previous implementation threw RangeError well below this.
    const size = 1_000_000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 7) % 256;
    expect(() => toBase64(bytes.buffer)).not.toThrow();
    expect(toBase64(bytes.buffer)).toBe(expectedBase64(bytes));
  });
});
