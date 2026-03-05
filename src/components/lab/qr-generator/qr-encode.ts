/**
 * Minimal QR Code encoder — byte mode, versions 1-10, ECC levels L/M/Q/H.
 * Implements Reed-Solomon over GF(256), 8 mask patterns with penalty scoring.
 * Zero external dependencies.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrCode {
  version: number;
  size: number;
  eccLevel: ErrorCorrectionLevel;
  modules: boolean[][];
}

// ── GF(256) Arithmetic ─────────────────────────────────────────────────────
// Galois Field with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

function initGaloisField(): void {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = x << 1;
    if (x >= 256) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

initGaloisField();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfPolyMultiply(p: Uint8Array, q: Uint8Array): Uint8Array {
  const result = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      result[i + j] ^= gfMultiply(p[i], q[j]);
    }
  }
  return result;
}

function gfPolyRemainder(dividend: Uint8Array, divisor: Uint8Array): Uint8Array {
  const result = new Uint8Array(dividend);
  for (let i = 0; i < dividend.length - divisor.length + 1; i++) {
    if (result[i] === 0) continue;
    const coeff = result[i];
    for (let j = 1; j < divisor.length; j++) {
      result[i + j] ^= gfMultiply(divisor[j], coeff);
    }
  }
  return result.slice(dividend.length - divisor.length + 1);
}

function rsGeneratorPolynomial(numSymbols: number): Uint8Array {
  let gen = new Uint8Array([1]);
  for (let i = 0; i < numSymbols; i++) {
    gen = gfPolyMultiply(gen, new Uint8Array([1, GF_EXP[i]]));
  }
  return gen;
}

function rsEncode(data: Uint8Array, numEcc: number): Uint8Array {
  const gen = rsGeneratorPolynomial(numEcc);
  const padded = new Uint8Array(data.length + numEcc);
  padded.set(data);
  return gfPolyRemainder(padded, gen);
}

// ── QR Code Tables ─────────────────────────────────────────────────────────

// Total codewords per version (data + ECC)
const TOTAL_CODEWORDS: number[] = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
];

// ECC codewords per block for each version and level
// [version][L, M, Q, H]
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [],
  [7, 10, 13, 17],    // v1
  [10, 16, 22, 28],   // v2
  [15, 26, 18, 22],   // v3
  [20, 18, 26, 16],   // v4
  [26, 24, 18, 22],   // v5
  [18, 16, 24, 28],   // v6
  [20, 18, 18, 26],   // v7
  [24, 22, 22, 26],   // v8
  [30, 22, 20, 24],   // v9
  [18, 26, 24, 28],   // v10
];

// Number of blocks for each version and level
// [version][L, M, Q, H]
const NUM_BLOCKS: number[][] = [
  [],
  [1, 1, 1, 1],       // v1
  [1, 1, 1, 1],       // v2
  [1, 1, 2, 2],       // v3
  [1, 2, 2, 4],       // v4
  [1, 2, 4, 4],       // v5
  [2, 4, 4, 4],       // v6
  [2, 4, 6, 5],       // v7
  [2, 4, 6, 6],       // v8
  [2, 5, 8, 8],       // v9
  [4, 5, 8, 8],       // v10
];

// Max byte-mode character capacity for each version and level
// (used for user-facing capacity display and version selection)
const BYTE_MODE_CAPACITY: number[][] = [
  [],
  [17, 14, 11, 7],        // v1
  [32, 26, 20, 14],       // v2
  [53, 42, 32, 24],       // v3
  [78, 62, 46, 34],       // v4
  [106, 84, 60, 44],      // v5
  [134, 106, 74, 58],     // v6
  [154, 122, 86, 64],     // v7
  [192, 152, 108, 84],    // v8
  [230, 180, 130, 98],    // v9
  [271, 213, 151, 119],   // v10
];

// Alignment pattern center positions per version
const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [],                    // v1 — none
  [6, 18],              // v2
  [6, 22],              // v3
  [6, 26],              // v4
  [6, 30],              // v5
  [6, 34],              // v6
  [6, 22, 38],          // v7
  [6, 24, 42],          // v8
  [6, 26, 46],          // v9
  [6, 28, 52],          // v10
];

const ECC_LEVEL_INDEX: Record<ErrorCorrectionLevel, number> = {
  L: 0,
  M: 1,
  Q: 2,
  H: 3,
};

// Format info bits for ECC level (2 bits)
const ECC_FORMAT_BITS: Record<ErrorCorrectionLevel, number> = {
  L: 0b01,
  M: 0b00,
  Q: 0b11,
  H: 0b10,
};

// ── Utility Functions ──────────────────────────────────────────────────────

function versionSize(version: number): number {
  return 17 + version * 4;
}

/** Total data codewords for a version/ECC (total codewords minus ECC codewords). */
function getDataCodewords(version: number, ecc: ErrorCorrectionLevel): number {
  const levelIdx = ECC_LEVEL_INDEX[ecc];
  const totalEcc = NUM_BLOCKS[version][levelIdx] * ECC_CODEWORDS_PER_BLOCK[version][levelIdx];
  return TOTAL_CODEWORDS[version] - totalEcc;
}

