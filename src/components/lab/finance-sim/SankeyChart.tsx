import { useMemo } from "preact/hooks";
import {
  sankey as d3Sankey,
  sankeyLinkHorizontal,
  type SankeyGraph,
  type SankeyNode,
  type SankeyLink,
} from "d3-sankey";

// ─── Types ─────────────────────────────────────────────────────────────

interface FlowItem {
  name: string;
  amount: number;
}

interface Props {
  incomes: FlowItem[];
  expenses: FlowItem[];
  loanPayments: FlowItem[];
  savings: number;
  width?: number;
  height?: number;
}

// ─── Node / Link types for d3-sankey ──────────────────────────────────

interface SNode {
  name: string;
  category: "income" | "hub" | "expense" | "loan" | "savings";
}

interface SLink {
  source: number;
  target: number;
  value: number;
}

// ─── Category colors ──────────────────────────────────────────────────

const COLORS = {
  income: "#3fb68a",
  hub: "#d4a843",
  expense: "#e05c6a",
  loan: "#4a9eff",
  savings: "#d4a843",
} as const;

const LINK_OPACITY = 0.35;

function categoryColor(cat: SNode["category"]): string {
  return COLORS[cat];
}

// ─── Formatting ───────────────────────────────────────────────────────

function fmtShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e6) return sign + "$" + (abs / 1e6).toFixed(1) + "M";
  if (abs >= 1e3) return sign + "$" + (abs / 1e3).toFixed(0) + "K";
  return sign + "$" + abs.toFixed(0);
}

// ─── Component ────────────────────────────────────────────────────────

