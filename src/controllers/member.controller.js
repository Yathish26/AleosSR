import Member from '../models/Member.js'
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
  if (req.body.name !== undefined) member.name = req.body.name
  await member.save()
  res.json({ success: true, member })
}

// GET /members/me/transactions
export async function getMyTransactions(req, res) {
  const transactions = await Transaction.find({ member: req.user.id }).sort({ date: -1 })
  res.json({ success: true, count: transactions.length, transactions })
}

// GET /members/me/referrals
export async function getMyReferrals(req, res) {
  const member = await getCurrentMember(req)
  const referrals = await Member.find({ referredBy: member.referralCode }).select('name createdAt')
  res.json({ success: true, count: referrals.length, referrals })
}
