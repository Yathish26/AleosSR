import mongoose from 'mongoose'

// Points a merchant cashes out of their wallet to their bank account: 1 point = ₹1 minus the admin's withdrawal
// fee %, at most 5,000 points a day.
// mode 'dummy' = simulated for now; swap in a RazorpayX payout later and record its payout id here.
const walletWithdrawalSchema = new mongoose.Schema(
  {
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', required: true },
    points: { type: Number, required: true, min: 1 },
    // Admin-set withdrawal fee at the time: fee = points × feePercent, amount = points − fee
    feePercent: { type: Number, default: 0, min: 0 },
    fee: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true, min: 0 }, // ₹ sent to the bank
    // Where it was sent, copied at the time so later bank changes don't rewrite history
    bankName: { type: String },
    ifsc: { type: String },
    accountLast4: { type: String },
    walletBalanceAfter: { type: Number, min: 0 },
    status: { type: String, enum: ['paid'], default: 'paid' },
    mode: { type: String, enum: ['dummy', 'razorpay'], default: 'dummy' },
    reference: { type: String, required: true },
  },
  { timestamps: true },
)

walletWithdrawalSchema.index({ merchant: 1, createdAt: -1 })

export default mongoose.model('WalletWithdrawal', walletWithdrawalSchema)
