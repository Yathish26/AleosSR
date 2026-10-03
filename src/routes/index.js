// All API routes in one place. Every path below is prefixed with /api (see app.js).
// The logic for each route lives in the matching file in src/controllers/.
import { Router } from 'express'
import mongoose from 'mongoose'
import { deleteMember, getMember, getStats, listMembers } from '../controllers/admin.controller.js'
import { adminLogin, joinMember, loginMember, sendOtp } from '../controllers/auth.controller.js'
import { getMe, getMyReferrals, getMyTransactions, updateMe } from '../controllers/member.controller.js'
import {
  getCategories,
  listMerchants,
  registerMerchant,
  updateMerchantStatus,
} from '../controllers/merchant.controller.js'
import { createTransaction, deleteTransaction, listTransactions } from '../controllers/transaction.controller.js'
import { protect } from '../middleware/auth.js'

const router = Router()

// protect('member') / protect('admin') = must send "Authorization: Bearer <token>" from that kind of login
const memberOnly = protect('member')
const adminOnly = protect('admin')

// ---------- Health (public) ----------
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
  })
})

// ---------- Auth (public) ----------
router.post('/auth/otp/send', sendOtp) //            { email, purpose: 'join' | 'login' } -> emails a 6-digit OTP
router.post('/auth/member/join', joinMember) //      { name, email, mobile, referralCode, otp }
router.post('/auth/member/login', loginMember) //    { email, otp }
router.post('/auth/admin/login', adminLogin) //      { username, password }

// ---------- Merchants (public) ----------
router.get('/merchants/categories', getCategories)
router.post('/merchants/register', registerMerchant) // { businessName, ownerName, category, email, mobile, city }

// ---------- Member (logged-in member) ----------
router.get('/members/me', memberOnly, getMe)
router.patch('/members/me', memberOnly, updateMe) //    { name }
router.get('/members/me/transactions', memberOnly, getMyTransactions)
router.get('/members/me/referrals', memberOnly, getMyReferrals)

// ---------- Admin (logged-in admin) ----------
router.get('/admin/stats', adminOnly, getStats)
router.get('/admin/members', adminOnly, listMembers) // ?search=&page=&limit=
router.get('/admin/members/:id', adminOnly, getMember)
router.delete('/admin/members/:id', adminOnly, deleteMember)
router.get('/admin/merchants', adminOnly, listMerchants) // ?status=pending
router.patch('/admin/merchants/:id/status', adminOnly, updateMerchantStatus) // { status: 'approved' | 'rejected' }

// ---------- Transactions / points (logged-in admin) ----------
router.get('/transactions', adminOnly, listTransactions) // ?memberId=
router.post('/transactions', adminOnly, createTransaction) // { mobile, shopName, purchaseAmount, pointsEarned? }
router.delete('/transactions/:id', adminOnly, deleteTransaction)

export default router
