import { persistTokens, refreshAccessToken } from "./utils/refreshToken.ts";

// Refresh the Stockbit access token and write it back to utils/constants.ts.
// Run when the token has expired (or proactively): `deno task refresh`
const t = await refreshAccessToken();
await persistTokens({ accessToken: t.accessToken, refreshToken: t.refreshToken });

console.log("✓ token refreshed and saved to utils/constants.ts");
console.log("  access expires: ", t.accessExpiredAt || "(unknown)");
console.log("  refresh expires:", t.refreshExpiredAt || "(unknown)");
