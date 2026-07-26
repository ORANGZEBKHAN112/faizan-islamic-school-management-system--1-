import crypto from "crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const DEFAULT_OTP_EMAILS = ["ceo@faizanschool.net", "erp01@faizanschool.net"];

export interface LoginOtpChallenge {
  userId: string;
  username: string;
  role: string;
  campusId?: string;
  otpHash: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
}

const challenges = new Map<string, LoginOtpChallenge>();

function pruneExpiredChallenges(): void {
  const now = Date.now();
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(id);
  }
}

export function getSuperAdminOtpEmails(): string[] {
  const raw = process.env.SUPERADMIN_OTP_EMAILS?.trim();
  if (!raw) return [...DEFAULT_OTP_EMAILS];
  const list = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [...DEFAULT_OTP_EMAILS];
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

function generateOtpCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

async function sendOtpEmail(code: string, username: string): Promise<void> {
  const recipients = getSuperAdminOtpEmails();
  const subject = "FISS Super Admin login verification code";
  const text =
    `Your FISS Super Admin login verification code is: ${code}\n\n` +
    `Username: ${username}\n` +
    `This code expires in 10 minutes. If you did not attempt to sign in, ignore this email.`;

  if (!isSmtpConfigured()) {
    if (IS_PRODUCTION) {
      throw new Error("Email is not configured. Set SMTP_HOST and related SMTP variables.");
    }
    console.warn(
      `[login-otp] SMTP not configured — Super Admin OTP for "${username}" is ${code} (recipients: ${recipients.join(", ")})`
    );
    return;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBooleanEnv("SMTP_SECURE", port === 465);
  const user = process.env.SMTP_USER?.trim() || undefined;
  const pass = process.env.SMTP_PASS?.trim() || undefined;
  const from = process.env.SMTP_FROM?.trim() || user || "noreply@faizanschool.net";

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  await transport.sendMail({
    from,
    to: recipients.join(", "),
    subject,
    text,
  });
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export async function createLoginOtpChallenge(user: {
  id: string;
  username: string;
  role: string;
  campusId?: string | null;
}): Promise<{ challengeId: string }> {
  if (IS_PRODUCTION && !isSmtpConfigured()) {
    throw new Error("Email is not configured for Super Admin login verification.");
  }

  pruneExpiredChallenges();

  const code = generateOtpCode();
  const otpHash = await bcrypt.hash(code, 10);
  const challengeId = crypto.randomUUID();
  const now = Date.now();

  challenges.set(challengeId, {
    userId: user.id,
    username: user.username,
    role: user.role,
    campusId: user.campusId || undefined,
    otpHash,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lastSentAt: now,
  });

  try {
    await sendOtpEmail(code, user.username);
  } catch (err) {
    challenges.delete(challengeId);
    throw err;
  }

  return { challengeId };
}

export async function resendLoginOtp(challengeId: string): Promise<{ ok: true } | { error: string; status: number }> {
  pruneExpiredChallenges();
  const challenge = challenges.get(challengeId);
  if (!challenge) {
    return { error: "Verification session expired. Please sign in again.", status: 400 };
  }
  if (challenge.expiresAt <= Date.now()) {
    challenges.delete(challengeId);
    return { error: "Verification session expired. Please sign in again.", status: 400 };
  }
  const waitMs = RESEND_COOLDOWN_MS - (Date.now() - challenge.lastSentAt);
  if (waitMs > 0) {
    return {
      error: `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting a new code.`,
      status: 429,
    };
  }
  if (IS_PRODUCTION && !isSmtpConfigured()) {
    return { error: "Email is not configured for Super Admin login verification.", status: 503 };
  }

  const code = generateOtpCode();
  challenge.otpHash = await bcrypt.hash(code, 10);
  challenge.attempts = 0;
  challenge.lastSentAt = Date.now();
  challenge.expiresAt = Date.now() + OTP_TTL_MS;

  try {
    await sendOtpEmail(code, challenge.username);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send verification email";
    return { error: message, status: 503 };
  }

  return { ok: true };
}

export async function verifyLoginOtp(
  challengeId: string,
  code: string
): Promise<{ challenge: LoginOtpChallenge } | { error: string; status: number }> {
  pruneExpiredChallenges();
  const challenge = challenges.get(challengeId);
  if (!challenge) {
    return { error: "Verification session expired. Please sign in again.", status: 400 };
  }
  if (challenge.expiresAt <= Date.now()) {
    challenges.delete(challengeId);
    return { error: "Verification session expired. Please sign in again.", status: 400 };
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    challenges.delete(challengeId);
    return { error: "Too many invalid attempts. Please sign in again.", status: 429 };
  }

  const trimmed = String(code || "").trim();
  if (!/^\d{6}$/.test(trimmed)) {
    challenge.attempts += 1;
    if (challenge.attempts >= MAX_ATTEMPTS) {
      challenges.delete(challengeId);
      return { error: "Too many invalid attempts. Please sign in again.", status: 429 };
    }
    return { error: "Invalid verification code", status: 401 };
  }

  const valid = await bcrypt.compare(trimmed, challenge.otpHash);
  if (!valid) {
    challenge.attempts += 1;
    if (challenge.attempts >= MAX_ATTEMPTS) {
      challenges.delete(challengeId);
      return { error: "Too many invalid attempts. Please sign in again.", status: 429 };
    }
    return { error: "Invalid verification code", status: 401 };
  }

  challenges.delete(challengeId);
  return { challenge };
}
