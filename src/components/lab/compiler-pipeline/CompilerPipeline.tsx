import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type TokenType = "keyword" | "number" | "identifier" | "operator" | "paren" | "equals" | "eof" | "unknown";

interface Token {
  type: TokenType;
  value: string;
  pos: number;
  len: number;
}

type ASTNode =
  | { kind: "Program"; body: ASTNode[] }
  | { kind: "LetDecl"; name: string; value: ASTNode }
  | { kind: "BinaryExpr"; op: string; left: ASTNode; right: ASTNode }
  | { kind: "NumericLiteral"; value: number }
  | { kind: "Identifier"; name: string }
  | { kind: "Error"; message: string; pos: number };

interface EvalStep {
  nodeLabel: string;
  result: number | string;
}

type Stage = "idle" | "lexer" | "parser" | "evaluator";

/* ══════════════════════════════════════════════════════════
   Lexer
   ══════════════════════════════════════════════════════════ */

const KEYWORDS = new Set(["let"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }

    if (/[0-9]/.test(source[i])) {
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i])) i++;
      tokens.push({ type: "number", value: source.slice(start, i), pos: start, len: i - start });
      continue;
    }

    if (/[a-zA-Z_]/.test(source[i])) {
      const start = i;
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) i++;
      const word = source.slice(start, i);
      tokens.push({ type: KEYWORDS.has(word) ? "keyword" : "identifier", value: word, pos: start, len: i - start });
      continue;
    }

    if ("+-*/".includes(source[i])) {
      tokens.push({ type: "operator", value: source[i], pos: i, len: 1 });
      i++; continue;
    }

    if (source[i] === "=") {
      tokens.push({ type: "equals", value: "=", pos: i, len: 1 });
      i++; continue;
    }

    if ("()".includes(source[i])) {
      tokens.push({ type: "paren", value: source[i], pos: i, len: 1 });
      i++; continue;
    }

    tokens.push({ type: "unknown", value: source[i], pos: i, len: 1 });
    i++;
  }

  tokens.push({ type: "eof", value: "", pos: i, len: 0 });
  return tokens;
}

/* ══════════════════════════════════════════════════════════
   Parser — Recursive Descent
   ══════════════════════════════════════════════════════════ */

class ParseError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: "eof" as TokenType, value: "", pos: 0, len: 0 };
  }

  private eat(expected?: TokenType): Token {
    const tok = this.peek();
    if (expected && tok.type !== expected) {
      throw new ParseError(`Expected ${expected}, got "${tok.value}"`, tok.pos);
    }
    this.pos++;
    return tok;
  }

  parse(): ASTNode {
    const body: ASTNode[] = [];
    while (this.peek().type !== "eof") {
      body.push(this.parseStatement());
    }
    return { kind: "Program", body };
  }

  private parseStatement(): ASTNode {
    if (this.peek().type === "keyword" && this.peek().value === "let") {
      return this.parseLetDecl();
    }
    return this.parseExpr();
  }

  private parseLetDecl(): ASTNode {
    this.eat("keyword");
    const nameTok = this.eat("identifier");
    this.eat("equals");
    const value = this.parseExpr();
    return { kind: "LetDecl", name: nameTok.value, value };
  }

  private parseExpr(): ASTNode {
    return this.parseAddSub();
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();
    while (this.peek().type === "operator" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.eat("operator").value;
      const right = this.parseMulDiv();
      left = { kind: "BinaryExpr", op, left, right };
    }
    return left;
  }

  private parseMulDiv(): ASTNode {
    let left = this.parsePrimary();
    while (this.peek().type === "operator" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.eat("operator").value;
      const right = this.parsePrimary();
      left = { kind: "BinaryExpr", op, left, right };
    }
    return left;
  }

  private parsePrimary(): ASTNode {
    const tok = this.peek();

    if (tok.type === "number") {
      this.eat();
      return { kind: "NumericLiteral", value: parseFloat(tok.value) };
    }

    if (tok.type === "identifier") {
      this.eat();
      return { kind: "Identifier", name: tok.value };
    }

    if (tok.type === "paren" && tok.value === "(") {
      this.eat();
      const expr = this.parseExpr();
      if (this.peek().type === "paren" && this.peek().value === ")") {
        this.eat();
      } else {
        throw new ParseError("Expected closing parenthesis", this.peek().pos);
      }
      return expr;
    }

    throw new ParseError(`Unexpected token: "${tok.value}"`, tok.pos);
  }
}

