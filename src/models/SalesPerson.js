import mongoose from 'mongoose'

// A member of the ALEOS sales team, added by the admin from the admin dashboard's Sales tab
const salesPersonSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: [100, 'Name is too long'] },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
      trim: true,
      match: [/^\d{10}$/, 'Mobile must be a 10-digit number'],
    },
  },
  { timestamps: true },
)

const SalesPerson = mongoose.model('SalesPerson', salesPersonSchema)
export default SalesPerson