/** Max characters in byte mode for user display. */
export function getCapacity(version: number, ecc: ErrorCorrectionLevel): number {
  if (version < 1 || version > 10) return 0;
  return BYTE_MODE_CAPACITY[version][ECC_LEVEL_INDEX[ecc]];
}

export function selectVersion(dataLength: number, ecc: ErrorCorrectionLevel): number {
  for (let v = 1; v <= 10; v++) {
    if (dataLength <= getCapacity(v, ecc)) return v;
  }
  return -1;
}

function utf8Encode(text: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(text);
}

// ── Data Encoding ──────────────────────────────────────────────────────────

class BitBuffer {
  private data: number[] = [];
  private bitLength = 0;

  put(value: number, numBits: number): void {
    for (let i = numBits - 1; i >= 0; i--) {
      this.data.push((value >>> i) & 1);
      this.bitLength++;
    }
  }

  getBitLength(): number {
    return this.bitLength;
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bitLength / 8));
    for (let i = 0; i < this.bitLength; i++) {
      if (this.data[i] === 1) {
        bytes[i >>> 3] |= 0x80 >>> (i & 7);
      }
    }
    return bytes;
  }
}

function encodeData(text: string, version: number, ecc: ErrorCorrectionLevel): Uint8Array {
  const utf8Bytes = utf8Encode(text);
  const totalDataCodewords = getDataCodewords(version, ecc);

  const buf = new BitBuffer();

  // Mode indicator: byte mode = 0100
  buf.put(0b0100, 4);

  // Character count indicator (8 bits for v1-9, 16 bits for v10+)
  const countBits = version <= 9 ? 8 : 16;
  buf.put(utf8Bytes.length, countBits);

  // Data bytes
  for (const b of utf8Bytes) {
    buf.put(b, 8);
  }

  // Terminator (up to 4 zero bits)
  const totalBits = totalDataCodewords * 8;
  const remainingBits = totalBits - buf.getBitLength();
  buf.put(0, Math.min(4, remainingBits));

  // Pad to byte boundary
  while (buf.getBitLength() % 8 !== 0) {
    buf.put(0, 1);
  }

  // Pad with alternating 0xEC and 0x11
  const bytes = buf.toBytes();
  const result = new Uint8Array(totalDataCodewords);
  result.set(bytes.slice(0, totalDataCodewords));

  let padIdx = bytes.length;
  let toggle = false;
  while (padIdx < totalDataCodewords) {
    result[padIdx] = toggle ? 0x11 : 0xec;
    toggle = !toggle;
    padIdx++;
  }

  return result;
}

// ── Error Correction ───────────────────────────────────────────────────────

interface BlockInfo {
  numBlocks: number;
  dataPerBlock: number;
  eccPerBlock: number;
  totalPerBlock: number;
}

