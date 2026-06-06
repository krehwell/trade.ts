import { warpClient } from "../lib/warpClient.ts";
import { TOKEN } from "./constants.ts";
import { persistTokens, refreshAccessToken } from "./refreshToken.ts";

const BASE = "https://exodus.stockbit.com";

// Mutable in-memory auth header so a refresh mid-run takes effect immediately.
let authToken = TOKEN;
let refreshing: Promise<void> | null = null;

// On 401: refresh the access token once (deduped across concurrent calls),
// persist to constants.ts if write perms allow, otherwise keep in-memory.
const ensureFreshAuth = (): Promise<void> => {
    if (!refreshing) {
        refreshing = (async () => {
            const t = await refreshAccessToken();
            authToken = t.token;
            try {
                await persistTokens({ token: t.token, refreshToken: t.refreshToken });
            } catch (_) {
                // no --allow-write/read: refreshed token stays in-memory for this run
            }
        })().finally(() => {
            refreshing = null;
        });
    }
    return refreshing;
};

export const fetchGET = async <T = any>({
    path,
    params,
}: {
    path: string;
    params?: Record<string, string>;
}): Promise<T> => {
    const u = new URL(path, BASE);
    if (params) {
        for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    }
    let res = await fetch(u.toString(), {
        headers: { Authorization: authToken },
        client: warpClient,
    });
    if (res.status === 401) {
        await ensureFreshAuth();
        res = await fetch(u.toString(), {
            headers: { Authorization: authToken },
            client: warpClient,
        });
    }
    return res.json();
};

export const fetchPOST = async <T = any>({
    path,
    body,
}: {
    path: string;
    body: Record<string, unknown>;
}): Promise<T> => {
    const doFetch = () =>
        fetch(`${BASE}${path}`, {
            method: "POST",
            headers: {
                Authorization: authToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            client: warpClient,
        });
    let res = await doFetch();
    if (res.status === 401) {
        await ensureFreshAuth();
        res = await doFetch();
    }
    return res.json();
};
