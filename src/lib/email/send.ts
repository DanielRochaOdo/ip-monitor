import nodemailer from "nodemailer";
import { getRequiredEnv } from "@/lib/env";

function getSmtpConfig() {
  const smtpHost = getRequiredEnv("SMTP_HOST").trim();
  const smtpPortRaw = getRequiredEnv("SMTP_PORT").trim();
  const smtpUser = getRequiredEnv("SMTP_USERNAME").trim();
  // Some providers (ex: Gmail) display "app password" with spaces; tolerate that in .env.
  const smtpPass = getRequiredEnv("SMTP_PASSWORD").replace(/\s+/g, "");
  const fromAddress = getRequiredEnv("EMAIL_FROM").trim();

  const smtpPort = Number(smtpPortRaw);
  if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
    throw new Error("SMTP_PORT inválido. Use 465 ou 587 (ex: 587).");
  }

  // Very common misconfig: setting SMTP_HOST to an email address instead of the SMTP hostname.
  if (smtpHost.includes("@")) {
    throw new Error(
      `SMTP_HOST inválido ("${smtpHost}"). Use o hostname do servidor SMTP (ex: smtp.gmail.com).`,
    );
  }

  return { smtpHost, smtpPort, smtpUser, smtpPass, fromAddress };
}

let cachedTransporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const { smtpHost, smtpPort, smtpUser, smtpPass } = getSmtpConfig();

  cachedTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  return cachedTransporter;
}

type SendMonitorEmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
};

export async function sendMonitorEmail({ to, subject, html }: SendMonitorEmailOptions) {
  const { fromAddress } = getSmtpConfig();
  const transporter = getTransporter();

  await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html,
  });
}
