// Manual HTTP/1.1 WebSocket over TLS to api.growin.id. Deno's WebSocketStream
// negotiates HTTP/2 which the server rejects, so hand-roll the upgrade. We don't
// offer permessage-deflate; Growin's frames are small and sent uncompressed.
import { GROWIN_UA } from "./growinAuth.ts";

export interface WsConn {
    conn: Deno.Conn;
    carry: { buf: Uint8Array };
}

const WS_KEY = "dGhlIHNhbXBsZSBub25jZQ==";

export const wsConnect = async (path: string, cookie: string): Promise<WsConn> => {
    const conn = await Deno.connectTls({
        hostname: "api.growin.id",
        port: 443,
        alpnProtocols: ["http/1.1"],
    });
    const req = [
        `GET ${path} HTTP/1.1`,
        "Host: api.growin.id",
        `User-Agent: ${GROWIN_UA}`,
        "Accept: */*",
        "Accept-Language: en",
        "Sec-WebSocket-Version: 13",
        `Sec-WebSocket-Key: ${WS_KEY}`,
        "Origin: https://invest.growin.id",
        "Sec-Fetch-Dest: empty",
        "Sec-Fetch-Mode: websocket",
        "Sec-Fetch-Site: same-site",
        `Cookie: ${cookie}`,
        "Connection: keep-alive, Upgrade",
        "Upgrade: websocket",
        "",
        "",
    ].join("\r\n");
    await conn.write(new TextEncoder().encode(req));

    const carry = { buf: new Uint8Array(0) };
    while (true) {
        const chunk = new Uint8Array(4096);
        const r = await conn.read(chunk);
        if (r === null) throw new Error("WS handshake: connection closed");
        const merged = new Uint8Array(carry.buf.length + r);
        merged.set(carry.buf);
        merged.set(chunk.subarray(0, r), carry.buf.length);
        carry.buf = merged;
        const s = new TextDecoder().decode(carry.buf);
        const idx = s.indexOf("\r\n\r\n");
        if (idx >= 0) {
            if (!s.startsWith("HTTP/1.1 101")) {
                throw new Error(
                    `Growin WS ${path} handshake failed: ${s.slice(0, s.indexOf("\r\n"))}. ` +
                        `Cookie rejected, or the account is logged in elsewhere (single-session).`,
                );
            }
            carry.buf = carry.buf.subarray(idx + 4);
            break;
        }
    }
    return { conn, carry };
};

export const writeFrame = async (conn: Deno.Conn, op: number, data: Uint8Array) => {
    const header: number[] = [0x80 | op];
    if (data.length < 126) header.push(0x80 | data.length);
    else if (data.length < 65536) header.push(0x80 | 126, (data.length >> 8) & 0xff, data.length & 0xff);
    else {
        header.push(0x80 | 127);
        for (let k = 7; k >= 0; k--) header.push((data.length >> (8 * k)) & 0xff);
    }
    header.push(0, 0, 0, 0); // client frames must be masked; zero mask ⇒ payload unchanged
    await conn.write(new Uint8Array([...header, ...data]));
};

export const readFrame = async (
    w: WsConn,
): Promise<{ op: number; payload: Uint8Array } | null> => {
    const { conn, carry } = w;
    const need = async (n: number) => {
        while (carry.buf.length < n) {
            const chunk = new Uint8Array(16384);
            const r = await conn.read(chunk);
            if (r === null) return false;
            const merged = new Uint8Array(carry.buf.length + r);
            merged.set(carry.buf);
            merged.set(chunk.subarray(0, r), carry.buf.length);
            carry.buf = merged;
        }
        return true;
    };
    if (!await need(2)) return null;
    const b0 = carry.buf[0], b1 = carry.buf[1];
    const op = b0 & 0x0f;
    let plen = b1 & 0x7f;
    let off = 2;
    if (plen === 126) {
        if (!await need(4)) return null;
        plen = (carry.buf[2] << 8) | carry.buf[3];
        off = 4;
    } else if (plen === 127) {
        if (!await need(10)) return null;
        plen = 0;
        for (let k = 2; k < 10; k++) plen = plen * 256 + carry.buf[k];
        off = 10;
    }
    if (!await need(off + plen)) return null;
    const payload = carry.buf.subarray(off, off + plen).slice();
    carry.buf = carry.buf.subarray(off + plen);
    return { op, payload };
};
