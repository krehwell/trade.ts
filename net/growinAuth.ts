// Growin (Mirae) login for the live orderbook (data/growinDepth.ts).
// getGrowinCookie() logs in and builds a fresh session cookie every run, so nothing to paste
// and nothing expires. Creds live in .env (loaded via the task's --env-file).
// Heads up: Growin is single-session per device. Logging in here logs this account out
// everywhere else (phone, laptop), so give the bot its own account.
const env = (k: string): string | undefined => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined; // no --allow-env
  }
};

const GROWIN_EMAIL = env("GROWIN_EMAIL");
const GROWIN_PASSWORD = env("GROWIN_PASSWORD");
const DEVICE_ID = env("GROWIN_DEVICE_ID"); // reused as x-device-id + login_device_uid

export const getGrowinCookie = async (): Promise<string> => {
  if (!GROWIN_EMAIL || !GROWIN_PASSWORD || !DEVICE_ID) {
    throw new Error(
      "Missing Growin creds. Fill GROWIN_EMAIL / GROWIN_PASSWORD / GROWIN_DEVICE_ID in .env (loaded via --env-file).",
    );
  }
  const res = await fetch("https://api.growin.id/auth/api/v1/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
      Origin: "https://invest.growin.id",
      Referer: "https://invest.growin.id/",
      "x-app-name": "web",
      "x-app-version": "v1.0.0",
      "x-device-id": DEVICE_ID,
      Cookie: `AKA_A2=A; login_device_uid=${DEVICE_ID}`,
    },
    body: JSON.stringify({
      login: GROWIN_EMAIL,
      password: GROWIN_PASSWORD,
      recaptcha: "mobile",
    }),
  });
  const body = await res.text();
  let j: {
    message?: string;
    data?: {
      token?: string;
      refresh_token?: string;
      is_password_expired?: boolean;
      is_otp_verified?: boolean;
    };
  };
  try {
    j = JSON.parse(body);
  } catch {
    // Not JSON = blocked before the API (Akamai 403 HTML, etc)
    throw new Error(
      `Growin login blocked (HTTP ${res.status}, non-JSON response). Akamai edge likely rejected it. ` +
        `Re-grab a working request from the browser (DevTools > Network > /auth/api/v1/login > Copy as cURL) ` +
        `and reconcile headers/device-id in net/growinAuth.ts (GROWIN_DEVICE_ID lives in .env).`,
    );
  }
  const d = j.data;
  if (!d?.token) {
    // Login reached the API but was rejected. Say why and what to do.
    const hint = d?.is_password_expired
      ? "password expired, reset it in the Growin app"
      : d?.is_otp_verified === false
      ? "account needs OTP verification, log in once in the app to clear it"
      : "wrong email/password, or the account is locked. Update GROWIN_EMAIL/GROWIN_PASSWORD in .env";
    throw new Error(
      `Growin login failed: ${j.message ?? "no token returned"}. ${hint}.`,
    );
  }
  return `AKA_A2=A; login_device_uid=${DEVICE_ID}; REFRESH_TOKEN=${d.refresh_token}; ACCESS_TOKEN=${d.token}`;
};
