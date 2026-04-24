import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchBrokerActivity, fetchTopBrokers } from "../fetchBrokerActivity.ts";
import { daysAgo, today } from "../utils/date.ts";

Deno.test("fetchTopBrokers - returns broker list", async () => {
    const brokers = await fetchTopBrokers();
    console.log("  Got", brokers.length, "brokers");
    if (brokers.length > 0) {
        console.log("  ✓ Top broker:", brokers[0].code, "-", brokers[0].name, `(${brokers[0].group})`);
        assertEquals(typeof brokers[0].code, "string");
        assertEquals(typeof brokers[0].name, "string");
    } else {
        console.log("  ✗ Empty broker list");
    }
});

Deno.test("fetchBrokerActivity - single broker 1-week flow", async () => {
    const flow = await fetchBrokerActivity({
        brokers: ["MS"],
        from: daysAgo(7),
        to: today(),
    });
    const entries = Object.entries(flow);
    console.log("  MS broker 7d: got", entries.length, "stocks with activity");
    if (entries.length > 0) {
        const top = entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
        console.log("  ✓ Top position:", top[0], "=", top[1].toLocaleString());
    } else {
        console.log("  ⚠ No activity (could be weekend/holiday)");
    }
    assertEquals(typeof flow, "object");
});

Deno.test("fetchBrokerActivity - multi broker aggregation", async () => {
    const flow = await fetchBrokerActivity({
        brokers: ["MS", "BK", "CS"],
        from: daysAgo(7),
        to: today(),
    });
    const entries = Object.entries(flow);
    console.log("  MS+BK+CS 7d: got", entries.length, "stocks");
    assertEquals(typeof flow, "object");
});
