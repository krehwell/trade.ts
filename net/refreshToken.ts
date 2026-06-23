import { warpClient } from "./warpClient.ts";
import { REFRESH_TOKEN } from "./constants.ts";

const BASE = "https://exodus.stockbit.com";

// All token fields are COMPLETE Authorization header strings ("Bearer <jwt>"), matching
// the form stored in constants.ts.  A raw JWT only becomes a "Bearer ..." string below,
// where the API response is read; nowhere else should prepend "Bearer ".
export interface RefreshedTokens {
    token: string; // "Bearer <jwt>", new access, ready for the Authorization header
    refreshToken: string; // "Bearer <jwt>", new refresh (rotated)
    accessExpiredAt: string;
    refreshExpiredAt: string;
}

// POST /login/refresh: exchange the refresh token for a fresh access + refresh pair.
// Send the REFRESH token in the Authorization header (already "Bearer ..."), empty body.
// IMPORTANT: refresh is SINGLE USE and rotates the whole session.  The old access AND
// refresh tokens are invalidated server side on each call, so the new refresh token in
// the response MUST be persisted, or the next refresh fails with UNAUTHORIZED.
// Response shape: { message, data: { access: {token, expired_at}, refresh: {token, expired_at} } }
export const refreshAccessToken = async (
    { refreshToken = REFRESH_TOKEN }: { refreshToken?: string } = {},
): Promise<RefreshedTokens> => {
    const res = await fetch(`${BASE}/login/refresh`, {
        method: "POST",
        headers: { Authorization: refreshToken },
        client: warpClient,
    });
    const json = await res.json().catch(() => ({}));
    const data = json?.data;
    if (!res.ok || !data?.access?.token || !data?.refresh?.token) {
        throw new Error(
            `Refresh failed (${res.status}): ${json?.message ?? "unknown error"}`,
        );
    }
    return {
        token: `Bearer ${data.access.token}`,
        refreshToken: `Bearer ${data.refresh.token}`,
        accessExpiredAt: data.access.expired_at ?? "",
        refreshExpiredAt: data.refresh.expired_at ?? "",
    };
};

// Rewrite net/constants.ts in place with the new tokens. Needs --allow-read + --allow-write.
// Both args are full "Bearer ..." strings and are written verbatim.
export const persistTokens = async (
    { token, refreshToken }: { token: string; refreshToken: string },
): Promise<void> => {
    const path = new URL("./constants.ts", import.meta.url);
    let src = await Deno.readTextFile(path);
    src = src.replace(
        /export const TOKEN =\s*"[^"]*";/,
        `export const TOKEN =\n    "${token}";`,
    );
    src = src.replace(
        /export const REFRESH_TOKEN =\s*"[^"]*";/,
        `export const REFRESH_TOKEN =\n    "${refreshToken}";`,
    );
    await Deno.writeTextFile(path, src);
};
