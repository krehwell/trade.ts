import { REFRESH_TOKEN } from "./constants.ts";

const BASE = "https://exodus.stockbit.com";

export interface RefreshedTokens {
    accessToken: string; // raw JWT, no "Bearer " prefix
    refreshToken: string;
    accessExpiredAt: string;
    refreshExpiredAt: string;
}

// POST /login/refresh — exchange a refresh token for a fresh access + refresh token.
// Server expects the REFRESH token in the Authorization header and an empty body.
// IMPORTANT: refresh is SINGLE-USE and rotates the whole session — the old access AND
// refresh tokens are invalidated server-side on each call. The new refresh token in the
// response MUST be persisted, or the next refresh fails with UNAUTHORIZED.
// Response shape: { message, data: { access: {token, expired_at}, refresh: {token, expired_at} } }
export const refreshAccessToken = async (
    { refreshToken = REFRESH_TOKEN }: { refreshToken?: string } = {},
): Promise<RefreshedTokens> => {
    const res = await fetch(`${BASE}/login/refresh`, {
        method: "POST",
        headers: { Authorization: `Bearer ${refreshToken}` },
    });
    const json = await res.json().catch(() => ({}));
    const data = json?.data;
    if (!res.ok || !data?.access?.token || !data?.refresh?.token) {
        throw new Error(
            `Refresh failed (${res.status}): ${json?.message ?? "unknown error"}`,
        );
    }
    return {
        accessToken: data.access.token,
        refreshToken: data.refresh.token,
        accessExpiredAt: data.access.expired_at ?? "",
        refreshExpiredAt: data.refresh.expired_at ?? "",
    };
};

// Rewrite utils/constants.ts in place with the new tokens. Needs --allow-read + --allow-write.
export const persistTokens = async (
    { accessToken, refreshToken }: { accessToken: string; refreshToken: string },
): Promise<void> => {
    const path = new URL("./constants.ts", import.meta.url);
    let src = await Deno.readTextFile(path);
    src = src.replace(
        /export const TOKEN =\s*"[^"]*";/,
        `export const TOKEN =\n    "Bearer ${accessToken}";`,
    );
    src = src.replace(
        /export const REFRESH_TOKEN =\s*"[^"]*";/,
        `export const REFRESH_TOKEN = "${refreshToken}";`,
    );
    await Deno.writeTextFile(path, src);
};
