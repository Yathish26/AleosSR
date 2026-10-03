import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, minlength: 6, select: false },
  },
  { timestamps: true },
)

adminSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, 10)
})

adminSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password)
}

export default mongoose.model('Admin', adminSchema)
