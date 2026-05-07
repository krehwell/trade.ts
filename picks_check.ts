import { fetchCandles } from "./utils/yahooFetch.ts";

const tickers = [""];

for (const ticker of tickers) {
  const candles = await fetchCandles({ symbol: ticker, range: "15d", interval: "1d" });
  if (candles && candles.length > 0) {
    const recent = candles.slice(-7);
    console.log(`\n=== ${ticker} ===`);
    for (const c of recent) {
      const date = new Date(c.date * 1000).toISOString().slice(0, 10);
      const chg = ((c.close - c.open) / c.open * 100).toFixed(2);
      const highPct = ((c.high - c.open) / c.open * 100).toFixed(2);
      const lowPct = ((c.low - c.open) / c.open * 100).toFixed(2);
      console.log(`${date} O:${c.open} H:${c.high} L:${c.low} C:${c.close} Vol:${c.volume} Chg:${chg}% Hi:${highPct}% Lo:${lowPct}%`);
    }
  } else {
    console.log(`${ticker}: no candle data`);
  }
}

// IHSG
console.log("\n=== IHSG (^JKSE) ===");
const ihsg = await fetchCandles({ symbol: "^JKSE", range: "30d", interval: "1d" });
if (ihsg && ihsg.length > 0) {
  const recent = ihsg.slice(-10);
  for (const c of recent) {
    const date = new Date(c.date * 1000).toISOString().slice(0, 10);
    const chg = ((c.close - c.open) / c.open * 100).toFixed(2);
    console.log(`${date} O:${c.open} H:${c.high} L:${c.low} C:${c.close} Chg:${chg}%`);
  }
}
