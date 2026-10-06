import { buildApp } from "./app.js";
const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: app.config.PORT });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void app.close());
