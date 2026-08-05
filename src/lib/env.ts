import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url().startsWith("postgresql://", {
      message: "DATABASE_URL must be a PostgreSQL connection URL",
    }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    APP_URL: optionalUrl,
    SMTP_HOST: optionalNonEmpty,
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_USER: optionalNonEmpty,
    SMTP_PASSWORD: optionalNonEmpty,
    SMTP_FROM: optionalNonEmpty,
    MEDIA_STORAGE_DIR: z.string().min(1).default("uploads"),
    STORAGE_DRIVER: z.enum(["local", "vercel-blob"]).default("local"),
    BLOB_READ_WRITE_TOKEN: optionalNonEmpty,
  })
  .superRefine((value, context) => {
    const smtpValues = [value.SMTP_HOST, value.SMTP_USER, value.SMTP_PASSWORD, value.SMTP_FROM];
    const configured = smtpValues.filter(Boolean).length;
    if (configured > 0 && configured !== smtpValues.length) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM must be configured together",
      });
    }
    if (value.STORAGE_DRIVER === "vercel-blob" && !value.BLOB_READ_WRITE_TOKEN) {
      context.addIssue({
        code: "custom",
        path: ["BLOB_READ_WRITE_TOKEN"],
        message: "BLOB_READ_WRITE_TOKEN is required when STORAGE_DRIVER is vercel-blob",
      });
    }
    if (value.NODE_ENV === "production") {
      if (!value.APP_URL) {
        context.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "APP_URL must be set explicitly in production (the localhost default is unsafe)",
        });
      } else if (!value.APP_URL.startsWith("https://")) {
        context.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "APP_URL must use https:// in production",
        });
      }
      if (value.STORAGE_DRIVER === "local") {
        context.addIssue({
          code: "custom",
          path: ["STORAGE_DRIVER"],
          message:
            "STORAGE_DRIVER must be vercel-blob in production; local disk storage does not persist on serverless hosts",
        });
      }
    }
  })
  .transform((value) => ({ ...value, APP_URL: value.APP_URL ?? "http://localhost:3000" }));

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function parseServerEnv(source: NodeJS.ProcessEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server environment: ${details}`);
  }

  return result.data;
}

export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}

const seedEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test"]).default("development"),
  SEED_MANAGER_PASSWORD: z.string().min(12),
  SEED_EMPLOYEE_PIN: z.string().regex(/^\d{4}$/),
});

export function parseSeedEnv(source: NodeJS.ProcessEnv) {
  const result = seedEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid seed environment: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  }
  return result.data;
}
