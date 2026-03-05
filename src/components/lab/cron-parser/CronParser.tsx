import { useState, useMemo, useCallback, useRef, useEffect } from "preact/hooks";
import type { JSX } from "preact";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

interface CronValidationError {
  field: number;
  message: string;
}

interface CronPreset {
  label: string;
  expression: string;
}

type TimelineView = "hour" | "day" | "week" | "month";

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const FIELD_LABELS = ["minute", "hour", "day of month", "month", "day of week"] as const;
const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

const MONTH_NAMES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DAY_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th",
  "11th", "12th", "13th", "14th", "15th", "16th", "17th", "18th", "19th", "20th",
  "21st", "22nd", "23rd", "24th", "25th", "26th", "27th", "28th", "29th", "30th", "31st"];

const MONTH_LABELS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PRESETS: CronPreset[] = [
  { label: "Every minute", expression: "* * * * *" },
  { label: "Every 5 minutes", expression: "*/5 * * * *" },
  { label: "Every 15 minutes", expression: "*/15 * * * *" },
  { label: "Hourly", expression: "0 * * * *" },
  { label: "Daily at midnight", expression: "0 0 * * *" },
  { label: "Daily at 9 AM", expression: "0 9 * * *" },
  { label: "Weekdays at 9 AM", expression: "0 9 * * 1-5" },
  { label: "Every Sunday at noon", expression: "0 12 * * 0" },
  { label: "Monthly on the 1st", expression: "0 0 1 * *" },
  { label: "Quarterly (Jan, Apr, Jul, Oct)", expression: "0 0 1 1,4,7,10 *" },
  { label: "Yearly on Jan 1st", expression: "0 0 1 1 *" },
  { label: "Every 30 minutes on weekdays", expression: "*/30 * * * 1-5" },
];

/* ──────────────────────────────────────
   Cron Parser Engine (Pure Functions)
   ────────────────────────────────────── */

function replaceNames(field: string, fieldIndex: number): string {
  let result = field.toUpperCase();
  if (fieldIndex === 3) {
    for (const [name, value] of Object.entries(MONTH_NAMES)) {
      result = result.replace(new RegExp(`\\b${name}\\b`, "g"), String(value));
    }
  }
  if (fieldIndex === 4) {
    for (const [name, value] of Object.entries(DAY_NAMES)) {
      result = result.replace(new RegExp(`\\b${name}\\b`, "g"), String(value));
    }
  }
  return result;
}

function parseField(field: string, fieldIndex: number): Set<number> | CronValidationError {
  const [min, max] = FIELD_RANGES[fieldIndex];
  const replaced = replaceNames(field.trim(), fieldIndex);
  const values = new Set<number>();

  const parts = replaced.split(",");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      return { field: fieldIndex, message: `Empty value in ${FIELD_LABELS[fieldIndex]} field` };
    }

    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/);
    let base = stepMatch ? stepMatch[1] : trimmed;
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 0;

    if (step !== 0 && (step < 1 || isNaN(step))) {
      return { field: fieldIndex, message: `Invalid step value in ${FIELD_LABELS[fieldIndex]} field` };
    }

    if (base === "*") {
      if (step > 0) {
        for (let i = min; i <= max; i += step) {
          values.add(normalizeValue(i, fieldIndex));
        }
      } else {
        for (let i = min; i <= max; i++) {
          values.add(normalizeValue(i, fieldIndex));
        }
      }
    } else {
      const rangeMatch = base.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1], 10);
        const end = parseInt(rangeMatch[2], 10);
        if (isNaN(start) || isNaN(end)) {
          return { field: fieldIndex, message: `Invalid range in ${FIELD_LABELS[fieldIndex]} field` };
        }
        if (start < min || start > max || end < min || end > max) {
          return { field: fieldIndex, message: `Value out of range (${min}-${max}) in ${FIELD_LABELS[fieldIndex]} field` };
        }
        if (start > end) {
          return { field: fieldIndex, message: `Invalid range ${start}-${end} in ${FIELD_LABELS[fieldIndex]} field` };
        }
        const increment = step > 0 ? step : 1;
        for (let i = start; i <= end; i += increment) {
          values.add(normalizeValue(i, fieldIndex));
        }
      } else {
        const num = parseInt(base, 10);
        if (isNaN(num)) {
          return { field: fieldIndex, message: `Invalid value "${base}" in ${FIELD_LABELS[fieldIndex]} field` };
        }
        if (num < min || num > max) {
          return { field: fieldIndex, message: `Value ${num} out of range (${min}-${max}) in ${FIELD_LABELS[fieldIndex]} field` };
        }
        if (step > 0) {
          for (let i = num; i <= max; i += step) {
            values.add(normalizeValue(i, fieldIndex));
          }
        } else {
          values.add(normalizeValue(num, fieldIndex));
        }
      }
    }
  }

  return values;
}

