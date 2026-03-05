import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import { encode, getCapacity, selectVersion } from "./qr-encode";
import type { ErrorCorrectionLevel, QrCode } from "./qr-encode";

// ── Types ──────────────────────────────────────────────────────────────────

type InputMode = "text" | "wifi" | "vcard" | "email";
type WifiEncryption = "WPA" | "WEP" | "nopass";

interface WifiFields {
  ssid: string;
  password: string;
  encryption: WifiEncryption;
  hidden: boolean;
}

interface VcardFields {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  organization: string;
}

interface EmailFields {
  address: string;
  subject: string;
  body: string;
}

interface QrSettings {
  fgColor: string;
  bgColor: string;
  moduleSize: number;
  eccLevel: ErrorCorrectionLevel;
  quietZone: boolean;
  roundedModules: boolean;
}

// ── Formatters ─────────────────────────────────────────────────────────────

function escapeWifi(val: string): string {
  return val.replace(/[\\;,:\"]/g, (ch) => `\\${ch}`);
}

function formatWifi(fields: WifiFields): string {
  const parts = [`T:${fields.encryption}`, `S:${escapeWifi(fields.ssid)}`];
  if (fields.encryption !== "nopass") {
    parts.push(`P:${escapeWifi(fields.password)}`);
  }
  if (fields.hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

function formatVcard(fields: VcardFields): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${fields.lastName};${fields.firstName};;;`,
    `FN:${fields.firstName} ${fields.lastName}`.trim(),
  ];
  if (fields.phone) lines.push(`TEL:${fields.phone}`);
  if (fields.email) lines.push(`EMAIL:${fields.email}`);
  if (fields.organization) lines.push(`ORG:${fields.organization}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

function formatEmail(fields: EmailFields): string {
  const params: string[] = [];
  if (fields.subject) params.push(`subject=${encodeURIComponent(fields.subject)}`);
  if (fields.body) params.push(`body=${encodeURIComponent(fields.body)}`);
  const query = params.length > 0 ? `?${params.join("&")}` : "";
  return `mailto:${fields.address}${query}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ModeSelector({
  mode,
  onModeChange,
}: {
  mode: InputMode;
  onModeChange: (m: InputMode) => void;
}) {
  const modes: { value: InputMode; label: string; icon: string }[] = [
    { value: "text", label: "Text / URL", icon: "Aa" },
    { value: "wifi", label: "WiFi", icon: "W" },
    { value: "vcard", label: "vCard", icon: "VC" },
    { value: "email", label: "Email", icon: "@" },
  ];

  return (
    <div class="flex flex-wrap gap-1.5">
      {modes.map((m) => (
        <button
          key={m.value}
          onClick={() => onModeChange(m.value)}
          class={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === m.value
              ? "bg-[var(--color-primary)] text-white"
              : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
          style={
            mode !== m.value
              ? { border: "1px solid var(--color-border)" }
              : undefined
          }
        >
          <span class="mr-1 font-mono text-[10px] opacity-60">{m.icon}</span>
          {m.label}
        </button>
      ))}
    </div>
  );
}

function EccSelector({
  level,
  onLevelChange,
}: {
  level: ErrorCorrectionLevel;
  onLevelChange: (l: ErrorCorrectionLevel) => void;
}) {
  const levels: { value: ErrorCorrectionLevel; label: string; pct: string }[] = [
    { value: "L", label: "L", pct: "7%" },
    { value: "M", label: "M", pct: "15%" },
    { value: "Q", label: "Q", pct: "25%" },
    { value: "H", label: "H", pct: "30%" },
  ];

  return (
    <div class="flex items-center gap-2">
      <span class="text-xs text-[var(--color-text-muted)]">ECC</span>
      <div class="flex gap-1">
        {levels.map((l) => (
          <button
            key={l.value}
            onClick={() => onLevelChange(l.value)}
            title={`Error correction: ${l.pct} recovery`}
            class={`rounded px-2.5 py-1 text-xs font-mono font-medium transition-colors ${
              level === l.value
                ? "bg-[var(--color-primary)] text-white"
                : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
            style={
              level !== l.value
                ? { border: "1px solid var(--color-border)" }
                : undefined
            }
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      value={value}
      onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
      placeholder="Enter text or URL..."
      rows={4}
      class="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
    />
  );
}

function WifiInput({
  fields,
  onChange,
}: {
  fields: WifiFields;
  onChange: (f: WifiFields) => void;
}) {
  return (
    <div class="space-y-2">
      <input
        type="text"
        value={fields.ssid}
        onInput={(e) =>
          onChange({ ...fields, ssid: (e.target as HTMLInputElement).value })
        }
        placeholder="Network name (SSID)"
        class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
      />
      <input
        type="text"
        value={fields.password}
        onInput={(e) =>
          onChange({ ...fields, password: (e.target as HTMLInputElement).value })
        }
        placeholder="Password"
        class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none"
      />
      <div class="flex items-center gap-3">
        <select
          value={fields.encryption}
          onChange={(e) =>
            onChange({
              ...fields,
              encryption: (e.target as HTMLSelectElement).value as WifiEncryption,
            })
          }
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
        >
          <option value="WPA">WPA/WPA2</option>
          <option value="WEP">WEP</option>
          <option value="nopass">None</option>
        </select>
        <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={fields.hidden}
            onChange={(e) =>
              onChange({
                ...fields,
                hidden: (e.target as HTMLInputElement).checked,
              })
            }
            class="accent-[var(--color-primary)]"
          />
          Hidden network
        </label>
      </div>
    </div>
  );
}

function VcardInput({
  fields,
  onChange,
}: {
  fields: VcardFields;
  onChange: (f: VcardFields) => void;
}) {
  const inputClass =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none";

  return (
    <div class="space-y-2">
      <div class="flex gap-2">
        <input
          type="text"
          value={fields.firstName}
          onInput={(e) =>
            onChange({ ...fields, firstName: (e.target as HTMLInputElement).value })
          }
          placeholder="First name"
          class={inputClass}
        />
        <input
          type="text"
          value={fields.lastName}
          onInput={(e) =>
            onChange({ ...fields, lastName: (e.target as HTMLInputElement).value })
          }
          placeholder="Last name"
          class={inputClass}
        />
      </div>
      <input
        type="tel"
        value={fields.phone}
        onInput={(e) =>
          onChange({ ...fields, phone: (e.target as HTMLInputElement).value })
        }
        placeholder="Phone"
        class={inputClass}
      />
      <input
        type="email"
        value={fields.email}
        onInput={(e) =>
          onChange({ ...fields, email: (e.target as HTMLInputElement).value })
        }
        placeholder="Email"
        class={inputClass}
      />
      <input
        type="text"
        value={fields.organization}
        onInput={(e) =>
          onChange({ ...fields, organization: (e.target as HTMLInputElement).value })
        }
        placeholder="Organization (optional)"
        class={inputClass}
      />
    </div>
  );
}

function EmailInput({
  fields,
  onChange,
}: {
  fields: EmailFields;
  onChange: (f: EmailFields) => void;
}) {
  const inputClass =
    "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-primary)] focus:outline-none";

  return (
    <div class="space-y-2">
      <input
        type="email"
        value={fields.address}
        onInput={(e) =>
          onChange({ ...fields, address: (e.target as HTMLInputElement).value })
        }
        placeholder="Email address"
        class={inputClass}
      />
      <input
        type="text"
        value={fields.subject}
        onInput={(e) =>
          onChange({ ...fields, subject: (e.target as HTMLInputElement).value })
        }
        placeholder="Subject (optional)"
        class={inputClass}
      />
      <textarea
        value={fields.body}
        onInput={(e) =>
          onChange({ ...fields, body: (e.target as HTMLTextAreaElement).value })
        }
        placeholder="Body (optional)"
        rows={3}
        class={`${inputClass} resize-none`}
      />
    </div>
  );
}

// ── Canvas Renderer ────────────────────────────────────────────────────────

function renderToCanvas(
  canvas: HTMLCanvasElement,
  qr: QrCode,
  settings: QrSettings,
): void {
  const margin = settings.quietZone ? 4 : 0;
  const totalModules = qr.size + margin * 2;
  const pixelSize = settings.moduleSize;
  const canvasSize = totalModules * pixelSize;

  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Background
  ctx.fillStyle = settings.bgColor;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  // Modules
  ctx.fillStyle = settings.fgColor;
  const radius = settings.roundedModules ? pixelSize * 0.35 : 0;

  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;

      const x = (c + margin) * pixelSize;
      const y = (r + margin) * pixelSize;

      if (radius > 0) {
        ctx.beginPath();
        ctx.roundRect(x, y, pixelSize, pixelSize, radius);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, pixelSize, pixelSize);
      }
    }
  }
}

// ── SVG Generator ──────────────────────────────────────────────────────────

function generateSvg(qr: QrCode, settings: QrSettings): string {
  const margin = settings.quietZone ? 4 : 0;
  const totalModules = qr.size + margin * 2;
  const pixelSize = settings.moduleSize;
  const svgSize = totalModules * pixelSize;
  const radius = settings.roundedModules ? pixelSize * 0.35 : 0;

  const rects: string[] = [];
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (!qr.modules[r][c]) continue;
      const x = (c + margin) * pixelSize;
      const y = (r + margin) * pixelSize;
      if (radius > 0) {
        rects.push(
          `<rect x="${x}" y="${y}" width="${pixelSize}" height="${pixelSize}" rx="${radius}" ry="${radius}" />`,
        );
      } else {
        rects.push(
          `<rect x="${x}" y="${y}" width="${pixelSize}" height="${pixelSize}" />`,
        );
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" width="${svgSize}" height="${svgSize}">`,
    `  <rect width="${svgSize}" height="${svgSize}" fill="${settings.bgColor}" />`,
    `  <g fill="${settings.fgColor}">`,
    ...rects.map((r) => `    ${r}`),
    "  </g>",
    "</svg>",
  ].join("\n");
}

// ── Download Helpers ───────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadPng(canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "qr-code.png");
  }, "image/png");
}

