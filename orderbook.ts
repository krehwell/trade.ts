// deno task orderbook <symbol>
// Live bid/offer ladder snapshot for one IDX stock (Growin). Market hours only.
import { fetchDepthSnapshot } from "./data/growinDepth.ts";

const sym = Deno.args[0]?.toUpperCase();
if (!sym) {
  console.error("Usage: deno task orderbook <symbol>");
  Deno.exit(1);
}

const d = await fetchDepthSnapshot({ symbol: sym });
const k = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const now = new Date().toLocaleTimeString("id-ID", {
  timeZone: "Asia/Jakarta",
});

console.log(`\n=== ${sym} orderbook @ ${now} WIB ===\n`);
console.log("        OFFER (ask)");
for (const l of [...d.asks].reverse()) {
  console.log(
    `  ${String(l.price).padStart(6)} x ${
      k(l.volume).padStart(7)
    }  (${l.orders})`,
  );
}
console.log("  ------------------------------");
for (const l of d.bids) {
  console.log(
    `  ${String(l.price).padStart(6)} x ${
      k(l.volume).padStart(7)
    }  (${l.orders})`,
  );
}
console.log("        BID");

const bidVol = d.bids.reduce((s, l) => s + l.volume, 0);
const askVol = d.asks.reduce((s, l) => s + l.volume, 0);
const imb = bidVol + askVol
  ? ((bidVol - askVol) / (bidVol + askVol) * 100).toFixed(0)
  : "0";
const bb = d.bids[0], ba = d.asks[0]; // inside market straight off the ladder
console.log(
  `\nBest: bid ${bb?.price ?? "-"} (${bb ? k(bb.volume) : "-"}) | ask ${
    ba?.price ?? "-"
  } (${ba ? k(ba.volume) : "-"})  spread ${
    bb && ba ? ba.price - bb.price : "-"
  }`,
);
console.log(
  `Depth: bid ${k(bidVol)} vs ask ${k(askVol)} lots  →  imbalance ${
    Number(imb) > 0 ? "+" : ""
  }${imb}% ${
    Number(imb) > 20 ? "(bid-heavy)" : Number(imb) < -20 ? "(ask-heavy)" : ""
  }`,
);
console.log("(snapshot, run again to refresh)");
