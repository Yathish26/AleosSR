import crypto from 'node:crypto'
import mongoose from 'mongoose'

// e.g. "ALM7K3QX9" — the merchant's public ID. No 0/O/1/I so it's easy to read out and type.
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generateMerchantId() {
  return 'ALM' + Array.from(crypto.randomBytes(6), (b) => ID_CHARS[b % ID_CHARS.length]).join('')
}

export const MERCHANT_CATEGORIES = [
  'Restaurant & Cafe',
  'Grocery & Supermarket',
  'Fashion & Apparel',
  'Electronics',
  'Health & Pharmacy',
  'Clinic & Healthcare',
  'Salon & Beauty',
  'Fitness & Gym',
  'Home & Furniture',
  'Education & Coaching',
  'Travel & Hotels',
  'Other',
]

const merchantSchema = new mongoose.Schema(
  {
    // Set at registration (and filled in for older merchants by ensureMerchantIds); unique index below
    merchantId: { type: String, uppercase: true, trim: true },
    businessName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    category: { type: String, required: true, enum: { values: MERCHANT_CATEGORIES, message: 'Invalid category' } },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email'],
    },
    mobile: { type: String, required: true, unique: true, match: [/^\d{10}$/, 'Mobile must be a 10-digit number'] },
    address: { type: String, trim: true },
    city: { type: String, trim: true },
    // Optional Google Business Profile / Maps link
    googleBusinessLink: {
      type: String,
      trim: true,
      match: [/^https?:\/\/\S+$/, 'Google Business link must be a valid URL starting with http:// or https://'],
    },
    tradeLicense: { type: String, required: true, trim: true },
    // Bank account the merchant's settlements go to
    bankName: { type: String, required: true, trim: true },
    accountHolderName: { type: String, required: true, trim: true },
    ifsc: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Please enter a valid 11-character IFSC code'],
    },
    accountNumber: { type: String, required: true, trim: true, match: [/^\d{9,18}$/, 'Account number must be 9 to 18 digits'] },
    // Passed the Razorpay ₹1 check at sign-up; bankRegisteredName is the holder name the bank returned
    bankVerified: { type: Boolean, default: false },
    bankRegisteredName: { type: String, trim: true },
    // Discount the merchant gives members, as reward points: a ₹500 bill at 10% earns 50 points.
    // The merchant sets it from their dashboard and every bill uses it.
    discountPercent: {
      type: Number,
      default: 10,
      min: [0.01, 'Discount must be more than 0%'],
      max: [100, 'Discount cannot be more than 100%'],
    },
    // Prepaid points the merchant can give out (₹1 recharged = 1 point); giving points takes them from here
    walletBalance: { type: Number, default: 0, min: 0 },
    signupPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletPayment' },
    // New merchants wait for admin approval before they can issue points
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true },
)

// Unique, but skips merchants that don't have one yet so the index can be built before older ones are filled in
merchantSchema.index({ merchantId: 1 }, { unique: true, partialFilterExpression: { merchantId: { $type: 'string' } } })

const Merchant = mongoose.model('Merchant', merchantSchema)
export default Merchant

// Gives every merchant registered before IDs existed their own merchantId. Safe to run on every start.
export async function ensureMerchantIds() {
  await Merchant.createIndexes()
  const missing = await Merchant.find({ merchantId: { $exists: false } }).select('_id')
  for (const { _id } of missing) {
    // Retry on the (very unlikely) chance the random ID is already taken
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await Merchant.updateOne({ _id, merchantId: { $exists: false } }, { $set: { merchantId: generateMerchantId() } })
        break
      } catch (err) {
        if (err.code !== 11000) throw err
      }
    }
  }
  if (missing.length) console.log(`Merchants: gave ${missing.length} existing merchant(s) a merchant ID`)
}
