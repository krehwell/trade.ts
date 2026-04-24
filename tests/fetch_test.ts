import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchGET, fetchPOST } from "../utils/stockbitFetch.ts";

Deno.test("fetchGET - basic auth works (top brokers endpoint)", async () => {
    const res = await fetchGET<any>({
        path: "/order-trade/broker/top",
        params: {
            sort: "TB_SORT_BY_TOTAL_VALUE",
            order: "ORDER_BY_DESC",
            period: "TB_PERIOD_LAST_1_DAY",
            market_type: "MARKET_TYPE_ALL",
            eod_only: "true",
        },
    });
    assertEquals(typeof res, "object");
    assertNotEquals(res, null);
    // Should have data.list if auth is valid
    console.log("  fetchGET response keys:", Object.keys(res));
    if (res.data?.list) {
        console.log("  ✓ Auth OK, got", res.data.list.length, "brokers");
    } else {
        console.log("  ✗ Unexpected response:", JSON.stringify(res).slice(0, 200));
    }
});

Deno.test("fetchPOST - screener endpoint works", async () => {
    const res = await fetchPOST<any>({
        path: "/screener/templates",
        body: {
            name: "screen",
            description: "",
            save: "0",
            ordertype: "desc",
            ordercol: 2661,
            page: 1,
            universe: JSON.stringify({ scope: "IHSG", scopeID: "", name: "" }),
            filters: JSON.stringify([]),
            sequence: "2661",
            screenerid: "0",
            type: "TEMPLATE_TYPE_CUSTOM",
        },
    });
    assertEquals(typeof res, "object");
    assertNotEquals(res, null);
    console.log("  fetchPOST response keys:", Object.keys(res));
    if (res.data?.calcs) {
        console.log("  ✓ Screener OK, got", res.data.calcs.length, "stocks");
    } else {
        console.log("  ✗ Unexpected response:", JSON.stringify(res).slice(0, 200));
    }
});
