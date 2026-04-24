import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fmt, today, daysAgo, subDays, parseTFDays } from "../utils/date.ts";

Deno.test("fmt formats date as YYYY-MM-DD", () => {
    assertEquals(fmt(new Date("2024-01-15T10:30:00Z")), "2024-01-15");
    assertEquals(fmt(new Date("2023-12-01T00:00:00Z")), "2023-12-01");
});

Deno.test("today returns current date string", () => {
    const result = today();
    assertEquals(result.length, 10);
    assertEquals(result[4], "-");
    assertEquals(result[7], "-");
});

Deno.test("daysAgo returns correct past date", () => {
    const result = daysAgo(0);
    assertEquals(result, today());

    const sevenAgo = daysAgo(7);
    const diff = new Date(today()).getTime() - new Date(sevenAgo).getTime();
    assertEquals(diff, 7 * 24 * 60 * 60 * 1000);
});

Deno.test("subDays subtracts days from a Date", () => {
    const base = new Date("2024-03-15T00:00:00Z");
    const result = subDays(base, 10);
    assertEquals(fmt(result), "2024-03-05");

    // Does not mutate original
    assertEquals(fmt(base), "2024-03-15");
});

Deno.test("parseTFDays parses timeframe strings", () => {
    assertEquals(parseTFDays("1d"), 1);
    assertEquals(parseTFDays("5d"), 5);
    assertEquals(parseTFDays("1w"), 7);
    assertEquals(parseTFDays("2w"), 14);
    assertEquals(parseTFDays("1m"), 30);
    assertEquals(parseTFDays("3m"), 90);
});

Deno.test("parseTFDays throws on invalid input", () => {
    assertThrows(() => parseTFDays("abc"));
    assertThrows(() => parseTFDays("1x"));
    assertThrows(() => parseTFDays(""));
});
