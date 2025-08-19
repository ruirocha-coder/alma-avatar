// /app/api/get-access-token/route.ts

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;

export async function POST() {
  try {
    if (!HEYGEN_API_KEY) {
      return new Response("Missing HEYGEN_API_KEY", { status: 500 });
    }

    const res = await fetch("https://api.heygen.com/v1/streaming.create_token", {
      method: "POST",
      headers: {
        "x-api-key": HEYGEN_API_KEY,
      },
      // body: JSON.stringify({}) // ← só se o teu plano exigir payload; normalmente não é preciso
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return new Response(`HEYGEN token error: ${res.status} ${txt}`, {
        status: res.status,
      });
    }

    const data = await res.json().catch(() => ({} as any));
    const token = data?.data?.token || data?.token;

    if (!token) {
      return new Response("Token not found in Heygen response", { status: 500 });
    }

    return new Response(token, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err: any) {
    return new Response(`Failed to retrieve access token: ${err?.message || err}`, {
      status: 500,
    });
  }
}
