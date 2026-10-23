import 'dotenv/config'
import app from './app.js'
import { connectDB, disconnectDB } from './config/db.js'
import { ensureMemberIndexes } from './models/Member.js'
import { ensureMerchantIds, getMasterMerchant } from './models/Merchant.js'

const PORT = process.env.PORT || 5000

async function start() {
  try {
    await connectDB()
    await ensureMemberIndexes()
    await ensureMerchantIds()
    await getMasterMerchant()
    const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`))

    const shutdown = async (signal) => {
      console.log(`${signal} received, shutting down...`)
      server.close(async () => {
        await disconnectDB()
        process.exit(0)
      })
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } catch (err) {
    console.error('Failed to start server:', err.message)
    process.exit(1)
  }
}

start()
