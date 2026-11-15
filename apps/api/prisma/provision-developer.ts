import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "../generated/prisma/client.js";
import { hashPassword, validateBootstrapPassword } from "../src/auth/password.js";

async function provisionDeveloper(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const username = process.env.DEVELOPER_USERNAME;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!username || !/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error("DEVELOPER_USERNAME must be 3-64 lowercase letters, digits, periods, underscores, or hyphens");
  }
  const password = validateBootstrapPassword(process.env.DEVELOPER_PASSWORD);
  const passwordHash = await hashPassword(password);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    await prisma.$transaction(async (transaction) => {
      const existing = await transaction.user.findUnique({ where: { username }, select: { id: true, role: true } });
      if (existing && existing.role !== UserRole.DEVELOPER) {
        throw new Error("The username already belongs to a different account role.");
      }
      const user = existing
        ? await transaction.user.update({ where: { id: existing.id }, data: { passwordHash, isActive: true }, select: { id: true } })
        : await transaction.user.create({ data: { username, passwordHash, role: UserRole.DEVELOPER }, select: { id: true } });
      await transaction.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    console.info("Developer account provisioned and existing sessions revoked.");
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await provisionDeveloper();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown provisioning failure";
  console.error(`Developer account provisioning failed: ${message}`);
  process.exitCode = 1;
}
