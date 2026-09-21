import { NextResponse } from "next/server";
import { deployedReleaseId } from "../lib/release-id";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { releaseId: deployedReleaseId() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
