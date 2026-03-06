/**
 * From-scratch Markdown-to-HTML parser supporting GFM features.
 *
 * Two-pass architecture:
 *   1. Block-level tokenizer: splits input into block tokens (headings, code blocks, lists, etc.)
 *   2. Inline parser: processes inline markup within each block token
 *
 * Security: Only produces whitelisted HTML tags. Strips all other HTML, event handlers, and scripts.
 */

/* ──────────────────────────────────────
   Safe HTML Tag Whitelist
   ────────────────────────────────────── */

const SAFE_TAGS = new Set([
  "br", "hr", "mark", "sub", "sup", "kbd", "abbr",
]);

const SELF_CLOSING_TAGS = new Set(["br", "hr"]);

/* ──────────────────────────────────────
   HTML Escaping
   ────────────────────────────────────── */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ──────────────────────────────────────
   Safe HTML Passthrough
   ────────────────────────────────────── */

function processSafeHtml(text: string): string {
  // Allow only whitelisted tags, strip everything else
  return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, (match, tagName: string) => {
    const lower = tagName.toLowerCase();
    if (!SAFE_TAGS.has(lower)) {
      return escapeHtml(match);
    }
    // For safe tags, only allow the tag itself (no attributes except title on abbr)
    const isClosing = match.startsWith("</");
    if (isClosing) {
      return `</${lower}>`;
    }
    if (lower === "abbr") {
      const titleMatch = match.match(/title\s*=\s*"([^"]*)"/i);
      if (titleMatch) {
        return `<abbr title="${escapeHtml(titleMatch[1])}">`;
      }
      return "<abbr>";
    }
    if (SELF_CLOSING_TAGS.has(lower)) {
      return `<${lower} />`;
    }
    return `<${lower}>`;
  });
}

/* ──────────────────────────────────────
   Escape Character Handling
   ────────────────────────────────────── */

const ESCAPE_PLACEHOLDER = "\x00ESC";