function normalizeValue(value: number, fieldIndex: number): number {
  if (fieldIndex === 4 && value === 7) return 0;
  return value;
}

function parseCronExpression(expression: string): ParsedCron | CronValidationError {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { field: -1, message: `Expected 5 fields, got ${parts.length}` };
  }

  const results: Array<Set<number>> = [];
  for (let i = 0; i < 5; i++) {
    const result = parseField(parts[i], i);
    if ("message" in result) return result;
    results.push(result);
  }

  return {
    minutes: results[0],
    hours: results[1],
    daysOfMonth: results[2],
    months: results[3],
    daysOfWeek: results[4],
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getNextExecutions(parsed: ParsedCron, count: number, from: Date): Date[] {
  const results: Date[] = [];
  const maxIterations = 525960; // ~1 year of minutes

  let year = from.getFullYear();
  let month = from.getMonth() + 1;
  let day = from.getDate();
  let hour = from.getHours();
  let minute = from.getMinutes() + 1;

  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    iterations++;

    if (minute > 59) {
      minute = 0;
      hour++;
    }
    if (hour > 23) {
      hour = 0;
      day++;
    }

    const maxDays = daysInMonth(year, month);
    if (day > maxDays) {
      day = 1;
      month++;
    }
    if (month > 12) {
      month = 1;
      year++;
    }

    if (!parsed.months.has(month)) {
      day = 1;
      hour = 0;
      minute = 0;
      month++;
      continue;
    }

    const currentMaxDays = daysInMonth(year, month);
    if (day > currentMaxDays) {
      day = 1;
      month++;
      hour = 0;
      minute = 0;
      continue;
    }

    if (!parsed.daysOfMonth.has(day)) {
      day++;
      hour = 0;
      minute = 0;
      continue;
    }

    const date = new Date(year, month - 1, day);
    const dow = date.getDay();
    if (!parsed.daysOfWeek.has(dow)) {
      day++;
      hour = 0;
      minute = 0;
      continue;
    }

    if (!parsed.hours.has(hour)) {
      hour++;
      minute = 0;
      continue;
    }

    if (!parsed.minutes.has(minute)) {
      minute++;
      continue;
    }

    results.push(new Date(year, month - 1, day, hour, minute, 0));
    minute++;
  }

  return results;
}

/* ──────────────────────────────────────
   Human-Readable Description
   ────────────────────────────────────── */

function describeField(fieldStr: string, fieldIndex: number): string {
  const replaced = replaceNames(fieldStr.trim(), fieldIndex);
  if (replaced === "*") return "";

  const stepMatch = replaced.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10);
    return `every ${step} ${FIELD_LABELS[fieldIndex]}${step > 1 ? "s" : ""}`;
  }

  return "";
}

function formatHour(h: number): string {
  if (h === 0) return "12:00 AM";
  if (h === 12) return "12:00 PM";
  if (h < 12) return `${h}:00 AM`;
  return `${h - 12}:00 PM`;
}

function formatHourMinute(h: number, m: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const displayMinute = m.toString().padStart(2, "0");
  return `${displayHour}:${displayMinute} ${period}`;
}

