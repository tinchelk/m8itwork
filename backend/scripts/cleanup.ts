import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  const now = new Date();
  await prisma.reviewSession.updateMany({
    where: { tokenExpiresAt: { lt: now } },
    data: { tokenEncrypted: null, tokenExpiresAt: null, githubLogin: null },
  });
  await prisma.reviewSession.updateMany({
    where: { oauthExpiresAt: { lt: now } },
    data: {
      oauthStateHash: null,
      oauthExpiresAt: null,
      verifierEncrypted: null,
    },
  });
  const result = await prisma.reviewSession.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  console.log(
    `Removed ${result.count} expired browser sessions. Submitted briefs are retained.`,
  );
} finally {
  await prisma.$disconnect();
}
