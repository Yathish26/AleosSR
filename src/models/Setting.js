import mongoose from 'mongoose'

// Sign-up wallet recharge choices (₹, 1 point per ₹1) until the admin changes them, and the limits on them
export const DEFAULT_SIGNUP_RECHARGE_OPTIONS = [1000, 2000, 3000]
export const SIGNUP_RECHARGE_MIN = 1000
export const SIGNUP_RECHARGE_MAX = 1000000
export const SIGNUP_RECHARGE_MAX_OPTIONS = 6

// App-wide settings the admin can change from the admin dashboard. There is only ever one document.
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'app', unique: true },
    // % kept from every merchant withdrawal: 2% of 1,000 points = ₹20 fee, ₹980 sent to the bank
    withdrawalFeePercent: {
      type: Number,
      default: 0,
      min: [0, 'Withdrawal fee cannot be negative'],
      max: [100, 'Withdrawal fee cannot be more than 100%'],
    },
    // Amounts a new merchant can pick from when loading their wallet at sign-up (₹1 = 1 point), lowest first
    signupRechargeOptions: { type: [Number], default: () => [...DEFAULT_SIGNUP_RECHARGE_OPTIONS] },
  },
  { timestamps: true },
)

const Setting = mongoose.model('Setting', settingSchema)
export default Setting

// The settings document, created with defaults the first time
export function getSettings() {
  return Setting.findOneAndUpdate({ key: 'app' }, { $setOnInsert: { key: 'app' } }, { upsert: true, new: true })
}

// The sign-up recharge choices, falling back to the defaults if none are saved
export function signupRechargeOptionsOf(settings) {
  const options = settings?.signupRechargeOptions
  return options?.length ? [...options] : [...DEFAULT_SIGNUP_RECHARGE_OPTIONS]
}