function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid expression";

  const [minStr, hourStr, domStr, monStr, dowStr] = parts;

  if (minStr === "*" && hourStr === "*" && domStr === "*" && monStr === "*" && dowStr === "*") {
    return "Every minute";
  }

  const segments: string[] = [];

  const minStep = minStr.match(/^\*\/(\d+)$/);
  const hourStep = hourStr.match(/^\*\/(\d+)$/);

  if (minStep && hourStr === "*") {
    const step = parseInt(minStep[1], 10);
    segments.push(`Every ${step} minute${step > 1 ? "s" : ""}`);
  } else if (minStr === "0" && hourStep) {
    const step = parseInt(hourStep[1], 10);
    segments.push(`Every ${step} hour${step > 1 ? "s" : ""}`);
  } else if (minStr === "*" && hourStr !== "*") {
    segments.push("Every minute");
    segments.push(describeHourPart(hourStr));
  } else if (hourStr === "*" && minStr !== "*" && !minStep) {
    segments.push(`At minute ${describeValues(minStr, 0)}`);
    segments.push("of every hour");
  } else if (hourStr !== "*" && minStr !== "*" && !minStep) {
    const hours = replaceNames(hourStr, 1);
    const mins = replaceNames(minStr, 0);

    if (!hours.includes(",") && !hours.includes("-") && !hours.includes("/") &&
        !mins.includes(",") && !mins.includes("-") && !mins.includes("/")) {
      const h = parseInt(hours, 10);
      const m = parseInt(mins, 10);
      if (!isNaN(h) && !isNaN(m)) {
        segments.push(`At ${formatHourMinute(h, m)}`);
      } else {
        segments.push(`At ${describeValues(minStr, 0)} past ${describeValues(hourStr, 1)}`);
      }
    } else {
      segments.push(`At minute ${describeValues(minStr, 0)} past hour ${describeValues(hourStr, 1)}`);
    }
  } else if (minStep) {
    const step = parseInt(minStep[1], 10);
    segments.push(`Every ${step} minute${step > 1 ? "s" : ""}`);
    if (hourStr !== "*") {
      segments.push(describeHourPart(hourStr));
    }
  }

  if (domStr !== "*") {
    segments.push(`on the ${describeDomValues(domStr)}`);
  }

  if (monStr !== "*") {
    segments.push(`in ${describeMonthValues(monStr)}`);
  }

  if (dowStr !== "*") {
    segments.push(describeDowPart(dowStr));
  }

  if (segments.length === 0) {
    return describeFieldByField(parts);
  }

  let result = segments.join(", ");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function describeFieldByField(parts: string[]): string {
  const pieces: string[] = [];
  for (let i = 0; i < 5; i++) {
    const desc = describeField(parts[i], i);
    if (desc) pieces.push(desc);
  }
  if (pieces.length === 0) return "Custom schedule";
  let result = pieces.join(", ");
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function describeHourPart(hourStr: string): string {
  const step = hourStr.match(/^\*\/(\d+)$/);
  if (step) {
    return `every ${step[1]} hours`;
  }
  const range = hourStr.match(/^(\d+)-(\d+)$/);
  if (range) {
    return `between ${formatHour(parseInt(range[1], 10))} and ${formatHour(parseInt(range[2], 10))}`;
  }
  return `during hour ${describeValues(hourStr, 1)}`;
}

function describeValues(fieldStr: string, fieldIndex: number): string {
  const replaced = replaceNames(fieldStr, fieldIndex);
  return replaced;
}

function describeDomValues(domStr: string): string {
  const replaced = replaceNames(domStr, 2);
  const parts = replaced.split(",");
  return parts.map((p) => {
    const trimmed = p.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= 31) {
      return ORDINALS[num - 1];
    }
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      return `${ORDINALS[start - 1]} through ${ORDINALS[end - 1]}`;
    }
    return trimmed;
  }).join(", ");
}

function describeMonthValues(monStr: string): string {
  const replaced = replaceNames(monStr, 3);
  const parts = replaced.split(",");
  return parts.map((p) => {
    const trimmed = p.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= 12) {
      return MONTH_LABELS[num - 1];
    }
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      return `${MONTH_LABELS[start - 1]} through ${MONTH_LABELS[end - 1]}`;
    }
    return trimmed;
  }).join(", ");
}

function describeDowPart(dowStr: string): string {
  const replaced = replaceNames(dowStr, 4);
  const parts = replaced.split(",");
  const dayNames = parts.map((p) => {
    const trimmed = p.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 0 && num <= 7) {
      return DAY_LABELS[num === 7 ? 0 : num];
    }
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = parseInt(range[2], 10);
      if (start === 1 && end === 5) return "Monday through Friday";
      if (start === 0 && end === 6) return "every day";
      return `${DAY_LABELS[start]} through ${DAY_LABELS[end]}`;
    }
    return trimmed;
  });

  if (dayNames.length === 1) {
    if (dayNames[0].includes("through") || dayNames[0] === "every day") {
      return dayNames[0];
    }
    return `on ${dayNames[0]}`;
  }
  return `on ${dayNames.join(" and ")}`;
}

