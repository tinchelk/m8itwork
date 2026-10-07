import { PrismaClient } from "@prisma/client";
import { loadEnv } from "../src/config.js";
import { pairWorker } from "../src/reviews/routes.js";
const env = loadEnv();
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
try {
  const { token } = await pairWorker(prisma, env, process.argv[2] ?? "", process.argv[3] ?? "Mac review worker");
  // Provisioning output is a secret: pipe directly into private worker configuration, never a terminal or logs.
  process.stdout.write(JSON.stringify({ apiUrl: `${env.PUBLIC_API_URL.replace(/\/$/, "")}/`, token, providers: ["codex"] }));
} finally { await prisma.$disconnect(); }
