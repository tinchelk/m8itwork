import type { PrismaClient } from "@prisma/client";
export async function cleanup(prisma: PrismaClient) {
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
  await prisma.reviewSession.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.accountSession.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.accountToken.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.accountClosure.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.authThrottle.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.healthAlert.deleteMany({ where: { resolvedAt: { lt: new Date(Date.now() - 90 * 86400_000) } } });
  await prisma.notificationToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  await prisma.notificationOutbox.deleteMany({
    where: {
      OR: [
        { sentAt: { lt: new Date(Date.now() - 90 * 86400_000) } },
        { skippedAt: { lt: new Date(Date.now() - 90 * 86400_000) } },
      ],
    },
  });
}
