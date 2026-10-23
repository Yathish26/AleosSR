import mongoose from 'mongoose'

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
  },
  { timestamps: true },
)

const Setting = mongoose.model('Setting', settingSchema)
export default Setting

// The settings document, created with defaults the first time
export function getSettings() {
  return Setting.findOneAndUpdate({ key: 'app' }, { $setOnInsert: { key: 'app' } }, { upsert: true, new: true })
}
