import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeSignals, computeVolumeEMARatio } from "../indicators.ts";
import type { DailyCandle } from "../fetchStockPrice.ts";

// Helper: generate synthetic candles (newest-first, as API returns)
const makeCandles = (count: number, basePrice = 1000): DailyCandle[] => {
    const candles: DailyCandle[] = [];
    for (let i = 0; i < count; i++) {
        const price = basePrice + Math.sin(i * 0.1) * 50 + (i * 0.5);
        candles.push({
            date: `2024-01-${String(count - i).padStart(2, "0")}`,
            open: price - 5,
            high: price + 10,
            low: price - 10,
            close: price,
            volume: 1_000_000 + Math.random() * 500_000,
            value: 1_000_000_000,
            frequency: 500,
            foreignBuy: 100_000_000,
            foreignSell: 80_000_000,
            foreignFlow: 20_000_000,
            shareOutstanding: 1_000_000_000,
        });
    }
    return candles;
};

Deno.test("computeSignals returns null with insufficient data", () => {
    const candles = makeCandles(30);
    const result = computeSignals({ candles });
    assertEquals(result, null);
});

Deno.test("computeSignals returns valid signals with enough data", () => {
    const candles = makeCandles(120);
    const result = computeSignals({ candles });
    assertNotEquals(result, null);
    if (!result) return;

    // RSI should be between 0-100
    assertEquals(result.rsi >= 0 && result.rsi <= 100, true);
    // Score should be a number
    assertEquals(typeof result.score, "number");
    // Price should be a positive number
    assertEquals(result.price > 0, true);
    // MA50 should exist
    assertEquals(isNaN(result.ma50), false);
    // MACD components should be defined
    assertEquals(isNaN(result.macdLine), false);
    assertEquals(isNaN(result.macdSignal), false);
    assertEquals(isNaN(result.macdHist), false);
    // Bollinger bands should be ordered
    assertEquals(result.bollingerUpper > result.bollingerMiddle, true);
    assertEquals(result.bollingerMiddle > result.bollingerLower, true);
});

Deno.test("computeVolumeEMARatio returns 0 with insufficient data", () => {
    const volumes = Array(30).fill(1_000_000);
    assertEquals(computeVolumeEMARatio({ volumes }), 0);
});

Deno.test("computeVolumeEMARatio returns ~1 for flat volumes", () => {
    const volumes = Array(100).fill(1_000_000);
    const ratio = computeVolumeEMARatio({ volumes });
    // Flat volume = EMA5 ≈ EMA50, ratio ≈ 1.0
    assertEquals(ratio > 0.95 && ratio < 1.05, true);
});

Deno.test("computeVolumeEMARatio detects volume spike", () => {
    const volumes = Array(80).fill(1_000_000);
    // Add a volume spike at the end
    for (let i = 0; i < 5; i++) volumes.push(5_000_000);
    const ratio = computeVolumeEMARatio({ volumes });
    // Should be significantly above 1
    assertEquals(ratio > 1.5, true);
});
