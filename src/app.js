import cors from 'cors'
import express from 'express'
import morgan from 'morgan'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import routes from './routes/index.js'

const app = express()

app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || '*' }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'))

app.get('/', (req, res) => res.json({ success: true, message: 'ALEOS API is running' }))
app.use('/api', routes)

app.use(notFound)
app.use(errorHandler)

export default app