function handleEscapes(text: string): { text: string; escapes: string[] } {
  const escapes: string[] = [];
  const processed = text.replace(/\\([\\`*_{}[\]()#+\-.!~|>])/g, (_match, char: string) => {
    escapes.push(char);
    return `${ESCAPE_PLACEHOLDER}${escapes.length - 1}\x00`;
  });
  return { text: processed, escapes };
}

function restoreEscapes(text: string, escapes: string[]): string {
  return text.replace(new RegExp(`${ESCAPE_PLACEHOLDER}(\\d+)\x00`, "g"), (_match, idx: string) => {
    return escapeHtml(escapes[parseInt(idx, 10)] ?? "");
  });
}

/* ──────────────────────────────────────
   Inline Parser
   ────────────────────────────────────── */

function autoLinkUrls(html: string): string {
  // Split by HTML tags so we only auto-link text outside of tags
  const parts = html.split(/(<[^>]+>)/g);
  let insideAnchor = 0;
  return parts
    .map((part) => {
      if (part.startsWith("<")) {
        if (part.startsWith("<a ")) insideAnchor++;
        if (part === "</a>") insideAnchor = Math.max(0, insideAnchor - 1);
        return part;
      }
      if (insideAnchor > 0) return part;
      return part.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
      );
    })
    .join("");
}

function parseInline(raw: string): string {
  const { text, escapes } = handleEscapes(raw);

  let result = escapeHtml(text);

  // Images: ![alt](url) - must come before links
  result = result.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, alt: string, url: string, title?: string) => {
      const safeUrl = sanitizeUrl(decodeEscapedHtml(url));
      const titleAttr = title ? ` title="${title}"` : "";
      return `<img src="${safeUrl}" alt="${alt}"${titleAttr} />`;
    },
  );

  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, text: string, url: string, title?: string) => {
      const safeUrl = sanitizeUrl(decodeEscapedHtml(url));
      const titleAttr = title ? ` title="${title}"` : "";
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
    },
  );

  // Inline code (backtick) - must come before bold/italic to avoid conflicts
  result = result.replace(/`([^`]+)`/g, (_m, code: string) => {
    return `<code>${code}</code>`;
  });

  // Bold + italic: ***text*** or ___text___
  result = result.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  result = result.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>");

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<em>$1</em>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Auto-linking bare URLs (not already inside an <a> or <img> tag)
  // Split by existing HTML tags, only auto-link in text segments
  result = autoLinkUrls(result);

  // Restore safe HTML tags from the original text
  // We need to un-escape the safe tags that got HTML-escaped
  result = restoreSafeHtmlTags(result);

  // Restore escape characters
  result = restoreEscapes(result, escapes);

  return result;
}

function decodeEscapedHtml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function restoreSafeHtmlTags(text: string): string {
  // Un-escape whitelisted self-closing tags: &lt;br /&gt; or &lt;br&gt; or &lt;hr /&gt;
  for (const tag of SELF_CLOSING_TAGS) {
    const pattern = new RegExp(`&lt;${tag}\\s*/?&gt;`, "gi");
    text = text.replace(pattern, `<${tag} />`);
  }
  // Un-escape whitelisted open/close tags
  for (const tag of SAFE_TAGS) {
    if (SELF_CLOSING_TAGS.has(tag)) continue;
    // Opening tag (possibly with title attr for abbr)
    if (tag === "abbr") {
      text = text.replace(
        /&lt;abbr(?:\s+title=&quot;([^&]*)&quot;)?&gt;/gi,
        (_m, title?: string) => title ? `<abbr title="${title}">` : "<abbr>",
      );
    } else {
      const openPattern = new RegExp(`&lt;${tag}&gt;`, "gi");
      text = text.replace(openPattern, `<${tag}>`);
    }
    const closePattern = new RegExp(`&lt;/${tag}&gt;`, "gi");
    text = text.replace(closePattern, `</${tag}>`);
  }
  return text;
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  // Block javascript: and data: URLs (case-insensitive)
  if (/^(javascript|data|vbscript):/i.test(trimmed)) {
    return "#";
  }
  return encodeURI(decodeURI(trimmed));
}

/* ──────────────────────────────────────
   Block-Level Types
   ────────────────────────────────────── */

const BlockType = {
  Heading: 0,
  Paragraph: 1,
  CodeBlock: 2,
  Blockquote: 3,
  UnorderedList: 4,
  OrderedList: 5,
  Table: 6,
  HorizontalRule: 7,
  Html: 8,
} as const;

interface HeadingBlock {
  type: typeof BlockType.Heading;
  level: number;
  text: string;
  id: string;
}

interface ParagraphBlock {
  type: typeof BlockType.Paragraph;
  text: string;
}

interface CodeBlockBlock {
  type: typeof BlockType.CodeBlock;
  language: string;
  code: string;
}

interface BlockquoteBlock {
  type: typeof BlockType.Blockquote;
  content: string;
}

interface ListItem {
  text: string;
  checked?: boolean;
  children?: ListItem[];
}

interface UnorderedListBlock {
  type: typeof BlockType.UnorderedList;
  items: ListItem[];
}

interface OrderedListBlock {
  type: typeof BlockType.OrderedList;
  start: number;
  items: ListItem[];
}

type TableAlign = "left" | "center" | "right" | null;

interface TableBlock {
  type: typeof BlockType.Table;
  headers: string[];
  alignments: TableAlign[];
  rows: string[][];
}

interface HorizontalRuleBlock {
  type: typeof BlockType.HorizontalRule;
}

interface HtmlBlock {
  type: typeof BlockType.Html;
  html: string;
}

type Block =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlockBlock
  | BlockquoteBlock
  | UnorderedListBlock
  | OrderedListBlock
  | TableBlock
  | HorizontalRuleBlock
  | HtmlBlock;

/* ──────────────────────────────────────
   Block-Level Tokenizer
   ────────────────────────────────────── */

function tokenizeBlocks(input: string): Block[] {
  const lines = input.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block: ``` or ~~~
    const codeMatch = line.match(/^(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/);
    if (codeMatch) {
      const fence = codeMatch[1];
      const language = codeMatch[2] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        if (lines[i].trim() === fence.charAt(0).repeat(fence.length)) {
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: BlockType.CodeBlock,
        language,
        code: codeLines.join("\n"),
      });
      continue;
    }

    // Horizontal rule: ---, ***, ___  (3 or more, optionally with spaces)
    if (/^(\s*[-*_]\s*){3,}$/.test(line) && line.trim().length >= 3) {
      blocks.push({ type: BlockType.HorizontalRule });
      i++;
      continue;
    }

    // Heading: # to ######
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const text = headingMatch[2].replace(/\s+#+\s*$/, ""); // Remove trailing # chars
      blocks.push({
        type: BlockType.Heading,
        level: headingMatch[1].length,
        text,
        id: slugify(text),
      });
      i++;
      continue;
    }

    // Table: starts with | or has | separator
    if (isTableStart(lines, i)) {
      const tableBlock = parseTable(lines, i);
      if (tableBlock) {
        blocks.push(tableBlock.block);
        i = tableBlock.nextIndex;
        continue;
      }
    }

    // Blockquote: > text
    if (line.match(/^\s*>\s?/)) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].match(/^\s*>\s?/) || (lines[i].trim() !== "" && quoteLines.length > 0 && !lines[i].match(/^[#\-*+\d]/)))) {
        if (lines[i].match(/^\s*>\s?/)) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        } else {
          quoteLines.push(lines[i]);
        }
        i++;
      }
      blocks.push({
        type: BlockType.Blockquote,
        content: quoteLines.join("\n"),
      });
      continue;
    }

    // Unordered list: - item, * item, + item
    if (line.match(/^(\s*)([-*+])\s+/)) {
      const listResult = parseUnorderedList(lines, i);
      blocks.push(listResult.block);
      i = listResult.nextIndex;
      continue;
    }

    // Ordered list: 1. item, 2. item
    const olMatch = line.match(/^(\s*)(\d+)\.\s+/);
    if (olMatch) {
      const listResult = parseOrderedList(lines, i);
      blocks.push(listResult.block);
      i = listResult.nextIndex;
      continue;
    }

    // Paragraph: everything else
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !lines[i].match(/^(`{3,}|~{3,})/) &&
      !lines[i].match(/^\s*>\s/) &&
      !lines[i].match(/^(\s*[-*+])\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/) &&
      !isTableStart(lines, i) &&
      !/^(\s*[-*_]\s*){3,}$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({
        type: BlockType.Paragraph,
        text: paraLines.join("\n"),
      });
    }
  }

  return blocks;
}

