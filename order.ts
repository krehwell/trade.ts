// deno task order <cmd>
//   list                                  show all auto-orders
//   buy  <sym> <lot> <cond> <exec> [until=..] [sell=<price>]   conditional buy
//   sell <sym> <lot> <cond> <exec> [until=..]                  conditional sell
//        <cond> = le=/ge=<price> | drop=<pct> (buy) | tp=/sl=<pct> | tpRp=/slRp=<rupiah> | trail=<gain%>,<drop%> (sell)
//        <exec> = at=<price> | tick=<n>     (place at price, or n ticks from trigger)
//        until=<YYYY-MM-DD> | until=+<days>  validity (default: expires today)
//        shorthand: buy/sell <sym> <lot> <price>  (buy = le+at price, sell = ge + tick 0)
//   edit <uuid> <field>...                edit an auto-order in place (any of the tokens above)
//   stop <uuid>                           pause (resumable)
//   resume <uuid>                         resume a paused order
//   cancel <uuid>                         delete permanently
//   dbuy  <sym> <lot> <price>             DIRECT buy (instant, hits book now, via WS)
//   dsell <sym> <lot> <price>             DIRECT sell (instant)
//   dwithdraw <marketId>          cancel a resting direct order (any order, ids looked up from REST)
//   damend    <marketId> <price>  reprice a resting direct order
//
// buy/sell = auto-order (conditional, fires on a price trigger).
// dbuy/dsell = direct order (instant fill). dwithdraw/damend take a marketId and
// look internalId+sequence up from the order-list, so they work on app-placed
// orders too. Nothing fires unless you pass a command.
import {
    CONTROL,
    controlAutoOrder,
    type CreateAutoOrder,
    createAutoOrder,
    deleteAutoOrder,
    listAutoOrders,
    updateAutoOrder,
} from "./data/growinAutoOrder.ts";
import { amendDirectOrder, placeDirectOrder, resolveOrderRef, withdrawDirectOrder } from "./data/growinOrderWs.ts";
import { daysAgo } from "./util/date.ts";
import { fmtPrice } from "./util/print.ts";

const [cmd, ...a] = Deno.args;

