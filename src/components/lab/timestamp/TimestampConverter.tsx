import { useState, useEffect, useCallback, useRef } from "preact/hooks";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface DateMathResult {
  date: Date;
  unix: number;
  unixMs: number;
  iso: string;
}

type DateMathOp = "add" | "subtract";
type DateMathUnit = "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "years";
type TimestampPrecision = "auto" | "seconds" | "milliseconds";

interface EpochInfo {
  name: string;
  description: string;
  epoch: string;
  unixOffset: number;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const COMMON_TIMEZONES: Array<{ label: string; value: string }> = [
  { label: "UTC", value: "UTC" },
  { label: "US/Eastern (New York)", value: "America/New_York" },
  { label: "US/Central (Chicago)", value: "America/Chicago" },
  { label: "US/Mountain (Denver)", value: "America/Denver" },
  { label: "US/Pacific (Los Angeles)", value: "America/Los_Angeles" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "Europe/Berlin", value: "Europe/Berlin" },
  { label: "Europe/Paris", value: "Europe/Paris" },
  { label: "Europe/Moscow", value: "Europe/Moscow" },
  { label: "Asia/Dubai", value: "Asia/Dubai" },
  { label: "Asia/Kolkata", value: "Asia/Kolkata" },
  { label: "Asia/Shanghai", value: "Asia/Shanghai" },
  { label: "Asia/Tokyo", value: "Asia/Tokyo" },
  { label: "Asia/Seoul", value: "Asia/Seoul" },
  { label: "Australia/Sydney", value: "Australia/Sydney" },
  { label: "Pacific/Auckland", value: "Pacific/Auckland" },
  { label: "America/Sao_Paulo", value: "America/Sao_Paulo" },
  { label: "America/Mexico_City", value: "America/Mexico_City" },
];

const EPOCH_REFERENCES: EpochInfo[] = [
  {
    name: "Unix Epoch",
    description: "The reference point for Unix timestamps",
    epoch: "1970-01-01T00:00:00Z",
    unixOffset: 0,
  },
  {
    name: "Windows FILETIME",
    description: "100-nanosecond intervals since Jan 1, 1601",
    epoch: "1601-01-01T00:00:00Z",
    unixOffset: -11644473600,
  },
  {
    name: "Mac Absolute Time",
    description: "Seconds since Jan 1, 2001 (CFAbsoluteTime)",
    epoch: "2001-01-01T00:00:00Z",
    unixOffset: 978307200,
  },
  {
    name: "NTP Epoch",
    description: "Seconds since Jan 1, 1900",
    epoch: "1900-01-01T00:00:00Z",
    unixOffset: -2208988800,
  },
  {
    name: "GPS Epoch",
    description: "Seconds since Jan 6, 1980",
    epoch: "1980-01-06T00:00:00Z",
    unixOffset: 315964800,
  },
  {
    name: "Y2K38 Problem",
    description: "Max 32-bit signed Unix timestamp",
    epoch: "2038-01-19T03:14:07Z",
    unixOffset: 2147483647,
  },
];

const DATE_MATH_UNITS: DateMathUnit[] = [
  "seconds",
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
  "years",
];

/* ──────────────────────────────────────
   Utility Functions
   ────────────────────────────────────── */

function detectPrecision(value: number): "seconds" | "milliseconds" {
  const abs = Math.abs(value);
  // 13+ digit numbers are almost certainly milliseconds
  // 10-digit numbers are seconds (covers dates from 2001-09-09 to 2286-11-20)
  if (abs > 9999999999) return "milliseconds";
  return "seconds";
}

function toMilliseconds(value: number, precision: TimestampPrecision): number {
  if (precision === "auto") {
    const detected = detectPrecision(value);
    return detected === "seconds" ? value * 1000 : value;
  }
  return precision === "seconds" ? value * 1000 : value;
}

function formatIso8601(date: Date): string {
  return date.toISOString();
}

function formatRfc2822(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const dayName = days[date.getUTCDay()];
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");

  return `${dayName}, ${day} ${month} ${year} ${hours}:${minutes}:${seconds} +0000`;
}

function formatRelative(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime();
  const absDiffMs = Math.abs(diffMs);
  const isFuture = diffMs > 0;

  if (absDiffMs < 1000) return "just now";

  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30.44);
  const years = Math.floor(days / 365.25);