/* ──────────────────────────────────────
   List Parsing Helpers
   ────────────────────────────────────── */

function parseUnorderedList(
  lines: string[],
  startIndex: number,
): { block: UnorderedListBlock; nextIndex: number } {
  const items: ListItem[] = [];
  let i = startIndex;

  while (i < lines.length) {
    const match = lines[i].match(/^(\s*)([-*+])\s+(.*)/);
    if (!match) break;

    const text = match[3];
    const item = parseListItemText(text);
    items.push(item);
    i++;

    // Collect continuation lines (indented, not a new list item at same level)
    while (i < lines.length && lines[i].match(/^\s+/) && !lines[i].match(/^\s*([-*+])\s+/) && !lines[i].match(/^\s*\d+\.\s+/) && lines[i].trim() !== "") {
      items[items.length - 1].text += " " + lines[i].trim();
      i++;
    }
  }

  return {
    block: { type: BlockType.UnorderedList, items },
    nextIndex: i,
  };
}

function parseOrderedList(
  lines: string[],
  startIndex: number,
): { block: OrderedListBlock; nextIndex: number } {
  const items: ListItem[] = [];
  let i = startIndex;
  let start = 1;

  const firstMatch = lines[i].match(/^\s*(\d+)\.\s+(.*)/);
  if (firstMatch) {
    start = parseInt(firstMatch[1], 10);
  }

  while (i < lines.length) {
    const match = lines[i].match(/^\s*\d+\.\s+(.*)/);
    if (!match) break;

    const item = parseListItemText(match[1]);
    items.push(item);
    i++;

    // Continuation lines
    while (i < lines.length && lines[i].match(/^\s+/) && !lines[i].match(/^\s*\d+\.\s+/) && !lines[i].match(/^\s*([-*+])\s+/) && lines[i].trim() !== "") {
      items[items.length - 1].text += " " + lines[i].trim();
      i++;
    }
  }

  return {
    block: { type: BlockType.OrderedList, start, items },
    nextIndex: i,
  };
}

function parseListItemText(text: string): ListItem {
  // Task list: [ ] or [x]
  const taskMatch = text.match(/^\[([ xX])\]\s+(.*)/);
  if (taskMatch) {
    return {
      text: taskMatch[2],
      checked: taskMatch[1].toLowerCase() === "x",
    };
  }
  return { text };
}

/* ──────────────────────────────────────
   Table Parsing
   ────────────────────────────────────── */

function isTableStart(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  const line = lines[index];
  const nextLine = lines[index + 1];
  // Header row must have pipes
  if (!line.includes("|")) return false;
  // Separator row must match pattern: |---|---|  or ---|---
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(nextLine);
}

