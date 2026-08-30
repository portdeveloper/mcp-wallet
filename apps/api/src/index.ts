import { buildApp } from "./app.js";
import { readEnvironment } from "./env.js";

const environment = readEnvironment();
const app = await buildApp(environment);

try {
  await app.listen({ host: "0.0.0.0", port: environment.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
