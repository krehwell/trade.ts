// deno task refresh
// Refresh the Stockbit access token and write it back to net/stockbitAuth.ts. Single-use: the
// refresh rotates the session, so don't run two tools on an expired token (double-refresh
// invalidates both).
import { persistTokens, refreshAccessToken } from "./net/refreshToken.ts";

const t = await refreshAccessToken();
await persistTokens({ token: t.token, refreshToken: t.refreshToken });

console.log("✓ token refreshed and saved to net/stockbitAuth.ts");
console.log("  access expires: ", t.accessExpiredAt || "(unknown)");
console.log("  refresh expires:", t.refreshExpiredAt || "(unknown)");
