import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "AssemblyAI connection failed: ASSEMBLYAI_API_KEY is not configured in the server environment.",
      },
      { status: 503 }
    );
  }

  try {
    const tokenUrl = process.env.ASSEMBLYAI_TOKEN_URL || "https://streaming.assemblyai.com/v3/token";
    const expiresInSeconds = 600;

    const url = new URL(tokenUrl);
    url.searchParams.set("expires_in_seconds", String(expiresInSeconds));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Authorization": apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return NextResponse.json(
        {
          error: `AssemblyAI token generation failed (${response.status}): ${errorText}`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    if (!data?.token) {
      return NextResponse.json(
        { error: "Invalid token response received from AssemblyAI" },
        { status: 502 }
      );
    }

    const wsUrl = process.env.ASSEMBLYAI_AGENT_WS_URL || "wss://agents.assemblyai.com/v1/ws";

    return NextResponse.json({
      token: data.token,
      wsUrl: `${wsUrl}?token=${encodeURIComponent(data.token)}`,
      expiresInSeconds,
    });
  } catch (err: any) {
    console.error("Voice token generation error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to generate AssemblyAI Voice Agent token" },
      { status: 500 }
    );
  }
}
