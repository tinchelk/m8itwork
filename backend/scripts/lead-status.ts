import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const input = z
  .tuple([
    z.uuid(),
    z.enum([
      "NEW",
      "CONTACTED",
      "ASSESSMENT_PROPOSED",
      "ASSESSMENT_PAID",
      "PROJECT_PROPOSED",
      "PROJECT_PAID",
      "COMPLETED",
      "DECLINED",
    ]),
  ])
  .safeParse(process.argv.slice(2));
if (!input.success) {
  console.error(
    "Usage: npm run lead:status -- <submission-uuid> <NEW|CONTACTED|ASSESSMENT_PROPOSED|ASSESSMENT_PAID|PROJECT_PROPOSED|PROJECT_PAID|COMPLETED|DECLINED>",
  );
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient();
  try {
    const [id, status] = input.data;
    const result = await prisma.submission.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
    });
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}
