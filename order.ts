// deno task order <cmd>
//   list                                  show all auto-orders
//   buy  <sym> <lot> <price> [sellAt]     buy limit; optional auto-sell price after fill
//   sell <sym> <lot> <price>              sell limit
//   stop <uuid>                           pause (resumable)
//   resume <uuid>                         resume a paused order
//   cancel <uuid>                         delete permanently
//   dbuy  <sym> <lot> <price>             DIRECT buy (instant, hits book now, via WS)
//   dsell <sym> <lot> <price>             DIRECT sell (instant)
//
// buy/sell = auto-order (conditional, fires on a price trigger).
// dbuy/dsell = direct order (instant fill). Nothing fires unless you pass a command.
import {
    controlAutoOrder,
    createAutoOrder,
    deleteAutoOrder,
    listAutoOrders,
    statusLabel,
} from "./data/growinAutoOrder.ts";
import { placeDirectOrder } from "./data/growinOrderWs.ts";
import { fmtPrice } from "./util/print.ts";

const [cmd, ...a] = Deno.args;

const list = async () => {
    const orders = await listAutoOrders();
    if (!orders.length) return console.log("(no auto-orders)");
    for (const o of orders) {
        const px = o.quotePrice ?? o.targetUpper;
        console.log(
            `  ${o.symbol.padEnd(6)} ${o.side.padEnd(4)} ${o.lot} lot @ ${px ? fmtPrice(px) : "-"} | ${statusLabel(o.status)} | ${o.validFrom}..${o.validUntil}` +
            (o.buyRef ? " | sell-after-buy" : "") +
            `  ${o.uuid}`,
        );
    }
};

switch (cmd) {
    case "list":
        await list();
        break;
    case "buy":
    case "sell": {
        const [sym, lot, price, sellAt] = a;
        if (!sym || !lot || !price) {
            console.error(`usage: deno task order ${cmd} <sym> <lot> <price>${cmd === "buy" ? " [sellAt]" : ""}`);
            Deno.exit(1);
        }
        const { uuid, payload } = await createAutoOrder({
            symbol: sym,
            side: cmd === "buy" ? "BUY" : "SELL",
            lot: Number(lot),
            price: Number(price),
            sellAfterBuyPrice: sellAt ? Number(sellAt) : undefined,
        });
        console.log("sent payload:", JSON.stringify(payload));
        console.log(`created auto-order ${uuid}`);
        await list();
        break;
    }
    case "stop":
    case "resume": {
        if (!a[0]) { console.error(`usage: deno task order ${cmd} <uuid>`); Deno.exit(1); }
        await controlAutoOrder(a[0], cmd === "stop" ? 2 : 1);
        console.log(`${cmd} ok`);
        break;
    }
    case "cancel": {
        if (!a[0]) { console.error("usage: deno task order cancel <uuid>"); Deno.exit(1); }
        await deleteAutoOrder(a[0]);
        console.log("deleted");
        break;
    }
    case "dbuy":
    case "dsell": {
        const [sym, lot, price] = a;
        if (!sym || !lot || !price) {
            console.error(`usage: deno task order ${cmd} <sym> <lot> <price>`);
            Deno.exit(1);
        }
        const ack = await placeDirectOrder({
            symbol: sym,
            side: cmd === "dbuy" ? "BUY" : "SELL",
            lot: Number(lot),
            price: Number(price),
        });
        console.log(
            `${ack.status === "B" ? "BUY" : "SELL"} accepted: ${ack.symbol} ${ack.lot} lot @ ${fmtPrice(ack.price)} | order ${ack.marketOrderId} (#${ack.orderId})`,
        );
        break;
    }
    default:
        console.error("commands: list | buy | sell | stop | resume | cancel | dbuy | dsell");
        Deno.exit(1);
}
