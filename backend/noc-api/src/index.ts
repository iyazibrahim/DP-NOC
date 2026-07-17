import { createApp } from "./app";
import { env } from "./env";

async function main() {
  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`noc-api listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("noc-api failed to start:", err);
  process.exit(1);
});

