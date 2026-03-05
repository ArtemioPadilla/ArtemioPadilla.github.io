import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type { JSX } from "preact";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

type InputMode = "text" | "file";
type OutputFormat = "hex" | "HEX" | "base64" | "binary";
type AlgorithmName = "MD5" | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512" | "CRC32";

interface HashResult {
  algorithm: AlgorithmName;
  value: string;
  computing: boolean;
}

interface BatchRow {
  input: string;
  hashes: Map<AlgorithmName, string>;
  computing: boolean;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const ALGORITHMS: AlgorithmName[] = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512", "CRC32"];
const WEB_CRYPTO_ALGORITHMS: AlgorithmName[] = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
const DEBOUNCE_MS = 100;
const FILE_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks

/* ──────────────────────────────────────
   MD5 Implementation
   ────────────────────────────────────── */

function md5(input: Uint8Array): string {
  const S: number[] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const K: number[] = new Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }

  const originalLen = input.length;
  const bitLen = originalLen * 8;

  // Padding: append 1 bit, then zeros, then 64-bit length
  const paddedLen = ((originalLen + 8) >>> 6 << 6) + 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(input);
  padded[originalLen] = 0x80;

  // Append original length in bits as 64-bit little-endian
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLen >>> 0, true);
  view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLen; offset += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) {
      M[j] = view.getUint32(offset + j * 4, true);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      F = (F + A + K[i] + M[g]) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}

function toHexLE(n: number): string {
  const bytes = [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ──────────────────────────────────────
   CRC32 Implementation
   ────────────────────────────────────── */

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
}

function crc32(input: Uint8Array): string {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ input[i]) & 0xff];
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

/* ──────────────────────────────────────
   Hashing Utilities
   ────────────────────────────────────── */

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function hexToBinary(hex: string): string {
  let result = "";
  for (let i = 0; i < hex.length; i++) {
    result += parseInt(hex[i], 16).toString(2).padStart(4, "0");
  }
  return result;
}

function formatHash(hexLower: string, format: OutputFormat): string {
  switch (format) {
    case "hex":
      return hexLower;
    case "HEX":
      return hexLower.toUpperCase();
    case "base64":
      return hexToBase64(hexLower);
    case "binary":
      return hexToBinary(hexLower);
  }
}

async function computeWebCryptoHash(algorithm: string, data: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest(algorithm, data);
  return arrayBufferToHex(buffer);
}

async function computeHmac(algorithm: string, data: Uint8Array, keyBytes: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: { name: algorithm } },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return arrayBufferToHex(signature);
}

async function computeAllHashes(
  data: Uint8Array,
  hmacEnabled: boolean,
  hmacKey: string
): Promise<Map<AlgorithmName, string>> {
  const results = new Map<AlgorithmName, string>();
  const keyBytes = new TextEncoder().encode(hmacKey);

  // MD5 — no HMAC support (Web Crypto doesn't support MD5 HMAC either)
  if (!hmacEnabled) {
    results.set("MD5", md5(data));
  }

  // CRC32 — no HMAC concept
  if (!hmacEnabled) {
    results.set("CRC32", crc32(data));
  }

  // Web Crypto algorithms
  const promises = WEB_CRYPTO_ALGORITHMS.map(async (algo) => {
    const hex = hmacEnabled
      ? await computeHmac(algo, data, keyBytes)
      : await computeWebCryptoHash(algo, data);
    results.set(algo, hex);
  });

  await Promise.all(promises);
  return results;
}

async function hashFileInChunks(
  file: File,
  onProgress: (pct: number) => void
): Promise<Map<AlgorithmName, string>> {
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  // For progress reporting, simulate progress across the hashing
  onProgress(10);
  const results = new Map<AlgorithmName, string>();

  results.set("MD5", md5(data));
  onProgress(30);

  results.set("CRC32", crc32(data));
  onProgress(40);

  for (let i = 0; i < WEB_CRYPTO_ALGORITHMS.length; i++) {
    const algo = WEB_CRYPTO_ALGORITHMS[i];
    const hex = await computeWebCryptoHash(algo, data);
    results.set(algo, hex);
    onProgress(40 + ((i + 1) / WEB_CRYPTO_ALGORITHMS.length) * 60);
  }

  return results;
}

