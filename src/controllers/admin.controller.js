import Member from '../models/Member.js'
import Merchant from '../models/Merchant.js'
import { getSettings } from '../models/Setting.js'
import Transaction from '../models/Transaction.js'
import ApiError from '../utils/ApiError.js'

// GET /admin/stats
export async function getStats(req, res) {
  const [totalMembers, totals, totalTransactions, totalMerchants, pendingMerchants] = await Promise.all([
    Member.countDocuments(),
    Member.aggregate([{ $group: { _id: null, points: { $sum: '$totalPoints' }, spent: { $sum: '$totalSpent' } } }]),
    Transaction.countDocuments(),
    Merchant.countDocuments(),
    Merchant.countDocuments({ status: 'pending' }),
  ])

  res.json({
    success: true,
    stats: {
      totalMembers,
      totalTransactions,
      totalMerchants,
      pendingMerchants,
      networkTotalPoints: totals[0]?.points ?? 0,
      networkTotalSpent: totals[0]?.spent ?? 0,
    },
  })
}

// GET /admin/members?search=&page=1&limit=20
export async function listMembers(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const search = req.query.search?.trim()

  const filter = search
    ? {
        $or: [
          { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
          { mobile: search },
          { email: search.toLowerCase() },
        ],
      }
    : {}

  const [members, total] = await Promise.all([
    Member.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Member.countDocuments(filter),
  ])

  res.json({ success: true, page, limit, total, members })
}

// GET /admin/members/:id
export async function getMember(req, res) {
  const member = await Member.findById(req.params.id)
  if (!member) throw new ApiError(404, 'Member not found')

  const [transactions, referrals] = await Promise.all([
    Transaction.find({ member: member._id }).sort({ date: -1 }),
    Member.find({ referredBy: member.referralCode }).select('name email mobile createdAt'),
  ])

  res.json({ success: true, member, transactions, referrals })
}

// GET /admin/settings
export async function getAdminSettings(req, res) {
  res.json({ success: true, settings: await getSettings() })
}

// PATCH /admin/settings  { withdrawalFeePercent }
export async function updateAdminSettings(req, res) {
  const settings = await getSettings()
  if (req.body.withdrawalFeePercent !== undefined) {
    const percent = Number(req.body.withdrawalFeePercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new ApiError(400, 'Withdrawal fee must be between 0% and 100%')
    }
    settings.withdrawalFeePercent = Math.round(percent * 100) / 100
  }
  await settings.save()
  res.json({ success: true, settings })
}

// DELETE /admin/members/:id
export async function deleteMember(req, res) {
  const member = await Member.findByIdAndDelete(req.params.id)
  if (!member) throw new ApiError(404, 'Member not found')
  await Transaction.deleteMany({ member: member._id })
  res.json({ success: true, message: 'Member and their transactions deleted' })
}
