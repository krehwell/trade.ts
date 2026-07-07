// deno task account [days=30]
// Snapshot of the Growin account: cash, holdings, live vs done orders, realized P&L.
import {
    fetchCash,
    fetchConsolidated,
    fetchHoldings,
    fetchOrders,
    fetchRealizedPnl,
    isLive,
    type Order,
} from "./data/growinAccount.ts";
import { daysAgo, today } from "./util/date.ts";
import { fmtNum, fmtPct, fmtPrice, printHeader, printSubHeader } from "./util/print.ts";

const days = Number(Deno.args[0] ?? 30);
const start = daysAgo(days);
const end = today();

const [cons, cash, holdings, orders, pnl] = await Promise.all([
    fetchConsolidated(),
    fetchCash(),
    fetchHoldings(),
    fetchOrders({ start, end }),
    fetchRealizedPnl({ start, end }),
]);

printHeader("ACCOUNT");
console.log(
    `Total asset ${fmtNum(cons.totalAsset)} | Available cash ${fmtNum(cons.availableCash)} | Trade limit ${fmtNum(cons.tradeLimit)}` +
        (cons.penaltyCharges ? ` | PENALTY ${fmtNum(cons.penaltyCharges)}` : ""),
);
console.log(
    `Settlement  T0 ${cash.dates.t0} ${fmtNum(cash.netCash.t0)} | T1 ${cash.dates.t1} ${fmtNum(cash.netCash.t1)} | T2 ${cash.dates.t2} ${fmtNum(cash.netCash.t2)}`,
);

printSubHeader("HOLDINGS");
if (!holdings.length) console.log("  (none)");
for (const h of holdings) {
    const flags = [
        h.corporateAction && h.corporateAction !== "--" ? h.corporateAction : "",
        h.isSuspended ? "SUSPENDED" : "",
        h.isUma ? "UMA" : "",
        h.lotOnDeliver ? `${h.lotOnDeliver} lot unsettled(T0)` : "",
    ].filter(Boolean).join(" ");
    console.log(
        `  ${h.symbol.padEnd(6)} ${h.lotAvailable} lot | avg ${fmtPrice(h.avgPrice)} last ${fmtPrice(h.lastPrice)} | ${fmtPct(h.pnlPct)}${flags ? "  [" + flags + "]" : ""}`,
    );
}

const line = (o: Order) =>
    `  ${o.symbol.padEnd(6)} ${o.side.padEnd(4)} ${o.lot} lot @ ${fmtPrice(o.price)} | ${o.status}` +
    (o.matchedLot ? ` (${o.matchedLot}/${o.lot} filled)` : "") +
    (o.canAmend || o.canWithdraw
        ? `  <${[o.canAmend && "amend", o.canWithdraw && "withdraw"].filter(Boolean).join("/")}>`
        : "") +
    `  #${o.id} ${o.entryTime.slice(0, 16).replace("T", " ")}`;

const live = orders.filter(isLive);
printSubHeader(`LIVE ORDERS (${live.length})`);
if (!live.length) console.log("  (none open)");
for (const o of live) console.log(line(o));

const done = orders.filter((o) => !isLive(o));
printSubHeader(`DONE ORDERS ${start}..${end} (${done.length})`);
for (const o of done) console.log(line(o));

printSubHeader(`REALIZED P&L ${start}..${end}`);
console.log(
    `  Gross ${fmtNum(pnl.totalGrossGl)} | Nett ${fmtNum(pnl.totalNettGl)} (after fees)`,
);
for (const t of pnl.trades) {
    console.log(
        `  ${t.date}  ${t.symbol.padEnd(6)} ${t.lot} lot ${fmtPrice(t.buyPrice)}->${fmtPrice(t.sellPrice)} | ${fmtPct(t.glPct)} | nett ${fmtNum(t.nettGl)}`,
    );
}
