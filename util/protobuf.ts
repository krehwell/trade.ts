// Minimal protobuf wire reader/writer. Enough for Growin's WS messages
// (varints, length-delimited strings/submessages, 32/64-bit floats). Shared by
// data/growinDepth.ts (orderbook) and data/growinOrderWs.ts (orders).

// writer
export const vw = (n: number, o: number[]) => {
    while (n > 0x7f) {
        o.push((n & 0x7f) | 0x80);
        n = Math.floor(n / 128);
    }
    o.push(n);
};
export const tag = (f: number, w: number, o: number[]) => vw((f << 3) | w, o);
export const len = (f: number, b: number[], o: number[]) => {
    tag(f, 2, o);
    vw(b.length, o);
    o.push(...b);
};
export const str = (f: number, s: string, o: number[]) => len(f, [...new TextEncoder().encode(s)], o);
export const vint = (f: number, n: number, o: number[]) => {
    tag(f, 0, o);
    vw(n, o);
};

// reader
export interface Field { f: number; w: number; v: number; s?: Uint8Array; }
export const parse = (u8: Uint8Array): Field[] => {
    const out: Field[] = [];
    let i = 0;
    const rv = () => {
        let sh = 1, r = 0, b: number;
        do {
            b = u8[i++];
            r += (b & 0x7f) * sh;
            sh *= 128;
        } while (b & 0x80);
        return r;
    };
    while (i < u8.length) {
        const key = rv();
        const f = key >>> 3, w = key & 7;
        if (w === 0) out.push({ f, w, v: rv() });
        else if (w === 1) {
            const dv = new DataView(u8.buffer, u8.byteOffset + i, 8);
            out.push({ f, w, v: dv.getFloat64(0, true) });
            i += 8;
        } else if (w === 2) {
            const l = rv();
            out.push({ f, w, v: 0, s: u8.subarray(i, i + l) });
            i += l;
        } else if (w === 5) {
            const dv = new DataView(u8.buffer, u8.byteOffset + i, 4);
            out.push({ f, w, v: dv.getFloat32(0, true) });
            i += 4;
        } else break;
    }
    return out;
};
export const get = (fs: Field[], f: number) => fs.find((x) => x.f === f);
export const getAll = (fs: Field[], f: number) => fs.filter((x) => x.f === f);
export const fstr = (u?: Uint8Array) => (u ? new TextDecoder().decode(u).trim() : "");
