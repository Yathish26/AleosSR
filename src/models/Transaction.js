import mongoose from 'mongoose'

const transactionSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    // Set when a merchant issued the points from their dashboard; admin-entered ones have none
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant' },
    // Discount % applied to this bill to work out the points (merchant-issued ones only)
    discountPercent: { type: Number, min: 0, max: 100 },
    // Points taken from the merchant's wallet for this, and the wallet points left afterwards
    walletDebit: { type: Number, min: 0 },
    walletBalanceAfter: { type: Number, min: 0 },
    shopName: { type: String, required: true, trim: true },
    purchaseAmount: { type: Number, required: true, min: 0 },
    pointsEarned: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

transactionSchema.index({ member: 1, date: -1 })
transactionSchema.index({ merchant: 1, date: -1 })

export default mongoose.model('Transaction', transactionSchema)
