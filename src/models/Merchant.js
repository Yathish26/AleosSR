import mongoose from 'mongoose'

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
    city: { type: String, trim: true },
    // New merchants wait for admin approval before they can issue points
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  },
  { timestamps: true },
)

export default mongoose.model('Merchant', merchantSchema)
