const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Format a date string (YYYY or YYYY-MM) to a readable format.
 * "2023-12" → "Dec 2023", "2020" → "2020"
 */
export function formatDate(
  dateStr: string | null | undefined,
  yearOnly = false,
): string {
  if (!dateStr) return "Present";

  const parts = dateStr.split("-");
  const year = parts[0];

  if (yearOnly || parts.length === 1) return year;

  const monthIndex = parseInt(parts[1], 10) - 1;
  if (monthIndex >= 0 && monthIndex < 12) {
    return `${MONTH_NAMES[monthIndex]} ${year}`;
  }

  return year;
}

/**
 * Format experience highlight text, bolding metric values if present.
 */
export function formatHighlight(highlight: {
  text: string;
  metrics?: Record<string, string | number | null>;
}): string {
  let text = highlight.text;

  if (highlight.metrics) {
    for (const [, value] of Object.entries(highlight.metrics)) {
      if (value !== null && value !== undefined && String(value).trim()) {
        const strVal = String(value);
        // Bold the metric value in the text
        text = text.replace(strVal, `<strong>${strVal}</strong>`);
      }
    }
  }

  return text;
}
