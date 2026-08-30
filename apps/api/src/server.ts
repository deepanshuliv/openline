import { createLogger } from "@repo/shared";
import { createApp } from "./app.js";
import { env } from "./env.js";

const logger = createLogger("api");
const app = createApp();

app.listen(env.API_PORT, () => {
  logger.info(`api listening`, { port: env.API_PORT, corsOrigin: env.CORS_ORIGIN });
});
