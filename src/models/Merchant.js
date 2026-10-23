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

// Food businesses, which may give an FSSAI licence number when applying
export const FSSAI_CATEGORIES = ['Restaurant & Cafe', 'Grocery & Supermarket']

const merchantSchema = new mongoose.Schema(
  {
    // Set at registration (and filled in for older merchants by ensureMerchantIds); unique index below
    merchantId: { type: String, uppercase: true, trim: true },
    // The company's own "ALEOS" merchant account, run by the admin. Only one exists (getMasterMerchant).
    isMaster: { type: Boolean, default: false },
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
    // Optional trade licence number
    tradeLicense: { type: String, trim: true },
    // Optional owner ID numbers. Aadhaar is shown masked (last 4 digits) on admin screens.
    aadhaarNumber: { type: String, trim: true, match: [/^[2-9]\d{11}$/, 'Aadhaar number must be 12 digits'] },
    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN must look like ABCDE1234F'],
    },
    // Optional FSSAI food licence number — only asked of FSSAI_CATEGORIES (restaurants, grocery)
    fssaiNumber: { type: String, trim: true, match: [/^\d{14}$/, 'FSSAI number must be 14 digits'] },
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

// Merchant ID of the master account — same as the root referral code, so members who join with it count as
// the master merchant's referrals
export const MASTER_MERCHANT_ID = 'ALEOS'

// The company's own merchant account, created the first time it's needed. It has no bank/licence details
// (those are for outside shops), so it's saved without the usual sign-up checks.
export async function getMasterMerchant() {
  const existing = await Merchant.findOne({ isMaster: true })
  if (existing) return existing

  const master = new Merchant({
    isMaster: true,
    merchantId: MASTER_MERCHANT_ID,
    businessName: 'ALEOS',
    ownerName: 'ALEOS Admin',
    category: 'Other',
    email: process.env.MASTER_MERCHANT_EMAIL?.trim() || 'master@aleos.local',
    mobile: '0000000000',
    status: 'approved',
  })
  try {
    await master.save({ validateBeforeSave: false })
    console.log(`Merchants: created the ALEOS master merchant (${MASTER_MERCHANT_ID})`)
    return master
  } catch (err) {
    // Created at the same moment by another request
    if (err.code === 11000) {
      const created = await Merchant.findOne({ isMaster: true })
      if (created) return created
    }
    throw err
  }
}

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

  // Members a merchant added before this was tracked count as that merchant's referrals too
  const Member = mongoose.model('Member')
  const merchantIds = await Member.distinct('createdByMerchant', {
    createdByMerchant: { $exists: true },
    referredBy: { $exists: false },
  })
  let linked = 0
  for (const id of merchantIds) {
    const merchant = await Merchant.findById(id).select('merchantId')
    if (!merchant?.merchantId) continue
    const result = await Member.updateMany(
      { createdByMerchant: id, referredBy: { $exists: false } },
      { $set: { referredBy: merchant.merchantId } },
    )
    linked += result.modifiedCount
  }
  if (linked) console.log(`Members: counted ${linked} merchant-added member(s) as that merchant's referrals`)
}
