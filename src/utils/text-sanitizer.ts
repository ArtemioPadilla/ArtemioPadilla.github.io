/**
 * Sanitize text for PDF generation — handles problematic Unicode characters.
 * Ported from pdf-generator.js
 */
export function sanitizeText(text: string): string {
  if (!text) return "";

  let result = text;

  // Convert various dash types to standard hyphen
  result = result.replace(/[\u2013\u2014\u2015\u2012]/g, "-");

  // Handle superscript notations (10⁻⁹ → 10^-9)
  result = result.replace(
    /(\d)[\u207B\u2070-\u2079\u00B2\u00B3\u00B9]+/g,
    (match, digit) => {
      const superscriptMap: Record<string, string> = {
        "\u2070": "0",
        "\u00B9": "1",
        "\u00B2": "2",
        "\u00B3": "3",
        "\u2074": "4",
        "\u2075": "5",
        "\u2076": "6",
        "\u2077": "7",
        "\u2078": "8",
        "\u2079": "9",
        "\u207B": "-",
      };
      let converted = digit + "^";
      for (let i = digit.length; i < match.length; i++) {
        converted += superscriptMap[match[i]] ?? match[i];
      }
      return converted;
    },
  );

  // Remove zero-width spaces and other invisible characters
  result = result.replace(/[\u200B\u200C\u200D\uFEFF]/g, "");

  // Normalize Unicode (NFKD) and strip combining marks
  result = result.normalize("NFKD");

  // Collapse spaced-out letters from encoding issues
  result = result.replace(/([A-Za-z])\s(?=[A-Za-z]\s[A-Za-z])/g, "$1");

  return result;
}

/**
 * Fix paragraphs where characters were spaced out by encoding.
 */
export function fixSpacedOutParagraph(text: string): string {
  if (!text) return "";

  // Detect if most characters have spaces between them
  const spaceRatio =
    (text.match(/ /g) || []).length / Math.max(text.length, 1);
  if (spaceRatio > 0.3) {
    // Likely spaced-out text: remove spaces between single characters
    return text.replace(/(\w) (?=\w( |$))/g, "$1");
  }

  return text;
}

/**
 * Wrap text to fit within a specified width (in mm) for PDF generation.
 * Returns an array of lines.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  charWidthFactor = 0.5,
): string[] {
  if (!text) return [""];

  const avgCharWidth = fontSize * charWidthFactor * 0.352778; // pt to mm
  const charsPerLine = Math.floor(maxWidth / avgCharWidth);
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > charsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
