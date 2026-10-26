import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TerminalClaimSchema, TerminalIntentSchema, TerminalResultSchema } from "@cafe/contracts";
import { claimMessage, intentMessage, resultMessage, signTerminalMessage, verifyTerminalMessage } from "../../src/modules/terminal-payments/terminal-signatures.js";
const vectors = JSON.parse(readFileSync(new URL("../../../sep-bridge/tests/protocol-vectors.json", import.meta.url), "utf8"));
const key = "00".repeat(32); // Shared C#/TypeScript fake vectors, not an installation key.
describe("Terminal proof conformance", () => {
  it("matches the C# worker's fixed UTF-8 field order and nullable encoding", () => {
    const intent = TerminalIntentSchema.parse({ ...vectors.intent, signature: vectors.intentSignature });
    const claim = TerminalClaimSchema.parse(vectors.claim); const result = TerminalResultSchema.parse(vectors.result);
    for (const [actual, expected, signature] of [[intentMessage(intent), vectors.intentMessage, vectors.intentSignature], [claimMessage(claim), vectors.claimMessage, vectors.claimSignature], [resultMessage(result), vectors.resultMessage, vectors.resultSignature]]) {
      expect(actual).toBe(expected); expect(signTerminalMessage(actual, key)).toBe(signature); expect(verifyTerminalMessage(actual, signature, key)).toBe(true);
    }
  });
  it("binds every intent scalar and rejects malformed, wrong-key and cross-purpose signatures", () => {
    for (const field of Object.keys(vectors.intent)) {
      const original = vectors.intent[field]; const changed = { ...vectors.intent, [field]: typeof original === "number" ? original + 1 : original + "x" };
      expect(verifyTerminalMessage(intentMessage(changed), vectors.intentSignature, key)).toBe(false);
    }
    expect(verifyTerminalMessage(vectors.claimMessage, vectors.intentSignature, key)).toBe(false);
    expect(verifyTerminalMessage(vectors.resultMessage, vectors.resultSignature, "11".repeat(32))).toBe(false);
    for (const proof of [null, {}, "bad", "FF".repeat(32)]) expect(verifyTerminalMessage(vectors.intentMessage, proof, key)).toBe(false);
  });
});