// Token parser shared by buy/sell/edit. side enables the bare-number shorthand
// (buy = le+at price, sell = ge+tick 0); edit passes null, explicit tokens only.
// Returns null on an unknown token. Only matched keys are set, so the result
// spreads cleanly over an existing order without clobbering fields.
const parseOrderTokens = (
    toks: string[],
    side: "BUY" | "SELL" | null,
): Partial<CreateAutoOrder> | null => {
    const o: Partial<CreateAutoOrder> = {};
    for (const tok of toks) {
        let m: RegExpMatchArray | null;
        if ((m = tok.match(/^le=(\d+(?:\.\d+)?)$/))) o.condition = { op: "le", price: Number(m[1]) };
        else if ((m = tok.match(/^ge=(\d+(?:\.\d+)?)$/))) o.condition = { op: "ge", price: Number(m[1]) };
        else if ((m = tok.match(/^lot=(\d+)$/))) o.lot = Number(m[1]); // edit only, buy/sell take lot positionally
        else if ((m = tok.match(/^drop=(\d+(?:\.\d+)?)$/))) o.dropPct = Number(m[1]); // buy on -drop% from high
        else if ((m = tok.match(/^tp=(\d+(?:\.\d+)?)$/))) o.tpPct = Number(m[1]); // take profit %
        else if ((m = tok.match(/^sl=(\d+(?:\.\d+)?)$/))) o.slPct = Number(m[1]); // stop loss %
        else if ((m = tok.match(/^tpRp=(\d+)$/))) o.tpRp = Number(m[1]); // take profit rupiah
        else if ((m = tok.match(/^slRp=(\d+)$/))) o.slRp = Number(m[1]); // stop loss rupiah
        else if ((m = tok.match(/^trail=(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/))) {
            o.trailGain = Number(m[1]);
            o.trailDrop = Number(m[2]);
        } // gain%,drop%
        else if ((m = tok.match(/^at=(\d+(?:\.\d+)?)$/))) o.execute = { mode: "price", value: Number(m[1]) };
        else if ((m = tok.match(/^tick=(-?\d+)$/))) o.execute = { mode: "tick", value: Number(m[1]) };
        else if ((m = tok.match(/^sell=(\d+(?:\.\d+)?)$/))) o.sellAfterBuyPrice = Number(m[1]);
        else if ((m = tok.match(/^until=(\d{4}-\d{2}-\d{2})$/))) o.validUntil = m[1]; // absolute date
        else if ((m = tok.match(/^until=\+(\d+)$/))) o.validUntil = daysAgo(-Number(m[1])); // +N days from today
        else if (side && /^\d+(?:\.\d+)?$/.test(tok)) {
            if (!o.condition && !o.execute) {
                const p = Number(tok);
                o.condition = { op: side === "BUY" ? "le" : "ge", price: p };
                o.execute = side === "BUY" ? { mode: "price", value: p } : { mode: "tick", value: 0 };
            } else o.sellAfterBuyPrice = Number(tok);
        } else return null;
    }
    return o;
};

const list = async () => {
    const orders = await listAutoOrders();
    if (!orders.length) return console.log("(no auto-orders)");
    for (const o of orders) {
        console.log(
            `  ${o.symbol.padEnd(6)} ${o.side.padEnd(4)} ${o.lot} lot | ${(o.condition || "-").padEnd(18)} | ${o.state.padEnd(7)} | ${o.validFrom}..${o.validUntil}` +
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
            console.error(`  <cond> le=<price>|ge=<price>|tp=<pct>|sl=<pct>   <exec> at=<price>|tick=<n>   until=<date>|+<days>   shorthand: <sym> <lot> <price>`);
            Deno.exit(1);
        };
        if (!sym || !lot) usage();
        const p = parseOrderTokens(rest, side);
        if (!p) usage();
        const sellOnly = p!.tpPct != null || p!.slPct != null || p!.tpRp != null || p!.slRp != null || p!.trailGain != null;
        if (sellOnly && side === "BUY") {
            console.error("tp/sl/tpRp/slRp/trail are sell-only (they act on a held position)");
            Deno.exit(1);
        }
        if (p!.dropPct != null && side === "SELL") {
            console.error("drop is buy-only (buy on a dip from the high)");
            Deno.exit(1);
        }
        if ((!p!.condition && !sellOnly && p!.dropPct == null) || !p!.execute) usage();
        const { uuid, payload } = await createAutoOrder({
            symbol: sym,
            side,
            lot: Number(lot),
            ...p!,
            execute: p!.execute!,
        });
        console.log("sent payload:", JSON.stringify(payload));
        console.log(`created auto-order ${uuid}`);
        await list();
        break;
    }
    case "edit": {
        // edit fields in place (same uuid): pause, PUT merged payload, re-play
        const [uuid, ...rest] = a;
        const p = uuid && rest.length ? parseOrderTokens(rest, null) : null;
        if (!p || !Object.keys(p).length) {
            console.error("usage: deno task order edit <uuid> <field>...");
            console.error("  fields: le=/ge=<price> at=<price> tick=<n> lot=<n> until=<date|+days> drop= tp= sl= tpRp= slRp= trail=");
            Deno.exit(1);
        }
        await updateAutoOrder(uuid, p!);
        console.log("updated");
        await list();
        break;
    }
    case "stop":
    case "resume": {
        if (!a[0]) { console.error(`usage: deno task order ${cmd} <uuid>`); Deno.exit(1); }
        await controlAutoOrder(a[0], cmd === "stop" ? CONTROL.PAUSE : CONTROL.PLAY);
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
        // <marketId> alone looks the ids up from the order-list (works on any
        // order, even app-placed), or pass all three to skip the lookup.
        const [mid, iid, seq] = a;
        if (!mid) { console.error("usage: deno task order dwithdraw <marketId> [<internalId> <sequence>]"); Deno.exit(1); }
        const ref = iid && seq ? { marketOrderId: mid, internalId: Number(iid), sequence: Number(seq) } : await resolveOrderRef(mid);
        await withdrawDirectOrder(ref);
        console.log(`withdraw accepted: ${mid}`);
        break;
    }
    case "damend": {
        // <marketId> <newPrice>, or <marketId> <internalId> <sequence> <newPrice>
        const price = a[a.length - 1];
        const [mid, iid, seq] = a;
        if (!mid || a.length < 2) { console.error("usage: deno task order damend <marketId> [<internalId> <sequence>] <newPrice>"); Deno.exit(1); }
        const ref = a.length >= 4 ? { marketOrderId: mid, internalId: Number(iid), sequence: Number(seq) } : await resolveOrderRef(mid);
        const ack = await amendDirectOrder(ref, Number(price));
        console.log(`amend accepted: new order ${ack.marketOrderId} @ ${fmtPrice(ack.price)}`);
        break;
    }
    default:
        console.error(
            "commands: list | buy | sell | edit | stop | resume | cancel | dbuy | dsell | dwithdraw | damend",
        );
        Deno.exit(1);
}
