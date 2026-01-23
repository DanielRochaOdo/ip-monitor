import nodemailer from "nodemailer";
import { getRequiredEnv } from "@/lib/env";

const smtpHost = getRequiredEnv("SMTP_HOST");
const smtpPort = Number(getRequiredEnv("SMTP_PORT"));
const smtpUser = getRequiredEnv("SMTP_USERNAME");
const smtpPass = getRequiredEnv("SMTP_PASSWORD");
const fromAddress = getRequiredEnv("EMAIL_FROM");

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

type SendMonitorEmailOptions = {
  to: string | string[];
  subject: string;
  html: string;
};

export async function sendMonitorEmail({ to, subject, html }: SendMonitorEmailOptions) {
  await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html,
  });
}