export default function SankeyChart({
  incomes,
  expenses,
  loanPayments,
  savings,
  width: propWidth,
  height: propHeight,
}: Props) {
  // Build the Sankey graph data
  const graphData = useMemo(() => {
    const nodes: SNode[] = [];
    const links: SLink[] = [];

    const totalIncome = incomes.reduce((s, i) => s + i.amount, 0);
    if (totalIncome <= 0) return null;

    // -- Income source nodes (left column)
    incomes.forEach((inc) => {
      nodes.push({ name: inc.name, category: "income" });
    });

    // -- Central hub node
    const hubIndex = nodes.length;
    nodes.push({ name: "Total Income", category: "hub" });

    // -- Links: income sources -> hub
    incomes.forEach((inc, i) => {
      links.push({ source: i, target: hubIndex, value: inc.amount });
    });

    // -- Outflow nodes (right column)
    let outflowTotal = 0;

    expenses.forEach((exp) => {
      const idx = nodes.length;
      nodes.push({ name: exp.name, category: "expense" });
      links.push({ source: hubIndex, target: idx, value: exp.amount });
      outflowTotal += exp.amount;
    });

    loanPayments.forEach((lp) => {
      const idx = nodes.length;
      nodes.push({ name: lp.name, category: "loan" });
      links.push({ source: hubIndex, target: idx, value: lp.amount });
      outflowTotal += lp.amount;
    });

    // -- Savings node (only if positive)
    const effectiveSavings = Math.max(0, totalIncome - outflowTotal);
    const savingsAmount = savings > 0 ? savings : effectiveSavings;
    if (savingsAmount > 0) {
      const idx = nodes.length;
      nodes.push({ name: "Net Savings", category: "savings" });
      links.push({ source: hubIndex, target: idx, value: savingsAmount });
    }

    return { nodes, links };
  }, [incomes, expenses, loanPayments, savings]);

  // Compute dimensions
  const nodeCount = graphData ? graphData.nodes.length : 0;
  const width = propWidth ?? 700;
  const height = propHeight ?? Math.max(300, nodeCount * 32);

  if (!graphData || graphData.links.length === 0) {
    return (
      <div class="flex items-center justify-center py-8 font-mono text-xs text-[var(--color-text-muted)]">
        No cash flow data for this year.
      </div>
    );
  }

  // Compute Sankey layout
  const layout = useMemo(() => {
    const margin = { top: 16, right: 140, bottom: 16, left: 140 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const sankeyGenerator = d3Sankey<SNode, SLink>()
      .nodeId((_d, i) => i)
      .nodeWidth(14)
      .nodePadding(14)
      .nodeSort(null)
      .extent([
        [margin.left, margin.top],
        [margin.left + innerWidth, margin.top + innerHeight],
      ]);

    const graph: SankeyGraph<SNode, SLink> = sankeyGenerator({
      nodes: graphData.nodes.map((n) => ({ ...n })),
      links: graphData.links.map((l) => ({ ...l })),
    });

    return { graph, margin };
  }, [graphData, width, height]);

  const { graph } = layout;
  const pathGenerator = sankeyLinkHorizontal();

  return (
    <div class="overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ maxWidth: "100%", height: "auto" }}
      >
        {/* Links */}
        <g fill="none">
          {(graph.links as SankeyLink<SNode, SLink>[]).map((link, i) => {
            const sourceNode = link.source as SankeyNode<SNode, SLink>;
            const targetNode = link.target as SankeyNode<SNode, SLink>;
            // Color by target category (outflow determines color), except income->hub uses income color
            const cat = sourceNode.category === "income" ? "income" : targetNode.category;
            const color = categoryColor(cat);
            const d = pathGenerator(link as any);
            if (!d) return null;
            return (
              <path
                key={i}
                d={d}
                stroke={color}
                stroke-opacity={LINK_OPACITY}
                stroke-width={Math.max(1, (link as any).width ?? 1)}
              >
                <title>
                  {sourceNode.name} → {targetNode.name}: {fmtShort((link as any).value ?? 0)}
                </title>
              </path>
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {(graph.nodes as SankeyNode<SNode, SLink>[]).map((node, i) => {
            const x0 = node.x0 ?? 0;
            const x1 = node.x1 ?? 0;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? 0;
            const color = categoryColor(node.category);
            const nodeHeight = y1 - y0;
            const nodeWidth = x1 - x0;

            // Determine label position: left-side nodes get label on the left, right-side on the right
            const isLeft = node.category === "income";
            const isHub = node.category === "hub";

            // Compute value for display
            let nodeValue = 0;
            if (node.sourceLinks) {
              nodeValue = (node.sourceLinks as any[]).reduce((s: number, l: any) => s + (l.value ?? 0), 0);
            }
            if (nodeValue === 0 && node.targetLinks) {
              nodeValue = (node.targetLinks as any[]).reduce((s: number, l: any) => s + (l.value ?? 0), 0);
            }

            return (
              <g key={i}>
                <rect
                  x={x0}
                  y={y0}
                  width={nodeWidth}
                  height={Math.max(1, nodeHeight)}
                  fill={color}
                  opacity={0.85}
                  rx={2}
                >
                  <title>
                    {node.name}: {fmtShort(nodeValue)}
                  </title>
                </rect>

                {/* Label */}
                <text
                  x={isLeft ? x0 - 6 : isHub ? (x0 + x1) / 2 : x1 + 6}
                  y={(y0 + y1) / 2}
                  dy="0.35em"
                  text-anchor={isLeft ? "end" : isHub ? "middle" : "start"}
                  fill="var(--color-text-muted)"
                  font-size="11"
                  font-family="ui-monospace, monospace"
                >
                  {node.name}
                </text>

                {/* Value below label for hub, next to label for others */}
                {!isHub && (
                  <text
                    x={isLeft ? x0 - 6 : x1 + 6}
                    y={(y0 + y1) / 2 + 14}
                    dy="0.35em"
                    text-anchor={isLeft ? "end" : "start"}
                    fill={color}
                    font-size="10"
                    font-family="ui-monospace, monospace"
                    font-weight="600"
                  >
                    {fmtShort(nodeValue)}
                  </text>
                )}

                {isHub && (
                  <text
                    x={(x0 + x1) / 2}
                    y={y0 - 8}
                    text-anchor="middle"
                    fill={color}
                    font-size="12"
                    font-family="ui-monospace, monospace"
                    font-weight="700"
                  >
                    {fmtShort(nodeValue)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div class="mt-2 flex flex-wrap gap-4 px-2">
        {(
          [
            { label: "Income", color: COLORS.income },
            { label: "Expenses", color: COLORS.expense },
            { label: "Loan Payments", color: COLORS.loan },
            { label: "Savings", color: COLORS.savings },
          ] as const
        ).map((item) => (
          <div key={item.label} class="flex items-center gap-1.5">
            <span
              class="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: item.color }}
            />
            <span class="font-mono text-[10px] text-[var(--color-text-muted)]">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
