import { useState, useCallback, useMemo } from "preact/hooks";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

type BitWidth = 8 | 16 | 32 | 64;
type FloatPrecision = "float32" | "float64";
type BitwiseOp = "AND" | "OR" | "XOR" | "NOT" | "SHL" | "SHR";
type ActiveTab = "converter" | "ieee754" | "bitwise" | "ascii";

interface Ieee754Parts {
  sign: number;
  exponentBits: number[];
  mantissaBits: number[];
  exponentValue: number;
  bias: number;
  mantissaValue: number;
  formula: string;
  specialValue: string | null;
  isDenormalized: boolean;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const BIT_WIDTHS: BitWidth[] = [8, 16, 32, 64];

const BITWISE_OPS: BitwiseOp[] = ["AND", "OR", "XOR", "NOT", "SHL", "SHR"];

const BITWISE_SYMBOLS: Record<BitwiseOp, string> = {
  AND: "&",
  OR: "|",
  XOR: "^",
  NOT: "~",
  SHL: "<<",
  SHR: ">>",
};

const ASCII_CONTROL_NAMES: Record<number, string> = {
  0: "NUL", 1: "SOH", 2: "STX", 3: "ETX", 4: "EOT", 5: "ENQ",
  6: "ACK", 7: "BEL", 8: "BS", 9: "TAB", 10: "LF", 11: "VT",
  12: "FF", 13: "CR", 14: "SO", 15: "SI", 16: "DLE", 17: "DC1",
  18: "DC2", 19: "DC3", 20: "DC4", 21: "NAK", 22: "SYN", 23: "ETB",
  24: "CAN", 25: "EM", 26: "SUB", 27: "ESC", 28: "FS", 29: "GS",
  30: "RS", 31: "US", 127: "DEL",
};

/* ──────────────────────────────────────
   Pure Conversion Functions
   ────────────────────────────────────── */

function clampToBitWidth(value: bigint, bitWidth: BitWidth, signed: boolean): bigint {
  const mask = (1n << BigInt(bitWidth)) - 1n;
  const clamped = value & mask;
  if (signed && clamped >= (1n << BigInt(bitWidth - 1))) {
    return clamped - (1n << BigInt(bitWidth));
  }
  return clamped;
}

function toUnsigned(value: bigint, bitWidth: BitWidth): bigint {
  const mask = (1n << BigInt(bitWidth)) - 1n;
  return value & mask;
}

function toBinaryString(value: bigint, bitWidth: BitWidth): string {
  const unsigned = toUnsigned(value, bitWidth);
  return unsigned.toString(2).padStart(bitWidth, "0");
}

function formatBinaryGrouped(binary: string, groupSize: number = 4): string {
  const groups: string[] = [];
  for (let i = 0; i < binary.length; i += groupSize) {
    groups.push(binary.slice(i, i + groupSize));
  }
  return groups.join(" ");
}

function toHexString(value: bigint, bitWidth: BitWidth): string {
  const unsigned = toUnsigned(value, bitWidth);
  const hexDigits = bitWidth / 4;
  return unsigned.toString(16).toUpperCase().padStart(hexDigits, "0");
}

function toOctalString(value: bigint, bitWidth: BitWidth): string {
  const unsigned = toUnsigned(value, bitWidth);
  return unsigned.toString(8);
}

function toCustomBaseString(value: bigint, bitWidth: BitWidth, base: number): string {
  const unsigned = toUnsigned(value, bitWidth);
  return unsigned.toString(base).toUpperCase();
}

function parseBigIntFromBase(input: string, base: number): bigint | null {
  const cleaned = input.replace(/[\s_]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;

  try {
    if (base === 10) {
      return BigInt(cleaned);
    }
    if (base === 16) {
      const hex = cleaned.replace(/^0x/i, "");
      if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
      return BigInt("0x" + hex);
    }
    if (base === 2) {
      const bin = cleaned.replace(/^0b/i, "");
      if (!/^[01]+$/.test(bin)) return null;
      return BigInt("0b" + bin);
    }
    if (base === 8) {
      const oct = cleaned.replace(/^0o/i, "");
      if (!/^[0-7]+$/.test(oct)) return null;
      return BigInt("0o" + oct);
    }
    // Custom base 2-36
    const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
    const lower = cleaned.toLowerCase();
    let result = 0n;
    for (const ch of lower) {
      const d = digits.indexOf(ch);
      if (d < 0 || d >= base) return null;
      result = result * BigInt(base) + BigInt(d);
    }
    return result;
  } catch {
    return null;
  }
}

function getBits(value: bigint, bitWidth: BitWidth): number[] {
  const unsigned = toUnsigned(value, bitWidth);
  const bits: number[] = [];
  for (let i = bitWidth - 1; i >= 0; i--) {
    bits.push(Number((unsigned >> BigInt(i)) & 1n));
  }
  return bits;
}

function toggleBit(value: bigint, bitIndex: number, bitWidth: BitWidth): bigint {
  const unsigned = toUnsigned(value, bitWidth);
  const toggled = unsigned ^ (1n << BigInt(bitIndex));
  return toggled & ((1n << BigInt(bitWidth)) - 1n);
}

/* ──────────────────────────────────────
   IEEE 754 Functions
   ────────────────────────────────────── */

function getIeee754Bits(value: number, precision: FloatPrecision): number[] {
  const buffer = new ArrayBuffer(precision === "float32" ? 4 : 8);
  const view = new DataView(buffer);

  if (precision === "float32") {
    view.setFloat32(0, value, false); // big-endian
    const bits: number[] = [];
    for (let byteIdx = 0; byteIdx < 4; byteIdx++) {
      const byte = view.getUint8(byteIdx);
      for (let bitIdx = 7; bitIdx >= 0; bitIdx--) {
        bits.push((byte >> bitIdx) & 1);
      }
    }
    return bits;
  }

  view.setFloat64(0, value, false);
  const bits: number[] = [];
  for (let byteIdx = 0; byteIdx < 8; byteIdx++) {
    const byte = view.getUint8(byteIdx);
    for (let bitIdx = 7; bitIdx >= 0; bitIdx--) {
      bits.push((byte >> bitIdx) & 1);
    }
  }
  return bits;
}

function parseIeee754(value: number, precision: FloatPrecision): Ieee754Parts {
  const bits = getIeee754Bits(value, precision);
  const expBits = precision === "float32" ? 8 : 11;
  const bias = precision === "float32" ? 127 : 1023;

  const sign = bits[0];
  const exponentBits = bits.slice(1, 1 + expBits);
  const mantissaBits = bits.slice(1 + expBits);

  let exponentValue = 0;
  for (const b of exponentBits) {
    exponentValue = (exponentValue << 1) | b;
  }

  let mantissaValue = 0;
  for (let i = 0; i < mantissaBits.length; i++) {
    mantissaValue += mantissaBits[i] * Math.pow(2, -(i + 1));
  }

  const maxExponent = (1 << expBits) - 1;
  let specialValue: string | null = null;
  let isDenormalized = false;
  let formula: string;

  if (exponentValue === 0 && mantissaValue === 0) {
    specialValue = sign === 0 ? "+0" : "-0";
    formula = `(-1)^${sign} * 0 = ${specialValue}`;
  } else if (exponentValue === 0) {
    isDenormalized = true;
    const actualExp = 1 - bias;
    const result = Math.pow(-1, sign) * Math.pow(2, actualExp) * mantissaValue;
    formula = `(-1)^${sign} * 2^(${actualExp}) * 0.${mantissaFraction(mantissaBits)} = ${result.toExponential(6)}`;
  } else if (exponentValue === maxExponent && mantissaValue === 0) {
    specialValue = sign === 0 ? "+Infinity" : "-Infinity";
    formula = specialValue;
  } else if (exponentValue === maxExponent) {
    specialValue = "NaN";
    formula = "NaN (not a number)";
  } else {
    const actualExp = exponentValue - bias;
    const implicitMantissa = 1 + mantissaValue;
    const result = Math.pow(-1, sign) * Math.pow(2, actualExp) * implicitMantissa;
    formula = `(-1)^${sign} * 2^(${actualExp}) * 1.${mantissaFraction(mantissaBits)} = ${formatIeeeResult(result)}`;
  }

  return {
    sign,
    exponentBits,
    mantissaBits,
    exponentValue,
    bias,
    mantissaValue,
    formula,
    specialValue,
    isDenormalized,
  };
}

function mantissaFraction(bits: number[]): string {
  let lastOne = -1;
  for (let i = bits.length - 1; i >= 0; i--) {
    if (bits[i] === 1) { lastOne = i; break; }
  }
  if (lastOne === -1) return "0";
  return bits.slice(0, lastOne + 1).join("");
}

function formatIeeeResult(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return value.toString();
  }
  const fixed = value.toPrecision(10);
  return parseFloat(fixed).toString();
}

/* ──────────────────────────────────────
   Bitwise Operations
   ────────────────────────────────────── */

function performBitwiseOp(
  a: bigint,
  b: bigint,
  op: BitwiseOp,
  bitWidth: BitWidth,
): bigint {
  const ua = toUnsigned(a, bitWidth);
  const ub = toUnsigned(b, bitWidth);
  const mask = (1n << BigInt(bitWidth)) - 1n;

  switch (op) {
    case "AND": return (ua & ub) & mask;
    case "OR": return (ua | ub) & mask;
    case "XOR": return (ua ^ ub) & mask;
    case "NOT": return (~ua) & mask;
    case "SHL": return (ua << ub) & mask;
    case "SHR": return (ua >> ub) & mask;
  }
}

/* ──────────────────────────────────────
   Byte Order
   ────────────────────────────────────── */

function getBytes(value: bigint, bitWidth: BitWidth): number[] {
  const unsigned = toUnsigned(value, bitWidth);
  const byteCount = bitWidth / 8;
  const bytes: number[] = [];
  for (let i = byteCount - 1; i >= 0; i--) {
    bytes.push(Number((unsigned >> BigInt(i * 8)) & 0xFFn));
  }
  return bytes;
}

/* ──────────────────────────────────────
   Styles
   ────────────────────────────────────── */

const STYLES = {
  container: {
    fontFamily: "var(--font-sans)",
    color: "var(--color-text)",
  },
  card: {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.75rem",
    padding: "1.25rem",
    marginBottom: "1rem",
  },
  input: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.5rem",
    color: "var(--color-text)",
    padding: "0.5rem 0.75rem",
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
    width: "100%",
    outline: "none",
  },
  label: {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--color-text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "0.25rem",
    display: "block",
  },
  sectionTitle: {
    fontSize: "0.875rem",
    fontWeight: 700,
    color: "var(--color-heading)",
    marginBottom: "0.75rem",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
  bitCell: (isSet: boolean, highlight?: string) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "1.75rem",
    height: "1.75rem",
    borderRadius: "0.25rem",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s ease",
    background: highlight
      ? highlight
      : isSet
        ? "var(--color-primary)"
        : "var(--color-bg)",
    color: isSet ? "#ffffff" : "var(--color-text-muted)",
    border: `1px solid ${isSet ? "var(--color-primary)" : "var(--color-border)"}`,
    userSelect: "none" as const,
  }),
  bitLabel: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.6rem",
    color: "var(--color-text-muted)",
    textAlign: "center" as const,
    marginTop: "0.125rem",
  },
  tab: (active: boolean) => ({
    padding: "0.5rem 1rem",
    borderRadius: "0.5rem",
    fontSize: "0.8rem",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    border: "none",
    transition: "all 0.15s ease",
    background: active ? "var(--color-primary)" : "transparent",
    color: active ? "#ffffff" : "var(--color-text-muted)",
  }),
  toggleBtn: (active: boolean) => ({
    padding: "0.375rem 0.75rem",
    borderRadius: "0.375rem",
    fontSize: "0.75rem",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    border: `1px solid ${active ? "var(--color-primary)" : "var(--color-border)"}`,
    background: active ? "var(--color-primary)" : "transparent",
    color: active ? "#ffffff" : "var(--color-text-muted)",
    transition: "all 0.15s ease",
  }),
  select: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.375rem",
    color: "var(--color-text)",
    padding: "0.375rem 0.5rem",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    outline: "none",
    cursor: "pointer",
  },
} as const;