function parseTable(
  lines: string[],
  startIndex: number,
): { block: TableBlock; nextIndex: number } | null {
  let i = startIndex;

  // Parse header row
  const headers = parseTableRow(lines[i]);
  i++;

  // Parse alignment row
  const alignCells = parseTableRow(lines[i]);
  const alignments: TableAlign[] = alignCells.map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(":");
    const right = trimmed.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
  i++;

  // Parse data rows
  const rows: string[][] = [];
  while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
    rows.push(parseTableRow(lines[i]));
    i++;
  }

  return {
    block: {
      type: BlockType.Table,
      headers,
      alignments,
      rows,
    },
    nextIndex: i,
  };
}

function parseTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

/* ──────────────────────────────────────
   Slug Generation (for heading IDs)
   ────────────────────────────────────── */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/* ──────────────────────────────────────
   Block-to-HTML Renderer
   ────────────────────────────────────── */

function renderBlock(block: Block): string {
  switch (block.type) {
    case BlockType.Heading:
      return `<h${block.level} id="${block.id}">${parseInline(block.text)}</h${block.level}>`;

    case BlockType.Paragraph: {
      const html = parseInline(block.text);
      // Handle line breaks: two trailing spaces or backslash before newline
      const withBreaks = html.replace(/  \n/g, "<br />\n").replace(/\\\n/g, "<br />\n");
      return `<p>${withBreaks}</p>`;
    }

    case BlockType.CodeBlock: {
      const escaped = escapeHtml(block.code);
      const langClass = block.language ? ` class="language-${escapeHtml(block.language)}"` : "";
      const langLabel = block.language
        ? `<span class="code-lang">${escapeHtml(block.language)}</span>`
        : "";
      return `<div class="code-block-wrapper">${langLabel}<pre><code${langClass}>${escaped}</code></pre></div>`;
    }

    case BlockType.Blockquote: {
      // Recursively parse blockquote content (supports nesting)
      const innerBlocks = tokenizeBlocks(block.content);
      const innerHtml = innerBlocks.map(renderBlock).join("\n");
      return `<blockquote>${innerHtml}</blockquote>`;
    }

    case BlockType.UnorderedList:
      return renderUnorderedList(block.items);

    case BlockType.OrderedList:
      return renderOrderedList(block.items, block.start);

    case BlockType.Table:
      return renderTable(block);

    case BlockType.HorizontalRule:
      return "<hr />";

    case BlockType.Html:
      return processSafeHtml(block.html);
  }
}

function renderUnorderedList(items: ListItem[]): string {
  const listItems = items.map((item) => {
    if (item.checked !== undefined) {
      const checkbox = item.checked
        ? '<input type="checkbox" checked disabled /> '
        : '<input type="checkbox" disabled /> ';
      return `<li class="task-item">${checkbox}${parseInline(item.text)}</li>`;
    }
    return `<li>${parseInline(item.text)}</li>`;
  });
  return `<ul>${listItems.join("")}</ul>`;
}

function renderOrderedList(items: ListItem[], start: number): string {
  const startAttr = start !== 1 ? ` start="${start}"` : "";
  const listItems = items.map((item) => `<li>${parseInline(item.text)}</li>`);
  return `<ol${startAttr}>${listItems.join("")}</ol>`;
}

function renderTable(block: TableBlock): string {
  const headerCells = block.headers
    .map((h, idx) => {
      const align = block.alignments[idx];
      const style = align ? ` style="text-align:${align}"` : "";
      return `<th${style}>${parseInline(h)}</th>`;
    })
    .join("");

  const bodyRows = block.rows
    .map((row) => {
      const cells = row
        .map((cell, idx) => {
          const align = block.alignments[idx];
          const style = align ? ` style="text-align:${align}"` : "";
          return `<td${style}>${parseInline(cell)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

/* ──────────────────────────────────────
   Public API
   ────────────────────────────────────── */

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export interface ParseResult {
  html: string;
  headings: Heading[];
}

export function parseMarkdown(input: string): ParseResult {
  const blocks = tokenizeBlocks(input);
  const headings: Heading[] = [];

  for (const block of blocks) {
    if (block.type === BlockType.Heading) {
      headings.push({ level: block.level, text: block.text, id: block.id });
    }
  }

  const html = blocks.map(renderBlock).join("\n");
  return { html, headings };
}

export function countStats(text: string): {
  words: number;
  characters: number;
  lines: number;
  readingTimeMinutes: number;
} {
  const lines = text.split("\n").length;
  const characters = text.length;
  const words = text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(words / 200));
  return { words, characters, lines, readingTimeMinutes };
}
