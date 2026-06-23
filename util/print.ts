// Number formatting

export const fmtNum = (n: number): string => {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "";
    if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}T`;
    if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
    return `${sign}${abs}`;
};

export const fmtPct = (n: number): string =>
    `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export const fmtPrice = (n: number): string =>
    n.toLocaleString("id-ID");

// Section headers

export const printHeader = (title: string) => {
    const line = "═".repeat(60);
    console.log(`\n${line}`);
    console.log(`  ${title}`);
    console.log(line);
};

export const printSubHeader = (title: string) => {
    console.log(`\n── ${title} ${"─".repeat(Math.max(0, 55 - title.length))}`);
};

// Generic table

export interface Column {
    label: string;
    width: number;
    align?: "left" | "right";
}

export const printTable = ({
    columns,
    rows,
    limit,
}: {
    columns: Column[];
    rows: string[][];
    limit?: number;
}) => {
    const header = columns
        .map((c) => c.label[c.align === "right" ? "padStart" : "padEnd"](c.width))
        .join("  ");
    console.log(header);
    console.log(columns.map((c) => "─".repeat(c.width)).join("──"));

    const display = limit ? rows.slice(0, limit) : rows;
    for (const row of display) {
        const line = columns
            .map((c, i) =>
                (row[i] ?? "")[c.align === "right" ? "padStart" : "padEnd"](c.width)
            )
            .join("  ");
        console.log(line);
    }

    if (limit && rows.length > limit) {
        console.log(`  ... and ${rows.length - limit} more`);
    }
};

// Stock list (compact columns)

export const printStockList = ({
    stocks,
    colWidth = 8,
    maxCols = 8,
}: {
    stocks: string[];
    colWidth?: number;
    maxCols?: number;
}) => {
    for (let i = 0; i < stocks.length; i += maxCols) {
        const chunk = stocks.slice(i, i + maxCols);
        console.log(chunk.map((s) => s.padEnd(colWidth)).join(""));
    }
};

// Flow summary

export const printFlowSummary = ({
    a,
    b,
    intersection,
}: {
    a: string[];
    b: string[];
    intersection: { symbol: string; rankA: number; rankB: number }[];
}) => {
    printHeader("RESULT SUMMARY");
    console.log(`  Flow A (technical):    ${a.length} stocks`);
    console.log(`  Flow B (bandarmology): ${b.length} stocks`);
    console.log(`  Intersection:          ${intersection.length} stocks`);

    if (intersection.length > 0) {
        printSubHeader("HIGH CONVICTION — Technical + Smart Money");
        printTable({
            columns: [
                { label: "#", width: 4, align: "right" },
                { label: "Stock", width: 8 },
                { label: "A Rank", width: 7, align: "right" },
                { label: "B Rank", width: 7, align: "right" },
            ],
            rows: intersection.map((r, i) => [
                String(i + 1),
                r.symbol,
                `#${r.rankA}`,
                `#${r.rankB}`,
            ]),
        });
    } else {
        console.log("\n  No intersection found.");
    }
};

// Broker flow table

import type { StockFlow } from "../data/fetchBrokerActivity.ts";

export const printFlowTable = ({
    title,
    flow,
    limit = 20,
    side = "buy",
}: {
    title: string;
    flow: StockFlow;
    limit?: number;
    side?: "buy" | "sell";
}) => {
    const sorted = Object.entries(flow)
        .filter(([, v]) => (side === "buy" ? v > 0 : v < 0))
        .sort((a, b) => (side === "buy" ? b[1] - a[1] : a[1] - b[1]));

    printSubHeader(`${title} (${sorted.length} stocks)`);
    printTable({
        columns: [
            { label: "#", width: 4, align: "right" },
            { label: "Stock", width: 8 },
            { label: "Net Flow", width: 12, align: "right" },
        ],
        rows: sorted.map(([sym, val], i) => [
            String(i + 1),
            sym,
            fmtNum(val),
        ]),
        limit,
    });
};

// Multi timeframe flow comparison

export const printMultiTFFlow = ({
    title,
    flows,
    stocks,
    limit = 20,
}: {
    title: string;
    flows: Record<string, StockFlow>;
    stocks?: string[];
    limit?: number;
}) => {
    const tfs = Object.keys(flows);
    const allStocks = stocks ??
        [...new Set(tfs.flatMap((tf) => Object.keys(flows[tf])))];

    const rows = allStocks
        .map((sym) => ({
            sym,
            vals: tfs.map((tf) => flows[tf][sym] ?? 0),
        }))
        .sort((a, b) => b.vals[0] - a.vals[0]);

    printSubHeader(title);
    printTable({
        columns: [
            { label: "#", width: 4, align: "right" },
            { label: "Stock", width: 8 },
            ...tfs.map((tf) => ({ label: tf, width: 12, align: "right" as const })),
        ],
        rows: rows.map(({ sym, vals }, i) => [
            String(i + 1),
            sym,
            ...vals.map(fmtNum),
        ]),
        limit,
    });
};