function downloadSvg(svgContent: string): void {
  const blob = new Blob([svgContent], { type: "image/svg+xml" });
  downloadBlob(blob, "qr-code.svg");
}

// ── Main Component ─────────────────────────────────────────────────────────

const DEFAULT_WIFI: WifiFields = {
  ssid: "",
  password: "",
  encryption: "WPA",
  hidden: false,
};

const DEFAULT_VCARD: VcardFields = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  organization: "",
};

const DEFAULT_EMAIL: EmailFields = {
  address: "",
  subject: "",
  body: "",
};

const DEFAULT_SETTINGS: QrSettings = {
  fgColor: "#000000",
  bgColor: "#ffffff",
  moduleSize: 8,
  eccLevel: "M",
  quietZone: true,
  roundedModules: false,
};

export default function QrGenerator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<InputMode>("text");
  const [textInput, setTextInput] = useState("https://artemiop.com");
  const [wifiFields, setWifiFields] = useState<WifiFields>(DEFAULT_WIFI);
  const [vcardFields, setVcardFields] = useState<VcardFields>(DEFAULT_VCARD);
  const [emailFields, setEmailFields] = useState<EmailFields>(DEFAULT_EMAIL);
  const [settings, setSettings] = useState<QrSettings>(DEFAULT_SETTINGS);
  const [qrResult, setQrResult] = useState<QrCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getEncodedText = useCallback((): string => {
    switch (mode) {
      case "text":
        return textInput;
      case "wifi":
        return wifiFields.ssid ? formatWifi(wifiFields) : "";
      case "vcard":
        return vcardFields.firstName || vcardFields.lastName
          ? formatVcard(vcardFields)
          : "";
      case "email":
        return emailFields.address ? formatEmail(emailFields) : "";
      default:
        return "";
    }
  }, [mode, textInput, wifiFields, vcardFields, emailFields]);

  const generateQr = useCallback(() => {
    const text = getEncodedText();
    if (!text) {
      setQrResult(null);
      setError(null);
      return;
    }

    try {
      const qr = encode(text, settings.eccLevel);
      setQrResult(qr);
      setError(null);
    } catch (err) {
      setQrResult(null);
      setError(err instanceof Error ? err.message : "Encoding failed");
    }
  }, [getEncodedText, settings.eccLevel]);

  // Generate QR code whenever inputs change
  useEffect(() => {
    generateQr();
  }, [generateQr]);

  // Render to canvas whenever QR result or visual settings change
  useEffect(() => {
    if (!qrResult || !canvasRef.current) return;
    renderToCanvas(canvasRef.current, qrResult, settings);
  }, [qrResult, settings]);

  const handleDownloadPng = useCallback(() => {
    if (!canvasRef.current) return;
    downloadPng(canvasRef.current);
  }, []);

  const handleDownloadSvg = useCallback(() => {
    if (!qrResult) return;
    const svgContent = generateSvg(qrResult, settings);
    downloadSvg(svgContent);
  }, [qrResult, settings]);

  const updateSetting = useCallback(
    <K extends keyof QrSettings>(key: K, value: QrSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Compute capacity info
  const encodedText = getEncodedText();
  const textByteLength = encodedText ? new TextEncoder().encode(encodedText).length : 0;
  const currentVersion = qrResult?.version ?? (textByteLength > 0 ? selectVersion(textByteLength, settings.eccLevel) : 1);
  const capacity = getCapacity(
    Math.max(1, Math.min(10, currentVersion > 0 ? currentVersion : 1)),
    settings.eccLevel,
  );

  return (
    <div
      class="rounded-xl border border-[var(--color-border)]"
      style={{
        background: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
      }}
    >
      <div class="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row">
        {/* ── Left Panel: Inputs ── */}
        <div class="flex min-w-0 flex-1 flex-col gap-4">
          {/* Mode selector */}
          <div>
            <label class="mb-2 block text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Input Type
            </label>
            <ModeSelector mode={mode} onModeChange={setMode} />
          </div>

          {/* Input fields */}
          <div>
            {mode === "text" && (
              <TextInput value={textInput} onChange={setTextInput} />
            )}
            {mode === "wifi" && (
              <WifiInput fields={wifiFields} onChange={setWifiFields} />
            )}
            {mode === "vcard" && (
              <VcardInput fields={vcardFields} onChange={setVcardFields} />
            )}
            {mode === "email" && (
              <EmailInput fields={emailFields} onChange={setEmailFields} />
            )}
          </div>

          {/* Error correction */}
          <EccSelector
            level={settings.eccLevel}
            onLevelChange={(l) => updateSetting("eccLevel", l)}
          />

          {/* Colors */}
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2">
              <label class="text-xs text-[var(--color-text-muted)]">FG</label>
              <input
                type="color"
                value={settings.fgColor}
                onInput={(e) =>
                  updateSetting("fgColor", (e.target as HTMLInputElement).value)
                }
                class="h-7 w-7 cursor-pointer rounded border border-[var(--color-border)] bg-transparent"
              />
              <span class="font-mono text-xs text-[var(--color-text-muted)]">
                {settings.fgColor}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <label class="text-xs text-[var(--color-text-muted)]">BG</label>
              <input
                type="color"
                value={settings.bgColor}
                onInput={(e) =>
                  updateSetting("bgColor", (e.target as HTMLInputElement).value)
                }
                class="h-7 w-7 cursor-pointer rounded border border-[var(--color-border)] bg-transparent"
              />
              <span class="font-mono text-xs text-[var(--color-text-muted)]">
                {settings.bgColor}
              </span>
            </div>
          </div>

          {/* Module size slider */}
          <div class="flex items-center gap-3">
            <label class="w-16 shrink-0 text-xs text-[var(--color-text-muted)]">
              Size
            </label>
            <input
              type="range"
              min={2}
              max={20}
              value={settings.moduleSize}
              onInput={(e) =>
                updateSetting(
                  "moduleSize",
                  Number((e.target as HTMLInputElement).value),
                )
              }
              class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)]"
              style="accent-color: var(--color-primary)"
            />
            <span class="w-8 text-right font-mono text-xs text-[var(--color-text)]">
              {settings.moduleSize}px
            </span>
          </div>

          {/* Toggles */}
          <div class="flex flex-wrap gap-4">
            <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={settings.quietZone}
                onChange={(e) =>
                  updateSetting(
                    "quietZone",
                    (e.target as HTMLInputElement).checked,
                  )
                }
                class="accent-[var(--color-primary)]"
              />
              Quiet zone (margin)
            </label>
            <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={settings.roundedModules}
                onChange={(e) =>
                  updateSetting(
                    "roundedModules",
                    (e.target as HTMLInputElement).checked,
                  )
                }
                class="accent-[var(--color-primary)]"
              />
              Rounded modules
            </label>
          </div>

          {/* Download buttons */}
          <div class="flex gap-2">
            <button
              onClick={handleDownloadPng}
              disabled={!qrResult}
              class="flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <DownloadIcon />
              PNG
            </button>
            <button
              onClick={handleDownloadSvg}
              disabled={!qrResult}
              class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs font-medium text-[var(--color-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <DownloadIcon />
              SVG
            </button>
          </div>
        </div>

        {/* ── Right Panel: QR Preview ── */}
        <div class="flex flex-col items-center justify-center gap-4 lg:min-w-[320px]">
          <div
            class="flex items-center justify-center rounded-lg border border-[var(--color-border)] bg-white p-4"
            style={{ minWidth: "200px", minHeight: "200px" }}
          >
            {error ? (
              <p class="max-w-[200px] text-center text-xs text-red-400">
                {error}
              </p>
            ) : qrResult ? (
              <canvas ref={canvasRef} class="block" />
            ) : (
              <p class="text-xs text-[var(--color-text-muted)]">
                Enter text to generate
              </p>
            )}
          </div>

          {/* Info */}
          {qrResult && (
            <div class="text-center text-xs text-[var(--color-text-muted)]">
              <p>
                Version {qrResult.version} ({qrResult.size} x {qrResult.size})
              </p>
              <p>
                {textByteLength} / {capacity} bytes &middot; ECC {settings.eccLevel}
              </p>
            </div>
          )}
          {!qrResult && !error && currentVersion > 0 && (
            <div class="text-center text-xs text-[var(--color-text-muted)]">
              <p>
                Capacity: {capacity} bytes at ECC {settings.eccLevel}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────

function DownloadIcon() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