function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("Clipboard API not available"));
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function HashGenerator() {
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [textInput, setTextInput] = useState("Hello, world!");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("hex");
  const [hmacEnabled, setHmacEnabled] = useState(false);
  const [hmacKey, setHmacKey] = useState("");
  const [compareHash, setCompareHash] = useState("");
  const [batchMode, setBatchMode] = useState(false);

  const [hashResults, setHashResults] = useState<Map<AlgorithmName, string>>(new Map());
  const [computing, setComputing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // File state
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [fileProgress, setFileProgress] = useState<number>(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  // Batch state
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchAlgorithm, setBatchAlgorithm] = useState<AlgorithmName>("SHA-256");

  // Compute hashes for text input with debounce
  useEffect(() => {
    if (inputMode !== "text" || batchMode) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!textInput) {
        setHashResults(new Map());
        return;
      }
      setComputing(true);
      try {
        const data = new TextEncoder().encode(textInput);
        const results = await computeAllHashes(data, hmacEnabled, hmacKey);
        setHashResults(results);
      } catch {
        setHashResults(new Map());
      } finally {
        setComputing(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [textInput, inputMode, hmacEnabled, hmacKey, batchMode]);

  // Batch mode computation
  useEffect(() => {
    if (!batchMode || inputMode !== "text") return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const lines = textInput.split("\n").filter((l) => l.length > 0);
      if (lines.length === 0) {
        setBatchRows([]);
        return;
      }

      const rows: BatchRow[] = lines.map((line) => ({
        input: line,
        hashes: new Map(),
        computing: true,
      }));
      setBatchRows(rows);

      const updatedRows = await Promise.all(
        lines.map(async (line) => {
          const data = new TextEncoder().encode(line);
          const hashes = await computeAllHashes(data, hmacEnabled, hmacKey);
          return { input: line, hashes, computing: false } as BatchRow;
        })
      );
      setBatchRows(updatedRows);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [textInput, batchMode, inputMode, hmacEnabled, hmacKey, batchAlgorithm]);

  const handleFileSelect = useCallback(async (file: File) => {
    fileRef.current = file;
    setFileName(file.name);
    setFileSize(file.size);
    setFileProgress(0);
    setComputing(true);
    setHashResults(new Map());

    try {
      const results = await hashFileInChunks(file, setFileProgress);
      setHashResults(results);
      setFileProgress(100);
    } catch {
      setHashResults(new Map());
    } finally {
      setComputing(false);
    }
  }, []);

  const handleFileDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleFileInputChange = useCallback(
    (e: JSX.TargetedEvent<HTMLInputElement>) => {
      const file = e.currentTarget.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleCopy = useCallback((text: string, label: string) => {
    copyToClipboard(text)
      .then(() => {
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        setCopyFeedback(label);
        copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
      })
      .catch(() => {});
  }, []);

  const compareResult = findCompareMatch(compareHash, hashResults, outputFormat);

  const formatButtons: { label: string; value: OutputFormat }[] = [
    { label: "hex", value: "hex" },
    { label: "HEX", value: "HEX" },
    { label: "Base64", value: "base64" },
    { label: "Binary", value: "binary" },
  ];

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">Hash Generator</span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{
              borderColor: "rgba(79, 143, 247, 0.3)",
              color: "var(--color-primary)",
            }}
          >
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          {copyFeedback && (
            <span class="text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>
              {copyFeedback} copied
            </span>
          )}
          <SecurityBadge />
        </div>
      </div>

      {/* Input Mode Tabs + Options */}
      <div class="border-b border-[var(--color-border)] px-4 py-4">
        <div class="mb-3 flex flex-wrap items-center gap-3">
          {/* Input mode tabs */}
          <div class="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            <TabButton active={inputMode === "text"} onClick={() => setInputMode("text")}>
              Text
            </TabButton>
            <TabButton active={inputMode === "file"} onClick={() => setInputMode("file")}>
              File
            </TabButton>
          </div>

          {/* Batch toggle (text only) */}
          {inputMode === "text" && (
            <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={batchMode}
                onChange={(e) => setBatchMode((e.target as HTMLInputElement).checked)}
                class="accent-[var(--color-primary)]"
              />
              Batch
            </label>
          )}
        </div>

        {/* Text input area */}
        {inputMode === "text" && (
          <textarea
            value={textInput}
            onInput={(e) => setTextInput((e.target as HTMLTextAreaElement).value)}
            class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm leading-relaxed text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
            style={{ fontFamily: "var(--font-mono)", minHeight: "100px" }}
            rows={batchMode ? 6 : 4}
            spellcheck={false}
            autocorrect="off"
            autocapitalize="off"
            placeholder={batchMode ? "Enter one string per line..." : "Type or paste text to hash..."}
          />
        )}

        {/* File drop zone */}
        {inputMode === "file" && (
          <div
            class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors"
            style={{
              borderColor: dragOver ? "var(--color-primary)" : "var(--color-border)",
              backgroundColor: dragOver ? "rgba(79, 143, 247, 0.05)" : "transparent",
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop as unknown as JSX.DragEventHandler<HTMLDivElement>}
          >
            <FileIcon />
            <p class="mt-2 text-sm text-[var(--color-text-muted)]">
              Drag and drop a file here, or{" "}
              <button
                onClick={() => fileInputRef.current?.click()}
                class="font-medium text-[var(--color-primary)] underline underline-offset-2 hover:text-[var(--color-heading)]"
              >
                browse
              </button>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              class="hidden"
              onChange={handleFileInputChange}
            />
            {fileName && (
              <div class="mt-3 text-xs text-[var(--color-text-muted)]">
                <span class="font-medium text-[var(--color-heading)]">{fileName}</span>
                <span class="ml-2">({formatFileSize(fileSize)})</span>
              </div>
            )}
            {computing && inputMode === "file" && (
              <div class="mt-3 w-full max-w-xs">
                <div class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div
                    class="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${fileProgress}%`,
                      backgroundColor: "var(--color-primary)",
                    }}
                  />
                </div>
                <p class="mt-1 text-[10px] text-[var(--color-text-muted)]">
                  Hashing... {Math.round(fileProgress)}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Output format + HMAC */}
        <div class="mt-3 flex flex-wrap items-center gap-4">
          {/* Format selector */}
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Format
            </span>
            <div class="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
              {formatButtons.map((btn) => (
                <TabButton
                  key={btn.value}
                  active={outputFormat === btn.value}
                  onClick={() => setOutputFormat(btn.value)}
                  small
                >
                  {btn.label}
                </TabButton>
              ))}
            </div>
          </div>

          {/* HMAC toggle */}
          <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hmacEnabled}
              onChange={(e) => setHmacEnabled((e.target as HTMLInputElement).checked)}
              class="accent-[var(--color-primary)]"
            />
            HMAC
          </label>

          {hmacEnabled && (
            <input
              type="text"
              value={hmacKey}
              onInput={(e) => setHmacKey((e.target as HTMLInputElement).value)}
              class="flex-1 min-w-[120px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
              placeholder="Secret key..."
              spellcheck={false}
            />
          )}
        </div>

        {hmacEnabled && (
          <p class="mt-2 text-[10px] text-[var(--color-text-muted)]">
            HMAC uses SHA family only. MD5 and CRC32 are excluded in HMAC mode.
          </p>
        )}
      </div>

      {/* Hash Results (non-batch) */}
      {!batchMode && (
        <div class="border-b border-[var(--color-border)]">
          {computing && (
            <div class="px-4 py-2">
              <span class="text-[10px] text-[var(--color-text-muted)]">Computing...</span>
            </div>
          )}
          {getDisplayAlgorithms(hmacEnabled).map((algo) => {
            const hexValue = hashResults.get(algo) ?? "";
            const displayValue = hexValue ? formatHash(hexValue, outputFormat) : "";
            return (
              <HashRow
                key={algo}
                algorithm={algo}
                value={displayValue}
                onCopy={() => handleCopy(displayValue, algo)}
              />
            );
          })}
        </div>
      )}

      {/* Batch Results */}
      {batchMode && inputMode === "text" && (
        <div class="border-b border-[var(--color-border)]">
          <div class="px-4 py-3">
            <div class="mb-2 flex items-center gap-3">
              <h3
                class="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-heading)" }}
              >
                Batch Results
              </h3>
              <select
                value={batchAlgorithm}
                onChange={(e) => setBatchAlgorithm((e.target as HTMLSelectElement).value as AlgorithmName)}
                class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] outline-none"
              >
                {getDisplayAlgorithms(hmacEnabled).map((algo) => (
                  <option key={algo} value={algo}>
                    {algo}
                  </option>
                ))}
              </select>
            </div>
            {batchRows.length === 0 && (
              <p class="py-4 text-center text-xs text-[var(--color-text-muted)]">
                Enter text above (one string per line)
              </p>
            )}
            {batchRows.length > 0 && (
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="border-b border-[var(--color-border)]">
                      <th
                        class="py-2 pr-4 text-left font-semibold uppercase tracking-wider"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Input
                      </th>
                      <th
                        class="py-2 pr-4 text-left font-semibold uppercase tracking-wider"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {batchAlgorithm}
                      </th>
                      <th class="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {batchRows.map((row, idx) => {
                      const hexValue = row.hashes.get(batchAlgorithm) ?? "";
                      const displayValue = hexValue ? formatHash(hexValue, outputFormat) : "";
                      return (
                        <tr
                          key={idx}
                          class="border-b border-[var(--color-border)] last:border-b-0"
                        >
                          <td
                            class="max-w-[200px] truncate py-2 pr-4 text-[var(--color-text)]"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {row.input}
                          </td>
                          <td
                            class="py-2 pr-4"
                            style={{
                              fontFamily: "var(--font-mono)",
                              color: "var(--color-heading)",
                              wordBreak: "break-all",
                            }}
                          >
                            {row.computing ? (
                              <span class="text-[var(--color-text-muted)]">...</span>
                            ) : (
                              displayValue
                            )}
                          </td>
                          <td class="py-2">
                            {displayValue && (
                              <button
                                onClick={() => handleCopy(displayValue, `Row ${idx + 1}`)}
                                class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
                                title="Copy hash"
                              >
                                <CopyIcon />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hash Comparison */}
      <div class="px-4 py-4">
        <div class="flex items-center gap-2 mb-2">
          <h3
            class="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-heading)" }}
          >
            Compare
          </h3>
        </div>
        <input
          type="text"
          value={compareHash}
          onInput={(e) => setCompareHash((e.target as HTMLInputElement).value)}
          class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
          style={{ fontFamily: "var(--font-mono)" }}
          placeholder="Paste expected hash to compare..."
          spellcheck={false}
        />
        {compareHash.trim() && (
          <div class="mt-2 flex items-center gap-2 text-xs">
            {compareResult ? (
              <>
                <CheckIcon />
                <span style={{ color: "#34d399" }}>
                  Matches {compareResult}!
                </span>
              </>
            ) : (
              <>
                <XIcon />
                <span style={{ color: "#ef4444" }}>
                  No match found
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Helpers
   ────────────────────────────────────── */

function getDisplayAlgorithms(hmacEnabled: boolean): AlgorithmName[] {
  if (hmacEnabled) return WEB_CRYPTO_ALGORITHMS;
  return ALGORITHMS;
}

function findCompareMatch(
  input: string,
  results: Map<AlgorithmName, string>,
  format: OutputFormat
): AlgorithmName | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const [algo, hexValue] of results.entries()) {
    if (!hexValue) continue;
    const formatted = formatHash(hexValue, format);
    if (formatted.toLowerCase() === trimmed.toLowerCase()) return algo;
    // Also check raw hex match in case user pastes hex while viewing base64
    if (hexValue.toLowerCase() === trimmed.toLowerCase()) return algo;
  }
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/* ──────────────────────────────────────
   Sub-Components
   ────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  children,
  small = false,
}: {
  active: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
  small?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      class="transition-colors"
      style={{
        padding: small ? "4px 10px" : "6px 14px",
        fontSize: small ? "10px" : "12px",
        fontWeight: 500,
        color: active ? "var(--color-heading)" : "var(--color-text-muted)",
        backgroundColor: active ? "var(--color-bg)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function HashRow({
  algorithm,
  value,
  onCopy,
}: {
  algorithm: AlgorithmName;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div class="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-2.5 last:border-b-0">
      <span
        class="w-16 shrink-0 pt-0.5 text-xs font-semibold"
        style={{ color: "var(--color-text-muted)" }}
      >
        {algorithm}
      </span>
      <span
        class="min-w-0 flex-1 text-xs leading-relaxed"
        style={{
          fontFamily: "var(--font-mono)",
          color: value ? "var(--color-heading)" : "var(--color-text-muted)",
          wordBreak: "break-all",
        }}
      >
        {value || "—"}
      </span>
      {value && (
        <button
          onClick={onCopy}
          class="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
          title={`Copy ${algorithm} hash`}
        >
          <CopyIcon />
        </button>
      )}
    </div>
  );
}

function SecurityBadge() {
  return (
    <span
      class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{
        borderColor: "rgba(52, 211, 153, 0.3)",
        color: "rgba(52, 211, 153, 0.8)",
      }}
    >
      <LockIcon /> Client-only
    </span>
  );
}

/* ──────────────────────────────────────
   Icons (inline SVG, zero deps)
   ────────────────────────────────────── */

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{ display: "inline", verticalAlign: "middle" }}
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#34d399"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ef4444"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6" />
      <path d="M9 9l6 6" />
    </svg>
  );
}
