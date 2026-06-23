export const warpClient = Deno.createHttpClient({
    proxy: { url: "socks5://127.0.0.1:40000" },
});

