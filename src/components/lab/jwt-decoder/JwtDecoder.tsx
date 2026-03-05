import { useState, useEffect, useMemo, useCallback, useRef } from "preact/hooks";
import type { JSX } from "preact";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  rawParts: [string, string, string];
}

interface ExpiryStatus {
  kind: "valid" | "expired" | "not-yet-valid" | "no-expiry";
  label: string;
  exp?: number;
  nbf?: number;
}

interface ClaimInfo {
  name: string;
  value: unknown;
  description: string;
}

interface Preset {
  label: string;
  token: string;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const PART_COLORS = {
  header: "#ef4444",
  payload: "#a855f7",
  signature: "#14b8a6",
} as const;

const STANDARD_CLAIMS: Record<string, string> = {
  iss: "Issuer",
  sub: "Subject",
  aud: "Audience",
  exp: "Expiration Time",
  nbf: "Not Before",
  iat: "Issued At",
  jti: "JWT ID",
  name: "Full Name",
  email: "Email Address",
  scope: "Scopes / Permissions",
  roles: "Roles",
  azp: "Authorized Party",
  nonce: "Nonce",
  at_hash: "Access Token Hash",
  typ: "Token Type",
  alg: "Algorithm",
  kid: "Key ID",
};

const TIMESTAMP_CLAIMS = new Set(["exp", "iat", "nbf"]);

function buildPresets(): Preset[] {
  const now = Math.floor(Date.now() / 1000);
  const twoHoursFromNow = now + 7200;
  const oneDayAgo = now - 86400;
  const fiveMinutesFromNow = now + 300;

  return [
    {
      label: "Simple User Token",
      token: buildFakeJwt(
        { alg: "HS256", typ: "JWT" },
        {
          sub: "1234567890",
          name: "Jane Doe",
          email: "jane@example.com",
          iat: now,
          exp: twoHoursFromNow,
        }
      ),
    },
    {
      label: "API Access Token",
      token: buildFakeJwt(
        { alg: "HS256", typ: "JWT" },
        {
          iss: "https://auth.example.com",
          sub: "api-client-42",
          aud: "https://api.example.com",
          scope: "read:users write:posts",
          jti: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
          iat: now,
          exp: twoHoursFromNow,
        }
      ),
    },
    {
      label: "Expired Token",
      token: buildFakeJwt(
        { alg: "HS256", typ: "JWT" },
        {
          sub: "user-expired",
          name: "Expired User",
          iat: oneDayAgo - 3600,
          exp: oneDayAgo,
        }
      ),
    },
    {
      label: "RS256 Token",
      token: buildFakeJwt(
        { alg: "RS256", typ: "JWT", kid: "my-key-id-01" },
        {
          iss: "https://idp.example.org",
          sub: "auth0|abc123def456",
          aud: ["https://myapp.example.com", "https://api.example.com"],
          azp: "client-app-id",
          scope: "openid profile email",
          iat: now,
          exp: twoHoursFromNow,
          nbf: fiveMinutesFromNow,
        }
      ),
    },
  ];
}

/* ──────────────────────────────────────
   Base64URL Utilities
   ────────────────────────────────────── */

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  if (padding === 2) base64 += "==";
  else if (padding === 3) base64 += "=";

  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    throw new Error("Invalid base64url encoding");
  }
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildFakeJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>
): string {
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const payloadPart = base64UrlEncode(JSON.stringify(payload));
  const fakeSig = base64UrlEncode("fake-signature-not-verified-" + Math.random().toString(36).slice(2, 10));
  return `${headerPart}.${payloadPart}.${fakeSig}`;
}

/* ──────────────────────────────────────
   JWT Decoding
   ────────────────────────────────────── */

