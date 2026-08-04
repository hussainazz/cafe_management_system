import { buildApp } from "./app.js";
import { env } from "./config/env.js";

const app = buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutdown requested");

  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ error }, "Graceful shutdown failed");
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({
    host: env.HOST,
    port: env.PORT,
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
