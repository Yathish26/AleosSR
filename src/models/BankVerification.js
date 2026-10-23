import mongoose from 'mongoose'

// One ₹1 bank check for a merchant applying with this email. Registration needs a 'verified' one
// whose IFSC + account number match what's submitted.
const bankVerificationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, index: true },
    accountHolderName: { type: String, required: true, trim: true },
    ifsc: { type: String, required: true, uppercase: true },
    accountNumber: { type: String, required: true },
    // Razorpay fund account validation id (fav_...); empty for a development-mode check
    razorpayValidationId: { type: String },
    status: { type: String, enum: ['pending', 'verified', 'failed'], default: 'pending' },
    // Account holder name as the bank reports it
    registeredName: { type: String },
    failureReason: { type: String },
  },
  { timestamps: true },
)

export default mongoose.model('BankVerification', bankVerificationSchema)