function decodeJwt(token: string): DecodedJwt {
  const trimmed = token.trim();
  const parts = trimmed.split(".");

  if (parts.length !== 3) {
    throw new Error(
      `Invalid JWT structure: expected 3 parts (header.payload.signature), got ${parts.length}`
    );
  }

  const [rawHeader, rawPayload, rawSignature] = parts;

  let header: Record<string, unknown>;
  try {
    const decoded = base64UrlDecode(rawHeader);
    header = JSON.parse(decoded);
  } catch {
    throw new Error("Failed to decode header: invalid base64url or JSON");
  }

  let payload: Record<string, unknown>;
  try {
    const decoded = base64UrlDecode(rawPayload);
    payload = JSON.parse(decoded);
  } catch {
    throw new Error("Failed to decode payload: invalid base64url or JSON");
  }

  return {
    header,
    payload,
    signature: rawSignature,
    rawParts: [rawHeader, rawPayload, rawSignature],
  };
}

function getExpiryStatus(payload: Record<string, unknown>): ExpiryStatus {
  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  const nbf = typeof payload.nbf === "number" ? payload.nbf : undefined;
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (nbf !== undefined && nowSeconds < nbf) {
    return { kind: "not-yet-valid", label: formatTimeDiff(nbf - nowSeconds, "starts in"), nbf };
  }

  if (exp !== undefined) {
    if (nowSeconds >= exp) {
      return { kind: "expired", label: formatTimeDiff(nowSeconds - exp, "ago"), exp };
    }
    return { kind: "valid", label: formatTimeDiff(exp - nowSeconds, "expires in"), exp };
  }

  return { kind: "no-expiry", label: "No expiration claim" };
}

