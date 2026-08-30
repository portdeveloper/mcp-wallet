import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { hashToken, verifyPkce } from "./crypto.js";

describe("OAuth crypto", () => {
  it("verifies an S256 PKCE challenge", () => {
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(`${verifier}b`, challenge)).toBe(false);
  });

  it("hashes tokens with a deployment-specific pepper", () => {
    expect(hashToken("token", "pepper-one")).not.toBe(
      hashToken("token", "pepper-two"),
    );
  });
});
