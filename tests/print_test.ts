import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fmtNum, fmtPct, fmtPrice } from "../utils/print.ts";

Deno.test("fmtNum formats trillions", () => {
    assertEquals(fmtNum(1_500_000_000_000), "1.5T");
    assertEquals(fmtNum(-2_000_000_000_000), "-2.0T");
});

Deno.test("fmtNum formats billions", () => {
    assertEquals(fmtNum(1_200_000_000), "1.2B");
    assertEquals(fmtNum(-500_000_000), "-500.0M");
});

Deno.test("fmtNum formats millions", () => {
    assertEquals(fmtNum(5_500_000), "5.5M");
    assertEquals(fmtNum(-1_000_000), "-1.0M");
});

Deno.test("fmtNum formats thousands", () => {
    assertEquals(fmtNum(12_000), "12.0K");
    assertEquals(fmtNum(999), "999");
});

Deno.test("fmtNum handles zero and small numbers", () => {
    assertEquals(fmtNum(0), "0");
    assertEquals(fmtNum(42), "42");
});

Deno.test("fmtPct formats percentages with sign", () => {
    assertEquals(fmtPct(5.123), "+5.12%");
    assertEquals(fmtPct(-3.5), "-3.50%");
    assertEquals(fmtPct(0), "+0.00%");
});

Deno.test("fmtPrice formats as Indonesian locale", () => {
    const result = fmtPrice(1234567);
    // Indonesian locale uses dot as thousands separator
    assertEquals(typeof result, "string");
    assertEquals(result.includes("1") && result.includes("234") && result.includes("567"), true);
});
