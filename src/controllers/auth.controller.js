import crypto from 'node:crypto'
import Member from '../models/Member.js'
import Otp from '../models/Otp.js'
import ApiError from '../utils/ApiError.js'
import { isEmailConfigured, sendMail } from '../utils/mailer.js'
import { signToken } from '../utils/token.js'

const EMAIL_RE = /^\S+@\S+\.\S+$/
const MOBILE_RE = /^\d{10}$/
const MAX_OTP_ATTEMPTS = 5

// Code that lets the very first members join before anyone has a referral code to share
const rootReferralCode = () => (process.env.ROOT_REFERRAL_CODE || 'ALEOS').toUpperCase()

function normalizeEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(value)) throw new ApiError(400, 'Please enter a valid email')
  return value
}

// Checks the OTP for this email and deletes it once used. Throws if wrong or expired.
async function consumeOtp(email, otp) {
  if (!otp) throw new ApiError(400, 'OTP is required')

  const record = await Otp.findOne({ email })
  if (!record || record.expiresAt < new Date()) throw new ApiError(400, 'OTP expired or not requested')
  if (record.attempts >= MAX_OTP_ATTEMPTS) throw new ApiError(429, 'Too many attempts, request a new OTP')

  if (record.code !== String(otp).trim()) {
    record.attempts += 1
    await record.save()
    throw new ApiError(400, 'Invalid OTP')
  }
  await record.deleteOne()
}

function otpEmailHtml(code, expiryMinutes) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-bottom:16px">ALEOS</div>
  <p style="margin:0 0 12px;font-size:15px">Your verification code is:</p>
  <div style="font-size:32px;font-weight:800;letter-spacing:8px;background:#eff6ff;border-radius:12px;padding:16px;text-align:center">${code}</div>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">This code expires in ${expiryMinutes} minutes. If you didn't request it, you can ignore this email.</p>
</div>`
}

// POST /api/auth/otp/send  { email, purpose: 'join' | 'login' }
export async function sendOtp(req, res) {
  const email = normalizeEmail(req.body.email)
  const purpose = req.body.purpose === 'login' ? 'login' : 'join'

  const exists = await Member.exists({ email })
  if (purpose === 'join' && exists) throw new ApiError(409, 'This email is already registered. Please log in.')
  if (purpose === 'login' && !exists) throw new ApiError(404, 'No member found with this email. Please join first.')

  const code = crypto.randomInt(100000, 1000000).toString()
  const expiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES) || 5

  await Otp.deleteMany({ email })
  await Otp.create({ email, code, expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000) })

  try {
    await sendMail({
      to: email,
      subject: `${code} is your ALEOS verification code`,
      text: `Your ALEOS verification code is ${code}. It expires in ${expiryMinutes} minutes. If you didn't request this, you can ignore this email.`,
      html: otpEmailHtml(code, expiryMinutes),
    })
  } catch (err) {
    console.error(`OTP email to ${email} failed: ${err.message}`)
    await Otp.deleteMany({ email })
    throw new ApiError(502, 'Could not send the OTP email right now. Please try again in a minute.')
  }

  res.json({
    success: true,
    message: `OTP sent to ${email}`,
    // Without an email provider, show the code in development so the flow can be tested
    ...(!isEmailConfigured && process.env.NODE_ENV === 'development' && { otp: code }),
  })
}

// POST /api/auth/member/join  { name, email, mobile, referralCode, otp }
export async function joinMember(req, res) {
  const email = normalizeEmail(req.body.email)
  const name = String(req.body.name || '').trim()
  const mobile = String(req.body.mobile || '').trim()
  const referralCode = String(req.body.referralCode || '').trim().toUpperCase()

  if (!name) throw new ApiError(400, 'Name is required')
  if (!MOBILE_RE.test(mobile)) throw new ApiError(400, 'Please enter a valid 10-digit mobile number')
  if (!referralCode) throw new ApiError(400, 'Referral code is required')

  if (referralCode !== rootReferralCode() && !(await Member.exists({ referralCode }))) {
    throw new ApiError(400, 'Invalid referral code')
  }
  if (await Member.exists({ email })) throw new ApiError(409, 'This email is already registered. Please log in.')
  if (await Member.exists({ mobile })) throw new ApiError(409, 'This mobile number is already registered')

  await consumeOtp(email, req.body.otp)

  const member = await Member.create({ name, email, mobile, referredBy: referralCode })
  res.status(201).json({ success: true, token: signToken(member._id, 'member'), member })
}

// POST /api/auth/member/login  { email, otp }
export async function loginMember(req, res) {
  const email = normalizeEmail(req.body.email)
  const member = await Member.findOne({ email })
  if (!member) throw new ApiError(404, 'No member found with this email. Please join first.')

  await consumeOtp(email, req.body.otp)
  res.json({ success: true, token: signToken(member._id, 'member'), member })
}

// POST /api/auth/admin/login  { username, password }
// For now the admin login is fixed: ADMIN_USERNAME / ADMIN_PASSWORD from .env (no database lookup).
export async function adminLogin(req, res) {
  const { username, password } = req.body
  if (!username || !password) throw new ApiError(400, 'Username and password are required')

  const adminUsername = process.env.ADMIN_USERNAME || 'admin'
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'

  if (username.trim().toLowerCase() !== adminUsername.toLowerCase() || password !== adminPassword) {
    throw new ApiError(401, 'Invalid Admin ID or Password')
  }

  res.json({
    success: true,
    token: signToken(adminUsername, 'admin'),
    admin: { username: adminUsername },
  })
}
