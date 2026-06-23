// Shared HTTP client for every Stockbit request.  On the VPS the outbound call needs
// the SOCKS tunnel, so uncomment the proxy there; keep it commented when running locally.
export const warpClient = Deno.createHttpClient({
    proxy: { url: "socks5://127.0.0.1:40000" },
});

