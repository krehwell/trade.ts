import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchDailyPrice } from "../fetchStockPrice.ts";
import { today, daysAgo } from "../utils/date.ts";

Deno.test("fetchDailyPrice - BBCA 30 days", async () => {
    const candles = await fetchDailyPrice({
        symbol: "BBCA",
        from: today(),
        to: daysAgo(30),
    });
    console.log("  BBCA daily candles:", candles.length);
    assertEquals(candles.length > 0, true, "Should return candles");
    const latest = candles[0];
    console.log("  ✓ Latest:", latest.date, "O:", latest.open, "H:", latest.high,
        "L:", latest.low, "C:", latest.close, "V:", latest.volume);
    assertEquals(typeof latest.close, "number");
    assertEquals(latest.close > 0, true);
});

Deno.test("fetchDailyPrice - BBRI 180 days (for indicators)", async () => {
    const candles = await fetchDailyPrice({
        symbol: "BBRI",
        from: today(),
        to: daysAgo(180),
    });
    console.log("  BBRI 180d candles:", candles.length);
    assertEquals(candles.length > 50, true, "Need at least 50 candles for indicators");

    // Verify newest-first ordering
    const firstDate = new Date(candles[0].date);
    const lastDate = new Date(candles[candles.length - 1].date);
    console.log("  Date range:", candles[candles.length - 1].date, "→", candles[0].date);
    assertEquals(firstDate >= lastDate, true, "Should be newest-first");
});

Deno.test("fetchDailyPrice - nonexistent symbol returns empty", async () => {
    const candles = await fetchDailyPrice({
        symbol: "ZZZZZ",
        from: today(),
        to: daysAgo(7),
    });
    assertEquals(candles.length, 0);
    console.log("  ✓ Nonexistent symbol correctly returns empty array");
});
