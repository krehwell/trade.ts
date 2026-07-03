// Live IDX orderbook depth from Growin (Mirae), the ladder Stockbit paywalls.
// It's protobuf over a WebSocket (wss://api.growin.id/marketws/ws). Deno's WebSocketStream
// speaks HTTP/2 which the server rejects, so we hand-roll the HTTP/1.1 WS handshake over TLS
// plus a tiny protobuf reader/writer. Snapshot: connect, subscribe, grab one frame, close.
// Wire schema was reverse-engineered from the web bundle, see the growin-live-orderbook memory.
import { getGrowinCookie } from "../net/growinAuth.ts";

export interface DepthLevel { ask: boolean; price: number; volume: number; orders: number; }
export interface Depth {
    symbol: string;
    bids: DepthLevel[]; // high → low
    asks: DepthLevel[]; // low → high
    bestBidPrice: number; bestBidVol: number;
    bestAskPrice: number; bestAskVol: number;
}

// ---------- protobuf writer (minimal) ----------
const vw = (n: number, o: number[]) => { while (n > 0x7f) { o.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } o.push(n); };
const tag = (f: number, w: number, o: number[]) => vw((f << 3) | w, o);
const len = (f: number, b: number[], o: number[]) => { tag(f, 2, o); vw(b.length, o); o.push(...b); };
const str = (f: number, s: string, o: number[]) => len(f, [...new TextEncoder().encode(s)], o);
const vint = (f: number, n: number, o: number[]) => { tag(f, 0, o); vw(n, o); };

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

// ---------- protobuf reader (minimal) ----------
interface Field { f: number; w: number; v: number; s?: Uint8Array; }
const parse = (u8: Uint8Array): Field[] => {
    const out: Field[] = []; let i = 0;
    const rv = () => { let sh = 1, r = 0, b: number; do { b = u8[i++]; r += (b & 0x7f) * sh; sh *= 128; } while (b & 0x80); return r; };
    while (i < u8.length) {
        const key = rv(); const f = key >>> 3, w = key & 7;
        if (w === 0) out.push({ f, w, v: rv() });
        else if (w === 1) { const dv = new DataView(u8.buffer, u8.byteOffset + i, 8); out.push({ f, w, v: dv.getFloat64(0, true) }); i += 8; }
        else if (w === 2) { const l = rv(); out.push({ f, w, v: 0, s: u8.subarray(i, i + l) }); i += l; }
        else if (w === 5) { const dv = new DataView(u8.buffer, u8.byteOffset + i, 4); out.push({ f, w, v: dv.getFloat32(0, true) }); i += 4; }
        else break;
    }
    return out;
};
const get = (fs: Field[], f: number) => fs.find((x) => x.f === f);
const getAll = (fs: Field[], f: number) => fs.filter((x) => x.f === f);

// envelope → (field 2) MarketDepthResponse → (field 2) BookData
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

// ---------- manual WS over TLS (HTTP/1.1) ----------
const wsKey = "dGhlIHNhbXBsZSBub25jZQ=="; // static client nonce is fine for a client
const readFrame = async (conn: Deno.Conn, carry: { buf: Uint8Array }): Promise<{ op: number; payload: Uint8Array } | null> => {
    const need = async (n: number) => {
        while (carry.buf.length < n) {
            const chunk = new Uint8Array(16384);
            const r = await conn.read(chunk);
            if (r === null) return false;
            const merged = new Uint8Array(carry.buf.length + r);
            merged.set(carry.buf); merged.set(chunk.subarray(0, r), carry.buf.length);
            carry.buf = merged;
        }
        return true;
    };
    if (!await need(2)) return null;
    const b0 = carry.buf[0], b1 = carry.buf[1];
    const op = b0 & 0x0f; let plen = b1 & 0x7f; let off = 2;
    if (plen === 126) { if (!await need(4)) return null; plen = (carry.buf[2] << 8) | carry.buf[3]; off = 4; }
    else if (plen === 127) { if (!await need(10)) return null; plen = 0; for (let k = 2; k < 10; k++) plen = plen * 256 + carry.buf[k]; off = 10; }
    if (!await need(off + plen)) return null;
    const payload = carry.buf.subarray(off, off + plen);
    const copy = payload.slice();
    carry.buf = carry.buf.subarray(off + plen);
    return { op, payload: copy };
};
const writeFrame = async (conn: Deno.Conn, op: number, data: Uint8Array) => {
    const mask = [0, 0, 0, 0]; // client frames must be masked; zero mask is valid
    const header: number[] = [0x80 | op];
    if (data.length < 126) header.push(0x80 | data.length);
    else if (data.length < 65536) header.push(0x80 | 126, (data.length >> 8) & 0xff, data.length & 0xff);
    else { header.push(0x80 | 127); for (let k = 7; k >= 0; k--) header.push((data.length >> (8 * k)) & 0xff); }
    header.push(...mask);
    await conn.write(new Uint8Array([...header, ...data])); // zero-mask ⇒ payload unchanged
};

