import mongoose from 'mongoose'

// Money a merchant pays to load points into their wallet: at sign-up, or a later recharge from the dashboard.
// ₹1 recharged = 1 point; a 3% convenience fee is on top. e.g. ₹1,000 + 3% (₹30) = ₹1,030 paid, 1,000 points.
// mode 'dummy' = simulated for now; swap in Razorpay checkout later and record its payment id here.
const walletPaymentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['signup', 'recharge'], required: true },
    email: { type: String, required: true, lowercase: true, index: true },
    // Empty for a sign-up payment until the registration that uses it goes through
    merchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant', index: true },
    rechargeAmount: { type: Number, required: true, min: 0 },
    convenienceFee: { type: Number, required: true, min: 0 },
    // One-time onboarding fee and the GST on it — sign-up payments only
    onboardingFee: { type: Number, default: 0, min: 0 },
    onboardingTax: { type: Number, default: 0, min: 0 },
    // total paid = rechargeAmount + convenienceFee + onboardingFee + onboardingTax
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
