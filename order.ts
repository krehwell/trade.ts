// deno task order <cmd>
//   list                                  show all auto-orders
//   buy  <sym> <lot> <cond> <exec> [sell=<price>]   conditional buy
//   sell <sym> <lot> <cond> <exec>                  conditional sell
//        <cond> = le=<price> | ge=<price>   (fire when price ≤ / ≥ that level)
//        <exec> = at=<price> | tick=<n>     (place at price, or n ticks from trigger)
//        shorthand: buy/sell <sym> <lot> <price>  (buy = le+at price; sell = ge + tick 0)
//   stop <uuid>                           pause (resumable)
//   resume <uuid>                         resume a paused order
//   cancel <uuid>                         delete permanently
//   dbuy  <sym> <lot> <price>             DIRECT buy (instant, hits book now, via WS)
//   dsell <sym> <lot> <price>             DIRECT sell (instant)
//   dwithdraw <marketId> <internalId> <sequence>          cancel a resting direct order
//   damend    <marketId> <internalId> <sequence> <price>  change a resting order's price
//
// buy/sell = auto-order (conditional, fires on a price trigger).
// dbuy/dsell = direct order (instant fill). dwithdraw/damend take the three ids
// dbuy/dsell print. Nothing fires unless you pass a command.
import {
    type Condition,
    controlAutoOrder,
    createAutoOrder,
    deleteAutoOrder,
    type Execute,
    listAutoOrders,
    statusLabel,
} from "./data/growinAutoOrder.ts";
import { amendDirectOrder, placeDirectOrder, withdrawDirectOrder } from "./data/growinOrderWs.ts";
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
        const side = cmd === "buy" ? "BUY" : "SELL";
        const [sym, lot, ...rest] = a;
        const usage = () => {
            console.error(`usage: deno task order ${cmd} <sym> <lot> <cond> <exec> [sell=<price>]`);
            console.error(`  <cond> le=<price>|ge=<price>   <exec> at=<price>|tick=<n>   shorthand: <sym> <lot> <price>`);
            Deno.exit(1);
        };
        if (!sym || !lot) usage();
        // parse cond/exec tokens; a bare number is shorthand (buy le+at, sell ge+tick0)
        let condition: Condition | undefined;
        let execute: Execute | undefined;
        let sellAt: number | undefined;
        for (const tok of rest) {
            let m: RegExpMatchArray | null;
            if ((m = tok.match(/^le=(\d+(?:\.\d+)?)$/))) condition = { op: "le", price: Number(m[1]) };
            else if ((m = tok.match(/^ge=(\d+(?:\.\d+)?)$/))) condition = { op: "ge", price: Number(m[1]) };
            else if ((m = tok.match(/^at=(\d+(?:\.\d+)?)$/))) execute = { mode: "price", value: Number(m[1]) };
            else if ((m = tok.match(/^tick=(-?\d+)$/))) execute = { mode: "tick", value: Number(m[1]) };
            else if ((m = tok.match(/^sell=(\d+(?:\.\d+)?)$/))) sellAt = Number(m[1]);
            else if (/^\d+(?:\.\d+)?$/.test(tok)) {
                if (!condition && !execute) {
                    const p = Number(tok);
                    condition = { op: side === "BUY" ? "le" : "ge", price: p };
                    execute = side === "BUY" ? { mode: "price", value: p } : { mode: "tick", value: 0 };
                } else sellAt = Number(tok);
            } else usage();
        }
        if (!condition || !execute) usage();
        const { uuid, payload } = await createAutoOrder({
            symbol: sym,
            side,
            lot: Number(lot),
            condition: condition!,
            execute: execute!,
            sellAfterBuyPrice: sellAt,
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
        console.log(`  to amend/withdraw: ${ack.marketOrderId} ${ack.internalId} ${ack.sequence}`);
        break;
    }
    case "dwithdraw": {
        const [mid, iid, seq] = a;
        if (!mid || !iid || !seq) {
            console.error("usage: deno task order dwithdraw <marketId> <internalId> <sequence>");
            Deno.exit(1);
        }
        const ack = await withdrawDirectOrder({ marketOrderId: mid, internalId: Number(iid), sequence: Number(seq) });
        console.log(`withdraw accepted: ${ack.marketOrderId || mid}`);
        break;
    }
    case "damend": {
        const [mid, iid, seq, price] = a;
        if (!mid || !iid || !seq || !price) {
            console.error("usage: deno task order damend <marketId> <internalId> <sequence> <newPrice>");
            Deno.exit(1);
        }
        const ack = await amendDirectOrder(
            { marketOrderId: mid, internalId: Number(iid), sequence: Number(seq) },
            Number(price),
        );
        console.log(`amend accepted: new order ${ack.marketOrderId} @ ${fmtPrice(ack.price)}`);
        break;
    }
    default:
        console.error(
            "commands: list | buy | sell | stop | resume | cancel | dbuy | dsell | dwithdraw | damend",
        );
        Deno.exit(1);
}
