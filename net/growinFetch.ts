// Authed Growin REST fetch. Base login (getGrowinCookie) plus a PIN step:
// portfolio/order routes live behind /protected/ which needs a PIN-verified
// session (pin-login, then carry PIN_ACCESS_TOKEN). Base login alone = 401.
// Growin is single-session, so the login promise is deduped.
import { getGrowinCookie, GROWIN_HEADERS } from "./growinAuth.ts";

let cookie: string | null = null;
let login: Promise<string> | null = null;

const authCookie = async (): Promise<string> => {
    const base = await getGrowinCookie();
    const pin = Deno.env.get("GROWIN_PIN");
    if (!pin) throw new Error("Missing GROWIN_PIN in .env (trading PIN for portfolio/order routes).");
    const res = await fetch("https://api.growin.id/auth/api/v1/protected/pin-login", {
        method: "POST",
        headers: { ...GROWIN_HEADERS, "Content-Type": "application/json", Cookie: base },
        body: JSON.stringify({ value: pin }),
    });
    if (!res.ok) throw new Error(`Growin pin-login: HTTP ${res.status} (wrong GROWIN_PIN?)`);
    const d = (await res.json())?.data;
    if (!d?.pin_token) throw new Error("Growin pin-login: no pin_token returned");
    return `${base}; PIN_REFRESH_TOKEN=${d.pin_refresh_token}; PIN_ACCESS_TOKEN=${d.pin_token}`;
};

// The authed cookie (base + PIN), deduped. For callers that need the raw string,
// e.g. the order WebSocket handshake.
export const growinAuthCookie = async (): Promise<string> => {
    cookie ??= await (login ??= authCookie());
    return cookie;
};

// Authed request. body !== undefined => JSON POST/PUT/DELETE.
export const growinFetch = async (
    path: string,
    { method = "GET", body }: { method?: string; body?: unknown } = {},
) => {
    const c = await growinAuthCookie();
    const res = await fetch(`https://api.growin.id${path}`, {
        method,
        headers: {
            ...GROWIN_HEADERS,
            Cookie: c,
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`Growin ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return await res.json();
};