function getBlockInfo(version: number, ecc: ErrorCorrectionLevel): BlockInfo[] {
  const levelIdx = ECC_LEVEL_INDEX[ecc];
  const totalCodewords = TOTAL_CODEWORDS[version];
  const numBlocks = NUM_BLOCKS[version][levelIdx];
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[version][levelIdx];
  const totalEcc = numBlocks * eccPerBlock;
  const totalData = totalCodewords - totalEcc;

  // For versions with multiple blocks, some blocks may have 1 more data codeword
  const shortBlockData = Math.floor(totalData / numBlocks);
  const longBlocks = totalData % numBlocks;
  const shortBlocks = numBlocks - longBlocks;

  const blocks: BlockInfo[] = [];
  if (shortBlocks > 0) {
    blocks.push({
      numBlocks: shortBlocks,
      dataPerBlock: shortBlockData,
      eccPerBlock,
      totalPerBlock: shortBlockData + eccPerBlock,
    });
  }
  if (longBlocks > 0) {
    blocks.push({
      numBlocks: longBlocks,
      dataPerBlock: shortBlockData + 1,
      eccPerBlock,
      totalPerBlock: shortBlockData + 1 + eccPerBlock,
    });
  }

  return blocks;
}

function addErrorCorrection(
  data: Uint8Array,
  version: number,
  ecc: ErrorCorrectionLevel,
): Uint8Array {
  const blockInfos = getBlockInfo(version, ecc);
  const allDataBlocks: Uint8Array[] = [];
  const allEccBlocks: Uint8Array[] = [];

  let dataOffset = 0;
  let maxDataLen = 0;
  let maxEccLen = 0;

  for (const info of blockInfos) {
    for (let b = 0; b < info.numBlocks; b++) {
      const blockData = data.slice(dataOffset, dataOffset + info.dataPerBlock);
      dataOffset += info.dataPerBlock;

      const eccData = rsEncode(blockData, info.eccPerBlock);

      allDataBlocks.push(blockData);
      allEccBlocks.push(eccData);

      maxDataLen = Math.max(maxDataLen, blockData.length);
      maxEccLen = Math.max(maxEccLen, eccData.length);
    }
  }

  // Interleave data blocks
  const result: number[] = [];
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of allDataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  // Interleave ECC blocks
  for (let i = 0; i < maxEccLen; i++) {
    for (const block of allEccBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }

  return new Uint8Array(result);
}

// ── Matrix Construction ────────────────────────────────────────────────────

type Module = 0 | 1;
type Matrix = Module[][];

function createMatrix(size: number): Matrix {
  return Array.from({ length: size }, () => new Array(size).fill(0) as Module[]);
}

function createReserved(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

function placeFinderPattern(
  matrix: Matrix,
  reserved: boolean[][],
  row: number,
  col: number,
): void {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r;
      const mc = col + c;
      if (mr < 0 || mr >= matrix.length || mc < 0 || mc >= matrix.length) continue;

      let val: Module = 0;
      if (r >= 0 && r <= 6 && (c === 0 || c === 6)) val = 1;
      else if (c >= 0 && c <= 6 && (r === 0 || r === 6)) val = 1;
      else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) val = 1;

      matrix[mr][mc] = val;
      reserved[mr][mc] = true;
    }
  }
}

function placeAlignmentPattern(
  matrix: Matrix,
  reserved: boolean[][],
  row: number,
  col: number,
): void {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const mr = row + r;
      const mc = col + c;
      if (mr < 0 || mr >= matrix.length || mc < 0 || mc >= matrix.length) continue;

      let val: Module = 0;
      if (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0)) val = 1;

      matrix[mr][mc] = val;
      reserved[mr][mc] = true;
    }
  }
}

function placeTimingPatterns(matrix: Matrix, reserved: boolean[][]): void {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i++) {
    const val: Module = i % 2 === 0 ? 1 : 0;
    // Horizontal
    if (!reserved[6][i]) {
      matrix[6][i] = val;
      reserved[6][i] = true;
    }
    // Vertical
    if (!reserved[i][6]) {
      matrix[i][6] = val;
      reserved[i][6] = true;
    }
  }
}

