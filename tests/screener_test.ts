import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchScreener } from "../fetchScreener.ts";
import { ITEMS } from "../utils/screenerItems.ts";

Deno.test("fetchScreener - no filters (all stocks)", async () => {
    const res = await fetchScreener({ perPage: 5 });
    console.log("  Total stocks:", res.totalRows);
    console.log("  Got page:", res.page, "with", res.stocks.length, "stocks");
    if (res.stocks.length > 0) {
        console.log("  ✓ First stock:", res.stocks[0].symbol, "-", res.stocks[0].name);
        assertEquals(typeof res.stocks[0].symbol, "string");
    } else {
        console.log("  ✗ No stocks returned");
    }
});

Deno.test("fetchScreener - with basic filters", async () => {
    const res = await fetchScreener({
        filters: [
            { id: ITEMS.PRICE, operator: ">", value: 100 },
            { id: ITEMS.MARKET_CAP, operator: ">", value: 1_000_000_000_000 },
        ],
        perPage: 10,
    });
    console.log("  Filtered stocks (price>100, mcap>1T):", res.totalRows);
    if (res.stocks.length > 0) {
        console.log("  ✓ First:", res.stocks[0].symbol);
        // Check that results contain the queried items
        const hasPrice = ITEMS.PRICE.toString() in res.stocks[0].results;
        const hasMcap = ITEMS.MARKET_CAP.toString() in res.stocks[0].results;
        console.log("  Has price data:", hasPrice, "| Has mcap data:", hasMcap);
    }
    assertEquals(typeof res.totalRows, "number");
});

Deno.test("fetchScreener - bandar items as filters", async () => {
    // Screener only returns data for items used as filters, not just in sequence
    const res = await fetchScreener({
        filters: [
            { id: ITEMS.VALUE_MA50, operator: ">", value: 1_000_000_000 },
            { id: ITEMS.BANDAR_VALUE, operator: "!=", value: 0 },
        ],
        perPage: 5,
        orderCol: ITEMS.BANDAR_VALUE,
        orderType: "desc",
    });
    console.log("  Liquid stocks with bandar data:", res.totalRows);
    if (res.stocks.length > 0) {
        const s = res.stocks[0];
        const bandarVal = s.results[ITEMS.BANDAR_VALUE];
        console.log("  ✓", s.symbol, "bandar:", bandarVal);
        assertEquals(typeof bandarVal, "number");
    }
});