  let label: string;
  if (years > 0) label = `${years} year${years !== 1 ? "s" : ""}`;
  else if (months > 0) label = `${months} month${months !== 1 ? "s" : ""}`;
  else if (weeks > 0) label = `${weeks} week${weeks !== 1 ? "s" : ""}`;
  else if (days > 0) label = `${days} day${days !== 1 ? "s" : ""}`;
  else if (hours > 0) label = `${hours} hour${hours !== 1 ? "s" : ""}`;
  else if (minutes > 0) label = `${minutes} minute${minutes !== 1 ? "s" : ""}`;
  else label = `${seconds} second${seconds !== 1 ? "s" : ""}`;

  return isFuture ? `in ${label}` : `${label} ago`;
}

function formatInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return "Invalid timezone";
  }
}

function applyDateMath(
  baseDate: Date,
  op: DateMathOp,
  amount: number,
  unit: DateMathUnit
): DateMathResult {
  const result = new Date(baseDate.getTime());
  const sign = op === "add" ? 1 : -1;
  const delta = amount * sign;

  switch (unit) {
    case "seconds":
      result.setSeconds(result.getSeconds() + delta);
      break;
    case "minutes":
      result.setMinutes(result.getMinutes() + delta);
      break;
    case "hours":
      result.setHours(result.getHours() + delta);
      break;
    case "days":
      result.setDate(result.getDate() + delta);
      break;
    case "weeks":
      result.setDate(result.getDate() + delta * 7);
      break;
    case "months":
      result.setMonth(result.getMonth() + delta);
      break;
    case "years":
      result.setFullYear(result.getFullYear() + delta);
      break;
  }

  return {
    date: result,
    unix: Math.floor(result.getTime() / 1000),
    unixMs: result.getTime(),
    iso: result.toISOString(),
  };
}

function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("Clipboard API not available"));
}

function dateToLocalInputs(date: Date): { dateStr: string; timeStr: string } {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return {
    dateStr: `${year}-${month}-${day}`,
    timeStr: `${hours}:${minutes}:${seconds}`,
  };
}

function readHashTimestamp(): number | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace("#", "");
  if (!hash) return null;
  const parsed = Number(hash);
  if (isNaN(parsed)) return null;
  return parsed;
}

