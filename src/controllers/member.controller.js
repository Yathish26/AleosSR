import Member from '../models/Member.js'
import Redemption from '../models/Redemption.js'
import Transaction from '../models/Transaction.js'
import ApiError from '../utils/ApiError.js'

async function getCurrentMember(req) {
  const member = await Member.findById(req.user.id)
  if (!member) throw new ApiError(404, 'Member not found')
  return member
}

// GET /members/me
export async function getMe(req, res) {
  const member = await getCurrentMember(req)
  res.json({ success: true, member })
}

// PATCH /members/me  { name }
export async function updateMe(req, res) {
  const member = await getCurrentMember(req)
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim()
    if (!name) throw new ApiError(400, 'Name is required')
    member.name = name
  }
  await member.save()
  res.json({ success: true, member })
}

// GET /members/me/transactions
export async function getMyTransactions(req, res) {
  const transactions = await Transaction.find({ member: req.user.id }).sort({ date: -1 })
  res.json({ success: true, count: transactions.length, transactions })
}

// GET /members/me/passbook?limit=200 — points earned (credit) and used at shops (debit), newest first, with the
// balance after each. The balance is worked backwards from today's points, so it always ends on the real number.
export async function getMyPassbook(req, res) {
  const member = await getCurrentMember(req)
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200))

  const [earned, used] = await Promise.all([
    Transaction.find({ member: member._id, pointsEarned: { $gt: 0 } }).sort({ date: -1 }).limit(limit),
    Redemption.find({ member: member._id }).sort({ createdAt: -1 }).limit(limit),
  ])

  const entries = [
    ...earned.map((t) => ({
      id: `earn-${t._id}`,
      date: t.date,
      type: t.kind === 'referral' ? 'Referral bonus' : 'Points earned',
      shopName: t.shopName,
      details:
        t.kind === 'referral'
          ? 'Someone you referred shopped here'
          : `₹${t.purchaseAmount.toLocaleString('en-IN')} purchase`,
      credit: t.pointsEarned,
    })),
    ...used.map((r) => ({
      id: `used-${r._id}`,
      date: r.createdAt,
      type: 'Points used',
      shopName: r.shopName,
      details: 'Redeemed at the shop',
      debit: r.points,
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)

  let balance = member.totalPoints ?? 0
  for (const entry of entries) {
    entry.balanceAfter = balance
    balance += (entry.debit || 0) - (entry.credit || 0)
  }

  res.json({ success: true, totalPoints: member.totalPoints ?? 0, entries })
}

// GET /members/me/referrals
export async function getMyReferrals(req, res) {
  const member = await getCurrentMember(req)
  const referrals = await Member.find({ referredBy: member.referralCode }).select('name createdAt')
  res.json({ success: true, count: referrals.length, referrals })
}
