const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;

export async function POST() {
  try {
    if (!HEYGEN_API_KEY) {
      return new Response(
        JSON.stringify({ error: "API key is missing from .env" }),
        { status: 500 }
      );
    }

    const res = await fetch("https://api.heygen.com/v1/streaming.create_token", {
      method: "POST",
      headers: {
        "x-api-key": HEYGEN_API_KEY,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const txt = await res.text();
      return new Response(
        JSON.stringify({ error: "Heygen error", detail: txt }),
        { status: res.status }
      );
    }

    const data = await res.json();

    // O Heygen devolve { data: { token, rtcToken, wsUrl } }
    // Temos de devolver o objeto todo, não só a string
    return new Response(
      JSON.stringify({
        rtcToken: data.data?.rtcToken || data.data?.token,
        wsUrl: data.data?.wsUrl,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error retrieving access token:", error);
    return new Response(
      JSON.stringify({ error: "Failed to retrieve access token" }),
      { status: 500 }
    );
  }
}
