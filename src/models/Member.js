import crypto from 'node:crypto'
import mongoose from 'mongoose'

// e.g. "ALE7K3QX" — what members share to invite others
function generateReferralCode() {
  return 'ALE' + crypto.randomBytes(4).toString('base64url').replace(/[-_]/g, 'X').slice(0, 5).toUpperCase()
}

const memberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
      match: [/^\d{10}$/, 'Mobile must be a 10-digit number'],
    },
    referralCode: { type: String, unique: true, default: generateReferralCode },
    // Referral code used when this member joined
    referredBy: { type: String, required: true, uppercase: true, trim: true },
    totalPoints: { type: Number, default: 0, min: 0 },
    totalSpent: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

memberSchema.index({ referredBy: 1 })

export default mongoose.model('Member', memberSchema)
