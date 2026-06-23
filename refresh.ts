import { persistTokens, refreshAccessToken } from "./net/refreshToken.ts";

// Refresh the Stockbit access token and write it back to net/constants.ts.
// Run when the token has expired (or proactively): `deno task refresh`
const t = await refreshAccessToken();
await persistTokens({ token: t.token, refreshToken: t.refreshToken });

console.log("✓ token refreshed and saved to net/constants.ts");
console.log("  access expires: ", t.accessExpiredAt || "(unknown)");
console.log("  refresh expires:", t.refreshExpiredAt || "(unknown)");