function writeHashTimestamp(unixSeconds: number): void {
  if (typeof window === "undefined") return;
  const newHash = `#${unixSeconds}`;
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, "", newHash);
  }
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function TimestampConverter() {
  const [now, setNow] = useState(() => new Date());
  const [timestampInput, setTimestampInput] = useState("");
  const [precision, setPrecision] = useState<TimestampPrecision>("auto");
  const [dateInput, setDateInput] = useState("");
  const [timeInput, setTimeInput] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [activeDate, setActiveDate] = useState<Date | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"timestamp" | "datetime">("timestamp");

  // Date math state
  const [mathOp, setMathOp] = useState<DateMathOp>("add");
  const [mathAmount, setMathAmount] = useState("7");
  const [mathUnit, setMathUnit] = useState<DateMathUnit>("days");
  const [mathResult, setMathResult] = useState<DateMathResult | null>(null);

  // Expanded sections
  const [showEpochs, setShowEpochs] = useState(false);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);

  // Live clock
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  // Read hash on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const hashTs = readHashTimestamp();
    if (hashTs !== null) {
      setTimestampInput(String(hashTs));
      const ms = toMilliseconds(hashTs, "auto");
      const date = new Date(ms);
      if (!isNaN(date.getTime())) {
        setActiveDate(date);
        setInputMode("timestamp");
      }
    } else {
      // Default: show current time
      const nowDate = new Date();
      const unixSec = Math.floor(nowDate.getTime() / 1000);
      setTimestampInput(String(unixSec));
      setActiveDate(nowDate);
    }
  }, []);

  // Process timestamp input
  const handleTimestampInput = useCallback(
    (value: string) => {
      setTimestampInput(value);
      setInputMode("timestamp");
      const trimmed = value.trim();
      if (!trimmed) {
        setActiveDate(null);
        return;
      }
      const num = Number(trimmed);
      if (isNaN(num)) {
        setActiveDate(null);
        return;
      }
      const ms = toMilliseconds(num, precision);
      const date = new Date(ms);
      if (isNaN(date.getTime())) {
        setActiveDate(null);
        return;
      }
      setActiveDate(date);
      writeHashTimestamp(Math.floor(date.getTime() / 1000));
    },
    [precision]
  );

  // Process date/time input
  const handleDateTimeInput = useCallback(
    (newDate: string, newTime: string) => {
      setDateInput(newDate);
      setTimeInput(newTime);
      setInputMode("datetime");
      if (!newDate) {
        setActiveDate(null);
        return;
      }
      const timeStr = newTime || "00:00:00";
      const dateStr = `${newDate}T${timeStr}`;
      const parsed = new Date(dateStr);
      if (isNaN(parsed.getTime())) {
        setActiveDate(null);
        return;
      }
      setActiveDate(parsed);
      const unixSec = Math.floor(parsed.getTime() / 1000);
      setTimestampInput(String(unixSec));
      writeHashTimestamp(unixSec);
    },
    []
  );

  // Use "now" button
  const handleUseNow = useCallback(() => {
    const current = new Date();
    const unixSec = Math.floor(current.getTime() / 1000);
    setTimestampInput(String(unixSec));
    setActiveDate(current);
    setInputMode("timestamp");
    const { dateStr, timeStr } = dateToLocalInputs(current);
    setDateInput(dateStr);
    setTimeInput(timeStr);
    writeHashTimestamp(unixSec);
  }, []);

  // Copy handler
  const handleCopy = useCallback((text: string, label: string) => {
    copyToClipboard(text)
      .then(() => {
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        setCopyFeedback(label);
        copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
      })
      .catch(() => {});
  }, []);

  // Date math
  const handleDateMath = useCallback(() => {
    if (!activeDate) return;
    const amount = parseInt(mathAmount, 10);
    if (isNaN(amount) || amount < 0) return;
    const result = applyDateMath(activeDate, mathOp, amount, mathUnit);
    setMathResult(result);
  }, [activeDate, mathOp, mathAmount, mathUnit]);

  // Re-apply when precision changes
  useEffect(() => {
    if (inputMode === "timestamp" && timestampInput.trim()) {
      const num = Number(timestampInput.trim());
      if (!isNaN(num)) {
        const ms = toMilliseconds(num, precision);
        const date = new Date(ms);
        if (!isNaN(date.getTime())) {
          setActiveDate(date);
        }
      }
    }
  }, [precision, inputMode, timestampInput]);

  // Sync datetime inputs when activeDate changes from timestamp input
  useEffect(() => {
    if (activeDate && inputMode === "timestamp") {
      const { dateStr, timeStr } = dateToLocalInputs(activeDate);
      setDateInput(dateStr);
      setTimeInput(timeStr);
    }
  }, [activeDate, inputMode]);

  // Derived values
  const detectedPrecision =
    timestampInput.trim() && !isNaN(Number(timestampInput.trim()))
      ? detectPrecision(Number(timestampInput.trim()))
      : null;

  const unixSeconds = activeDate
    ? Math.floor(activeDate.getTime() / 1000)
    : null;
  const unixMilliseconds = activeDate ? activeDate.getTime() : null;

  const nowUnix = Math.floor(now.getTime() / 1000);
  const nowUnixMs = now.getTime();

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Timestamp Converter
          </span>
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
            <span
              class="text-[10px] font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              {copyFeedback} copied
            </span>
          )}
          <span
            class="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
            style={{
              borderColor: "rgba(52, 211, 153, 0.3)",
              color: "rgba(52, 211, 153, 0.8)",
            }}
          >
            <LockIcon /> Client-only
          </span>
        </div>
      </div>

      {/* Live Clock */}
      <div class="border-b border-[var(--color-border)] px-4 py-3">
        <div class="mb-1.5 flex items-center gap-2">
          <span
            class="inline-block h-2 w-2 rounded-full"
            style={{
              backgroundColor: "var(--color-accent)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
          <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Current Time
          </span>
        </div>
        <div class="grid gap-1.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
          <ClockRow
            label="Unix (s)"
            value={String(nowUnix)}
            onCopy={() => handleCopy(String(nowUnix), "Unix seconds")}
          />
          <ClockRow
            label="Unix (ms)"
            value={String(nowUnixMs)}
            onCopy={() => handleCopy(String(nowUnixMs), "Unix ms")}
          />
          <ClockRow
            label="ISO 8601"
            value={now.toISOString()}
            onCopy={() => handleCopy(now.toISOString(), "ISO 8601")}
          />
          <ClockRow
            label="RFC 2822"
            value={formatRfc2822(now)}
            onCopy={() => handleCopy(formatRfc2822(now), "RFC 2822")}
          />
          <ClockRow
            label="Local"
            value={formatInTimezone(now, Intl.DateTimeFormat().resolvedOptions().timeZone)}
            onCopy={() =>
              handleCopy(
                formatInTimezone(now, Intl.DateTimeFormat().resolvedOptions().timeZone),
                "Local time"
              )
            }
          />
        </div>
      </div>

      {/* Input Section */}
      <div class="border-b border-[var(--color-border)] px-4 py-4">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Convert
          </span>
          <button
            onClick={handleUseNow}
            class="rounded-lg border border-[var(--color-border)] px-3 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
          >
            Use Now
          </button>
        </div>

        {/* Timestamp input */}
        <div class="mb-3">
          <label class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Unix Timestamp
          </label>
          <div class="flex gap-2">
            <input
              type="text"
              value={timestampInput}
              onInput={(e) =>
                handleTimestampInput((e.target as HTMLInputElement).value)
              }
              class="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
              placeholder="1772829000"
              spellcheck={false}
              autocomplete="off"
            />
            <select
              value={precision}
              onChange={(e) =>
                setPrecision(
                  (e.target as HTMLSelectElement).value as TimestampPrecision
                )
              }
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
            >
              <option value="auto">
                auto{detectedPrecision ? ` (${detectedPrecision})` : ""}
              </option>
              <option value="seconds">seconds</option>
              <option value="milliseconds">milliseconds</option>
            </select>
          </div>
        </div>

        {/* Divider */}
        <div class="mb-3 flex items-center gap-3">
          <div
            class="flex-1 border-t"
            style={{ borderColor: "var(--color-border)" }}
          />
          <span class="text-[10px] font-medium text-[var(--color-text-muted)]">
            or
          </span>
          <div
            class="flex-1 border-t"
            style={{ borderColor: "var(--color-border)" }}
          />
        </div>

        {/* Date/time inputs */}
        <div class="mb-3">
          <label class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Date & Time (local)
          </label>
          <div class="flex flex-wrap gap-2">
            <input
              type="date"
              value={dateInput}
              onInput={(e) =>
                handleDateTimeInput(
                  (e.target as HTMLInputElement).value,
                  timeInput
                )
              }
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <input
              type="time"
              step="1"
              value={timeInput}
              onInput={(e) =>
                handleDateTimeInput(
                  dateInput,
                  (e.target as HTMLInputElement).value
                )
              }
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
            />
          </div>
        </div>

        {/* Timezone selector */}
        <div>
          <label class="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Display Timezone
          </label>
          <select
            value={timezone}
            onChange={(e) =>
              setTimezone((e.target as HTMLSelectElement).value)
            }
            class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)] sm:w-auto"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Output Formats */}
      {activeDate && (
        <div class="border-b border-[var(--color-border)] px-4 py-4">
          <h3
            class="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-heading)" }}
          >
            Output Formats
          </h3>
          <div class="space-y-2">
            <FormatRow
              label="ISO 8601"
              value={formatIso8601(activeDate)}
              onCopy={() =>
                handleCopy(formatIso8601(activeDate), "ISO 8601")
              }
            />
            <FormatRow
              label="RFC 2822"
              value={formatRfc2822(activeDate)}
              onCopy={() =>
                handleCopy(formatRfc2822(activeDate), "RFC 2822")
              }
            />
            <FormatRow
              label="Unix (s)"
              value={String(unixSeconds)}
              onCopy={() =>
                handleCopy(String(unixSeconds), "Unix seconds")
              }
            />
            <FormatRow
              label="Unix (ms)"
              value={String(unixMilliseconds)}
              onCopy={() =>
                handleCopy(String(unixMilliseconds), "Unix ms")
              }
            />
            <FormatRow
              label="Relative"
              value={formatRelative(activeDate, now)}
              onCopy={() =>
                handleCopy(formatRelative(activeDate, now), "Relative time")
              }
            />
            <FormatRow
              label={`In ${timezone}`}
              value={formatInTimezone(activeDate, timezone)}
              onCopy={() =>
                handleCopy(
                  formatInTimezone(activeDate, timezone),
                  `Time in ${timezone}`
                )
              }
              highlight
            />
          </div>
        </div>
      )}

      {/* Date Math */}
      {activeDate && (
        <div class="border-b border-[var(--color-border)] px-4 py-4">
          <h3
            class="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-heading)" }}
          >
            Date Math
          </h3>
          <div class="flex flex-wrap items-end gap-2">
            <select
              value={mathOp}
              onChange={(e) =>
                setMathOp((e.target as HTMLSelectElement).value as DateMathOp)
              }
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
            >
              <option value="add">+ Add</option>
              <option value="subtract">- Subtract</option>
            </select>
            <input
              type="number"
              min="0"
              value={mathAmount}
              onInput={(e) =>
                setMathAmount((e.target as HTMLInputElement).value)
              }
              class="w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <select
              value={mathUnit}
              onChange={(e) =>
                setMathUnit(
                  (e.target as HTMLSelectElement).value as DateMathUnit
                )
              }
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
            >
              {DATE_MATH_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button
              onClick={handleDateMath}
              class="rounded-lg border border-[var(--color-primary)] px-4 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-primary)]"
              style={{ color: "var(--color-primary)" }}
            >
              Calculate
            </button>
          </div>

          {mathResult && (
            <div
              class="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
            >
              <div class="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                Result
              </div>
              <div class="space-y-1.5">
                <FormatRow
                  label="ISO 8601"
                  value={mathResult.iso}
                  onCopy={() => handleCopy(mathResult.iso, "Math ISO 8601")}
                  compact
                />
                <FormatRow
                  label="Unix (s)"
                  value={String(mathResult.unix)}
                  onCopy={() =>
                    handleCopy(String(mathResult.unix), "Math Unix seconds")
                  }
                  compact
                />
                <FormatRow
                  label="Relative"
                  value={formatRelative(mathResult.date, now)}
                  onCopy={() =>
                    handleCopy(
                      formatRelative(mathResult.date, now),
                      "Math Relative"
                    )
                  }
                  compact
                />
                <FormatRow
                  label={`In ${timezone}`}
                  value={formatInTimezone(mathResult.date, timezone)}
                  onCopy={() =>
                    handleCopy(
                      formatInTimezone(mathResult.date, timezone),
                      `Math ${timezone}`
                    )
                  }
                  compact
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Epoch References */}
      <div class="px-4 py-4">
        <button
          onClick={() => setShowEpochs(!showEpochs)}
          class="flex w-full items-center justify-between text-left"
        >
          <h3
            class="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-heading)" }}
          >
            Epoch References
          </h3>
          <ChevronIcon expanded={showEpochs} />
        </button>

        {showEpochs && (
          <div class="mt-3 overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-[var(--color-border)]">
                  <th
                    class="py-2 pr-4 text-left font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Epoch
                  </th>
                  <th
                    class="py-2 pr-4 text-left font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Date
                  </th>
                  <th
                    class="py-2 pr-4 text-left font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Description
                  </th>
                  <th
                    class="py-2 text-left font-semibold uppercase tracking-wider"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Unix Offset
                  </th>
                </tr>
              </thead>
              <tbody>
                {EPOCH_REFERENCES.map((epoch) => (
                  <tr
                    key={epoch.name}
                    class="border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <td class="py-2 pr-4">
                      <span
                        class="font-semibold"
                        style={{ color: "var(--color-heading)" }}
                      >
                        {epoch.name}
                      </span>
                    </td>
                    <td class="py-2 pr-4">
                      <code
                        class="text-[11px]"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-primary)",
                        }}
                      >
                        {epoch.epoch}
                      </code>
                    </td>
                    <td class="py-2 pr-4 text-[var(--color-text-muted)]">
                      {epoch.description}
                    </td>
                    <td class="py-2">
                      <code
                        class="text-[11px]"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-text)",
                        }}
                      >
                        {epoch.unixOffset.toLocaleString()}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

