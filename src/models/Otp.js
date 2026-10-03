import mongoose from 'mongoose'

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, index: true },
  code: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  // MongoDB TTL index removes the document once expiresAt passes
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
})

export default mongoose.model('Otp', otpSchema)
