import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "../generated/prisma/client.js";
import { hashPassword } from "../src/auth/password.js";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const accounts = {
  manager: {
    role: UserRole.MANAGER,
    username: process.env.DEV_POS_MANAGER_USERNAME ?? "run.manager",
    password: process.env.DEV_POS_MANAGER_PASSWORD ?? "RunCafeManager2026",
  },
  staff: {
    role: UserRole.STAFF,
    username: process.env.DEV_POS_STAFF_USERNAME ?? "run.staff",
    password: process.env.DEV_POS_STAFF_PASSWORD ?? "RunCafeStaff2026",
  },
} as const;

function readAccount(): (typeof accounts)[keyof typeof accounts] {
  const role = process.argv[2] as keyof typeof accounts | undefined;
  if (!role || !(role in accounts)) {
    throw new Error("Usage: provision-dev-pos-user.ts <manager|staff>");
  }
  return accounts[role];
}

function validateLocalDevelopmentDatabase(databaseUrl: string): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development POS users cannot be provisioned in production.");
  }

  const url = new URL(databaseUrl);
  if (!localHosts.has(url.hostname)) {
    throw new Error("Development POS users may only be provisioned against a local database.");
  }

  if (url.pathname.endsWith("_test")) {
    throw new Error("Development POS users cannot be provisioned against a _test database.");
  }
}

async function provision(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  validateLocalDevelopmentDatabase(databaseUrl);
  const account = readAccount();
  const passwordHash = await hashPassword(account.password);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    await prisma.user.upsert({
      where: { username: account.username },
      create: {
        username: account.username,
        passwordHash,
        role: account.role,
        isActive: true,
      },
      update: {
        passwordHash,
        role: account.role,
        isActive: true,
      },
    });

    console.info(`Local ${account.role.toLowerCase()} account is ready.`);
    console.info(`Username: ${account.username}`);
    console.info(`Password: ${account.password}`);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await provision();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown provisioning failure";
  console.error(`Development POS account provisioning failed: ${message}`);
  process.exitCode = 1;
}
