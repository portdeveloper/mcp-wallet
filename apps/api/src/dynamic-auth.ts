import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import type { Environment } from "./env.js";

const verifiedCredentialSchema = z.object({
  address: z.string().optional(),
  chain: z.string().optional(),
  email: z.string().email().optional(),
  format: z.string().optional(),
  id: z.string().optional(),
  wallet_provider: z.string().optional(),
});

type VerifiedCredential = z.infer<typeof verifiedCredentialSchema>;

const dynamicProfileSchema = z.object({
  id: z.string(),
  projectEnvironmentId: z.string(),
  email: z.string().email().nullable().optional(),
  verifiedCredentials: z.array(verifiedCredentialSchema),
});

export interface DynamicIdentity {
  dynamicUserId: string;
  email: string;
  wallet: {
    address: string;
    dynamicWalletId?: string;
  };
}

function getCredentials(payload: JWTPayload): VerifiedCredential[] {
  const value = payload.verified_credentials;
  const parsed = z.array(verifiedCredentialSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function createDynamicTokenVerifier(environment: Environment) {
  const jwks = createRemoteJWKSet(
    new URL(
      `https://app.dynamic.xyz/api/v0/sdk/${environment.DYNAMIC_ENVIRONMENT_ID}/.well-known/jwks`,
    ),
  );

  return async function verifyDynamicToken(
    token: string,
    submittedWalletAddress?: string,
  ): Promise<DynamicIdentity> {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
    });

    if (!payload.sub || !payload.exp || payload.exp * 1000 <= Date.now()) {
      throw new Error("Dynamic token is missing a valid subject or expiration");
    }

    const issuer = payload.iss ?? "";
    if (!issuer.endsWith(`/${environment.DYNAMIC_ENVIRONMENT_ID}`)) {
      throw new Error("Dynamic token issuer does not match this environment");
    }

    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (!scopes.includes("user:basic")) {
      throw new Error("Dynamic authentication is not complete");
    }

    const tokenCredentials = getCredentials(payload);
    const tokenEmailCredential = tokenCredentials.find(
      (credential) => credential.format === "email" && credential.email,
    );
    const profileResponse = await fetch(
      `https://app.dynamicauth.com/api/v0/sdk/${environment.DYNAMIC_ENVIRONMENT_ID}/users`,
      {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!profileResponse.ok) {
      throw new Error(`Dynamic profile lookup failed with status ${profileResponse.status}`);
    }

    const profile = dynamicProfileSchema.parse(await profileResponse.json());
    if (
      profile.id !== payload.sub ||
      profile.projectEnvironmentId !== environment.DYNAMIC_ENVIRONMENT_ID
    ) {
      throw new Error("Dynamic profile does not match the authenticated environment or user");
    }

    // Dynamic provider metadata varies between embedded-wallet implementations.
    // Matching the exact submitted address against the fresh authenticated
    // profile proves that the Dynamic user owns this wallet.
    const walletCredentials = profile.verifiedCredentials.filter(
      (credential) => credential.format === "blockchain" && credential.address,
    );
    const normalizedSubmittedAddress = submittedWalletAddress?.toLowerCase();
    const walletCredential = normalizedSubmittedAddress
      ? walletCredentials.find(
          (credential) => credential.address?.toLowerCase() === normalizedSubmittedAddress,
        )
      : walletCredentials[0];

    const email = tokenEmailCredential?.email ?? profile.email ?? undefined;
    if (!email) {
      throw new Error("Dynamic token does not contain a verified email credential");
    }
    if (!walletCredential?.address) {
      throw new Error("The submitted wallet is not present in the authenticated Dynamic profile.");
    }

    return {
      dynamicUserId: payload.sub,
      email,
      wallet: {
        address: walletCredential.address,
        ...(walletCredential.id ? { dynamicWalletId: walletCredential.id } : {}),
      },
    };
  };
}