function parseTokens(tokens: Token[]): ASTNode {
  try {
    const filtered = tokens.filter((t) => t.type !== "eof");
    filtered.push({ type: "eof", value: "", pos: 0, len: 0 });
    const parser = new Parser(filtered);
    return parser.parse();
  } catch (e) {
    if (e instanceof ParseError) {
      return { kind: "Error", message: e.message, pos: e.pos };
    }
    return { kind: "Error", message: String(e), pos: 0 };
  }
}

/* ══════════════════════════════════════════════════════════
   Evaluator
   ══════════════════════════════════════════════════════════ */

function evaluate(ast: ASTNode): { steps: EvalStep[]; finalResult: number | string } {
  const steps: EvalStep[] = [];
  const env: Record<string, number> = {};

  function evalNode(node: ASTNode): number | string {
    if (node.kind === "NumericLiteral") {
      steps.push({ nodeLabel: `Literal: ${node.value}`, result: node.value });
      return node.value;
    }

    if (node.kind === "Identifier") {
      const val = env[node.name];
      if (val === undefined) {
        steps.push({ nodeLabel: `Lookup: ${node.name}`, result: "undefined" });
        return `undefined (${node.name})`;
      }
      steps.push({ nodeLabel: `Lookup: ${node.name}`, result: val });
      return val;
    }

    if (node.kind === "BinaryExpr") {
      const l = evalNode(node.left);
      const r = evalNode(node.right);
      if (typeof l !== "number" || typeof r !== "number") {
        const errMsg = `Cannot compute ${l} ${node.op} ${r}`;
        steps.push({ nodeLabel: errMsg, result: "error" });
        return errMsg;
      }
      let result: number;
      switch (node.op) {
        case "+": result = l + r; break;
        case "-": result = l - r; break;
        case "*": result = l * r; break;
        case "/": result = r === 0 ? 0 : l / r; break;
        default: result = 0;
      }
      steps.push({ nodeLabel: `${l} ${node.op} ${r}`, result });
      return result;
    }

    if (node.kind === "LetDecl") {
      const val = evalNode(node.value);
      if (typeof val === "number") {
        env[node.name] = val;
        steps.push({ nodeLabel: `let ${node.name} = ${val}`, result: val });
        return val;
      }
      steps.push({ nodeLabel: `let ${node.name} = ${val}`, result: String(val) });
      return val;
    }

    if (node.kind === "Program") {
      let last: number | string = 0;
      for (const stmt of node.body) {
        last = evalNode(stmt);
      }
      return last;
    }

    if (node.kind === "Error") {
      steps.push({ nodeLabel: `Error: ${node.message}`, result: "error" });
      return node.message;
    }

    return 0;
  }

  const finalResult = evalNode(ast);
  return { steps, finalResult };
}

/* ══════════════════════════════════════════════════════════
   AST Tree Drawing (Canvas)
   ══════════════════════════════════════════════════════════ */

interface TreeNode {
  label: string;
  children: TreeNode[];
  x: number;
  y: number;
  width: number;
}

function astToTree(node: ASTNode): TreeNode {
  switch (node.kind) {
    case "Program":
      return { label: "Program", children: node.body.map(astToTree), x: 0, y: 0, width: 0 };
    case "LetDecl":
      return { label: `let ${node.name}`, children: [astToTree(node.value)], x: 0, y: 0, width: 0 };
    case "BinaryExpr":
      return { label: node.op, children: [astToTree(node.left), astToTree(node.right)], x: 0, y: 0, width: 0 };
    case "NumericLiteral":
      return { label: String(node.value), children: [], x: 0, y: 0, width: 0 };
    case "Identifier":
      return { label: node.name, children: [], x: 0, y: 0, width: 0 };
    case "Error":
      return { label: `ERR`, children: [], x: 0, y: 0, width: 0 };
  }
}

