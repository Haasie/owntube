import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    console.log(`[CLIENT-LOG]`, JSON.stringify(body));
  } catch {
    // ignore malformed payloads
  }
  return new NextResponse(null, { status: 204 });
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}