/* ──────────────────────────────────────
   Sub-Components
   ────────────────────────────────────── */

function InputRow({
  label,
  value,
  onChange,
  placeholder,
  prefix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
}) {
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <label style={STYLES.label}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {prefix && (
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            color: "var(--color-text-muted)",
            whiteSpace: "nowrap",
          }}>
            {prefix}
          </span>
        )}
        <input
          type="text"
          value={value}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
          placeholder={placeholder}
          style={STYLES.input}
          spellcheck={false}
        />
      </div>
    </div>
  );
}

function BitGrid({
  bits,
  bitWidth,
  onToggle,
}: {
  bits: number[];
  bitWidth: BitWidth;
  onToggle: (bitIndex: number) => void;
}) {
  const rowSize = bitWidth <= 16 ? bitWidth : 16;
  const rows: number[][] = [];
  for (let i = 0; i < bits.length; i += rowSize) {
    rows.push(bits.slice(i, i + rowSize));
  }

  return (
    <div>
      {rows.map((row, rowIdx) => (
        <div key={rowIdx} style={{ marginBottom: "0.5rem" }}>
          <div style={{
            display: "flex",
            gap: "0.25rem",
            flexWrap: "wrap",
          }}>
            {row.map((bit, colIdx) => {
              const globalIdx = rowIdx * rowSize + colIdx;
              const bitPosition = bitWidth - 1 - globalIdx;
              const isMsb = globalIdx === 0;
              return (
                <div
                  key={colIdx}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    marginRight: (colIdx + 1) % 4 === 0 && colIdx < row.length - 1
                      ? "0.5rem"
                      : "0",
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onToggle(bitPosition)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onToggle(bitPosition);
                      }
                    }}
                    style={{
                      ...STYLES.bitCell(bit === 1),
                      ...(isMsb && bit === 1 ? { background: "var(--color-accent)" } : {}),
                      ...(isMsb && bit === 1 ? { borderColor: "var(--color-accent)" } : {}),
                    }}
                    title={`Bit ${bitPosition}${isMsb ? " (MSB)" : ""}`}
                  >
                    {bit}
                  </div>
                  <div style={STYLES.bitLabel}>{bitPosition}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Ieee754Viewer({
  floatInput,
  setFloatInput,
  precision,
  setPrecision,
}: {
  floatInput: string;
  setFloatInput: (v: string) => void;
  precision: FloatPrecision;
  setPrecision: (v: FloatPrecision) => void;
}) {
  const parsed = useMemo(() => {
    const val = parseFloat(floatInput);
    if (floatInput.trim() === "" || (isNaN(val) && floatInput.trim().toLowerCase() !== "nan")) {
      return null;
    }
    const numVal = floatInput.trim().toLowerCase() === "nan" ? NaN
      : floatInput.trim().toLowerCase() === "infinity" || floatInput.trim() === "+inf" ? Infinity
      : floatInput.trim().toLowerCase() === "-infinity" || floatInput.trim() === "-inf" ? -Infinity
      : val;
    return parseIeee754(numVal, precision);
  }, [floatInput, precision]);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <label style={STYLES.label}>Float Value</label>
          <input
            type="text"
            value={floatInput}
            onInput={(e) => setFloatInput((e.target as HTMLInputElement).value)}
            placeholder="e.g. 3.14, NaN, Infinity"
            style={STYLES.input}
            spellcheck={false}
          />
        </div>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {(["float32", "float64"] as FloatPrecision[]).map((p) => (
            <button
              key={p}
              onClick={() => setPrecision(p)}
              style={STYLES.toggleBtn(precision === p)}
            >
              {p === "float32" ? "32-bit" : "64-bit"}
            </button>
          ))}
        </div>
      </div>

      {parsed && (
        <div>
          {/* Bit visualization */}
          <div style={{
            display: "flex",
            gap: "0.25rem",
            flexWrap: "wrap",
            alignItems: "flex-start",
            marginBottom: "0.75rem",
          }}>
            {/* Sign bit */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                ...STYLES.bitCell(parsed.sign === 1, "#ef4444"),
                color: "#ffffff",
              }}>
                {parsed.sign}
              </div>
              <div style={{ ...STYLES.bitLabel, color: "#ef4444" }}>S</div>
            </div>

            <div style={{ width: "0.5rem" }} />

            {/* Exponent bits */}
            {parsed.exponentBits.map((bit, i) => (
              <div key={`exp-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  ...STYLES.bitCell(bit === 1, bit === 1 ? "#4f8ff7" : undefined),
                  ...(bit === 1 ? { color: "#ffffff", borderColor: "#4f8ff7" } : { borderColor: "#4f8ff7" }),
                }}>
                  {bit}
                </div>
                <div style={{ ...STYLES.bitLabel, color: "#4f8ff7" }}>
                  {i === 0 ? "E" : ""}
                </div>
              </div>
            ))}

            <div style={{ width: "0.5rem" }} />

            {/* Mantissa bits — show first 23 then truncation indicator */}
            {parsed.mantissaBits.slice(0, 32).map((bit, i) => (
              <div key={`man-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  ...STYLES.bitCell(bit === 1, bit === 1 ? "#34d399" : undefined),
                  ...(bit === 1 ? { color: "#ffffff", borderColor: "#34d399" } : { borderColor: "#34d399" }),
                }}>
                  {bit}
                </div>
                <div style={{ ...STYLES.bitLabel, color: "#34d399" }}>
                  {i === 0 ? "M" : ""}
                </div>
              </div>
            ))}
            {parsed.mantissaBits.length > 32 && (
              <div style={{
                display: "flex",
                alignItems: "center",
                color: "var(--color-text-muted)",
                fontSize: "0.75rem",
                fontFamily: "var(--font-mono)",
                paddingTop: "0.25rem",
              }}>
                ...+{parsed.mantissaBits.length - 32} bits
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{
            display: "flex",
            gap: "1rem",
            fontSize: "0.7rem",
            color: "var(--color-text-muted)",
            marginBottom: "0.75rem",
            flexWrap: "wrap",
          }}>
            <span><span style={{ color: "#ef4444", fontWeight: 700 }}>S</span> Sign (1 bit)</span>
            <span><span style={{ color: "#4f8ff7", fontWeight: 700 }}>E</span> Exponent ({precision === "float32" ? 8 : 11} bits)</span>
            <span><span style={{ color: "#34d399", fontWeight: 700 }}>M</span> Mantissa ({precision === "float32" ? 23 : 52} bits)</span>
          </div>

          {/* Details */}
          <div style={{
            background: "var(--color-bg)",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            lineHeight: 1.8,
          }}>
            {parsed.specialValue && (
              <div style={{ color: "#ef4444", fontWeight: 700, marginBottom: "0.25rem" }}>
                Special value: {parsed.specialValue}
              </div>
            )}
            {parsed.isDenormalized && (
              <div style={{ color: "#f59e0b", fontWeight: 700, marginBottom: "0.25rem" }}>
                Denormalized number
              </div>
            )}
            <div>
              <span style={{ color: "var(--color-text-muted)" }}>Sign: </span>
              <span style={{ color: "#ef4444" }}>{parsed.sign}</span>
              <span style={{ color: "var(--color-text-muted)" }}> = {parsed.sign === 0 ? "positive" : "negative"}</span>
            </div>
            <div>
              <span style={{ color: "var(--color-text-muted)" }}>Exponent: </span>
              <span style={{ color: "#4f8ff7" }}>{parsed.exponentValue}</span>
              <span style={{ color: "var(--color-text-muted)" }}> - {parsed.bias} (bias) = {parsed.exponentValue - parsed.bias}</span>
            </div>
            <div style={{ color: "var(--color-heading)", marginTop: "0.25rem" }}>
              {parsed.formula}
            </div>
          </div>
        </div>
      )}

      {!parsed && floatInput.trim() !== "" && (
        <div style={{ color: "#ef4444", fontSize: "0.8rem" }}>
          Invalid float value. Try a number, NaN, or Infinity.
        </div>
      )}
    </div>
  );
}

function BitwiseSection({
  bitWidth,
}: {
  bitWidth: BitWidth;
}) {
  const [inputA, setInputA] = useState("255");
  const [inputB, setInputB] = useState("128");
  const [op, setOp] = useState<BitwiseOp>("AND");

  const result = useMemo(() => {
    const a = parseBigIntFromBase(inputA, 10);
    const b = parseBigIntFromBase(inputB, 10);
    if (a === null) return null;
    if (op === "NOT") {
      return performBitwiseOp(a, 0n, op, bitWidth);
    }
    if (b === null) return null;
    return performBitwiseOp(a, b, op, bitWidth);
  }, [inputA, inputB, op, bitWidth]);

  const aBits = useMemo(() => {
    const a = parseBigIntFromBase(inputA, 10);
    return a !== null ? getBits(a, bitWidth) : null;
  }, [inputA, bitWidth]);

  const bBits = useMemo(() => {
    const b = parseBigIntFromBase(inputB, 10);
    return b !== null ? getBits(b, bitWidth) : null;
  }, [inputB, bitWidth]);

  const resultBits = useMemo(() => {
    return result !== null ? getBits(result, bitWidth) : null;
  }, [result, bitWidth]);

  const changedBits = useMemo(() => {
    if (!aBits || !resultBits) return null;
    return resultBits.map((bit, i) => bit !== aBits[i]);
  }, [aBits, resultBits]);

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div style={{ flex: 1, minWidth: "100px" }}>
          <label style={STYLES.label}>A</label>
          <input
            type="text"
            value={inputA}
            onInput={(e) => setInputA((e.target as HTMLInputElement).value)}
            style={STYLES.input}
            spellcheck={false}
          />
        </div>

        <div>
          <select
            value={op}
            onChange={(e) => setOp((e.target as HTMLSelectElement).value as BitwiseOp)}
            style={STYLES.select}
          >
            {BITWISE_OPS.map((o) => (
              <option key={o} value={o}>
                {o} ({BITWISE_SYMBOLS[o]})
              </option>
            ))}
          </select>
        </div>

        {op !== "NOT" && (
          <div style={{ flex: 1, minWidth: "100px" }}>
            <label style={STYLES.label}>B</label>
            <input
              type="text"
              value={inputB}
              onInput={(e) => setInputB((e.target as HTMLInputElement).value)}
              style={STYLES.input}
              spellcheck={false}
            />
          </div>
        )}

        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.875rem",
          color: "var(--color-text-muted)",
          padding: "0.5rem 0",
        }}>
          = {result !== null ? result.toString(10) : "?"}
        </div>
      </div>

      {/* Bit-level visualization */}
      {aBits && resultBits && (
        <div style={{
          background: "var(--color-bg)",
          borderRadius: "0.5rem",
          padding: "0.75rem",
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
          lineHeight: 2,
          overflowX: "auto",
        }}>
          <div style={{ whiteSpace: "nowrap" }}>
            <span style={{ color: "var(--color-text-muted)", display: "inline-block", width: "3rem" }}>A: </span>
            {formatBinaryGrouped(toBinaryString(parseBigIntFromBase(inputA, 10) ?? 0n, bitWidth))}
          </div>
          {op !== "NOT" && bBits && (
            <div style={{ whiteSpace: "nowrap" }}>
              <span style={{ color: "var(--color-text-muted)", display: "inline-block", width: "3rem" }}>B: </span>
              {formatBinaryGrouped(toBinaryString(parseBigIntFromBase(inputB, 10) ?? 0n, bitWidth))}
            </div>
          )}
          <div style={{
            borderTop: "1px solid var(--color-border)",
            paddingTop: "0.25rem",
            whiteSpace: "nowrap",
          }}>
            <span style={{ color: "var(--color-text-muted)", display: "inline-block", width: "3rem" }}>
              {BITWISE_SYMBOLS[op]}:
            </span>
            {toBinaryString(result ?? 0n, bitWidth).split("").map((bit, i) => (
              <span
                key={i}
                style={{
                  color: changedBits && changedBits[i] ? "var(--color-accent)" : "var(--color-text)",
                  fontWeight: changedBits && changedBits[i] ? 700 : 400,
                  marginRight: (i + 1) % 4 === 0 ? "0.35em" : "0",
                }}
              >
                {bit}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AsciiSection({ value }: { value: bigint }) {
  const charCode = Number(value & 0x7Fn);
  const isPrintable = charCode >= 32 && charCode < 127;
  const charDisplay = isPrintable
    ? String.fromCharCode(charCode)
    : ASCII_CONTROL_NAMES[charCode] ?? "?";

  return (
    <div>
      {/* Current value ASCII */}
      <div style={{
        background: "var(--color-bg)",
        borderRadius: "0.5rem",
        padding: "0.75rem",
        marginBottom: "1rem",
        display: "flex",
        alignItems: "center",
        gap: "1rem",
      }}>
        <div style={{
          fontSize: "2rem",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          color: isPrintable ? "var(--color-primary)" : "var(--color-text-muted)",
          minWidth: "3rem",
          textAlign: "center",
        }}>
          {isPrintable ? `'${charDisplay}'` : charDisplay}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
          <div>
            Decimal: {charCode} | Hex: 0x{charCode.toString(16).toUpperCase()} | Oct: 0{charCode.toString(8)}
          </div>
          <div>{isPrintable ? "Printable character" : "Control character"}</div>
        </div>
      </div>

      {/* ASCII table */}
      <div style={{ overflowX: "auto" }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(16, minmax(2rem, 1fr))",
          gap: "0.125rem",
          fontSize: "0.65rem",
          fontFamily: "var(--font-mono)",
        }}>
          {Array.from({ length: 128 }, (_, i) => {
            const isActive = i === charCode;
            const print = i >= 32 && i < 127;
            const ch = print ? String.fromCharCode(i) : (ASCII_CONTROL_NAMES[i] ?? "?");
            return (
              <div
                key={i}
                style={{
                  padding: "0.2rem",
                  textAlign: "center",
                  borderRadius: "0.2rem",
                  background: isActive
                    ? "var(--color-primary)"
                    : "var(--color-bg)",
                  color: isActive
                    ? "#ffffff"
                    : print
                      ? "var(--color-text)"
                      : "var(--color-text-muted)",
                  fontWeight: isActive ? 700 : 400,
                  lineHeight: 1.4,
                  cursor: "default",
                  border: isActive ? "1px solid var(--color-primary)" : "1px solid transparent",
                }}
                title={`${i}: ${ch}`}
              >
                <div style={{ fontSize: "0.55rem", color: isActive ? "#ffffff" : "var(--color-text-muted)" }}>
                  {i}
                </div>
                <div>{ch}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ByteOrderSection({ value, bitWidth }: { value: bigint; bitWidth: BitWidth }) {
  const bytes = getBytes(value, bitWidth);
  const littleEndian = [...bytes].reverse();

  return (
    <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
      <div>
        <div style={{ ...STYLES.label, marginBottom: "0.5rem" }}>Big-Endian (Network Order)</div>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {bytes.map((b, i) => (
            <div key={i} style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              padding: "0.375rem 0.5rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              textAlign: "center",
              minWidth: "2.5rem",
            }}>
              <div style={{ fontWeight: 700, color: "var(--color-primary)" }}>
                0x{b.toString(16).toUpperCase().padStart(2, "0")}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>
                [{i}]
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={{ ...STYLES.label, marginBottom: "0.5rem" }}>Little-Endian (x86 / ARM)</div>
        <div style={{ display: "flex", gap: "0.25rem" }}>
          {littleEndian.map((b, i) => (
            <div key={i} style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              padding: "0.375rem 0.5rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8rem",
              textAlign: "center",
              minWidth: "2.5rem",
            }}>
              <div style={{ fontWeight: 700, color: "var(--color-accent)" }}>
                0x{b.toString(16).toUpperCase().padStart(2, "0")}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-muted)" }}>
                [{i}]
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Main Component
   ────────────────────────────────────── */

export default function BaseConverter() {
  const [value, setValue] = useState<bigint>(255n);
  const [bitWidth, setBitWidth] = useState<BitWidth>(8);
  const [signed, setSigned] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("converter");
  const [customBase, setCustomBase] = useState(3);

  // IEEE 754
  const [floatInput, setFloatInput] = useState("3.14");
  const [precision, setPrecision] = useState<FloatPrecision>("float32");

  // Derived text values for inputs
  const [decimalText, setDecimalText] = useState("255");
  const [binaryText, setBinaryText] = useState("1111 1111");
  const [hexText, setHexText] = useState("FF");
  const [octalText, setOctalText] = useState("377");
  const [customBaseText, setCustomBaseText] = useState("");

  const unsignedValue = useMemo(
    () => toUnsigned(value, bitWidth),
    [value, bitWidth],
  );

  const bits = useMemo(
    () => getBits(value, bitWidth),
    [value, bitWidth],
  );

  // Sync text fields when value changes externally (not from own input)
  const updateAllTexts = useCallback((newValue: bigint, bw: BitWidth, isSigned: boolean, sourceField?: string) => {
    const clamped = clampToBitWidth(newValue, bw, isSigned);
    const unsigned = toUnsigned(newValue, bw);

    if (sourceField !== "decimal") {
      setDecimalText(clamped.toString(10));
    }
    if (sourceField !== "binary") {
      setBinaryText(formatBinaryGrouped(toBinaryString(newValue, bw)));
    }
    if (sourceField !== "hex") {
      setHexText(toHexString(newValue, bw));
    }
    if (sourceField !== "octal") {
      setOctalText(toOctalString(newValue, bw));
    }
    if (sourceField !== "custom") {
      setCustomBaseText(toCustomBaseString(newValue, bw, customBase));
    }
  }, [customBase]);

  const handleValueChange = useCallback((newValue: bigint, sourceField: string) => {
    setValue(newValue);
    updateAllTexts(newValue, bitWidth, signed, sourceField);
  }, [bitWidth, signed, updateAllTexts]);

  const handleDecimalChange = useCallback((text: string) => {
    setDecimalText(text);
    const parsed = parseBigIntFromBase(text, 10);
    if (parsed !== null) {
      handleValueChange(parsed, "decimal");
    }
  }, [handleValueChange]);

  const handleBinaryChange = useCallback((text: string) => {
    setBinaryText(text);
    const parsed = parseBigIntFromBase(text, 2);
    if (parsed !== null) {
      handleValueChange(parsed, "binary");
    }
  }, [handleValueChange]);

  const handleHexChange = useCallback((text: string) => {
    setHexText(text);
    const parsed = parseBigIntFromBase(text, 16);
    if (parsed !== null) {
      handleValueChange(parsed, "hex");
    }
  }, [handleValueChange]);

  const handleOctalChange = useCallback((text: string) => {
    setOctalText(text);
    const parsed = parseBigIntFromBase(text, 8);
    if (parsed !== null) {
      handleValueChange(parsed, "octal");
    }
  }, [handleValueChange]);

  const handleCustomBaseChange = useCallback((text: string) => {
    setCustomBaseText(text);
    const parsed = parseBigIntFromBase(text, customBase);
    if (parsed !== null) {
      handleValueChange(parsed, "custom");
    }
  }, [customBase, handleValueChange]);

  const handleBitToggle = useCallback((bitIndex: number) => {
    const newValue = toggleBit(value, bitIndex, bitWidth);
    setValue(newValue);
    updateAllTexts(newValue, bitWidth, signed);
  }, [value, bitWidth, signed, updateAllTexts]);

  const handleBitWidthChange = useCallback((newWidth: BitWidth) => {
    setBitWidth(newWidth);
    updateAllTexts(value, newWidth, signed);
  }, [value, signed, updateAllTexts]);

  const handleSignedChange = useCallback((newSigned: boolean) => {
    setSigned(newSigned);
    updateAllTexts(value, bitWidth, newSigned);
  }, [value, bitWidth, updateAllTexts]);

  const handleCustomBaseSelect = useCallback((newBase: number) => {
    setCustomBase(newBase);
    const unsigned = toUnsigned(value, bitWidth);
    setCustomBaseText(unsigned.toString(newBase).toUpperCase());
  }, [value, bitWidth]);

  // Initialize texts on mount
  useMemo(() => {
    updateAllTexts(255n, 8, false);
  }, []);

  const TABS: { id: ActiveTab; label: string }[] = [
    { id: "converter", label: "Converter" },
    { id: "ieee754", label: "IEEE 754" },
    { id: "bitwise", label: "Bitwise" },
    { id: "ascii", label: "ASCII" },
  ];

  return (
    <div style={STYLES.container}>
      {/* Tab navigation */}
      <div style={{
        display: "flex",
        gap: "0.25rem",
        marginBottom: "1rem",
        background: "var(--color-surface)",
        borderRadius: "0.75rem",
        padding: "0.25rem",
        border: "1px solid var(--color-border)",
        flexWrap: "wrap",
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={STYLES.tab(activeTab === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Converter Tab ── */}
      {activeTab === "converter" && (
        <div>
          {/* Number inputs */}
          <div style={STYLES.card}>
            <div style={STYLES.sectionTitle}>Number Input</div>
            <InputRow
              label="Decimal (base 10)"
              value={decimalText}
              onChange={handleDecimalChange}
              placeholder="Enter a decimal number"
            />
            <InputRow
              label="Binary (base 2)"
              value={binaryText}
              onChange={handleBinaryChange}
              placeholder="e.g. 1111 1111"
              prefix="0b"
            />
            <InputRow
              label="Hexadecimal (base 16)"
              value={hexText}
              onChange={handleHexChange}
              placeholder="e.g. FF"
              prefix="0x"
            />
            <InputRow
              label="Octal (base 8)"
              value={octalText}
              onChange={handleOctalChange}
              placeholder="e.g. 377"
              prefix="0o"
            />

            {/* Custom base */}
            <div style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--color-border)" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
                <div style={{ width: "5rem" }}>
                  <label style={STYLES.label}>Base</label>
                  <select
                    value={customBase}
                    onChange={(e) => handleCustomBaseSelect(Number((e.target as HTMLSelectElement).value))}
                    style={{ ...STYLES.select, width: "100%" }}
                  >
                    {Array.from({ length: 35 }, (_, i) => i + 2).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={STYLES.label}>Custom Base ({customBase})</label>
                  <input
                    type="text"
                    value={customBaseText}
                    onInput={(e) => handleCustomBaseChange((e.target as HTMLInputElement).value)}
                    placeholder={`Base ${customBase} representation`}
                    style={STYLES.input}
                    spellcheck={false}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bit Width & Signed controls */}
          <div style={STYLES.card}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
              flexWrap: "wrap",
              gap: "0.5rem",
            }}>
              <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                <span style={STYLES.label}>Width:</span>
                {BIT_WIDTHS.map((w) => (
                  <button
                    key={w}
                    onClick={() => handleBitWidthChange(w)}
                    style={STYLES.toggleBtn(bitWidth === w)}
                  >
                    {w}-bit
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                <button
                  onClick={() => handleSignedChange(false)}
                  style={STYLES.toggleBtn(!signed)}
                >
                  Unsigned
                </button>
                <button
                  onClick={() => handleSignedChange(true)}
                  style={STYLES.toggleBtn(signed)}
                >
                  Signed
                </button>
              </div>
            </div>

            {/* Signed/Unsigned display */}
            <div style={{
              display: "flex",
              gap: "2rem",
              fontSize: "0.8rem",
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-muted)",
              marginBottom: "0.75rem",
            }}>
              <span>
                Unsigned: <span style={{ color: "var(--color-heading)", fontWeight: 700 }}>
                  {unsignedValue.toString(10)}
                </span>
              </span>
              <span>
                Signed: <span style={{ color: "var(--color-heading)", fontWeight: 700 }}>
                  {clampToBitWidth(value, bitWidth, true).toString(10)}
                </span>
              </span>
            </div>

            {/* Bit grid */}
            <div style={STYLES.sectionTitle}>Bit Visualization</div>
            <BitGrid bits={bits} bitWidth={bitWidth} onToggle={handleBitToggle} />
          </div>

          {/* Byte order */}
          <div style={STYLES.card}>
            <div style={STYLES.sectionTitle}>Byte Order</div>
            <ByteOrderSection value={value} bitWidth={bitWidth} />
          </div>
        </div>
      )}

      {/* ── IEEE 754 Tab ── */}
      {activeTab === "ieee754" && (
        <div style={STYLES.card}>
          <div style={STYLES.sectionTitle}>IEEE 754 Float Inspector</div>
          <Ieee754Viewer
            floatInput={floatInput}
            setFloatInput={setFloatInput}
            precision={precision}
            setPrecision={setPrecision}
          />
        </div>
      )}

      {/* ── Bitwise Tab ── */}
      {activeTab === "bitwise" && (
        <div style={STYLES.card}>
          <div style={STYLES.sectionTitle}>Bitwise Operations</div>
          <BitwiseSection bitWidth={bitWidth} />

          {/* Bit width control for this tab too */}
          <div style={{
            marginTop: "1rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            gap: "0.25rem",
            alignItems: "center",
          }}>
            <span style={STYLES.label}>Width:</span>
            {BIT_WIDTHS.map((w) => (
              <button
                key={w}
                onClick={() => handleBitWidthChange(w)}
                style={STYLES.toggleBtn(bitWidth === w)}
              >
                {w}-bit
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── ASCII Tab ── */}
      {activeTab === "ascii" && (
        <div style={STYLES.card}>
          <div style={STYLES.sectionTitle}>ASCII / Unicode Reference</div>
          <AsciiSection value={value} />
        </div>
      )}
    </div>
  );
}