function layoutTree(root: TreeNode, centerX: number, startY: number, hGap: number, vGap: number): void {
  function computeWidth(n: TreeNode): number {
    if (n.children.length === 0) { n.width = 1; return 1; }
    let total = 0;
    for (const child of n.children) total += computeWidth(child);
    n.width = Math.max(total, 1);
    return n.width;
  }
  computeWidth(root);

  function position(n: TreeNode, cx: number, y: number): void {
    n.x = cx;
    n.y = y;
    if (n.children.length === 0) return;
    let startX = cx - (n.width * hGap) / 2;
    for (const child of n.children) {
      const childCx = startX + (child.width * hGap) / 2;
      position(child, childCx, y + vGap);
      startX += child.width * hGap;
    }
  }
  position(root, centerX, startY);
}

function drawTree(ctx: CanvasRenderingContext2D, node: TreeNode, highlightIdx: number, counter: { v: number }): void {
  const nodeW = 56;
  const nodeH = 24;
  const idx = counter.v;
  counter.v++;
  const isHl = idx === highlightIdx;

  for (const child of node.children) {
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y + nodeH / 2);
    ctx.lineTo(child.x, child.y - nodeH / 2);
    ctx.stroke();
  }

  const rx = node.x - nodeW / 2;
  const ry = node.y - nodeH / 2;

  ctx.fillStyle = isHl ? "rgba(79,143,247,0.3)" : "#111111";
  ctx.strokeStyle = isHl ? "#4f8ff7" : "#27272a";
  ctx.lineWidth = isHl ? 2 : 1;
  ctx.beginPath();
  ctx.roundRect(rx, ry, nodeW, nodeH, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = isHl ? "#ffffff" : "#e4e4e7";
  ctx.font = "bold 11px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = node.label.length > 8 ? node.label.slice(0, 7) + ".." : node.label;
  ctx.fillText(label, node.x, node.y);

  for (const child of node.children) {
    drawTree(ctx, child, highlightIdx, counter);
  }
}

function ASTCanvas({ ast, highlightStep }: { ast: ASTNode | null; highlightStep: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ast) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const tree = astToTree(ast);
    layoutTree(tree, rect.width / 2, 28, 75, 48);
    drawTree(ctx, tree, highlightStep, { v: 0 });
  }, [ast, highlightStep]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "220px",
        borderRadius: "8px",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

const PRESETS: { label: string; code: string }[] = [
  { label: "3 + 4 * 2", code: "3 + 4 * 2" },
  { label: "let x = 10", code: "let x = 10" },
  { label: "(1 + 2) * (3 + 4)", code: "(1 + 2) * (3 + 4)" },
  { label: "let y = 5 + 3 * 2", code: "let y = 5 + 3 * 2" },
  { label: "10 / 2 - 3", code: "10 / 2 - 3" },
];

const TOKEN_COLORS: Record<TokenType, string> = {
  keyword: "#a855f7",
  number: "#f59e0b",
  identifier: "#4f8ff7",
  operator: "#ef4444",
  paren: "#ec4899",
  equals: "#a1a1aa",
  eof: "#555555",
  unknown: "#ef4444",
};

