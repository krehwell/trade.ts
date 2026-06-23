import { persistTokens, refreshAccessToken } from "./src/net/refreshToken.ts";

// Refresh the Stockbit access token and write it back to src/net/constants.ts.
// Run when the token has expired (or proactively): `deno task refresh`
const t = await refreshAccessToken();
await persistTokens({ token: t.token, refreshToken: t.refreshToken });

console.log("✓ token refreshed and saved to src/net/constants.ts");
console.log("  access expires: ", t.accessExpiredAt || "(unknown)");
console.log("  refresh expires:", t.refreshExpiredAt || "(unknown)");
