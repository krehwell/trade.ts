// shared http client for every stockbit request
// stockbit blocks call that is not from IDN.  so:
// - on the vps (linux) outbound calls need the warp socks tunnel (make sure cloudflare-warp client is installed on vps) 
// - locally (darwin - mac) we can go direct.
export const warpClient = Deno.createHttpClient(
    Deno.build.os === "linux" ? { proxy: { url: "socks5://127.0.0.1:40000" } } : {},
);