function formatTimeDiff(seconds: number, suffix: string): string {
  if (seconds < 60) return `${seconds}s ${suffix}`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s ${suffix}`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m ${suffix}`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h ${suffix}`;
}

function formatTimestamp(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function buildClaimsTable(payload: Record<string, unknown>): ClaimInfo[] {
  return Object.entries(payload).map(([name, value]) => ({
    name,
    value,
    description: STANDARD_CLAIMS[name] ?? "(custom claim)",
  }));
}

function formatClaimValue(name: string, value: unknown): string {
  if (TIMESTAMP_CLAIMS.has(name) && typeof value === "number") {
    return `${value} (${formatTimestamp(value)})`;
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
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

export default function JwtDecoder() {
  const presets = useMemo(() => buildPresets(), []);
  const [jwtInput, setJwtInput] = useState(presets[0].token);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [base64Input, setBase64Input] = useState("");
  const [base64Output, setBase64Output] = useState("");
  const [base64Error, setBase64Error] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const decoded = useMemo<DecodedJwt | null>(() => {
    if (!jwtInput.trim()) return null;
    try {
      return decodeJwt(jwtInput);
    } catch {
      return null;
    }
  }, [jwtInput]);

  const decodeError = useMemo<string | null>(() => {
    if (!jwtInput.trim()) return null;
    try {
      decodeJwt(jwtInput);
      return null;
    } catch (err: unknown) {
      if (err instanceof Error) return err.message;
      return String(err);
    }
  }, [jwtInput]);

  const expiryStatus = useMemo<ExpiryStatus | null>(() => {
    if (!decoded) return null;
    // tick dependency forces recalculation every second
    void tick;
    return getExpiryStatus(decoded.payload);
  }, [decoded, tick]);

  const claims = useMemo<ClaimInfo[]>(() => {
    if (!decoded) return [];
    return buildClaimsTable(decoded.payload);
  }, [decoded]);

  useEffect(() => {
    tickIntervalRef.current = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => {
      if (tickIntervalRef.current) clearInterval(tickIntervalRef.current);
    };
  }, []);

  const handleCopy = useCallback((text: string, label: string) => {
    copyToClipboard(text)
      .then(() => {
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        setCopyFeedback(label);
        copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
      })
      .catch(() => {
        /* clipboard not available */
      });
  }, []);

  const loadPreset = useCallback(
    (e: JSX.TargetedEvent<HTMLSelectElement>) => {
      const index = parseInt(e.currentTarget.value, 10);
      if (isNaN(index) || index < 0) return;
      setJwtInput(presets[index].token);
    },
    [presets]
  );

  const handleBase64Decode = useCallback(() => {
    if (!base64Input.trim()) {
      setBase64Output("");
      setBase64Error(null);
      return;
    }
    try {
      const result = base64UrlDecode(base64Input.trim());
      setBase64Output(result);
      setBase64Error(null);
    } catch {
      setBase64Output("");
      setBase64Error("Invalid base64url string");
    }
  }, [base64Input]);

  const parts = jwtInput.trim().split(".");

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">JWT Decoder</span>
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

      {/* JWT Input */}
      <div class="border-b border-[var(--color-border)] px-4 py-4">
        <div class="mb-2 flex items-center justify-between">
          <label class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Paste JWT
          </label>
          <div class="flex items-center gap-2">
            <label class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Presets
            </label>
            <select
              onChange={loadPreset}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
            >
              <option value="-1">Select a preset...</option>
              {presets.map((p, i) => (
                <option key={i} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Color-coded JWT display */}
        <div
          class="relative rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
          style={{ minHeight: "80px" }}
        >
          {/* Color overlay */}
          <pre
            class="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-all px-3 py-2 text-sm leading-relaxed"
            style={{ fontFamily: "var(--font-mono)" }}
            aria-hidden="true"
          >
            {parts.length === 3 ? (
              <>
                <span style={{ color: PART_COLORS.header }}>{parts[0]}</span>
                <span style={{ color: "var(--color-text-muted)" }}>.</span>
                <span style={{ color: PART_COLORS.payload }}>{parts[1]}</span>
                <span style={{ color: "var(--color-text-muted)" }}>.</span>
                <span style={{ color: PART_COLORS.signature }}>{parts[2]}</span>
              </>
            ) : (
              <span style={{ color: "var(--color-text)" }}>{jwtInput}</span>
            )}
          </pre>
          <textarea
            value={jwtInput}
            onInput={(e) => setJwtInput((e.target as HTMLTextAreaElement).value)}
            class="relative z-[1] w-full resize-none bg-transparent px-3 py-2 text-sm leading-relaxed outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              color: "transparent",
              caretColor: "var(--color-primary)",
              minHeight: "80px",
            }}
            rows={3}
            spellcheck={false}
            autocorrect="off"
            autocapitalize="off"
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0..."
          />
        </div>

        {/* Part legend */}
        <div class="mt-2 flex flex-wrap items-center gap-3 text-[10px]">
          <span class="flex items-center gap-1">
            <span
              class="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: PART_COLORS.header }}
            />
            <span style={{ color: PART_COLORS.header }}>Header</span>
          </span>
          <span class="flex items-center gap-1">
            <span
              class="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: PART_COLORS.payload }}
            />
            <span style={{ color: PART_COLORS.payload }}>Payload</span>
          </span>
          <span class="flex items-center gap-1">
            <span
              class="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: PART_COLORS.signature }}
            />
            <span style={{ color: PART_COLORS.signature }}>Signature</span>
          </span>
        </div>

        {/* Error message */}
        {decodeError && (
          <p class="mt-2 text-xs" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
            {decodeError}
          </p>
        )}
      </div>

      {/* Expiry Status */}
      {decoded && expiryStatus && expiryStatus.kind !== "no-expiry" && (
        <div class="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <ExpiryBadge status={expiryStatus} />
        </div>
      )}

      {/* Decoded Panels */}
      {decoded && (
        <div class="grid border-b border-[var(--color-border)] md:grid-cols-3">
          {/* Header Panel */}
          <div class="border-b border-[var(--color-border)] md:border-r md:border-b-0">
            <DecodedPanel
              title="Header"
              color={PART_COLORS.header}
              json={decoded.header}
              onCopy={(text) => handleCopy(text, "Header")}
            />
          </div>

          {/* Payload Panel */}
          <div class="border-b border-[var(--color-border)] md:border-r md:border-b-0">
            <DecodedPanel
              title="Payload"
              color={PART_COLORS.payload}
              json={decoded.payload}
              onCopy={(text) => handleCopy(text, "Payload")}
              highlightClaims
            />
          </div>

          {/* Signature Panel */}
          <div>
            <SignaturePanel
              signature={decoded.signature}
              algorithm={String(decoded.header.alg ?? "unknown")}
              onCopy={(text) => handleCopy(text, "Signature")}
            />
          </div>
        </div>
      )}

      {/* Claims Table */}
      {decoded && claims.length > 0 && (
        <div class="border-b border-[var(--color-border)]">
          <div class="px-4 py-3">
            <div class="mb-3 flex items-center justify-between">
              <h3
                class="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-heading)" }}
              >
                Claims ({claims.length})
              </h3>
              <button
                onClick={() =>
                  handleCopy(
                    JSON.stringify(decoded.payload, null, 2),
                    "All claims"
                  )
                }
                class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
                title="Copy all claims as JSON"
              >
                <CopyIcon />
              </button>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-[var(--color-border)]">
                    <th
                      class="py-2 pr-4 text-left font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Claim
                    </th>
                    <th
                      class="py-2 pr-4 text-left font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Value
                    </th>
                    <th
                      class="py-2 text-left font-semibold uppercase tracking-wider"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Description
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr
                      key={claim.name}
                      class="border-b border-[var(--color-border)] last:border-b-0"
                    >
                      <td class="py-2 pr-4">
                        <code
                          class="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: STANDARD_CLAIMS[claim.name]
                              ? "var(--color-primary)"
                              : "var(--color-text)",
                            backgroundColor: STANDARD_CLAIMS[claim.name]
                              ? "rgba(79, 143, 247, 0.1)"
                              : "transparent",
                          }}
                        >
                          {claim.name}
                        </code>
                      </td>
                      <td class="py-2 pr-4">
                        <code
                          class="text-[11px] text-[var(--color-text)]"
                          style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}
                        >
                          {formatClaimValue(claim.name, claim.value)}
                        </code>
                      </td>
                      <td class="py-2 text-[var(--color-text-muted)]">{claim.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Base64URL Decoder Utility */}
      <div class="px-4 py-4">
        <h3
          class="mb-3 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-heading)" }}
        >
          Base64URL Decoder
        </h3>
        <div class="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div class="flex-1">
            <input
              type="text"
              value={base64Input}
              onInput={(e) => {
                setBase64Input((e.target as HTMLInputElement).value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleBase64Decode();
              }}
              class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
              placeholder="Paste a base64url string..."
              spellcheck={false}
            />
          </div>
          <button
            onClick={handleBase64Decode}
            class="shrink-0 rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
          >
            Decode
          </button>
        </div>
        {base64Error && (
          <p class="mt-2 text-xs" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
            {base64Error}
          </p>
        )}
        {base64Output && (
          <div class="mt-2">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                Decoded Output
              </span>
              <button
                onClick={() => handleCopy(base64Output, "Base64 result")}
                class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
                title="Copy decoded output"
              >
                <CopyIcon />
              </button>
            </div>
            <pre
              class="mt-1 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)]"
              style={{ fontFamily: "var(--font-mono)", maxHeight: "120px" }}
            >
              {base64Output}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Sub-Components
   ────────────────────────────────────── */

function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const badgeStyles = {
    valid: {
      bg: "rgba(52, 211, 153, 0.15)",
      border: "rgba(52, 211, 153, 0.4)",
      color: "#34d399",
    },
    expired: {
      bg: "rgba(239, 68, 68, 0.15)",
      border: "rgba(239, 68, 68, 0.4)",
      color: "#ef4444",
    },
    "not-yet-valid": {
      bg: "rgba(251, 191, 36, 0.15)",
      border: "rgba(251, 191, 36, 0.4)",
      color: "#fbbf24",
    },
    "no-expiry": {
      bg: "rgba(161, 161, 170, 0.15)",
      border: "rgba(161, 161, 170, 0.4)",
      color: "#a1a1aa",
    },
  } as const;

  const style = badgeStyles[status.kind];
  const kindLabel =
    status.kind === "valid"
      ? "Valid"
      : status.kind === "expired"
        ? "Expired"
        : status.kind === "not-yet-valid"
          ? "Not Yet Valid"
          : "No Expiry";

  return (
    <div class="flex items-center gap-2">
      <TimerIcon color={style.color} />
      <span
        class="rounded-full border px-3 py-1 text-xs font-semibold"
        style={{
          backgroundColor: style.bg,
          borderColor: style.border,
          color: style.color,
        }}
      >
        {kindLabel}
      </span>
      <span class="text-xs text-[var(--color-text-muted)]">{status.label}</span>
    </div>
  );
}

function DecodedPanel({
  title,
  color,
  json,
  onCopy,
  highlightClaims = false,
}: {
  title: string;
  color: string;
  json: Record<string, unknown>;
  onCopy: (text: string) => void;
  highlightClaims?: boolean;
}) {
  const jsonStr = JSON.stringify(json, null, 2);

  return (
    <div class="flex h-full flex-col">
      <div class="flex items-center justify-between px-4 py-2">
        <h3 class="text-xs font-semibold uppercase tracking-wider" style={{ color }}>
          {title}
        </h3>
        <button
          onClick={() => onCopy(jsonStr)}
          class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
          title={`Copy ${title} JSON`}
        >
          <CopyIcon />
        </button>
      </div>
      <div
        class="flex-1 overflow-auto px-4 pb-3"
        style={{ maxHeight: "280px" }}
      >
        <pre
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[11px] leading-relaxed"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {highlightClaims
            ? renderHighlightedJson(json)
            : <span style={{ color: "var(--color-text)" }}>{jsonStr}</span>
          }
        </pre>
      </div>
    </div>
  );
}

function renderHighlightedJson(json: Record<string, unknown>): JSX.Element {
  const entries = Object.entries(json);
  return (
    <>
      <span style={{ color: "var(--color-text-muted)" }}>{"{\n"}</span>
      {entries.map(([key, value], index) => {
        const isStandard = key in STANDARD_CLAIMS;
        const isTimestamp = TIMESTAMP_CLAIMS.has(key) && typeof value === "number";
        const formattedValue = JSON.stringify(value);
        const isLast = index === entries.length - 1;

        return (
          <span key={key}>
            <span style={{ color: "var(--color-text-muted)" }}>{"  "}</span>
            <span style={{ color: isStandard ? "var(--color-primary)" : "var(--color-text)" }}>
              "{key}"
            </span>
            <span style={{ color: "var(--color-text-muted)" }}>: </span>
            <span style={{ color: isTimestamp ? "#fbbf24" : "var(--color-accent)" }}>
              {formattedValue}
            </span>
            {isTimestamp && (
              <span style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>
                {" // " + formatTimestamp(value as number)}
              </span>
            )}
            {!isLast && <span style={{ color: "var(--color-text-muted)" }}>,</span>}
            {"\n"}
          </span>
        );
      })}
      <span style={{ color: "var(--color-text-muted)" }}>{"}"}</span>
    </>
  );
}

function SignaturePanel({
  signature,
  algorithm,
  onCopy,
}: {
  signature: string;
  algorithm: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div class="flex h-full flex-col">
      <div class="flex items-center justify-between px-4 py-2">
        <h3
          class="text-xs font-semibold uppercase tracking-wider"
          style={{ color: PART_COLORS.signature }}
        >
          Signature
        </h3>
        <button
          onClick={() => onCopy(signature)}
          class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
          title="Copy signature"
        >
          <CopyIcon />
        </button>
      </div>
      <div class="flex-1 px-4 pb-3">
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
          <div class="mb-2">
            <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Algorithm:{" "}
            </span>
            <code
              class="text-[11px] font-semibold"
              style={{ fontFamily: "var(--font-mono)", color: PART_COLORS.signature }}
            >
              {algorithm}
            </code>
          </div>
          <pre
            class="overflow-auto text-[11px] leading-relaxed text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-mono)", maxHeight: "120px", wordBreak: "break-all", whiteSpace: "pre-wrap" }}
          >
            {signature}
          </pre>
          <div
            class="mt-3 rounded-lg border px-3 py-2 text-[10px]"
            style={{
              borderColor: "rgba(251, 191, 36, 0.3)",
              backgroundColor: "rgba(251, 191, 36, 0.05)",
              color: "rgba(251, 191, 36, 0.8)",
            }}
          >
            <LockIcon />{" "}
            Signature verification requires the secret key and is not performed client-side for
            security.
          </div>
        </div>
      </div>
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

function TimerIcon({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
