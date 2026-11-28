/**
 * Chalbazi API Worker — staged security migration
 *
 * This first stage ONLY authenticates Telegram Mini App initData.
 * It deliberately does not read/write Firebase or accept score values.
 * Deploy only after setting TELEGRAM_BOT_TOKEN and APP_ORIGIN secrets/vars.
 */
const encoder = new TextEncoder();

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validates Telegram WebApp initData according to Telegram's HMAC scheme.
 * Rejects stale payloads and malformed/duplicate fields.
 */
async function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 3600) {
  if (!initData || initData.length > 8192 || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hashes = params.getAll("hash");
  if (hashes.length !== 1 || !/^[a-f0-9]{64}$/i.test(hashes[0])) return null;

  const entries = Array.from(params.entries()).filter(([k]) => k !== "hash");
  const keys = entries.map(([k]) => k);
  if (new Set(keys).size !== keys.length) return null;

  const authDateValues = params.getAll("auth_date");
  if (authDateValues.length !== 1) return null;
  const authDate = Number(authDateValues[0]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(authDate) || authDate > now + 30 || now - authDate > maxAgeSeconds) return null;

  const dataCheckString = entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = await hmacSha256(encoder.encode("WebAppData"), botToken);
  const calculatedHash = hex(await hmacSha256(secretKey, dataCheckString));
  if (!constantTimeEqual(calculatedHash, hashes[0].toLowerCase())) return null;

  let user;
  try {
    const raw = params.get("user");
    if (!raw) return null;
    user = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!user || (typeof user.id !== "number" && typeof user.id !== "string")) return null;

  return {
    telegramId: String(user.id),
    firstName: String(user.first_name || "").slice(0, 64),
    lastName: String(user.last_name || "").slice(0, 64),
    username: String(user.username || "").slice(0, 64),
    authDate,
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      if (!cors["access-control-allow-origin"]) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "chalbazi-api", stage: "telegram-auth-only" }, 200, cors);
    }

    if (url.pathname === "/api/auth/telegram" && request.method === "POST") {
      if (!cors["access-control-allow-origin"]) return json({ ok: false, error: "origin_not_allowed" }, 403);
      if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: "server_not_configured" }, 503, cors);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ ok: false, error: "invalid_json" }, 400, cors);
      }

      const user = await verifyTelegramInitData(body?.initData, env.TELEGRAM_BOT_TOKEN);
      if (!user) return json({ ok: false, error: "invalid_or_expired_init_data" }, 401, cors);

      // Do not return or log initData, bot token, or other Telegram payload fields.
      return json({ ok: true, user }, 200, cors);
    }

    return json({ ok: false, error: "not_found" }, 404, cors);
  },
};

export { verifyTelegramInitData };
