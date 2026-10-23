import mongoose from 'mongoose'

const transactionSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    // 'purchase' = points the member earned on their own bill; 'referral' = the 10% a member earns when someone
    // they referred makes a purchase (no merchant set, so it doesn't count in the shop's own history)
    kind: { type: String, enum: ['purchase', 'referral'], default: 'purchase' },
    // Set when a merchant issued the points from their dashboard; admin-entered ones have none
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant' },
    // How a merchant-issued bill's points were split (80 / 10 / 10). pointsEarned is the member's share;
    // totalPoints is everything taken from the merchant's wallet.
    totalPoints: { type: Number, min: 0 },
    referrerPoints: { type: Number, min: 0 },
    masterPoints: { type: Number, min: 0 },
    referrerCode: { type: String },
    referrerMember: { type: mongoose.Schema.Types.ObjectId, ref: 'Member' },
    referrerMerchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant' },
    // For a 'referral' entry: the purchase it came from
    sourceTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
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
