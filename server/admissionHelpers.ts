import type sql from "mssql";

export const ADMISSION_TEST_PASS_MARKS = Number(process.env.ADMISSION_TEST_PASS_MARKS || 40);

export const ADMISSION_DOC_TYPES = ["b_form", "birth_certificate", "previous_school", "other"] as const;
export type AdmissionDocType = (typeof ADMISSION_DOC_TYPES)[number];

export type AdmissionSmsTemplate =
  | "admission_application_received"
  | "admission_under_review"
  | "admission_rejected"
  | "admission_interview_schedule";

export async function generateAdmissionTrackingNo(pool: sql.ConnectionPool): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `ADM-${year}-%`;
  const result = await pool.request()
    .input("pattern", pattern)
    .query("SELECT COUNT(*) AS cnt FROM AdmissionApplications WHERE tracking_no LIKE @pattern");
  const seq = Number(result.recordset[0]?.cnt ?? 0) + 1;
  return `ADM-${year}-${String(seq).padStart(4, "0")}`;
}

function buildAdmissionSmsMessage(payload: {
  template: AdmissionSmsTemplate;
  applicantName?: string;
  campusName?: string;
  campusAddress?: string | null;
  campusPhone?: string | null;
  trackingNo?: string;
  applicationId: string;
  interviewAt?: string;
  rejectionReason?: string;
}): string {
  const name = payload.applicantName || "your child";
  const campus = payload.campusName || "Faizan Islamic School";
  const ref = payload.trackingNo || payload.applicationId.slice(0, 8);

  switch (payload.template) {
    case "admission_application_received":
      return [
        "Dear Parent/Guardian,",
        `We received the admission application for ${name}.`,
        `Tracking No: ${ref}`,
        `Campus: ${campus}`,
        "Our team will review and contact you soon.",
      ].join(" ");
    case "admission_under_review":
      return [
        "Dear Parent/Guardian,",
        `The admission application for ${name} is now under review.`,
        `Tracking No: ${ref}`,
        `Campus: ${campus}`,
        "We will notify you of the next steps.",
      ].join(" ");
    case "admission_rejected": {
      const reason = payload.rejectionReason ? ` Reason: ${payload.rejectionReason}.` : "";
      return [
        "Dear Parent/Guardian,",
        `We regret to inform you that the admission application for ${name} could not be approved.${reason}`,
        `Tracking No: ${ref}`,
        payload.campusPhone ? `Contact: ${payload.campusPhone}` : "",
      ].filter(Boolean).join(" ");
    }
    case "admission_interview_schedule": {
      const interviewDate = payload.interviewAt ? new Date(payload.interviewAt) : null;
      const dateText = interviewDate && !Number.isNaN(interviewDate.getTime())
        ? interviewDate.toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })
        : payload.interviewAt || "TBD";
      return [
        "Dear Parent/Guardian,",
        `Admission interview for ${name} is scheduled on ${dateText}.`,
        `Campus: ${campus}`,
        payload.campusAddress ? `Address: ${payload.campusAddress}` : "",
        payload.campusPhone ? `Campus Contact: ${payload.campusPhone}` : "",
        `Tracking No: ${ref}`,
        "Please arrive 15 minutes earlier.",
      ].filter(Boolean).join(" ");
    }
    default:
      return `Admission update for ${name}. Ref: ${ref}`;
  }
}

export async function sendAdmissionSms(payload: {
  phoneNumber: string;
  template: AdmissionSmsTemplate;
  applicationId: string;
  applicantName?: string;
  campusName?: string;
  campusAddress?: string | null;
  campusPhone?: string | null;
  trackingNo?: string;
  interviewAt?: string;
  rejectionReason?: string;
}) {
  const webhookUrl = process.env.SMS_WEBHOOK_URL || "";
  if (!webhookUrl) {
    console.log("[SMS SKIP] SMS_WEBHOOK_URL not configured", {
      applicationId: payload.applicationId,
      template: payload.template,
      phone: payload.phoneNumber,
    });
    return { sent: false as const, reason: "SMS_WEBHOOK_URL not configured" };
  }

  const message = buildAdmissionSmsMessage(payload);
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: payload.phoneNumber,
      message,
      template: payload.template,
      applicationId: payload.applicationId,
      trackingNo: payload.trackingNo,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SMS API failed (${resp.status}): ${body.slice(0, 240)}`);
  }
  return { sent: true as const };
}

export function normalizePhoneDigits(phone: unknown): string {
  return String(phone || "").replace(/\D/g, "");
}

export function contactMatchesApplication(contactInput: string, storedContact: string): boolean {
  const input = normalizePhoneDigits(contactInput);
  const stored = normalizePhoneDigits(storedContact);
  if (!input || !stored) return false;
  if (input === stored) return true;
  if (input.length >= 4 && stored.endsWith(input)) return true;
  return false;
}
