import crypto from 'node:crypto'
import mongoose from 'mongoose'

// e.g. "ALE7K3QX" — what members share to invite others
function generateReferralCode() {
  return 'ALE' + crypto.randomBytes(4).toString('base64url').replace(/[-_]/g, 'X').slice(0, 5).toUpperCase()
}

const memberSchema = new mongoose.Schema(
  {
    // Empty for a member a merchant added by email; they fill it in after logging in
    name: { type: String, trim: true, default: '' },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    // Not set for a member a merchant added by email (unique index below skips those)
    mobile: { type: String, match: [/^\d{10}$/, 'Mobile must be a 10-digit number'] },
    address: { type: String, trim: true },
    pincode: { type: String, trim: true, match: [/^\d{6}$/, 'Pincode must be a 6-digit number'] },
    referralCode: { type: String, unique: true, default: generateReferralCode },
    // Referral code used when this member joined: a member's code, or a merchant's Merchant ID
    // (also the Merchant ID for a member a merchant added while giving points)
    referredBy: { type: String, uppercase: true, trim: true },
    // Set when a merchant created this member while giving them points
    createdByMerchant: { type: mongoose.Schema.Types.ObjectId, ref: 'Merchant' },
    totalPoints: { type: Number, default: 0, min: 0 },
    totalSpent: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
)

memberSchema.index({ referredBy: 1 })
// Mobile numbers stay unique, but any number of members may have none
memberSchema.index({ mobile: 1 }, { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } })

const Member = mongoose.model('Member', memberSchema)
export default Member

// Older databases have a plain unique index on mobile, which allows only ONE member without a mobile.
// Swap it for the one above. Safe to run on every start: it does nothing once the index is updated.
export async function ensureMemberIndexes() {
  const indexes = await Member.collection.indexes().catch(() => []) // collection may not exist yet
  if (indexes.some((i) => i.name === 'mobile_1' && !i.partialFilterExpression)) {
    await Member.collection.dropIndex('mobile_1')
    console.log('Members: replaced the mobile index so members without a mobile number are allowed')
  }
  await Member.createIndexes()
}
