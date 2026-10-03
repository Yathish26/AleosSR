import nodemailer from 'nodemailer'

// Emails are only sent when SMTP_HOST is set in .env; otherwise they are just logged.
const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null

export const isEmailConfigured = Boolean(transporter)

export async function sendMail({ to, subject, text }) {
  if (!transporter) {
    console.log(`[email not configured] To: ${to} | ${subject} | ${text}`)
    return
  }
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text })
}
