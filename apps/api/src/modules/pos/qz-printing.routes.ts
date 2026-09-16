import { createSign, constants } from "node:crypto";
import { readFile, readFileSync } from "node:fs";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { requireStaff } from "../auth/authorization.js";

const SignBody = z.object({ payload: z.string().min(1).max(256 * 1024) }).strict();

function credentialPaths() {
  if (!env.QZ_CERTIFICATE_PATH || !env.QZ_PRIVATE_KEY_PATH) {
    throw new ApplicationError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Trusted QZ printing is not configured on this server.");
  }
  return { certificate: env.QZ_CERTIFICATE_PATH, privateKey: env.QZ_PRIVATE_KEY_PATH };
}

export const qzPrintingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/pos/printing/qz/certificate", { preHandler: requireStaff }, async (request) => {
    const { certificate } = credentialPaths();
    try { return { data: { certificate: readFileSync(certificate, "utf8") }, meta: { requestId: request.id } }; }
    catch { throw new ApplicationError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Trusted QZ printing credentials are unavailable."); }
  });
  app.post<{ Body: z.infer<typeof SignBody> }>("/pos/printing/qz/sign", { preHandler: requireStaff }, async (request) => {
    const body = SignBody.parse(request.body);
    const { privateKey } = credentialPaths();
    try {
      const signer = createSign("RSA-SHA512");
      signer.update(body.payload, "utf8"); signer.end();
      const signature = signer.sign({ key: readFileSync(privateKey, "utf8"), padding: constants.RSA_PKCS1_PADDING }, "base64");
      return { data: { signature }, meta: { requestId: request.id } };
    } catch { throw new ApplicationError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Trusted QZ printing credentials are unavailable."); }
  });
};
