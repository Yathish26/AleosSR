import Member from '../models/Member.js'
import Merchant from '../models/Merchant.js'
import Transaction from '../models/Transaction.js'
import ApiError from '../utils/ApiError.js'

// GET /api/admin/stats
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

// GET /api/admin/members?search=&page=1&limit=20
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

// GET /api/admin/members/:id
export async function getMember(req, res) {
  const member = await Member.findById(req.params.id)
  if (!member) throw new ApiError(404, 'Member not found')

  const [transactions, referrals] = await Promise.all([
    Transaction.find({ member: member._id }).sort({ date: -1 }),
    Member.find({ referredBy: member.referralCode }).select('name email mobile createdAt'),
  ])

  res.json({ success: true, member, transactions, referrals })
}

// DELETE /api/admin/members/:id
export async function deleteMember(req, res) {
  const member = await Member.findByIdAndDelete(req.params.id)
  if (!member) throw new ApiError(404, 'Member not found')
  await Transaction.deleteMany({ member: member._id })
  res.json({ success: true, message: 'Member and their transactions deleted' })
}
