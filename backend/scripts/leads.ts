import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  const submissions = await prisma.submission.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  console.log(JSON.stringify(submissions, null, 2));
} finally {
  await prisma.$disconnect();
}