/* ──────────────────────────────────────
   Frequency Estimation
   ────────────────────────────────────── */

function estimateFrequency(parsed: ParsedCron): string {
  const minutesPerHour = parsed.minutes.size;
  const hoursPerDay = parsed.hours.size;

  const allDom = parsed.daysOfMonth.size >= 28;
  const allDow = parsed.daysOfWeek.size >= 7;
  const allMonths = parsed.months.size >= 12;

  const executionsPerDay = minutesPerHour * hoursPerDay;

  if (allDom && allDow && allMonths) {
    return formatFrequency(executionsPerDay, "day");
  }

  if (allMonths && !allDow) {
    const daysPerWeek = parsed.daysOfWeek.size;
    const perWeek = executionsPerDay * daysPerWeek;
    return formatFrequency(perWeek, "week");
  }

  if (allMonths && allDow && !allDom) {
    const daysPerMonth = parsed.daysOfMonth.size;
    const perMonth = executionsPerDay * daysPerMonth;
    return formatFrequency(perMonth, "month");
  }

  if (!allMonths) {
    const monthsPerYear = parsed.months.size;
    const effectiveDays = allDom ? 30 : parsed.daysOfMonth.size;
    const perYear = executionsPerDay * effectiveDays * monthsPerYear;
    return formatFrequency(perYear, "year");
  }

  const avgDaysPerMonth = allDom ? 30.44 : parsed.daysOfMonth.size;
  const perMonth = Math.round(executionsPerDay * avgDaysPerMonth);
  return formatFrequency(perMonth, "month");
}

function formatFrequency(count: number, period: string): string {
  const rounded = count >= 100 ? Math.round(count / 10) * 10 : count;
  const approx = count >= 10 ? "~" : "";
  return `Runs ${approx}${rounded.toLocaleString()} time${rounded === 1 ? "" : "s"} per ${period}`;
}

/* ──────────────────────────────────────
   Relative Time Formatting
   ────────────────────────────────────── */

function formatRelativeTime(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs < 0) return "just now";

  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "in less than a minute";
  if (diffMinutes === 1) return "in 1 minute";
  if (diffMinutes < 60) return `in ${diffMinutes} minutes`;
  if (diffHours === 1) return "in 1 hour";
  if (diffHours < 24) {
    const remainingMins = diffMinutes % 60;
    if (remainingMins === 0) return `in ${diffHours} hours`;
    return `in ${diffHours}h ${remainingMins}m`;
  }
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 7) return `in ${diffDays} days`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `in ${weeks} week${weeks > 1 ? "s" : ""}`;
  }
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `in ${months} month${months > 1 ? "s" : ""}`;
  }
  return "in over a year";
}

function formatDateTime(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  return date.toLocaleString("en-US", options);
}

/* ──────────────────────────────────────
   Timeline SVG Component
   ────────────────────────────────────── */

interface TimelineProps {
  executions: Date[];
  now: Date;
  view: TimelineView;
}

function getTimelineRange(now: Date, view: TimelineView): { start: Date; end: Date; label: string } {
  const start = new Date(now);
  const end = new Date(now);

  switch (view) {
    case "hour":
      start.setMinutes(0, 0, 0);
      end.setMinutes(0, 0, 0);
      end.setHours(end.getHours() + 1);
      return { start, end, label: "Next hour" };
    case "day":
      start.setMinutes(0, 0, 0);
      end.setMinutes(0, 0, 0);
      end.setDate(end.getDate() + 1);
      return { start, end, label: "Next 24 hours" };
    case "week":
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 7);
      return { start, end, label: "Next 7 days" };
    case "month":
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() + 30);
      return { start, end, label: "Next 30 days" };
  }
}

