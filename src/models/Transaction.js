import mongoose from 'mongoose'

const transactionSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    shopName: { type: String, required: true, trim: true },
    purchaseAmount: { type: Number, required: true, min: 0 },
    pointsEarned: { type: Number, required: true, min: 0 },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

transactionSchema.index({ member: 1, date: -1 })

export default mongoose.model('Transaction', transactionSchema)
