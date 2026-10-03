// Creates the admin account from ADMIN_USERNAME / ADMIN_PASSWORD in .env (skips if it exists).
import 'dotenv/config'
import { connectDB, disconnectDB } from '../config/db.js'
import Admin from '../models/Admin.js'

const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase()
const password = process.env.ADMIN_PASSWORD || 'admin123'

try {
  await connectDB()
  if (await Admin.exists({ username })) {
    console.log(`Admin "${username}" already exists`)
  } else {
    await Admin.create({ username, password })
    console.log(`Admin "${username}" created`)
  }
} catch (err) {
  console.error('Seed failed:', err.message)
  process.exitCode = 1
} finally {
  await disconnectDB()
}