function getTickLabels(start: Date, end: Date, view: TimelineView): Array<{ position: number; label: string }> {
  const ticks: Array<{ position: number; label: string }> = [];
  const totalMs = end.getTime() - start.getTime();

  switch (view) {
    case "hour": {
      for (let m = 0; m <= 60; m += 10) {
        const tickTime = new Date(start.getTime() + m * 60000);
        const pos = (tickTime.getTime() - start.getTime()) / totalMs;
        const label = `:${m.toString().padStart(2, "0")}`;
        ticks.push({ position: pos, label });
      }
      break;
    }
    case "day": {
      for (let h = 0; h <= 24; h += 3) {
        const tickTime = new Date(start);
        tickTime.setHours(start.getHours() + h, 0, 0, 0);
        const pos = (tickTime.getTime() - start.getTime()) / totalMs;
        if (pos >= 0 && pos <= 1) {
          const displayHour = tickTime.getHours();
          const period = displayHour >= 12 ? "p" : "a";
          const display = displayHour === 0 ? "12a" : displayHour > 12 ? `${displayHour - 12}${period}` : `${displayHour}${period}`;
          ticks.push({ position: pos, label: display });
        }
      }
      break;
    }
    case "week": {
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      for (let d = 0; d <= 7; d++) {
        const tickTime = new Date(start);
        tickTime.setDate(tickTime.getDate() + d);
        const pos = (tickTime.getTime() - start.getTime()) / totalMs;
        if (pos >= 0 && pos <= 1) {
          ticks.push({ position: pos, label: dayNames[tickTime.getDay()] });
        }
      }
      break;
    }
    case "month": {
      for (let d = 0; d <= 30; d += 5) {
        const tickTime = new Date(start);
        tickTime.setDate(tickTime.getDate() + d);
        const pos = (tickTime.getTime() - start.getTime()) / totalMs;
        if (pos >= 0 && pos <= 1) {
          ticks.push({ position: pos, label: `${tickTime.getMonth() + 1}/${tickTime.getDate()}` });
        }
      }
      break;
    }
  }

  return ticks;
}

function Timeline({ executions, now, view }: TimelineProps) {
  const { start, end, label } = getTimelineRange(now, view);
  const totalMs = end.getTime() - start.getTime();
  const ticks = getTickLabels(start, end, view);

  const points = executions
    .filter((d) => d.getTime() >= start.getTime() && d.getTime() <= end.getTime())
    .map((d) => ({
      position: (d.getTime() - start.getTime()) / totalMs,
      date: d,
    }));

  const nowPos = (now.getTime() - start.getTime()) / totalMs;
  const svgWidth = 800;
  const svgHeight = 80;
  const marginLeft = 20;
  const marginRight = 20;
  const trackWidth = svgWidth - marginLeft - marginRight;
  const trackY = 30;

  return (
    <div>
      <div class="mb-2 flex items-center justify-between">
        <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          {label}
        </span>
        <span class="text-[10px] text-[var(--color-text-muted)]">
          {points.length} execution{points.length !== 1 ? "s" : ""} in view
        </span>
      </div>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        class="w-full"
        style={{ minHeight: "60px" }}
      >
        {/* Track background */}
        <line
          x1={marginLeft}
          y1={trackY}
          x2={svgWidth - marginRight}
          y2={trackY}
          stroke="var(--color-border)"
          stroke-width="2"
          stroke-linecap="round"
        />

        {/* Tick marks */}
        {ticks.map((tick, i) => {
          const x = marginLeft + tick.position * trackWidth;
          return (
            <g key={i}>
              <line
                x1={x}
                y1={trackY - 6}
                x2={x}
                y2={trackY + 6}
                stroke="var(--color-border)"
                stroke-width="1"
              />
              <text
                x={x}
                y={trackY + 22}
                text-anchor="middle"
                fill="var(--color-text-muted)"
                font-size="9"
                font-family="var(--font-mono)"
              >
                {tick.label}
              </text>
            </g>
          );
        })}

        {/* Now indicator */}
        {nowPos >= 0 && nowPos <= 1 && (
          <g>
            <line
              x1={marginLeft + nowPos * trackWidth}
              y1={trackY - 10}
              x2={marginLeft + nowPos * trackWidth}
              y2={trackY + 10}
              stroke="var(--color-accent)"
              stroke-width="2"
              stroke-dasharray="3,2"
            />
            <text
              x={marginLeft + nowPos * trackWidth}
              y={trackY - 14}
              text-anchor="middle"
              fill="var(--color-accent)"
              font-size="8"
              font-family="var(--font-sans)"
              font-weight="600"
            >
              now
            </text>
          </g>
        )}

        {/* Execution dots */}
        {points.length <= 200 ? (
          points.map((point, i) => {
            const x = marginLeft + point.position * trackWidth;
            return (
              <circle
                key={i}
                cx={x}
                cy={trackY}
                r={points.length > 50 ? 2.5 : 4}
                fill="var(--color-primary)"
                opacity={0.85}
              >
                <title>{formatDateTime(point.date)}</title>
              </circle>
            );
          })
        ) : (
          /* For dense schedules, show a density bar */
          <DensityBar
            points={points}
            trackY={trackY}
            marginLeft={marginLeft}
            trackWidth={trackWidth}
            bucketCount={60}
          />
        )}
      </svg>
    </div>
  );
}

