import mongoose from 'mongoose'

// Money a merchant pays to load points into their wallet: at sign-up, or a later recharge from the dashboard.
// ₹1 recharged = 1 point; 18% GST is on top. e.g. ₹1,000 + 18% (₹180) = ₹1,180 paid, 1,000 points.
// mode 'dummy' = simulated for now; swap in Razorpay checkout later and record its payment id here.
const walletPaymentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['signup', 'recharge'], required: true },
    email: { type: String, required: true, lowercase: true, index: true },
    // Empty for a sign-up payment until the registration that uses it goes through
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', index: true },
    rechargeAmount: { type: Number, required: true, min: 0 },
    // Old 3% convenience fee — no longer charged (0 on new payments); kept for older payments
    convenienceFee: { type: Number, default: 0, min: 0 },
    // 18% GST on the recharge amount
    gst: { type: Number, default: 0, min: 0 },
    // One-time onboarding fee and the GST on it — no longer charged (always 0 now); kept for older sign-up payments
    onboardingFee: { type: Number, default: 0, min: 0 },
    onboardingTax: { type: Number, default: 0, min: 0 },
    // total paid = rechargeAmount + gst + convenienceFee + onboardingFee + onboardingTax
    amount: { type: Number, required: true, min: 0 },
    points: { type: Number, required: true, min: 0 },
    // Wallet points right after this payment was credited (set once credited)
    walletBalanceAfter: { type: Number, min: 0 },
    mode: { type: String, enum: ['dummy', 'razorpay'], default: 'dummy' },
    reference: { type: String, required: true },
  },
  { timestamps: true },
)

export default mongoose.model('WalletPayment', walletPaymentSchema)
