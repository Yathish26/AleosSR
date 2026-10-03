import Merchant, { MERCHANT_CATEGORIES } from '../models/Merchant.js'
import ApiError from '../utils/ApiError.js'

// GET /api/merchants/categories
export function getCategories(req, res) {
  res.json({ success: true, categories: MERCHANT_CATEGORIES })
}

// POST /api/merchants/register  { businessName, ownerName, category, email, mobile, city }
export async function registerMerchant(req, res) {
  const { businessName, ownerName, category, email, mobile, city } = req.body

  if (email && (await Merchant.exists({ email: String(email).trim().toLowerCase() }))) {
    throw new ApiError(409, 'A business is already registered with this email')
  }
  if (mobile && (await Merchant.exists({ mobile }))) {
    throw new ApiError(409, 'A business is already registered with this mobile number')
  }

  const merchant = await Merchant.create({ businessName, ownerName, category, email, mobile, city })
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
  merchant.status = req.body.status
  await merchant.save()
  res.json({ success: true, merchant })
}
