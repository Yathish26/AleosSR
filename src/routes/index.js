// All API routes in one place. They're mounted at the root (see app.js), e.g. GET /health.
// The logic for each route lives in the matching file in src/controllers/.
import { Router } from 'express'
import mongoose from 'mongoose'
import {
  deleteMember,
  getAdminSettings,
  getMember,
  getStats,
  listMembers,
  updateAdminSettings,
} from '../controllers/admin.controller.js'
import { adminLogin, joinMember, loginMember, loginMerchant, sendOtp } from '../controllers/auth.controller.js'
import { getMe, getMyReferrals, getMyTransactions, updateMe } from '../controllers/member.controller.js'
import {
  getBankVerification,
  getCategories,
  getMerchantProfile,
  getMyMerchant,
  getMyMerchantTransactions,
  getMyWalletPayments,
  getMyMerchantReferrals,
  getMyRedemptions,
  getMyWithdrawals,
  issuePoints,
  listMerchants,
  paySignupFee,
  lookupCustomer,
  rechargeWallet,
  redeemPoints,
  registerMerchant,
  startBankVerification,
  updateMerchantStatus,
  updateMyMerchant,
  withdrawPoints,
} from '../controllers/merchant.controller.js'
import { createTransaction, deleteTransaction, listTransactions } from '../controllers/transaction.controller.js'
import { protect } from '../middleware/auth.js'

const router = Router()

// protect('member') / protect('merchant') / protect('admin') = must send "Authorization: Bearer <token>" from that kind of login
const memberOnly = protect('member')
const merchantOnly = protect('merchant')
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
router.post('/auth/otp/send', sendOtp) //            { email, purpose: 'join' | 'login' | 'merchant-join' | 'merchant-login' } -> emails a 6-digit OTP
router.post('/auth/member/join', joinMember) //      { name, email, mobile, address, pincode, referralCode (member code or Merchant ID), otp }
router.post('/auth/member/login', loginMember) //    { email, otp }
router.post('/auth/merchant/login', loginMerchant) // { email, otp } — approved merchants only
router.post('/auth/admin/login', adminLogin) //      { username, password }

// ---------- Merchants (public) ----------
router.get('/merchants/categories', getCategories)
router.post('/merchants/bank-verification', startBankVerification) // { email, otp, accountHolderName, ifsc, accountNumber } -> ₹1 check
router.get('/merchants/bank-verification/:id', getBankVerification) // ?email= — poll until not 'pending'
router.post('/merchants/signup-payment', paySignupFee) // { email, otp, rechargeAmount? } -> DUMMY: ₹1,000 + 3% fee = 1,000 pts
router.post('/merchants/register', registerMerchant) // { businessName, ..., accountHolderName, ifsc, accountNumber, bankVerificationId, signupPaymentId, otp }

// ---------- Merchant (logged-in merchant) ----------
router.get('/merchants/me', merchantOnly, getMyMerchant)
router.patch('/merchants/me', merchantOnly, updateMyMerchant) // { discountPercent }
router.get('/merchants/me/transactions', merchantOnly, getMyMerchantTransactions)
router.post('/merchants/me/transactions', merchantOnly, issuePoints) // { email, purchaseAmount, otp? } — new email: 202 { otpRequired } first
router.get('/merchants/me/wallet/payments', merchantOnly, getMyWalletPayments)
router.post('/merchants/me/wallet/recharge', merchantOnly, rechargeWallet) // { rechargeAmount } — min ₹1,000, DUMMY payment
router.get('/merchants/me/customers', merchantOnly, lookupCustomer) // ?email= -> { name, email, totalPoints }
router.get('/merchants/me/redemptions', merchantOnly, getMyRedemptions)
router.get('/merchants/me/referrals', merchantOnly, getMyMerchantReferrals) // members who joined with the Merchant ID
router.post('/merchants/me/redemptions', merchantOnly, redeemPoints) // { email, points, otp? } — 202 { otpRequired } first
router.get('/merchants/me/wallet/withdrawals', merchantOnly, getMyWithdrawals)
router.post('/merchants/me/wallet/withdraw', merchantOnly, withdrawPoints) // { points } — 1 pt = ₹1, max 5,000/day, DUMMY payout

// ---------- Member (logged-in member) ----------
router.get('/members/me', memberOnly, getMe)
router.patch('/members/me', memberOnly, updateMe) //    { name }
router.get('/members/me/transactions', memberOnly, getMyTransactions)
router.get('/members/me/referrals', memberOnly, getMyReferrals)

// ---------- Admin (logged-in admin) ----------
router.get('/admin/stats', adminOnly, getStats)
router.get('/admin/settings', adminOnly, getAdminSettings)
router.patch('/admin/settings', adminOnly, updateAdminSettings) // { withdrawalFeePercent }
router.get('/admin/members', adminOnly, listMembers) // ?search=&page=&limit=
router.get('/admin/members/:id', adminOnly, getMember)
router.delete('/admin/members/:id', adminOnly, deleteMember)
router.get('/admin/merchants', adminOnly, listMerchants) // ?status=pending
router.get('/admin/merchants/:id', adminOnly, getMerchantProfile) // full details + activity for the profile page
router.patch('/admin/merchants/:id/status', adminOnly, updateMerchantStatus) // { status: 'approved' | 'rejected' }

// ---------- Transactions / points (logged-in admin) ----------
router.get('/transactions', adminOnly, listTransactions) // ?memberId=
router.post('/transactions', adminOnly, createTransaction) // { mobile, shopName, purchaseAmount, pointsEarned? }
router.delete('/transactions/:id', adminOnly, deleteTransaction)

export default router
