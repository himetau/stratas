// Payload length of a record without decoding it. Keep in sync with decode.ts
import { ReplayError } from "./decode";

const FIXED: Record<number, number> = {
  0: 1, 1: 17, 2: 17, 3: 5, 4: 13, 5: 1, 6: 4, 7: 1, 8: 2, 9: 1, 10: 4, 11: 1, 12: 4, 13: 1, 14: 10, 15: 6,
  17: 1, 18: 1, 19: 1, 20: 0, 25: 14, 26: 9, 27: 9, 28: 10, 29: 10, 30: 6, 31: 3, 32: 3, 33: 4,
  40: 29, 41: 21, 42: 9, 43: 17, 44: 15, 45: 11, 46: 9, 47: 6, 48: 9, 49: 7, 50: 11, 51: 9,
  61: 21, 62: 10, 63: 50, 80: 16, 81: 10, 82: 1, 83: 1, 84: 1, 85: 1, 86: 3, 89: 3, 100: 17, 101: 27, 102: 8,
};

function pieNameLen(b: Uint8Array, i: number): number {
  let n = 1;
  const v0 = b[i];
  let v = v0;
  if (v0 >= 128) { v = ((v0 & 127) << 8) | b[i + 1]; n = 2; }
  if (v) return n;
  return n + 1 + b[i + n];
}

export function recordLength(type: number, b: Uint8Array, i: number): number {
  const f = FIXED[type];
  if (f !== undefined) return f;
  const s = i;
  switch (type) {
    case 16: { const flags = b[i + 2]; return 3 + 8 * (flags & 3); }
    case 21: {
      const n = b[i++];
      for (let k = 0; k < n; k++) {
        if (k === 0) { const m = b[i++]; for (let j = 0; j < m; j++) i += pieNameLen(b, i); }
        else i += pieNameLen(b, i);
        i += 2;
      }
      return i - s;
    }
    case 64: return 7 + 2 * (b[i + 6] & 63);
    case 87: return 1 + 8 * b[i];
    case 88: return b[i] === 1 ? 1 : 19;
    case 90: return b[i] === 0 ? 1 : 13;
    case 91: { i += 1; const n = b[i++]; for (let k = 0; k < n; k++) { if (b[i++] === 255) i += 8; } return i - s; }
    case 103: return 6 + 3 * b[i + 5];
    default: throw new ReplayError(`unknown record type ${type}`);
  }
}
