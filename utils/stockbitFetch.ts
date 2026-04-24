import { TOKEN } from "./constants.ts";

const BASE = "https://exodus.stockbit.com";

export const fetchGET = async <T = any>({ path, params }: {
    path: string;
    params?: Record<string, string>;
}): Promise<T> => {
    const u = new URL(path, BASE);
    if (params) {
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    }
    const res = await fetch(u.toString(), {
        headers: { Authorization: TOKEN },
    });
    return res.json();
};

export const fetchPOST = async <T = any>({ path, body }: {
    path: string;
    body: Record<string, unknown>;
}): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return res.json();
};
