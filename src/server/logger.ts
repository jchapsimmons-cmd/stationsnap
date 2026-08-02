import pino from "pino";

const level = process.env["LOG_LEVEL"] ?? "info";

export const logger = pino({
  level,
  base: {
    service: "stationsnap",
    environment: process.env["NODE_ENV"] ?? "development",
  },
  redact: {
    paths: [
      "password",
      "pin",
      "token",
      "authorization",
      "cookie",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.pin",
      "*.token",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});
