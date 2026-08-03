import nodemailer from "nodemailer";
import { AppError } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";

function getSmtpConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
} {
  const env = getServerEnv();
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM) {
    throw new AppError("SERVICE_UNAVAILABLE", "Password reset email is not configured.");
  }
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
  };
}

export function assertPasswordResetEmailConfigured(): void {
  getSmtpConfig();
}

export async function sendPasswordResetEmail(input: {
  email: string;
  displayName: string;
  resetUrl: string;
}): Promise<void> {
  const smtp = getSmtpConfig();

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  await transport.sendMail({
    from: smtp.from,
    to: input.email,
    subject: "Reset your StationSnap password",
    text: `Hello ${input.displayName},\n\nUse this link within 30 minutes to reset your StationSnap password:\n${input.resetUrl}\n\nIf you did not request this, you can ignore this message.`,
  });
}
