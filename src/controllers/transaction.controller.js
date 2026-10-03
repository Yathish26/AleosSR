import Member from '../models/Member.js'
import Transaction from '../models/Transaction.js'
import ApiError from '../utils/ApiError.js'

// Default reward rate: 10% of purchase amount, matching the frontend demo data
const DEFAULT_POINTS_RATE = 0.1

// POST /api/transactions  { mobile, shopName, purchaseAmount, pointsEarned?, date? }
export async function createTransaction(req, res) {
  const { mobile, shopName, purchaseAmount, pointsEarned, date } = req.body

  const amount = Number(purchaseAmount)
  if (!Number.isFinite(amount) || amount < 0) throw new ApiError(400, 'purchaseAmount must be a positive number')

  const member = await Member.findOne({ mobile })
  if (!member) throw new ApiError(404, 'No member registered with this mobile number')

  const points = pointsEarned !== undefined ? Number(pointsEarned) : Math.floor(amount * DEFAULT_POINTS_RATE)

  const transaction = await Transaction.create({
    member: member._id,
    shopName,
    purchaseAmount: amount,
    pointsEarned: points,
    ...(date && { date }),
  })

  await Member.updateOne({ _id: member._id }, { $inc: { totalPoints: points, totalSpent: amount } })

  res.status(201).json({ success: true, transaction })
}

// GET /api/transactions?memberId=
export async function listTransactions(req, res) {
  const filter = req.query.memberId ? { member: req.query.memberId } : {}
  const transactions = await Transaction.find(filter).populate('member', 'name mobile').sort({ date: -1 })
  res.json({ success: true, count: transactions.length, transactions })
}

// DELETE /api/transactions/:id
export async function deleteTransaction(req, res) {
  const transaction = await Transaction.findByIdAndDelete(req.params.id)
  if (!transaction) throw new ApiError(404, 'Transaction not found')

  await Member.updateOne(
    { _id: transaction.member },
    { $inc: { totalPoints: -transaction.pointsEarned, totalSpent: -transaction.purchaseAmount } },
  )

  res.json({ success: true, message: 'Transaction deleted' })
}
