import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { cleanup } from "../src/maintenance.js";
const prisma = new PrismaClient();
try {
  await cleanup(prisma);
  console.log(
    "Expired credentials and notification delivery records cleared. Business history retained.",
  );
} finally {
  await prisma.$disconnect();
}
