// Live IDX orderbook depth from Growin (Mirae), the ladder Stockbit paywalls.
// It's protobuf over a WebSocket (wss://api.growin.id/marketws/ws). Snapshot:
// connect, subscribe, grab one frame, close.
// Wire schema was reverse-engineered from the web bundle, see the growin-live-orderbook memory.
import { getGrowinCookie } from "../net/growinAuth.ts";
import { readFrame, writeFrame, wsConnect } from "../net/growinWs.ts";
import { get, getAll, len, parse, str, vint } from "../util/protobuf.ts";

export interface DepthLevel { ask: boolean; price: number; volume: number; orders: number; }
export interface Depth {
    symbol: string;
    bids: DepthLevel[]; // high → low
    asks: DepthLevel[]; // low → high
    bestBidPrice: number; bestBidVol: number;
    bestAskPrice: number; bestAskVol: number;
}

const buildSubscribe = (sym: string, limit: number): Uint8Array => {
    const inst: number[] = [];
    vint(1, 2, inst);              // Instrument.Type = Equity(2)
    str(2, "IDX", inst);           // Instrument.Exchange
    str(3, sym, inst);             // Instrument.Symbol
    const smd: number[] = [];
    len(1, inst, smd);             // SubscribeMarketDepth.Instruments[0]
    vint(3, limit, smd);           // SubscribeMarketDepth.Limit
    const env: number[] = [];
    len(2, smd, env);              // Request.payload = SubscribeMarketDepth (field 2)
    return new Uint8Array(env);
};

const decodeDepth = (frame: Uint8Array, symbol: string): Depth | null => {
    const env = parse(frame);
    const mdr = get(env, 2)?.s; if (!mdr) return null;         // Response.marketDepthResponse
    const mdrF = parse(mdr);
    const book = get(mdrF, 2)?.s; if (!book) return null;      // MarketDepthResponse.BookData
    const bf = parse(book);
    const levels: DepthLevel[] = getAll(bf, 3).map((lv) => {   // BookData.BookLevels (repeated)
        const l = parse(lv.s!);
        return {
            ask: !!get(l, 1)?.v,           // AskSide bool
            price: get(l, 3)?.v ?? 0,      // Price double
            volume: get(l, 4)?.v ?? 0,     // Volume u64
            orders: get(l, 6)?.v ?? 0,     // OrderCount u32
        };
    });
    return {
        symbol,
        bids: levels.filter((l) => !l.ask).sort((a, b) => b.price - a.price),
        asks: levels.filter((l) => l.ask).sort((a, b) => a.price - b.price),
        bestBidPrice: get(bf, 8)?.v ?? 0, bestBidVol: get(bf, 9)?.v ?? 0,
        bestAskPrice: get(bf, 10)?.v ?? 0, bestAskVol: get(bf, 11)?.v ?? 0,
    };
};

export const fetchDepthSnapshot = async ({ symbol, limit = 10, timeoutMs = 7000 }: {
    symbol: string; limit?: number; timeoutMs?: number;
}): Promise<Depth> => {
    const sym = symbol.toUpperCase();
    const w = await wsConnect("/marketws/ws", await getGrowinCookie());
    await writeFrame(w.conn, 0x2, buildSubscribe(sym, limit));

    const deadline = Date.now() + timeoutMs;
    try {
        while (Date.now() < deadline) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<null>((res) => {
                timer = setTimeout(() => res(null), deadline - Date.now());
            });
            const fr = await Promise.race([readFrame(w), timeout]);
            clearTimeout(timer); // else the pending timer keeps the process alive after we return
            if (!fr) break;
            if (fr.op === 0x9) { await writeFrame(w.conn, 0xA, fr.payload); continue; } // ping→pong
            if (fr.op === 0x8) break;                                                 // close
            if (fr.op !== 0x2 && fr.op !== 0x0) continue;                             // want binary
            const depth = decodeDepth(fr.payload, sym);
            if (depth && (depth.bids.length || depth.asks.length)) return depth;
        }
    } finally {
        try { w.conn.close(); } catch { /* already closed */ }
    }
    throw new Error(`No depth frame for ${sym} within ${timeoutMs}ms (market closed, or symbol has no book)`);
};