interface DensityBarProps {
  points: Array<{ position: number; date: Date }>;
  trackY: number;
  marginLeft: number;
  trackWidth: number;
  bucketCount: number;
}

function DensityBar({ points, trackY, marginLeft, trackWidth, bucketCount }: DensityBarProps) {
  const buckets = new Array(bucketCount).fill(0);
  for (const p of points) {
    const bucket = Math.min(Math.floor(p.position * bucketCount), bucketCount - 1);
    buckets[bucket]++;
  }
  const maxCount = Math.max(...buckets, 1);
  const barWidth = trackWidth / bucketCount;
  const maxBarHeight = 16;

  return (
    <g>
      {buckets.map((count, i) => {
        if (count === 0) return null;
        const height = (count / maxCount) * maxBarHeight;
        const x = marginLeft + i * barWidth;
        return (
          <rect
            key={i}
            x={x}
            y={trackY - height / 2}
            width={barWidth - 0.5}
            height={height}
            fill="var(--color-primary)"
            opacity={0.5 + (count / maxCount) * 0.4}
            rx="1"
          >
            <title>{count} executions</title>
          </rect>
        );
      })}
    </g>
  );
}

/* ──────────────────────────────────────
   Field Reference Diagram
   ────────────────────────────────────── */

function FieldReference() {
  return (
    <div class="rounded-lg border border-[var(--color-border)] p-4"
         style={{ backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)" }}>
      <pre
        class="text-xs leading-relaxed text-[var(--color-text-muted)]"
        style={{ fontFamily: "var(--font-mono)" }}
      >
{`\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 minute (0\u201359)
\u2502 \u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 hour (0\u201323)
\u2502 \u2502 \u250C\u2500\u2500\u2500\u2500\u2500\u2500 day of month (1\u201331)
\u2502 \u2502 \u2502 \u250C\u2500\u2500\u2500\u2500 month (1\u201312 or JAN\u2013DEC)
\u2502 \u2502 \u2502 \u2502 \u250C\u2500\u2500 day of week (0\u20137 or SUN\u2013SAT)
\u2502 \u2502 \u2502 \u2502 \u2502    0 and 7 both = Sunday
* * * * *`}
      </pre>
      <div class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-3">
        <div>
          <code class="rounded px-1 py-0.5 text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-mono)", backgroundColor: "rgba(79, 143, 247, 0.1)" }}>
            *
          </code>
          <span class="ml-1.5 text-[var(--color-text-muted)]">any value</span>
        </div>
        <div>
          <code class="rounded px-1 py-0.5 text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-mono)", backgroundColor: "rgba(79, 143, 247, 0.1)" }}>
            ,
          </code>
          <span class="ml-1.5 text-[var(--color-text-muted)]">list (1,3,5)</span>
        </div>
        <div>
          <code class="rounded px-1 py-0.5 text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-mono)", backgroundColor: "rgba(79, 143, 247, 0.1)" }}>
            -
          </code>
          <span class="ml-1.5 text-[var(--color-text-muted)]">range (1-5)</span>
        </div>
        <div>
          <code class="rounded px-1 py-0.5 text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-mono)", backgroundColor: "rgba(79, 143, 247, 0.1)" }}>
            /
          </code>
          <span class="ml-1.5 text-[var(--color-text-muted)]">step (*/5)</span>
        </div>
        <div>
          <code class="rounded px-1 py-0.5 text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-mono)", backgroundColor: "rgba(79, 143, 247, 0.1)" }}>
            MON-FRI
          </code>
          <span class="ml-1.5 text-[var(--color-text-muted)]">day names</span>
        </div>
        <div>
          <code class="rounded px-1 py-0.5 text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-mono)", backgroundColor: "rgba(79, 143, 247, 0.1)" }}>
            JAN-DEC
          </code>
          <span class="ml-1.5 text-[var(--color-text-muted)]">month names</span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Inline SVG Icons
   ────────────────────────────────────── */

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ──────────────────────────────────────
   Main Component
   ────────────────────────────────────── */

