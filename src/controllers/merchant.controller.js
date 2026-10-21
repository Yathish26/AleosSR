import Merchant, { MERCHANT_CATEGORIES } from '../models/Merchant.js'
import ApiError from '../utils/ApiError.js'
import { sendMail } from '../utils/mailer.js'

// GET /api/merchants/categories
export function getCategories(req, res) {
  res.json({ success: true, categories: MERCHANT_CATEGORIES })
}

// POST /api/merchants/register  { businessName, ownerName, category, email, mobile, city, googleBusinessLink? }
export async function registerMerchant(req, res) {
  const { businessName, ownerName, category, email, mobile, city } = req.body
  // Empty string means "not provided" — store nothing rather than fail URL validation
  const googleBusinessLink = req.body.googleBusinessLink || undefined

  if (email && (await Merchant.exists({ email: String(email).trim().toLowerCase() }))) {
    throw new ApiError(409, 'A business is already registered with this email')
  }
  if (mobile && (await Merchant.exists({ mobile }))) {
    throw new ApiError(409, 'A business is already registered with this mobile number')
  }

  const merchant = await Merchant.create({ businessName, ownerName, category, email, mobile, city, googleBusinessLink })
  res.status(201).json({
    success: true,
    message: 'Application received. Our team will review it and contact you.',
    merchant,
  })
}

// GET /api/admin/merchants?status=pending
export async function listMerchants(req, res) {
  const filter = req.query.status ? { status: req.query.status } : {}
  const merchants = await Merchant.find(filter).sort({ createdAt: -1 })
  res.json({ success: true, count: merchants.length, merchants })
}

// PATCH /api/admin/merchants/:id/status  { status: 'approved' | 'rejected' | 'pending' }
export async function updateMerchantStatus(req, res) {
  const merchant = await Merchant.findById(req.params.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  const wasApproved = merchant.status === 'approved'
  merchant.status = req.body.status
  await merchant.save()

  // Email the merchant only when they newly become approved. A failed email is logged
  // but doesn't undo the approval.
  if (merchant.status === 'approved' && !wasApproved) {
    try {
      await sendMail({
        to: merchant.email,
        subject: `${merchant.businessName} is approved on ALEOS`,
        text: `Hi ${merchant.ownerName}, good news! ${merchant.businessName} has been approved as an ALEOS merchant. You can now start issuing reward points to members.`,
        html: approvalEmailHtml(merchant),
      })
    } catch (err) {
      console.error(`Approval email to ${merchant.email} failed: ${err.message}`)
    }
  }

  res.json({ success: true, merchant })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function approvalEmailHtml(merchant) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-bottom:16px">ALEOS</div>
  <p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(merchant.ownerName)},</p>
  <p style="margin:0 0 12px;font-size:15px">Good news! <strong>${escapeHtml(merchant.businessName)}</strong> has been approved as an ALEOS merchant.</p>
  <div style="font-size:15px;font-weight:700;background:#ecfdf5;color:#047857;border-radius:12px;padding:16px;text-align:center">✅ Application approved</div>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">You can now start issuing reward points to members. Reply to this email if you have any questions.</p>
</div>`
}