export default function CompilerPipeline() {
  const [source, setSource] = useState("3 + 4 * 2");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [ast, setAst] = useState<ASTNode | null>(null);
  const [evalSteps, setEvalSteps] = useState<EvalStep[]>([]);
  const [finalResult, setFinalResult] = useState<number | string>("");
  const [currentStage, setCurrentStage] = useState<Stage>("idle");
  const [evalStep, setEvalStep] = useState(-1);
  const [parseError, setParseError] = useState("");
  const [autoPlaying, setAutoPlaying] = useState(false);
  const autoRef = useRef(false);

  const compile = useCallback(() => {
    setParseError("");
    setEvalStep(-1);
    setAutoPlaying(false);
    autoRef.current = false;

    const toks = tokenize(source);
    setTokens(toks);
    setCurrentStage("lexer");

    setTimeout(() => {
      const tree = parseTokens(toks);
      if (tree.kind === "Error") {
        setParseError(tree.message);
        setAst(null);
        setEvalSteps([]);
        setFinalResult("");
        setCurrentStage("parser");
        return;
      }
      setAst(tree);
      setCurrentStage("parser");

      setTimeout(() => {
        const { steps, finalResult: fr } = evaluate(tree);
        setEvalSteps(steps);
        setFinalResult(fr);
        setCurrentStage("evaluator");
      }, 400);
    }, 400);
  }, [source]);

  const playEval = useCallback(() => {
    if (evalSteps.length === 0) return;
    setAutoPlaying(true);
    autoRef.current = true;
    setEvalStep(0);

    let step = 0;
    const interval = setInterval(() => {
      if (!autoRef.current) { clearInterval(interval); return; }
      step++;
      if (step >= evalSteps.length) {
        autoRef.current = false;
        setAutoPlaying(false);
        clearInterval(interval);
        return;
      }
      setEvalStep(step);
    }, 700);
  }, [evalSteps]);

  const stageBox = (stage: Stage, label: string) => {
    const isActive = currentStage === stage;
    const isPast = (
      (stage === "lexer" && (currentStage === "parser" || currentStage === "evaluator")) ||
      (stage === "parser" && currentStage === "evaluator")
    );
    return (
      <div
        style={{
          borderRadius: "8px",
          padding: "8px 16px",
          fontSize: "12px",
          fontWeight: "700",
          textAlign: "center",
          border: isActive ? "2px solid var(--color-primary)" : isPast ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
          background: isActive ? "rgba(79,143,247,0.12)" : isPast ? "rgba(52,211,153,0.06)" : "var(--color-surface)",
          color: isActive ? "var(--color-primary)" : isPast ? "var(--color-accent)" : "var(--color-text-muted)",
        }}
      >
        {label}
      </div>
    );
  };

  const btnPrimary = {
    borderRadius: "4px",
    padding: "6px 16px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#ffffff",
    background: "var(--color-primary)",
    border: "none",
    cursor: "pointer",
  };

  const btnOutline = {
    borderRadius: "4px",
    padding: "5px 10px",
    fontSize: "12px",
    color: "var(--color-text-muted)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    cursor: "pointer",
  };

  const displayTokens = tokens.filter((t) => t.type !== "eof");

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Code Input */}
      <div>
        <label style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
          Source Code (expressions, let bindings):
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          <textarea
            value={source}
            onInput={(e) => setSource((e.target as HTMLTextAreaElement).value)}
            rows={2}
            style={{
              flex: 1,
              borderRadius: "6px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              padding: "8px 12px",
              fontSize: "14px",
              fontFamily: "monospace",
              color: "var(--color-text)",
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <button onClick={compile} style={btnPrimary}>Compile</button>
            {evalSteps.length > 0 && (
              <button onClick={playEval} disabled={autoPlaying} style={{ ...btnOutline, opacity: autoPlaying ? 0.4 : 1 }}>
                Evaluate
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Presets */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: "var(--color-text-muted)", marginRight: "4px" }}>Presets:</span>
        {PRESETS.map((p, i) => (
          <button
            key={i}
            onClick={() => {
              setSource(p.code);
              setCurrentStage("idle");
              setTokens([]);
              setAst(null);
              setEvalSteps([]);
              setParseError("");
              setFinalResult("");
              setEvalStep(-1);
            }}
            style={btnOutline}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Pipeline Stages */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr auto 1fr", gap: "6px", alignItems: "center" }}>
        {stageBox("idle", "Source")}
        <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontWeight: "700" }}>-&gt;</div>
        {stageBox("lexer", "Lexer")}
        <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontWeight: "700" }}>-&gt;</div>
        {stageBox("parser", "Parser")}
        <div style={{ textAlign: "center", color: "var(--color-text-muted)", fontWeight: "700" }}>-&gt;</div>
        {stageBox("evaluator", "Evaluator")}
      </div>

      {/* Parse Error */}
      {parseError && (
        <div style={{
          borderRadius: "6px",
          border: "1px solid rgba(239,68,68,0.4)",
          background: "rgba(239,68,68,0.08)",
          padding: "10px 14px",
          fontSize: "13px",
          color: "#ef4444",
          fontFamily: "monospace",
        }}>
          Parse Error: {parseError}
        </div>
      )}

      {/* Stage 1: Token Stream */}
      {displayTokens.length > 0 && currentStage !== "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Stage 1: Token Stream
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
            {displayTokens.map((tok, i) => (
              <div
                key={i}
                style={{
                  borderRadius: "4px",
                  padding: "4px 8px",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  fontWeight: "600",
                  border: `1px solid ${TOKEN_COLORS[tok.type]}40`,
                  background: `${TOKEN_COLORS[tok.type]}15`,
                  color: TOKEN_COLORS[tok.type],
                }}
                title={`Type: ${tok.type} | Pos: ${tok.pos}`}
              >
                {tok.value}
                <span style={{ fontSize: "9px", marginLeft: "4px", opacity: 0.6 }}>{tok.type}</span>
              </div>
            ))}
          </div>

          {/* Highlighted source */}
          <div style={{
            borderRadius: "6px",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            padding: "10px 14px",
            fontFamily: "monospace",
            fontSize: "14px",
            letterSpacing: "0.5px",
            lineHeight: "2",
          }}>
            {source.split("").map((ch, i) => {
              const tok = displayTokens.find((t) => i >= t.pos && i < t.pos + t.len);
              return (
                <span key={i} style={{ color: tok ? TOKEN_COLORS[tok.type] : "var(--color-text-muted)" }}>
                  {ch}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Stage 2: AST */}
      {ast && (currentStage === "parser" || currentStage === "evaluator") && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Stage 2: Abstract Syntax Tree
          </div>
          <ASTCanvas ast={ast} highlightStep={evalStep} />
        </div>
      )}

      {/* Stage 3: Step-by-step Evaluation */}
      {evalSteps.length > 0 && currentStage === "evaluator" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Stage 3: Step-by-step Evaluation
            </div>
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <button
                onClick={() => setEvalStep((p) => Math.max(-1, p - 1))}
                style={btnOutline}
              >
                Prev
              </button>
              <span style={{ fontSize: "11px", color: "var(--color-text-muted)", padding: "0 6px" }}>
                {Math.max(0, evalStep + 1)} / {evalSteps.length}
              </span>
              <button
                onClick={() => setEvalStep((p) => Math.min(evalSteps.length - 1, p + 1))}
                style={btnOutline}
              >
                Next
              </button>
            </div>
          </div>

          <div style={{
            borderRadius: "8px",
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            padding: "10px",
            fontFamily: "monospace",
            fontSize: "12px",
          }}>
            {evalSteps.map((step, i) => (
              <div
                key={i}
                style={{
                  padding: "4px 8px",
                  borderRadius: "3px",
                  marginBottom: "2px",
                  background: i === evalStep ? "rgba(79,143,247,0.12)" : "transparent",
                  borderLeft: i === evalStep ? "3px solid var(--color-primary)" : "3px solid transparent",
                  color: i <= evalStep ? "var(--color-text)" : "var(--color-text-muted)",
                  opacity: i > evalStep + 1 ? 0.3 : 1,
                }}
              >
                <span style={{ color: "var(--color-text-muted)", marginRight: "8px" }}>{i + 1}.</span>
                {step.nodeLabel}
                {i <= evalStep && (
                  <span style={{ color: "var(--color-accent)", marginLeft: "8px" }}>
                    = {step.result}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Final Result */}
          {evalStep >= evalSteps.length - 1 && (
            <div style={{
              borderRadius: "6px",
              padding: "10px 14px",
              background: "rgba(52,211,153,0.08)",
              border: "1px solid rgba(52,211,153,0.3)",
              fontSize: "14px",
              fontWeight: "700",
              color: "var(--color-accent)",
              fontFamily: "monospace",
            }}>
              Result: {finalResult}
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div style={{ fontSize: "11px", color: "var(--color-text-muted)", lineHeight: "1.5" }}>
        Supports: arithmetic (<code style={{ color: "#ef4444" }}>+ - * /</code>), parentheses, and{" "}
        <code style={{ color: "#a855f7" }}>let</code> bindings. The parser implements recursive descent with proper operator precedence (* / before + -).
      </div>
    </div>
  );
}