export default function CronParser() {
  const [expression, setExpression] = useState("*/5 * * * *");
  const [timelineView, setTimelineView] = useState<TimelineView>("day");
  const [showReference, setShowReference] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const fields = useMemo(() => expression.trim().split(/\s+/), [expression]);

  const parseResult = useMemo(() => parseCronExpression(expression), [expression]);

  const isValid = useMemo(() => !("message" in parseResult), [parseResult]);

  const error = useMemo((): CronValidationError | null => {
    if ("message" in parseResult) return parseResult;
    return null;
  }, [parseResult]);

  const description = useMemo(() => {
    if (!isValid) return "";
    return describeCron(expression);
  }, [expression, isValid]);

  const frequency = useMemo(() => {
    if (!isValid || "message" in parseResult) return "";
    return estimateFrequency(parseResult);
  }, [parseResult, isValid]);

  const executions = useMemo(() => {
    if (!isValid || "message" in parseResult) return [];
    return getNextExecutions(parseResult, 10, now);
  }, [parseResult, isValid, now]);

  const handlePreset = useCallback((e: JSX.TargetedEvent<HTMLSelectElement>) => {
    const index = parseInt(e.currentTarget.value, 10);
    if (isNaN(index) || index < 0) return;
    setExpression(PRESETS[index].expression);
  }, []);

  const handleFieldChange = useCallback((fieldIndex: number, value: string) => {
    const currentFields = expression.trim().split(/\s+/);
    while (currentFields.length < 5) currentFields.push("*");
    currentFields[fieldIndex] = value;
    setExpression(currentFields.join(" "));
  }, [expression]);

  const timelineViews: Array<{ value: TimelineView; label: string }> = [
    { value: "hour", label: "1H" },
    { value: "day", label: "24H" },
    { value: "week", label: "7D" },
    { value: "month", label: "30D" },
  ];

  return (
    <div class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
         style={{ boxShadow: "0 0 0 1px var(--color-border)" }}>

      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <ClockIcon />
          <span class="text-xs font-medium text-[var(--color-text-muted)]">Cron Parser</span>
          <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: "rgba(79, 143, 247, 0.3)",
                  color: "var(--color-primary)",
                }}>
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Presets
          </label>
          <select
            onChange={handlePreset}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
          >
            <option value="-1">Select a preset...</option>
            {PRESETS.map((preset, i) => (
              <option key={i} value={i}>{preset.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Cron Input with Field Labels */}
      <div class="border-b border-[var(--color-border)] px-4 py-4">
        <div class="flex flex-wrap items-end gap-2">
          {FIELD_LABELS.map((label, i) => (
            <div key={label} class="flex flex-col items-center">
              <label
                class="mb-1 text-[9px] font-medium uppercase tracking-wider"
                style={{
                  color: error && error.field === i ? "rgba(239, 68, 68, 0.9)" : "var(--color-text-muted)",
                }}
              >
                {label === "day of month" ? "dom" : label === "day of week" ? "dow" : label}
              </label>
              <input
                type="text"
                value={fields[i] || "*"}
                onInput={(e) => handleFieldChange(i, (e.target as HTMLInputElement).value)}
                class="w-16 rounded-lg border bg-[var(--color-bg)] px-2 py-2 text-center text-sm text-[var(--color-heading)] outline-none transition-colors focus:border-[var(--color-primary)]"
                style={{
                  fontFamily: "var(--font-mono)",
                  borderColor: error && error.field === i ? "rgba(239, 68, 68, 0.6)" : "var(--color-border)",
                }}
                spellcheck={false}
                autocorrect="off"
                autocapitalize="off"
              />
            </div>
          ))}
          <div class="flex flex-col items-start" style={{ flex: 1, minWidth: "120px" }}>
            <label class="mb-1 text-[9px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              full expression
            </label>
            <input
              type="text"
              value={expression}
              onInput={(e) => setExpression((e.target as HTMLInputElement).value)}
              class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-heading)] outline-none transition-colors focus:border-[var(--color-primary)]"
              style={{ fontFamily: "var(--font-mono)" }}
              placeholder="* * * * *"
              spellcheck={false}
              autocorrect="off"
              autocapitalize="off"
            />
          </div>
        </div>
        {error && (
          <p class="mt-2 text-xs" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
            {error.message}
          </p>
        )}
      </div>

      {/* Description + Frequency */}
      {isValid && (
        <div class="border-b border-[var(--color-border)] px-4 py-3">
          <p class="text-sm font-medium text-[var(--color-heading)]">
            {description}
          </p>
          <p class="mt-1 text-xs text-[var(--color-text-muted)]">
            {frequency}
          </p>
        </div>
      )}

      {/* Timeline */}
      {isValid && (
        <div class="border-b border-[var(--color-border)] px-4 py-4">
          <div class="mb-3 flex items-center justify-between">
            <span class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Timeline
            </span>
            <div class="flex rounded-lg border border-[var(--color-border)]">
              {timelineViews.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setTimelineView(value)}
                  class="px-2.5 py-1 text-[10px] font-semibold transition-colors"
                  style={{
                    backgroundColor: timelineView === value ? "rgba(79, 143, 247, 0.15)" : "transparent",
                    color: timelineView === value ? "var(--color-primary)" : "var(--color-text-muted)",
                    borderRight: value !== "month" ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Timeline
            executions={executions.length > 0 ? getTimelineExecutions(parseResult as ParsedCron, now, timelineView) : []}
            now={now}
            view={timelineView}
          />
        </div>
      )}

      {/* Next Executions */}
      {isValid && executions.length > 0 && (
        <div class="border-b border-[var(--color-border)] px-4 py-4">
          <div class="mb-3 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Next 10 executions
          </div>
          <div class="space-y-1.5">
            {executions.map((exec, i) => (
              <div
                key={i}
                class="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors"
                style={{
                  backgroundColor: i % 2 === 0
                    ? "color-mix(in srgb, var(--color-surface) 80%, transparent)"
                    : "transparent",
                }}
              >
                <div class="flex items-center gap-3">
                  <span
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{
                      backgroundColor: "rgba(79, 143, 247, 0.15)",
                      color: "var(--color-primary)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span class="text-[var(--color-heading)]" style={{ fontFamily: "var(--font-mono)" }}>
                    {formatDateTime(exec)}
                  </span>
                </div>
                <span class="shrink-0 text-xs text-[var(--color-text-muted)]">
                  {formatRelativeTime(exec, now)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Field Reference (collapsible) */}
      <div>
        <button
          onClick={() => setShowReference(!showReference)}
          class="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
        >
          <span class="flex items-center gap-2">
            <ReferenceIcon />
            Cron Syntax Reference
          </span>
          <ChevronIcon open={showReference} />
        </button>
        {showReference && (
          <div class="border-t border-[var(--color-border)] px-4 py-4">
            <FieldReference />
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Timeline execution helper
   ────────────────────────────────────── */

function getTimelineExecutions(parsed: ParsedCron, now: Date, view: TimelineView): Date[] {
  const { end } = getTimelineRange(now, view);
  const maxCount = 1500;
  const results: Date[] = [];
  const maxIterations = 525960;

  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate();
  let hour = now.getHours();
  let minute = now.getMinutes();

  let iterations = 0;
  const endTime = end.getTime();

  while (results.length < maxCount && iterations < maxIterations) {
    iterations++;

    if (minute > 59) { minute = 0; hour++; }
    if (hour > 23) { hour = 0; day++; }
    const maxDays = daysInMonth(year, month);
    if (day > maxDays) { day = 1; month++; }
    if (month > 12) { month = 1; year++; }

    const candidateTime = new Date(year, month - 1, day, hour, minute, 0).getTime();
    if (candidateTime > endTime) break;

    if (!parsed.months.has(month)) { day = 1; hour = 0; minute = 0; month++; continue; }
    const currentMaxDays = daysInMonth(year, month);
    if (day > currentMaxDays) { day = 1; month++; hour = 0; minute = 0; continue; }
    if (!parsed.daysOfMonth.has(day)) { day++; hour = 0; minute = 0; continue; }

    const date = new Date(year, month - 1, day);
    const dow = date.getDay();
    if (!parsed.daysOfWeek.has(dow)) { day++; hour = 0; minute = 0; continue; }
    if (!parsed.hours.has(hour)) { hour++; minute = 0; continue; }
    if (!parsed.minutes.has(minute)) { minute++; continue; }

    results.push(new Date(year, month - 1, day, hour, minute, 0));
    minute++;
  }

  return results;
}

/* ──────────────────────────────────────
   Icon
   ────────────────────────────────────── */

function ReferenceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
