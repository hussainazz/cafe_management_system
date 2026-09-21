/**
 * This value is injected while the POS artifact is built. It is deliberately
 * part of both the browser bundle and the route response, avoiding runtime
 * filesystem access that would bloat the standalone Next.js artifact.
 */
export function deployedReleaseId(): string {
  return process.env.NEXT_PUBLIC_POS_RELEASE_ID?.trim() || "development";
}
