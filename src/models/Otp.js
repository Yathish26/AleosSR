import mongoose from 'mongoose'

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, index: true },
  // Kept separate so a code sent for a member login can't be used for a merchant login on the same email.
  // 'reward' = code a new customer gives a merchant so the merchant can add them and give them points.
  // 'redeem' = code a member gives a merchant to approve using their points at that shop.
  account: { type: String, enum: ['member', 'merchant', 'reward', 'redeem'], default: 'member' },
  code: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  // MongoDB TTL index removes the document once expiresAt passes
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})

export default mongoose.model('Otp', otpSchema)