/* ──────────────────────────────────────
   Sub-Components
   ────────────────────────────────────── */

function ClockRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5">
      <span class="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </span>
      <code
        class="flex-1 truncate text-[11px]"
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-text)",
        }}
      >
        {value}
      </code>
      <button
        onClick={onCopy}
        class="shrink-0 rounded p-0.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
        title={`Copy ${label}`}
      >
        <CopyIcon />
      </button>
    </div>
  );
}

function FormatRow({
  label,
  value,
  onCopy,
  highlight = false,
  compact = false,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  highlight?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      class={`flex items-center gap-3 rounded-lg border px-3 ${compact ? "py-1.5" : "py-2"}`}
      style={{
        borderColor: highlight
          ? "rgba(79, 143, 247, 0.3)"
          : "var(--color-border)",
        backgroundColor: highlight
          ? "rgba(79, 143, 247, 0.05)"
          : "var(--color-bg)",
      }}
    >
      <span
        class="w-20 shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
      >
        {label}
      </span>
      <code
        class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px]"
        style={{
          fontFamily: "var(--font-mono)",
          color: highlight ? "var(--color-primary)" : "var(--color-text)",
        }}
        title={value}
      >
        {value}
      </code>
      <button
        onClick={onCopy}
        class="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
        title={`Copy ${label}`}
      >
        <CopyIcon />
      </button>
    </div>
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      style={{
        color: "var(--color-text-muted)",
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 0.2s ease",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
