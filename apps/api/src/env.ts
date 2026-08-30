import { z } from "zod";

const environmentSchema = z.object({
  API_URL: z.url().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1),
  DYNAMIC_ENVIRONMENT_ID: z.string().uuid(),
  MONAD_RPC_URL: z.url().default("https://testnet-rpc.monad.xyz"),
  PORT: z.coerce.number().int().positive().default(3001),
  TOKEN_PEPPER: z.string().min(24),
  WEB_URL: z.url().default("http://localhost:3000"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid API environment:\n${errors}`);
  }

  return parsed.data;
}
