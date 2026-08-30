import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string, pepper: string): string {
  return createHash("sha256").update(pepper).update("\0").update(token).digest("hex");
}

export function verifyPkce(verifier: string, expectedChallenge: string): boolean {
  const actualChallenge = createHash("sha256").update(verifier).digest("base64url");
  return actualChallenge === expectedChallenge;
}
