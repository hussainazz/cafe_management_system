import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import {
  ApplicationError,
  ErrorCodes,
  type ErrorCode,
  type ErrorDetail,
} from "./application-error.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
    timestamp: string;
  };
};

function validationPath(instancePath: unknown, validationContext: unknown): string {
  const segments = typeof instancePath === "string" ? instancePath.split("/").filter(Boolean) : [];
  const prefix = typeof validationContext === "string" ? validationContext : "";

  return [prefix, ...segments]
    .filter(Boolean)
    .map((segment, index) => (index > 0 && /^\d+$/.test(segment) ? `[${segment}]` : segment))
    .join(".")
    .replace(".[", "[");
}

function validationDetails(error: FastifyError): ErrorDetail[] | undefined {
  if (!error.validation) {
    return undefined;
  }

  return error.validation.map((issue) => ({
    path: validationPath(issue.instancePath, error.validationContext),
    code: issue.keyword ?? "invalid",
    message: issue.message ?? "Invalid value.",
  }));
}

function fallbackError(statusCode: number): Pick<ApplicationError, "code" | "message"> {
  switch (statusCode) {
    case 400:
      return { code: ErrorCodes.BAD_REQUEST, message: "The request is invalid." };
    case 401:
      return { code: ErrorCodes.AUTHENTICATION_REQUIRED, message: "Authentication is required." };
    case 403:
      return {
        code: ErrorCodes.FORBIDDEN,
        message: "You do not have permission to perform this action.",
      };
    case 404:
      return { code: ErrorCodes.NOT_FOUND, message: "The requested resource was not found." };
    case 409:
      return {
        code: ErrorCodes.CONFLICT,
        message: "The request conflicts with the current state.",
      };
    case 422:
      return {
        code: ErrorCodes.BUSINESS_RULE_VIOLATION,
        message: "The request violates a business rule.",
      };
    case 429:
      return {
        code: ErrorCodes.RATE_LIMITED,
        message: "Too many requests. Please try again later.",
      };
    case 503:
      return {
        code: ErrorCodes.SERVICE_UNAVAILABLE,
        message: "A required service is unavailable.",
      };
    default:
      return { code: ErrorCodes.INTERNAL_ERROR, message: "An unexpected error occurred." };
  }
}

function errorResponse(
  request: FastifyRequest,
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
      requestId: request.id,
      timestamp: new Date().toISOString(),
    },
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    const { code, message } = fallbackError(404);
    return reply.status(404).send(errorResponse(request, code, message));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApplicationError) {
      return reply
        .status(error.statusCode)
        .send(errorResponse(request, error.code, error.message, error.details));
    }

    const fastifyError = error as FastifyError;

    if (fastifyError.validation || fastifyError.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      return reply
        .status(400)
        .send(
          errorResponse(
            request,
            ErrorCodes.VALIDATION_ERROR,
            "One or more fields are invalid.",
            validationDetails(fastifyError),
          ),
        );
    }

    const statusCode =
      typeof fastifyError.statusCode === "number" && fastifyError.statusCode >= 400
        ? fastifyError.statusCode
        : 500;
    const { code, message } = fallbackError(statusCode);

    if (statusCode >= 500) {
      request.log.error(
        { errName: error instanceof Error ? error.name : "UnknownError", requestId: request.id },
        "Unhandled request error",
      );
    }

    return reply.status(statusCode).send(errorResponse(request, code, message));
  });
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}
