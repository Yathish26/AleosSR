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
// The name can only be set once — for members a merchant added by email, who start without one
export async function updateMe(req, res) {
  const member = await getCurrentMember(req)
  if (req.body.name !== undefined) {
    if (member.name) throw new ApiError(400, "Your name is already set and can't be changed")
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

// GET /members/me/passbook?page=1&limit=20 — points earned (credit) and used at shops (debit), newest first, with
// the balance after each. The balance is worked backwards from today's points, so page 1 always ends on the real
// number and every later page carries on from where the previous one stopped.
export async function getMyPassbook(req, res) {
  const member = await getCurrentMember(req)
  res.json({ success: true, ...(await buildMemberPassbook(member, req.query)) })
}

// One page of a member's points ledger — shared by the member's own dashboard and the admin member profile.
// query: { page, limit } (as strings from the URL is fine)
export async function buildMemberPassbook(member, query = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20))
  const page = Math.max(1, Math.floor(Number(query.page)) || 1)
  const skip = (page - 1) * limit

  const earnedFilter = { member: member._id, pointsEarned: { $gt: 0 } }
  const usedFilter = { member: member._id }

  // The newest skip+limit rows of each kind are enough to know both this page and everything newer than it
  const [earned, used, earnedCount, usedCount] = await Promise.all([
    Transaction.find(earnedFilter).sort({ date: -1 }).limit(skip + limit),
    Redemption.find(usedFilter).sort({ createdAt: -1 }).limit(skip + limit),
    Transaction.countDocuments(earnedFilter),
    Redemption.countDocuments(usedFilter),
  ])
  const total = earnedCount + usedCount

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
    .slice(0, skip + limit)

  // Walk back from today's balance through every newer entry, then through this page
  let balance = member.totalPoints ?? 0
  for (const entry of entries) {
    entry.balanceAfter = balance
    balance += (entry.debit || 0) - (entry.credit || 0)
  }

  return {
    totalPoints: member.totalPoints ?? 0,
    entries: entries.slice(skip),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

// GET /members/me/referrals
export async function getMyReferrals(req, res) {
  const member = await getCurrentMember(req)
  const referrals = await Member.find({ referredBy: member.referralCode }).select('name createdAt')
  res.json({ success: true, count: referrals.length, referrals })
}
