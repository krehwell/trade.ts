// What's bandar buying on a given day? One date, all stocks, SM flow ranked.
// Today is empty until ~6PM WIB (EOD finalization), so pass a past date meanwhile.
//   deno task bandar-top [date=today] [n=15]
import { fetchBrokerActivity, SM_BROKERS } from "./data/fetchBrokerActivity.ts";
import { fetchDailyMulti } from "./data/stockbitCandles.ts";
import { today } from "./util/date.ts";

const date = Deno.args[0] ?? today();
const n = Number(Deno.args[1] ?? 15);

console.log(`\n=== SM net flow ${date} (brokers: ${SM_BROKERS.join(",")}) ===`);

const flow = await fetchBrokerActivity({ brokers: SM_BROKERS, from: date, to: date });
const ranked = Object.entries(flow).sort((a, b) => b[1] - a[1]);
if (ranked.length === 0) {
    console.log("No data. Broker activity finalizes ~6PM WIB, try yesterday's date.");
    Deno.exit(0);
}

const top = ranked.slice(0, n);
const bottom = ranked.slice(-n).reverse();
const syms = [...new Set([...top, ...bottom].map(([s]) => s))];
const candles = await fetchDailyMulti({ symbols: syms, days: 10 });

const chgOn = (sym: string): string => {
    const cs = candles[sym] ?? [];
    const i = cs.findIndex((c) => c.date === date);
    const cur = i >= 0 ? cs[i] : cs[cs.length - 1];
    const prev = i > 0 ? cs[i - 1] : cs[cs.length - 2];
    if (!cur || !prev) return "     ?";
    const chg = ((cur.close - prev.close) / prev.close) * 100;
    return `${String(cur.close).padStart(6)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`;
};

const row = ([sym, v]: [string, number]) => {
    const fB = v / 1e9;
    const bar = "█".repeat(Math.min(25, Math.round(Math.abs(fB) / 4)));
    console.log(`${sym.padEnd(6)} ${((fB >= 0 ? "+" : "") + fB.toFixed(1) + "B").padStart(8)}  ${chgOn(sym)}  ${bar}`);
};

console.log(`\n--- TOP ${n} INFLOW ---`);
console.log("sym       flow   close    chg%");
top.forEach(row);
console.log(`\n--- TOP ${n} OUTFLOW ---`);
bottom.forEach(row);
