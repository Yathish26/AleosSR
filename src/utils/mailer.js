import nodemailer from 'nodemailer'

// Emails go out through Gmail using an App Password (GMAIL_USER + GMAIL_APP_PASSWORD in .env).
// If either is missing, emails are just logged to the console instead.
const user = process.env.GMAIL_USER?.trim()
// Google shows the app password in groups of 4 ("abcd efgh ijkl mnop") — spaces are removed
const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '')

const transporter =
  user && pass
    ? nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user, pass },
      })
    : null

export const isEmailConfigured = Boolean(transporter)

// Check the Gmail login once at startup so a wrong app password shows up in the server log right away
if (transporter) {
  transporter
    .verify()
    .then(() => console.log(`Email: sending via Gmail as ${user}`))
    .catch((err) => console.error(`Email: Gmail login failed for ${user} — check GMAIL_APP_PASSWORD (${err.message})`))
} else {
  console.log('Email: GMAIL_USER / GMAIL_APP_PASSWORD not set — emails will only be logged')
}

export async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.log(`[email not configured] To: ${to} | ${subject} | ${text}`)
    return
  }
  const fromName = process.env.MAIL_FROM_NAME?.trim() || 'ALEOS'
  await transporter.sendMail({ from: `"${fromName}" <${user}>`, to, subject, text, html })
}
