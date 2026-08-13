import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "../generated/prisma/client.js";
import { hashPassword, validateBootstrapPassword } from "../src/auth/password.js";

const bootstrapLockId = 741203001n;

function validateBootstrapUsername(username: string | undefined): string {
  if (!username || !/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new Error(
      "BOOTSTRAP_MANAGER_USERNAME must be 3-64 lowercase letters, digits, periods, underscores, or hyphens",
    );
  }

  return username;
}

async function bootstrapManager(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const password = validateBootstrapPassword(process.env.BOOTSTRAP_MANAGER_PASSWORD);
  const username = validateBootstrapUsername(process.env.BOOTSTRAP_MANAGER_USERNAME);
  const passwordHash = await hashPassword(password);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${bootstrapLockId})`;

      const managerCount = await transaction.user.count({
        where: { role: UserRole.MANAGER },
      });

      if (managerCount > 0) {
        throw new Error("Bootstrap refused: a Manager account already exists");
      }

      await transaction.user.create({
        data: {
          username,
          passwordHash,
          role: UserRole.MANAGER,
        },
      });
    });

    console.info("Initial Manager account created.");
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await bootstrapManager();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown bootstrap failure";
  console.error(`Manager bootstrap failed: ${message}`);
  process.exitCode = 1;
}
