import mongoose from 'mongoose'

// A member using their points at a merchant's shop. The member approves it with an emailed code; the points
// leave the member's balance and go into the merchant's wallet.
const redemptionSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true },
    shopName: { type: String, trim: true },
    points: { type: Number, required: true, min: 1 },
    memberPointsAfter: { type: Number, min: 0 },
    merchantWalletAfter: { type: Number, min: 0 },
  },
  { timestamps: true },
)

redemptionSchema.index({ merchant: 1, createdAt: -1 })
redemptionSchema.index({ member: 1, createdAt: -1 })

export default mongoose.model('Redemption', redemptionSchema)