function reserveFormatArea(reserved: boolean[][], size: number): void {
  // Around top-left finder
  for (let i = 0; i <= 8; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  // Around top-right finder
  for (let i = 0; i <= 7; i++) {
    reserved[8][size - 1 - i] = true;
  }
  // Around bottom-left finder
  for (let i = 0; i <= 7; i++) {
    reserved[size - 1 - i][8] = true;
  }
}

function placeDarkModule(matrix: Matrix, reserved: boolean[][], version: number): void {
  const row = 4 * version + 9;
  matrix[row][8] = 1;
  reserved[row][8] = true;
}

function placeDataBits(matrix: Matrix, reserved: boolean[][], data: Uint8Array): void {
  const size = matrix.length;
  let bitIndex = 0;
  const totalBits = data.length * 8;

  // Zigzag from right to left, bottom to top, then top to bottom
  let col = size - 1;
  while (col >= 0) {
    // Skip the vertical timing pattern column
    if (col === 6) col--;

    for (let step = 0; step < size; step++) {
      for (let dx = 0; dx <= 1; dx++) {
        const c = col - dx;
        // Direction alternates: right columns go upward, next pair goes downward
        const upward = ((size - 1 - col) >> 1) % 2 === 0;
        const r = upward ? size - 1 - step : step;

        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        if (reserved[r][c]) continue;

        if (bitIndex < totalBits) {
          const byteIdx = bitIndex >>> 3;
          const bitIdx = 7 - (bitIndex & 7);
          matrix[r][c] = ((data[byteIdx] >>> bitIdx) & 1) as Module;
          bitIndex++;
        }
        // Remaining modules stay 0
      }
    }
    col -= 2;
  }
}

// ── Masking ────────────────────────────────────────────────────────────────

type MaskFunction = (row: number, col: number) => boolean;

const MASK_FUNCTIONS: MaskFunction[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(matrix: Matrix, reserved: boolean[][], maskIdx: number): Matrix {
  const size = matrix.length;
  const masked = matrix.map((row) => [...row]) as Matrix;
  const fn = MASK_FUNCTIONS[maskIdx];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) {
        masked[r][c] = (masked[r][c] ^ 1) as Module;
      }
    }
  }

  return masked;
}

// ── Penalty Scoring ────────────────────────────────────────────────────────

function penaltyScore(matrix: Matrix): number {
  const size = matrix.length;
  let penalty = 0;

  // Rule 1: runs of same color >= 5 in a row/column
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (matrix[r][c] === matrix[r][c - 1]) {
        run++;
      } else {
        if (run >= 5) penalty += run - 2;
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (matrix[r][c] === matrix[r - 1][c]) {
        run++;
      } else {
        if (run >= 5) penalty += run - 2;
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const val = matrix[r][c];
      if (
        val === matrix[r][c + 1] &&
        val === matrix[r + 1][c] &&
        val === matrix[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like patterns (1:1:3:1:1 dark pattern)
  const finderPattern = [1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      // Check with 4 white before
      let match = true;
      for (let i = 0; i < 4; i++) {
        if (matrix[r][c + i] !== 0) { match = false; break; }
      }
      if (match) {
        for (let i = 0; i < 7; i++) {
          if (matrix[r][c + 4 + i] !== finderPattern[i]) { match = false; break; }
        }
        if (match) penalty += 40;
      }

      // Check with 4 white after
      match = true;
      for (let i = 0; i < 7; i++) {
        if (matrix[r][c + i] !== finderPattern[i]) { match = false; break; }
      }
      if (match) {
        let allWhite = true;
        for (let i = 0; i < 4; i++) {
          if (matrix[r][c + 7 + i] !== 0) { allWhite = false; break; }
        }
        if (allWhite) penalty += 40;
      }
    }
  }
  // Same for columns
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let match = true;
      for (let i = 0; i < 4; i++) {
        if (matrix[r + i][c] !== 0) { match = false; break; }
      }
      if (match) {
        for (let i = 0; i < 7; i++) {
          if (matrix[r + 4 + i][c] !== finderPattern[i]) { match = false; break; }
        }
        if (match) penalty += 40;
      }

      match = true;
      for (let i = 0; i < 7; i++) {
        if (matrix[r + i][c] !== finderPattern[i]) { match = false; break; }
      }
      if (match) {
        let allWhite = true;
        for (let i = 0; i < 4; i++) {
          if (matrix[r + 7 + i][c] !== 0) { allWhite = false; break; }
        }
        if (allWhite) penalty += 40;
      }
    }
  }

  // Rule 4: proportion of dark modules
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) darkCount++;
    }
  }
  const totalModules = size * size;
  const darkPercent = (darkCount / totalModules) * 100;
  const prev5 = Math.floor(darkPercent / 5) * 5;
  const next5 = prev5 + 5;
  penalty += Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;

  return penalty;
}

