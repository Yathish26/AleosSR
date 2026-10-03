import mongoose from 'mongoose'

export async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set in .env')

  mongoose.connection.on('connected', () => console.log(`MongoDB connected: ${mongoose.connection.host}`))
  mongoose.connection.on('error', (err) => console.error('MongoDB error:', err.message))
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'))

  await mongoose.connect(uri)
}

export async function disconnectDB() {
  await mongoose.connection.close()
}
