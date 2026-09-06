import type { PrismaClient } from "../../generated/prisma/client.js";
import { readCookie } from "../auth/session.js";
import { ApplicationError, ErrorCodes } from "../errors/application-error.js";
import {
  createCustomerSessionToken,
  createOtpCode,
  customerAuthCookieName,
  customerAuthLifetimeSeconds,
  customerOtpLifetimeSeconds,
  customerOtpMaxAttempts,
  customerOtpResendCooldownSeconds,
  customerTableVisitLifetimeSeconds,
  hashCustomerPhone,
  hashCustomerSessionToken,
  hashOtp,
  normalizeIranMobile,
  otpMatches,
} from "./customer-auth.js";

export async function readCustomerAuth(prisma: PrismaClient, cookieHeader: string | undefined) {
  const token = readCookie(cookieHeader, customerAuthCookieName);
  if (!token) return null;
  return prisma.customerAuthSession.findFirst({
    where: { tokenHash: hashCustomerSessionToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { customer: true },
  });
}

export async function requestCustomerOtp(prisma: PrismaClient, credentialId: string, phoneInput: string) {
  const phone = normalizeIranMobile(phoneInput);
  if (!phone) throw new ApplicationError(400, ErrorCodes.BAD_REQUEST, "Invalid mobile number.");
  const now = new Date();
  const phoneLookupHash = hashCustomerPhone(phone);
  const recent = await prisma.customerOtpChallenge.findFirst({
    where: { phoneLookupHash, tableCredentialId: credentialId, purpose: "TABLE_WAITER_CALL", consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (recent && recent.resendAvailableAt > now) {
    throw new ApplicationError(429, ErrorCodes.OTP_RESEND_COOLDOWN, "Please wait before requesting another code.");
  }
  const id = crypto.randomUUID();
  const code = createOtpCode();
  const challenge = await prisma.customerOtpChallenge.create({
    data: {
      id,
      phoneLookupHash,
      tableCredentialId: credentialId,
      purpose: "TABLE_WAITER_CALL",
      codeHash: hashOtp(id, code),
      expiresAt: new Date(now.getTime() + customerOtpLifetimeSeconds * 1_000),
      resendAvailableAt: new Date(now.getTime() + customerOtpResendCooldownSeconds * 1_000),
    },
  });
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt, resendAvailableAt: challenge.resendAvailableAt };
}

export async function verifyCustomerOtp(prisma: PrismaClient, challengeId: string, code: string) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const challenge = await tx.customerOtpChallenge.findUnique({ where: { id: challengeId }, include: { tableCredential: { include: { table: true } } } });
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) throw new ApplicationError(401, ErrorCodes.OTP_EXPIRED, "The verification code is no longer valid.");
    if (challenge.attemptCount >= customerOtpMaxAttempts) throw new ApplicationError(429, ErrorCodes.OTP_ATTEMPTS_EXCEEDED, "Too many verification attempts.");
    if (!otpMatches(challenge.id, code, challenge.codeHash)) {
      await tx.customerOtpChallenge.update({ where: { id: challenge.id }, data: { attemptCount: { increment: 1 } } });
      throw new ApplicationError(401, ErrorCodes.OTP_INVALID, "The verification code is not valid.");
    }
    const consumed = await tx.customerOtpChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) throw new ApplicationError(409, ErrorCodes.CONFLICT, "The verification code has already been used.");
    const customer = await tx.customer.upsert({ where: { phoneLookupHash: challenge.phoneLookupHash }, create: { phoneLookupHash: challenge.phoneLookupHash }, update: {} });
    await tx.customerTableVisit.updateMany({ where: { customerId: customer.id, invalidatedAt: null }, data: { invalidatedAt: now } });
    const visit = await tx.customerTableVisit.create({ data: { customerId: customer.id, tableId: challenge.tableCredential.tableId, tableCredentialId: challenge.tableCredentialId, expiresAt: new Date(now.getTime() + customerTableVisitLifetimeSeconds * 1_000) } });
    const token = createCustomerSessionToken();
    await tx.customerAuthSession.create({ data: { customerId: customer.id, tokenHash: hashCustomerSessionToken(token), expiresAt: new Date(now.getTime() + customerAuthLifetimeSeconds * 1_000) } });
    return { token, visit };
  });
}

export async function createVisitForAuthenticatedCustomer(prisma: PrismaClient, customerId: string, credentialId: string) {
  const now = new Date();
  const credential = await prisma.tableQrCredential.findFirst({ where: { id: credentialId, isActive: true, table: { isActive: true, archivedAt: null, waiterCallEnabled: true } } });
  if (!credential) return null;
  return prisma.$transaction(async (tx) => {
    await tx.customerTableVisit.updateMany({ where: { customerId, invalidatedAt: null }, data: { invalidatedAt: now } });
    return tx.customerTableVisit.create({ data: { customerId, tableId: credential.tableId, tableCredentialId: credential.id, expiresAt: new Date(now.getTime() + customerTableVisitLifetimeSeconds * 1_000) } });
  });
}