// ── Format Information ─────────────────────────────────────────────────────

const FORMAT_MASK = 0b101010000010010;

function computeFormatBits(ecc: ErrorCorrectionLevel, maskIdx: number): number {
  const data = (ECC_FORMAT_BITS[ecc] << 3) | maskIdx;
  let bits = data << 10;

  // BCH(15,5) with generator 0x537
  let temp = bits;
  for (let i = 4; i >= 0; i--) {
    if (temp & (1 << (i + 10))) {
      temp ^= 0x537 << i;
    }
  }
  bits |= temp;
  return bits ^ FORMAT_MASK;
}

function placeFormatInfo(matrix: Matrix, ecc: ErrorCorrectionLevel, maskIdx: number): void {
  const size = matrix.length;
  const bits = computeFormatBits(ecc, maskIdx);

  // Place around top-left finder pattern
  const positions0: [number, number][] = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ];

  // Place along right side and bottom
  const positions1: [number, number][] = [
    [8, size - 1], [8, size - 2], [8, size - 3], [8, size - 4],
    [8, size - 5], [8, size - 6], [8, size - 7], [8, size - 8],
    [size - 7, 8], [size - 6, 8], [size - 5, 8], [size - 4, 8],
    [size - 3, 8], [size - 2, 8], [size - 1, 8],
  ];

  for (let i = 0; i < 15; i++) {
    const bit: Module = ((bits >>> i) & 1) as Module;
    const [r0, c0] = positions0[i];
    matrix[r0][c0] = bit;
    const [r1, c1] = positions1[i];
    matrix[r1][c1] = bit;
  }
}

// ── Main Encode Function ───────────────────────────────────────────────────

export function encode(text: string, ecc: ErrorCorrectionLevel = "M"): QrCode {
  if (text.length === 0) {
    throw new Error("Input text cannot be empty");
  }

  const utf8Bytes = utf8Encode(text);
  const version = selectVersion(utf8Bytes.length, ecc);

  if (version < 0) {
    throw new Error(
      `Text too long for QR versions 1-10 at ECC level ${ecc}. ` +
      `Max capacity: ${getCapacity(10, ecc)} bytes.`,
    );
  }

  const size = versionSize(version);

  // 1. Encode data
  const dataCodewords = encodeData(text, version, ecc);

  // 2. Add error correction
  const fullCodewords = addErrorCorrection(dataCodewords, version, ecc);

  // 3. Create matrix and place function patterns
  const matrix = createMatrix(size);
  const reserved = createReserved(size);

  // Finder patterns (top-left, top-right, bottom-left)
  placeFinderPattern(matrix, reserved, 0, 0);
  placeFinderPattern(matrix, reserved, 0, size - 7);
  placeFinderPattern(matrix, reserved, size - 7, 0);

  // Alignment patterns
  const positions = ALIGNMENT_POSITIONS[version];
  if (positions.length > 0) {
    for (const r of positions) {
      for (const c of positions) {
        // Skip if overlapping with finder patterns
        if (r <= 8 && c <= 8) continue;
        if (r <= 8 && c >= size - 8) continue;
        if (r >= size - 8 && c <= 8) continue;
        placeAlignmentPattern(matrix, reserved, r, c);
      }
    }
  }

  // Timing patterns
  placeTimingPatterns(matrix, reserved);

  // Dark module
  placeDarkModule(matrix, reserved, version);

  // Reserve format area
  reserveFormatArea(reserved, size);

  // 4. Place data
  placeDataBits(matrix, reserved, fullCodewords);

  // 5. Try all 8 masks and pick best
  let bestPenalty = Infinity;
  let bestMatrix: Matrix = matrix;

  for (let m = 0; m < 8; m++) {
    const masked = applyMask(matrix, reserved, m);
    placeFormatInfo(masked, ecc, m);
    const score = penaltyScore(masked);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMatrix = masked;
    }
  }

  // Convert to boolean matrix
  const modules: boolean[][] = bestMatrix.map((row) =>
    row.map((cell) => cell === 1),
  );

  return { version, size, eccLevel: ecc, modules };
}
