import { buildApp } from "./app.js";
const app = await buildApp();
let stopping = false;
let inFlight: Promise<void> | null = null;
function maintain() {
  if (stopping || inFlight) return;
  inFlight = app
    .maintenance()
    .catch(() =>
      app.log.error(
        { code: "MAINTENANCE_FAILED" },
        "Background processing needs attention",
      ),
    )
    .finally(() => {
      inFlight = null;
    });
}
const timer = setInterval(maintain, 60_000);
timer.unref();
app.addHook("preClose", async () => {
  stopping = true;
  clearInterval(timer);
  await inFlight;
});
await app.listen({ host: "0.0.0.0", port: app.config.PORT });
maintain();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void app.close());