export const fetchDepthSnapshot = async ({ symbol, limit = 10, timeoutMs = 7000 }: {
    symbol: string; limit?: number; timeoutMs?: number;
}): Promise<Depth> => {
    const sym = symbol.toUpperCase();
    const cookie = await getGrowinCookie();
    const conn = await Deno.connectTls({ hostname: "api.growin.id", port: 443, alpnProtocols: ["http/1.1"] });
    const req = [
        "GET /marketws/ws HTTP/1.1", "Host: api.growin.id",
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0",
        "Accept: */*", "Accept-Language: en", "Accept-Encoding: gzip, deflate, br, zstd",
        "Sec-WebSocket-Version: 13", `Sec-WebSocket-Key: ${wsKey}`,
        "Origin: https://invest.growin.id",
        "Sec-Fetch-Dest: empty", "Sec-Fetch-Mode: websocket", "Sec-Fetch-Site: same-site",
        `Cookie: ${cookie}`,
        "Connection: keep-alive, Upgrade", "Upgrade: websocket", "", "",
    ].join("\r\n");
    await conn.write(new TextEncoder().encode(req));

    // read handshake response headers (until \r\n\r\n)
    const carry = { buf: new Uint8Array(0) };
    while (true) {
        const chunk = new Uint8Array(4096); const r = await conn.read(chunk);
        if (r === null) throw new Error("WS handshake: connection closed");
        const merged = new Uint8Array(carry.buf.length + r);
        merged.set(carry.buf); merged.set(chunk.subarray(0, r), carry.buf.length); carry.buf = merged;
        const s = new TextDecoder().decode(carry.buf);
        const idx = s.indexOf("\r\n\r\n");
        if (idx >= 0) {
            if (!s.startsWith("HTTP/1.1 101")) {
                const status = s.slice(0, s.indexOf("\r\n"));
                // Login just succeeded, so a rejected upgrade means the session was killed
                // (another device logged in) or the header set no longer satisfies Akamai.
                throw new Error(
                    `Growin WS handshake failed: ${status}. The login cookie was rejected. ` +
                        `Usually means the account logged in elsewhere (Growin is single-session per device), ` +
                        `so stop other Growin sessions. If it persists, Akamai may want updated headers: ` +
                        `re-grab wss://api.growin.id/marketws/ws from the browser and reconcile data/growinDepth.ts.`,
                );
            }
            carry.buf = carry.buf.subarray(idx + 4); // leftover = start of first WS frame
            break;
        }
    }

    await writeFrame(conn, 0x2, buildSubscribe(sym, limit)); // binary subscribe

    const deadline = Date.now() + timeoutMs;
    try {
        while (Date.now() < deadline) {
            const fr = await Promise.race([
                readFrame(conn, carry),
                new Promise<null>((res) => setTimeout(() => res(null), deadline - Date.now())),
            ]);
            if (!fr) break;
            if (fr.op === 0x9) { await writeFrame(conn, 0xA, fr.payload); continue; } // ping→pong
            if (fr.op === 0x8) break;                                                 // close
            if (fr.op !== 0x2 && fr.op !== 0x0) continue;                             // want binary
            const depth = decodeDepth(fr.payload, sym);
            if (depth && (depth.bids.length || depth.asks.length)) return depth;
        }
    } finally {
        try { conn.close(); } catch { /* already closed */ }
    }
    throw new Error(`No depth frame for ${sym} within ${timeoutMs}ms (market closed, or symbol has no book)`);
};
