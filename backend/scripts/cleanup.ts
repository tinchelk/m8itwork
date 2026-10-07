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
      oauthAttemptId: null,
      oauthPurpose: null,
      oauthAccountId: null,
      oauthNonceHash: null,
    },
  });
  const result = await prisma.reviewSession.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  await prisma.accountSession.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.accountToken.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.accountClosure.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.authThrottle.deleteMany({ where: { expiresAt: { lt: now } } });
  console.log(
    `Removed ${result.count} expired browser sessions. Submitted briefs are retained.`,
  );
} finally {
  await prisma.$disconnect();
}
