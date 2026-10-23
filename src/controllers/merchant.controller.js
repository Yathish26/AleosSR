import mongoose from 'mongoose'
import BankVerification from '../models/BankVerification.js'
import Member from '../models/Member.js'
import Merchant, {
  FSSAI_CATEGORIES,
  generateMerchantId,
  getMasterMerchant,
  MERCHANT_CATEGORIES,
} from '../models/Merchant.js'
import Redemption from '../models/Redemption.js'
import { getSettings } from '../models/Setting.js'
import Transaction from '../models/Transaction.js'
import WalletPayment from '../models/WalletPayment.js'
import WalletWithdrawal from '../models/WalletWithdrawal.js'
import ApiError from '../utils/ApiError.js'
import { escapeHtml, escapeRegex } from '../utils/html.js'
import { sendMail } from '../utils/mailer.js'
import { signToken } from '../utils/token.js'
import { getBankValidation, isRazorpayConfigured, startBankValidation } from '../utils/razorpay.js'
import { consumeOtp, issueOtp } from './auth.controller.js'

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/
const ACCOUNT_NUMBER_RE = /^\d{9,18}$/
// Each check costs real money, so cap how many one email can run
const MAX_BANK_CHECKS_PER_EMAIL = 5

// Wallet: merchants load points by paying ₹1 per point, plus a convenience fee on top.
// Sign-up and every recharge must be at least ₹1,000 (= 1,000 points); the fee is 3% of the recharge amount
// (₹1,000 → ₹1,030, ₹2,500 → ₹2,575), kept to the paisa.
const MIN_RECHARGE = 1000
const CONVENIENCE_FEE_RATE = 0.03
const POINTS_PER_RUPEE = 1

// Sign-up only: the recharge is one of these, plus a one-time onboarding fee with 18% GST on it
const SIGNUP_RECHARGE_OPTIONS = [1000, 2000, 3000]
const ONBOARDING_FEE = 249
const ONBOARDING_TAX_RATE = 0.18

const toPaise = (n) => Math.round(n * 100) / 100

// Works out what a recharge of `rechargeAmount` rupees costs and how many points it gives.
// { signup: true } adds the onboarding fee + GST and only allows SIGNUP_RECHARGE_OPTIONS.
function priceRecharge(rechargeAmount, { signup = false } = {}) {
  const value = Number(rechargeAmount)
  if (signup && !SIGNUP_RECHARGE_OPTIONS.includes(value)) {
    throw new ApiError(400, `Choose a recharge of ${SIGNUP_RECHARGE_OPTIONS.map((v) => `₹${v.toLocaleString('en-IN')}`).join(', ')}`)
  }
  if (!Number.isInteger(value) || value < MIN_RECHARGE) {
    throw new ApiError(400, `Recharge must be a whole amount of at least ₹${MIN_RECHARGE.toLocaleString('en-IN')}`)
  }
  const convenienceFee = toPaise(value * CONVENIENCE_FEE_RATE)
  const onboardingFee = signup ? ONBOARDING_FEE : 0
  const onboardingTax = signup ? toPaise(ONBOARDING_FEE * ONBOARDING_TAX_RATE) : 0
  return {
    rechargeAmount: value,
    convenienceFee,
    onboardingFee,
    onboardingTax,
    amount: toPaise(value + convenienceFee + onboardingFee + onboardingTax),
    points: value * POINTS_PER_RUPEE,
  }
}

const dummyReference = () => `DUMMY-${Date.now().toString(36).toUpperCase()}`

// Withdrawals: 1 point = ₹1 to the merchant's bank, at most this many points per day (Indian time)
const DAILY_WITHDRAWAL_LIMIT = 5000
const RUPEES_PER_POINT_WITHDRAWN = 1
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

// When today started in India (midnight IST), as a real Date
function startOfTodayIST() {
  const nowInIST = new Date(Date.now() + IST_OFFSET_MS)
  nowInIST.setUTCHours(0, 0, 0, 0)
  return new Date(nowInIST.getTime() - IST_OFFSET_MS)
}

async function pointsWithdrawnToday(merchantId) {
  const [row] = await WalletWithdrawal.aggregate([
    { $match: { merchant: new mongoose.Types.ObjectId(String(merchantId)), createdAt: { $gte: startOfTodayIST() } } },
    { $group: { _id: null, points: { $sum: '$points' } } },
  ])
  return row?.points || 0
}

// GET /merchants/categories
export function getCategories(req, res) {
  res.json({ success: true, categories: MERCHANT_CATEGORIES, fssaiCategories: FSSAI_CATEGORIES })
}

function bankVerificationJson(v) {
  return {
    id: v._id,
    status: v.status,
    registeredName: v.registeredName || null,
    failureReason: v.failureReason || null,
  }
}

// POST /merchants/bank-verification  { email, otp, mobile?, accountHolderName, ifsc, accountNumber }
// Starts the ₹1 check. Needs the email OTP (checked, not used up) so only someone who owns the email can trigger it.
export async function startBankVerification(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase()
  const accountHolderName = String(req.body.accountHolderName || '').trim()
  const ifsc = String(req.body.ifsc || '').trim().toUpperCase()
  const accountNumber = String(req.body.accountNumber || '').trim()
  const mobile = String(req.body.mobile || '').trim()

  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Please enter a valid email')
  if (!accountHolderName) throw new ApiError(400, 'Account holder name is required')
  if (!IFSC_RE.test(ifsc)) throw new ApiError(400, 'Please enter a valid 11-character IFSC code')
  if (!ACCOUNT_NUMBER_RE.test(accountNumber)) throw new ApiError(400, 'Account number must be 9 to 18 digits')
  if (await Merchant.exists({ email })) throw new ApiError(409, 'A business is already registered with this email')

  await consumeOtp(email, req.body.otp, 'merchant', { keep: true })

  // Same account already checked (or being checked) for this email — don't pay for it twice
  const existing = await BankVerification.findOne({ email, ifsc, accountNumber, status: { $in: ['verified', 'pending'] } })
  if (existing) return res.json({ success: true, verification: bankVerificationJson(existing) })

  if ((await BankVerification.countDocuments({ email })) >= MAX_BANK_CHECKS_PER_EMAIL) {
    throw new ApiError(429, 'Too many bank verification attempts for this email. Please contact support.')
  }

  if (!isRazorpayConfigured) {
    // DUMMY for now (no RazorpayX access yet): the check passes straight away. No razorpayValidationId = dummy.
    const verification = await BankVerification.create({
      email,
      accountHolderName,
      ifsc,
      accountNumber,
      status: 'verified',
      registeredName: accountHolderName,
    })
    return res.status(201).json({ success: true, dummy: true, verification: bankVerificationJson(verification) })
  }

  const verification = await BankVerification.create({ email, accountHolderName, ifsc, accountNumber })
  try {
    const result = await startBankValidation({
      name: accountHolderName,
      email,
      mobile: /^\d{10}$/.test(mobile) ? mobile : undefined,
      ifsc,
      accountNumber,
      referenceId: String(verification._id),
    })
    verification.razorpayValidationId = result.id
    verification.status = result.status
    verification.registeredName = result.registeredName || undefined
    verification.failureReason = result.reason || undefined
  } catch (err) {
    console.error(`Razorpay bank check for ${email} failed: ${err.message}`)
    verification.status = 'failed'
    verification.failureReason = err.message
    await verification.save()
    throw new ApiError(502, `Could not verify the bank account: ${err.message}`)
  }
  await verification.save()
  res.status(201).json({ success: true, verification: bankVerificationJson(verification) })
}

// POST /merchants/signup-payment  { email, otp, rechargeAmount? }  — ₹1,000 / ₹2,000 / ₹3,000 (default ₹1,000),
// plus 3% convenience fee and the one-time ₹249 onboarding fee + 18% GST
// DUMMY for now: records the payment as paid without charging anything. Replace with a Razorpay order +
// signature check before going live.
export async function paySignupFee(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Please enter a valid email')
  if (await Merchant.exists({ email })) throw new ApiError(409, 'A business is already registered with this email')
  await consumeOtp(email, req.body.otp, 'merchant', { keep: true })

  // Already paid and not yet used — reuse it rather than charge again
  const existing = await WalletPayment.findOne({ kind: 'signup', email, merchant: { $exists: false } })
  if (existing) return res.json({ success: true, payment: existing })

  const payment = await WalletPayment.create({
    kind: 'signup',
    email,
    ...priceRecharge(req.body.rechargeAmount ?? MIN_RECHARGE, { signup: true }),
    mode: 'dummy',
    reference: dummyReference(),
  })
  res.status(201).json({ success: true, payment })
}

// POST /merchants/me/wallet/recharge  { rechargeAmount }  — at least ₹1,000; DUMMY payment for now
export async function rechargeWallet(req, res) {
  const merchant = await Merchant.findById(req.user.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  if (merchant.status !== 'approved') throw new ApiError(403, 'Your merchant account is not approved')

  const price = priceRecharge(req.body.rechargeAmount)
  const updated = await Merchant.findByIdAndUpdate(merchant._id, { $inc: { walletBalance: price.points } }, { new: true })
  const payment = await WalletPayment.create({
    kind: 'recharge',
    email: merchant.email,
    merchant: merchant._id,
    ...price,
    walletBalanceAfter: updated.walletBalance,
    mode: 'dummy',
    reference: dummyReference(),
  })
  res.status(201).json({ success: true, payment, walletBalance: updated.walletBalance })
}

// POST /merchants/me/wallet/withdraw  { points } — cash points out to the merchant's bank (DUMMY payout for now)
export async function withdrawPoints(req, res) {
  const merchant = await Merchant.findById(req.user.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  if (merchant.status !== 'approved') throw new ApiError(403, 'Your merchant account is not approved')
  if (!merchant.accountNumber || !merchant.ifsc) {
    throw new ApiError(400, 'No bank account on file. Please contact support to add your bank details.')
  }

  const points = Number(req.body.points)
  if (!Number.isInteger(points) || points < 1) throw new ApiError(400, 'Enter a whole number of points to withdraw')

  const usedToday = await pointsWithdrawnToday(merchant._id)
  const leftToday = Math.max(0, DAILY_WITHDRAWAL_LIMIT - usedToday)
  if (points > leftToday) {
    throw new ApiError(
      400,
      leftToday === 0
        ? `You've reached today's limit of ${DAILY_WITHDRAWAL_LIMIT.toLocaleString('en-IN')} points. Try again tomorrow.`
        : `You can withdraw ${leftToday.toLocaleString('en-IN')} more points today (daily limit ${DAILY_WITHDRAWAL_LIMIT.toLocaleString('en-IN')}).`,
    )
  }

  // Take the points only if they're there, in one step, so two quick submits can't overspend the wallet
  const updated = await Merchant.findOneAndUpdate(
    { _id: merchant._id, walletBalance: { $gte: points } },
    { $inc: { walletBalance: -points } },
    { new: true },
  )
  if (!updated) {
    throw new ApiError(400, `Not enough points: you have ${merchant.walletBalance} pts in your wallet`)
  }

  // Admin-set fee %, kept to the paisa: 2% of 1,000 points → ₹20 fee, ₹980 to the bank
  const { withdrawalFeePercent: feePercent = 0 } = await getSettings()
  const gross = points * RUPEES_PER_POINT_WITHDRAWN
  const fee = Math.round(gross * feePercent) / 100

  let withdrawal
  try {
    withdrawal = await WalletWithdrawal.create({
      merchant: merchant._id,
      points,
      feePercent,
      fee,
      amount: Math.round((gross - fee) * 100) / 100,
      bankName: merchant.bankName,
      ifsc: merchant.ifsc,
      accountLast4: merchant.accountNumber.slice(-4),
      walletBalanceAfter: updated.walletBalance,
      mode: 'dummy',
      reference: dummyReference(),
    })
  } catch (err) {
    await Merchant.updateOne({ _id: merchant._id }, { $inc: { walletBalance: points } }) // give the points back
    throw err
  }

  res.status(201).json({
    success: true,
    withdrawal,
    walletBalance: updated.walletBalance,
    withdrawnToday: usedToday + points,
    dailyLimit: DAILY_WITHDRAWAL_LIMIT,
    feePercent,
  })
}

// GET /merchants/me/wallet/withdrawals — newest first, plus how much of today's limit is used and the current fee %
export async function getMyWithdrawals(req, res) {
  const [withdrawals, withdrawnToday, settings] = await Promise.all([
    WalletWithdrawal.find({ merchant: req.user.id }).sort({ createdAt: -1 }),
    pointsWithdrawnToday(req.user.id),
    getSettings(),
  ])
  res.json({
    success: true,
    withdrawals,
    withdrawnToday,
    dailyLimit: DAILY_WITHDRAWAL_LIMIT,
    feePercent: settings.withdrawalFeePercent ?? 0,
  })
}

// GET /merchants/me/wallet/payments — sign-up payment and recharges, newest first
export async function getMyWalletPayments(req, res) {
  const payments = await WalletPayment.find({ merchant: req.user.id }).sort({ createdAt: -1 })
  res.json({ success: true, count: payments.length, payments })
}

// GET /merchants/bank-verification/:id?email=  — the page polls this until the check is no longer 'pending'
export async function getBankVerification(req, res) {
  const email = String(req.query.email || '').trim().toLowerCase()
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Bank verification not found')
  const verification = await BankVerification.findOne({ _id: req.params.id, email })
  if (!verification) throw new ApiError(404, 'Bank verification not found')

  if (verification.status === 'pending' && verification.razorpayValidationId) {
    const result = await getBankValidation(verification.razorpayValidationId)
    verification.status = result.status
    verification.registeredName = result.registeredName || undefined
    verification.failureReason = result.reason || undefined
    await verification.save()
  }

  res.json({ success: true, verification: bankVerificationJson(verification) })
}

// POST /merchants/register
//   { businessName, ownerName, category, email, mobile, address, city, googleBusinessLink?,
//     tradeLicense?, fssaiNumber?, aadhaarNumber?, panNumber?, bankName, accountHolderName, ifsc, accountNumber,
//     bankVerificationId, otp }
export async function registerMerchant(req, res) {
  const { businessName, ownerName, category, mobile, address, city, tradeLicense, bankName, accountHolderName } =
    req.body
  const email = String(req.body.email || '').trim().toLowerCase()
  const ifsc = String(req.body.ifsc || '').trim().toUpperCase()
  const accountNumber = String(req.body.accountNumber || '').trim()
  // Empty string means "not provided" — store nothing rather than fail URL validation
  const googleBusinessLink = req.body.googleBusinessLink || undefined
  // Optional, and only kept for food businesses; empty = not provided
  const fssaiNumber = FSSAI_CATEGORIES.includes(category) ? String(req.body.fssaiNumber || '').trim() || undefined : undefined

  if (email && (await Merchant.exists({ email }))) {
    throw new ApiError(409, 'A business is already registered with this email')
  }
  if (mobile && (await Merchant.exists({ mobile }))) {
    throw new ApiError(409, 'A business is already registered with this mobile number')
  }

  // The bank account must have passed the ₹1 check, for this email and exactly these details
  const verification = mongoose.isValidObjectId(req.body.bankVerificationId)
    ? await BankVerification.findOne({ _id: req.body.bankVerificationId, email })
    : null
  if (!verification || verification.status !== 'verified') {
    throw new ApiError(400, 'Please verify your bank account before submitting')
  }
  if (verification.ifsc !== ifsc || verification.accountNumber !== accountNumber) {
    throw new ApiError(400, 'Bank details changed after verification. Please verify the bank account again.')
  }

  const payment = mongoose.isValidObjectId(req.body.signupPaymentId)
    ? await WalletPayment.findOne({ _id: req.body.signupPaymentId, kind: 'signup', email, merchant: { $exists: false } })
    : null
  if (!payment) throw new ApiError(400, 'Please complete the sign-up payment before submitting')

  // Check the form is valid before using up the OTP, so a typo doesn't force a new code
  const merchant = new Merchant({
    businessName,
    ownerName,
    category,
    email,
    mobile,
    address,
    city,
    googleBusinessLink,
    tradeLicense: String(tradeLicense || '').trim() || undefined, // optional
    fssaiNumber,
    // Optional; empty = not provided. Spaces in Aadhaar ("1234 5678 9012") are ignored.
    aadhaarNumber: String(req.body.aadhaarNumber || '').replace(/\s+/g, '') || undefined,
    panNumber: String(req.body.panNumber || '').trim().toUpperCase() || undefined,
    bankName,
    accountHolderName,
    ifsc,
    accountNumber,
    bankVerified: true,
    bankRegisteredName: verification.registeredName,
    walletBalance: payment.points,
    signupPayment: payment._id,
  })
  await merchant.validate()
  await consumeOtp(email, req.body.otp, 'merchant')
  // Retry with a fresh ID on the (very unlikely) chance the random one is already taken
  for (let attempt = 0; ; attempt++) {
    merchant.merchantId = generateMerchantId()
    try {
      await merchant.save()
      break
    } catch (err) {
      if (err.code !== 11000 || !err.keyValue?.merchantId || attempt >= 4) throw err
    }
  }
  payment.merchant = merchant._id
  payment.walletBalanceAfter = payment.points
  await payment.save()
  res.status(201).json({
    success: true,
    message: 'Application received. Our team will review it and contact you.',
    merchant,
  })
}

// GET /merchants/me
export async function getMyMerchant(req, res) {
  const merchant = await Merchant.findById(req.user.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  res.json({ success: true, merchant })
}

// Reads a discount % from the request: more than 0, at most 100, up to 2 decimals
function parseDiscountPercent(value) {
  const percent = Number(value)
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw new ApiError(400, 'Discount must be more than 0% and at most 100%')
  }
  return Math.round(percent * 100) / 100
}

// PATCH /merchants/me  { discountPercent }
export async function updateMyMerchant(req, res) {
  const merchant = await Merchant.findById(req.user.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  merchant.discountPercent = parseDiscountPercent(req.body.discountPercent)
  // Only validate what changed — older merchants were saved before some fields were required
  await merchant.save({ validateModifiedOnly: true })
  res.json({ success: true, merchant })
}

// GET /merchants/me/transactions
export async function getMyMerchantTransactions(req, res) {
  const transactions = await Transaction.find({ merchant: req.user.id })
    .populate('member', 'name email mobile')
    .sort({ date: -1 })
  res.json({ success: true, count: transactions.length, transactions })
}

// POST /merchants/me/transactions  { email, purchaseAmount, otp? } — points are worked out on the server
// (bill × the merchant's discount %) and taken from the merchant's wallet points.
// Email not registered yet: the first call (no otp) emails the customer a code and answers 202 { otpRequired };
// the merchant sends it again with the code, which creates the member (email only) and adds the points.
// Either way the customer gets a "points added" email.
export async function issuePoints(req, res) {
  const merchant = await Merchant.findById(req.user.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  // The login token outlives an admin moving the merchant back to pending/rejected
  if (merchant.status !== 'approved') throw new ApiError(403, 'Your merchant account is not approved')

  const email = String(req.body.email || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Please enter a valid email address')
  const amount = Number(req.body.purchaseAmount)
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(400, 'Purchase amount must be more than 0')

  const discountPercent = merchant.discountPercent ?? 10
  const points = Math.floor((amount * discountPercent) / 100)
  if (points < 1) throw new ApiError(400, `At ${discountPercent}% this bill earns less than 1 point`)
  // Check before emailing a code — the real check happens when the points are taken below
  if (merchant.walletBalance < points) {
    throw new ApiError(
      400,
      `Not enough points in your wallet: this needs ${points} pts, you have ${merchant.walletBalance} pts. Please recharge.`,
    )
  }

  let member = await Member.findOne({ email })
  const isNewMember = !member
  if (!member) {
    if (!req.body.otp) {
      const sent = await issueOtp(email, 'reward', {
        intro: `${merchant.businessName} wants to add ${points} ALEOS reward points for you. To confirm your email, give this code to the shop:`,
      })
      return res.status(202).json({ success: true, otpRequired: true, ...sent })
    }
    await consumeOtp(email, req.body.otp, 'reward')
    try {
      // The merchant brought this member in, so it counts as the merchant's referral
      member = await Member.create({ email, createdByMerchant: merchant._id, referredBy: merchant.merchantId })
    } catch (err) {
      // Joined at the same moment some other way — just use that account
      if (err.code !== 11000) throw err
      member = await Member.findOne({ email })
      if (!member) throw err
    }
  }

  // Take the points only if they're there, in one step, so two quick submits can't overspend the wallet
  const updated = await Merchant.findOneAndUpdate(
    { _id: merchant._id, walletBalance: { $gte: points } },
    { $inc: { walletBalance: -points } },
    { new: true },
  )
  if (!updated) {
    throw new ApiError(
      400,
      `Not enough points in your wallet: this needs ${points} pts, you have ${merchant.walletBalance} pts. Please recharge.`,
    )
  }

  // Split the points: 80% member, 10% whoever referred them, 10% ALEOS (20% to ALEOS if no one referred them)
  const [referrer, master] = await Promise.all([findReferrer(member), getMasterMerchant()])
  const split = splitPoints(points, Boolean(referrer))

  let transaction
  try {
    transaction = await Transaction.create({
      member: member._id,
      merchant: merchant._id,
      shopName: merchant.businessName,
      purchaseAmount: amount,
      pointsEarned: split.member,
      totalPoints: points,
      referrerPoints: split.referrer,
      masterPoints: split.master,
      referrerCode: referrer?.code,
      referrerMember: referrer?.member?._id,
      referrerMerchant: referrer?.merchant?._id,
      discountPercent,
      walletDebit: points,
      walletBalanceAfter: updated.walletBalance,
    })
  } catch (err) {
    await Merchant.updateOne({ _id: merchant._id }, { $inc: { walletBalance: points } }) // give the points back
    throw err
  }

  const credited = await Member.findByIdAndUpdate(
    member._id,
    { $inc: { totalPoints: split.member, totalSpent: amount } },
    { new: true },
  )
  await creditReferrerAndMaster({ transaction, referrer, master, split, member, merchant })

  // Tell the customer. A failed email is logged but doesn't undo the points.
  const emailArgs = { merchant, points: split.member, amount, totalPoints: credited.totalPoints, isNewMember }
  try {
    await sendMail({
      to: email,
      subject: `You earned ${split.member} ALEOS points at ${merchant.businessName}`,
      text: pointsEmailText(emailArgs),
      html: pointsEmailHtml(emailArgs),
    })
  } catch (err) {
    console.error(`Points email to ${email} failed: ${err.message}`)
  }

  await transaction.populate([
    { path: 'member', select: 'name email mobile' },
    { path: 'referrerMember', select: 'name email' },
    { path: 'referrerMerchant', select: 'businessName merchantId' },
  ])
  // The merchant's own wallet may have changed again if they referred this member or are the master account
  const { walletBalance } = await Merchant.findById(merchant._id).select('walletBalance')
  res.status(201).json({ success: true, transaction, walletBalance, newMember: isNewMember })
}

// Shares of every bill's points
const MEMBER_SHARE = 0.8
const REFERRER_SHARE = 0.1

// 80 / 10 / 10 in whole points; ALEOS takes the referrer's share when there's no referrer, and any remainder
// from rounding, so the three always add up to `total`
function splitPoints(total, hasReferrer) {
  const member = Math.floor(total * MEMBER_SHARE)
  const referrer = hasReferrer ? Math.floor(total * REFERRER_SHARE) : 0
  return { member, referrer, master: total - member - referrer }
}

// Who referred this member: { code, member } for a member's code, { code, merchant } for a shop's Merchant ID,
// or null when there's no referrer, the code is ALEOS's own, or the referrer no longer exists
async function findReferrer(member) {
  const code = member.referredBy
  if (!code) return null
  const referringMember = await Member.findOne({ referralCode: code, _id: { $ne: member._id } })
  if (referringMember) return { code, member: referringMember }
  const referringMerchant = await Merchant.findOne({ merchantId: code })
  if (referringMerchant && !referringMerchant.isMaster) return { code, merchant: referringMerchant }
  return null
}

// Pays the referrer's and ALEOS's shares of a bill. Errors are logged, not thrown: the member already has their
// points, and the bill's own record shows what each side should have received.
async function creditReferrerAndMaster({ transaction, referrer, master, split, member, merchant }) {
  try {
    if (referrer?.member && split.referrer > 0) {
      await Member.updateOne({ _id: referrer.member._id }, { $inc: { totalPoints: split.referrer } })
      // Shows up in the referrer's own points list as a referral bonus
      await Transaction.create({
        member: referrer.member._id,
        kind: 'referral',
        shopName: merchant.businessName,
        purchaseAmount: 0,
        pointsEarned: split.referrer,
        sourceTransaction: transaction._id,
      })
    } else if (referrer?.merchant && split.referrer > 0) {
      await Merchant.updateOne({ _id: referrer.merchant._id }, { $inc: { walletBalance: split.referrer } })
    }
    if (split.master > 0) {
      await Merchant.updateOne({ _id: master._id }, { $inc: { walletBalance: split.master } })
    }
  } catch (err) {
    console.error(`Points split for bill ${transaction._id} (member ${member._id}) failed: ${err.message}`)
  }
}

async function findApprovedMerchantById(id) {
  const merchant = await Merchant.findById(id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  if (merchant.status !== 'approved') throw new ApiError(403, 'Your merchant account is not approved')
  return merchant
}

function normalizeCustomerEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError(400, 'Please enter a valid email address')
  return email
}

// GET /merchants/me/customers?email= — a member's name and points, so the merchant can redeem them
export async function lookupCustomer(req, res) {
  await findApprovedMerchantById(req.user.id)
  const email = normalizeCustomerEmail(req.query.email)
  const member = await Member.findOne({ email }).select('name email totalPoints')
  if (!member) throw new ApiError(404, 'No ALEOS member found with this email')
  res.json({ success: true, customer: { name: member.name, email: member.email, totalPoints: member.totalPoints } })
}

// POST /merchants/me/redemptions  { email, points, otp? }
// First call (no otp) emails the member a code and answers 202 { otpRequired }; the merchant sends it again with
// the code. Then the points move from the member's balance into the merchant's wallet.
export async function redeemPoints(req, res) {
  const merchant = await findApprovedMerchantById(req.user.id)
  const email = normalizeCustomerEmail(req.body.email)
  const points = Number(req.body.points)
  if (!Number.isInteger(points) || points < 1) throw new ApiError(400, 'Enter a whole number of points to redeem')

  const member = await Member.findOne({ email })
  if (!member) throw new ApiError(404, 'No ALEOS member found with this email')
  if (member.totalPoints < points) {
    throw new ApiError(400, `This member has only ${member.totalPoints} points`)
  }

  if (!req.body.otp) {
    const sent = await issueOtp(email, 'redeem', {
      intro: `${merchant.businessName} wants to use ${points} of your ALEOS points. If you agree, give this code to the shop:`,
    })
    return res.status(202).json({ success: true, otpRequired: true, ...sent })
  }
  await consumeOtp(email, req.body.otp, 'redeem')

  // Take the points only if the member still has them, in one step
  const updatedMember = await Member.findOneAndUpdate(
    { _id: member._id, totalPoints: { $gte: points } },
    { $inc: { totalPoints: -points } },
    { new: true },
  )
  if (!updatedMember) throw new ApiError(400, 'This member no longer has enough points')

  let updatedMerchant
  let redemption
  try {
    updatedMerchant = await Merchant.findByIdAndUpdate(merchant._id, { $inc: { walletBalance: points } }, { new: true })
    redemption = await Redemption.create({
      member: member._id,
      merchant: merchant._id,
      shopName: merchant.businessName,
      points,
      memberPointsAfter: updatedMember.totalPoints,
      merchantWalletAfter: updatedMerchant.walletBalance,
    })
  } catch (err) {
    // Undo both sides so no points are lost
    await Member.updateOne({ _id: member._id }, { $inc: { totalPoints: points } })
    if (updatedMerchant) await Merchant.updateOne({ _id: merchant._id }, { $inc: { walletBalance: -points } })
    throw err
  }

  try {
    await sendMail({
      to: email,
      subject: `You used ${points} ALEOS points at ${merchant.businessName}`,
      text: `You used ${points} reward points at ${merchant.businessName}. Your ALEOS points balance is now ${updatedMember.totalPoints}.`,
      html: redeemEmailHtml({ merchant, points, totalPoints: updatedMember.totalPoints }),
    })
  } catch (err) {
    console.error(`Redemption email to ${email} failed: ${err.message}`)
  }

  await redemption.populate('member', 'name email')
  res.status(201).json({ success: true, redemption, walletBalance: updatedMerchant.walletBalance })
}

// GET /merchants/me/referrals — members who joined with this merchant's Merchant ID as their referral code
export async function getMyMerchantReferrals(req, res) {
  const merchant = await Merchant.findById(req.user.id).select('merchantId')
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  const referrals = merchant.merchantId
    ? await Member.find({ referredBy: merchant.merchantId }).select('name email createdAt').sort({ createdAt: -1 })
    : []
  res.json({ success: true, count: referrals.length, referrals })
}

// GET /merchants/me/passbook?limit=200 — every point in and out of the wallet, newest first, like a bank passbook.
// Built from the records that moved the points. The balance column is worked backwards from today's wallet
// balance, so it always ends on the real number.
export async function getMyPassbook(req, res) {
  const merchant = await Merchant.findById(req.user.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200))
  res.json({ success: true, walletBalance: merchant.walletBalance ?? 0, entries: await buildPassbook(merchant, limit) })
}

// The newest `limit` wallet movements of a merchant, each with the balance right after it
async function buildPassbook(merchant, limit = 200) {
  const newest = { sort: { createdAt: -1 }, limit }
  const memberName = (m) => (m ? m.name || m.email : 'a removed member')

  const [payments, bills, withdrawals, redemptions, referralShares, masterShares] = await Promise.all([
    WalletPayment.find({ merchant: merchant._id }, null, newest),
    Transaction.find({ merchant: merchant._id, walletDebit: { $gt: 0 } }, null, { sort: { date: -1 }, limit }).populate(
      'member',
      'name email',
    ),
    WalletWithdrawal.find({ merchant: merchant._id }, null, newest),
    Redemption.find({ merchant: merchant._id }, null, newest).populate('member', 'name email'),
    Transaction.find({ referrerMerchant: merchant._id, referrerPoints: { $gt: 0 } }, null, {
      sort: { date: -1 },
      limit,
    }).populate('member', 'name email'),
    merchant.isMaster
      ? Transaction.find({ masterPoints: { $gt: 0 } }, null, { sort: { date: -1 }, limit })
      : [],
  ])

  const entries = [
    ...payments.map((p) => ({
      id: `pay-${p._id}`,
      date: p.createdAt,
      type: p.kind === 'signup' ? 'Sign-up top-up' : 'Recharge',
      details:
        `Paid ₹${p.amount.toLocaleString('en-IN')} (incl. ₹${p.convenienceFee.toLocaleString('en-IN')} fee` +
        (p.onboardingFee
          ? `, ₹${p.onboardingFee.toLocaleString('en-IN')} onboarding + ₹${(p.onboardingTax || 0).toLocaleString('en-IN')} GST)`
          : ')'),
      reference: p.reference,
      credit: p.points,
    })),
    ...bills.map((t) => ({
      id: `bill-${t._id}`,
      date: t.date,
      type: 'Points given',
      details:
        `${memberName(t.member)} · ₹${t.purchaseAmount.toLocaleString('en-IN')} bill` +
        (t.totalPoints != null
          ? ` · member ${t.pointsEarned}${t.referrerPoints ? `, referrer ${t.referrerPoints}` : ''}, ALEOS ${t.masterPoints ?? 0}`
          : ''),
      debit: t.walletDebit,
    })),
    ...withdrawals.map((w) => ({
      id: `out-${w._id}`,
      date: w.createdAt,
      type: 'Withdrawal',
      details: `₹${w.amount.toLocaleString('en-IN')} to ${w.bankName || 'bank'} ··${w.accountLast4}${w.fee ? ` (fee ₹${w.fee})` : ''}`,
      reference: w.reference,
      debit: w.points,
    })),
    ...redemptions.map((r) => ({
      id: `used-${r._id}`,
      date: r.createdAt,
      type: 'Points used by member',
      details: memberName(r.member),
      credit: r.points,
    })),
    ...referralShares.map((t) => ({
      id: `ref-${t._id}`,
      date: t.date,
      type: 'Referral share',
      details: `${memberName(t.member)} (your referral) shopped at ${t.shopName}`,
      credit: t.referrerPoints,
    })),
    ...masterShares.map((t) => ({
      id: `aleos-${t._id}`,
      date: t.date,
      type: 'ALEOS share',
      details: `From a bill at ${t.shopName}`,
      credit: t.masterPoints,
    })),
  ]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)

  // Walk back from today's balance: before a credit there was less, before a debit there was more
  let balance = merchant.walletBalance ?? 0
  for (const entry of entries) {
    entry.balanceAfter = balance
    balance += (entry.debit || 0) - (entry.credit || 0)
  }
  return entries
}

// GET /merchants/me/redemptions — points members used at this shop, newest first
export async function getMyRedemptions(req, res) {
  const redemptions = await Redemption.find({ merchant: req.user.id }).populate('member', 'name email').sort({ createdAt: -1 })
  res.json({ success: true, redemptions })
}

function redeemEmailHtml({ merchant, points, totalPoints }) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-bottom:16px">ALEOS</div>
  <p style="margin:0 0 12px;font-size:15px">You used reward points at <strong>${escapeHtml(merchant.businessName)}</strong>.</p>
  <div style="font-size:28px;font-weight:800;background:#fef2f2;color:#b91c1c;border-radius:12px;padding:16px;text-align:center">−${points} points</div>
  <p style="margin:16px 0 0;font-size:15px">Your points balance is now <strong>${totalPoints}</strong>.</p>
  <p style="margin:12px 0 0;font-size:13px;color:#64748b">If you didn't approve this, contact ALEOS support right away.</p>
</div>`
}

// Where customers log in — first CLIENT_ORIGIN entry, if set
function loginLink() {
  const origin = process.env.CLIENT_ORIGIN?.split(',')[0]?.trim()
  return origin && origin !== '*' ? `${origin.replace(/\/$/, '')}/login` : null
}

function pointsEmailText({ merchant, points, amount, totalPoints, isNewMember }) {
  const link = loginLink()
  return [
    `You earned ${points} reward points at ${merchant.businessName} on your ₹${amount.toLocaleString('en-IN')} purchase.`,
    `Your ALEOS points balance is now ${totalPoints}.`,
    isNewMember
      ? `An ALEOS account has been created for you with this email. Log in${link ? ` at ${link}` : ''} with this email to add your name and see your points.`
      : `Log in${link ? ` at ${link}` : ''} to see your points.`,
  ].join('\n\n')
}

function pointsEmailHtml({ merchant, points, amount, totalPoints, isNewMember }) {
  const link = loginLink()
  const loginText = link ? `<a href="${escapeHtml(link)}" style="color:#1d4ed8;font-weight:700">Log in</a>` : 'Log in'
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-bottom:16px">ALEOS</div>
  <p style="margin:0 0 12px;font-size:15px">You earned reward points at <strong>${escapeHtml(merchant.businessName)}</strong> on your ₹${amount.toLocaleString('en-IN')} purchase.</p>
  <div style="font-size:28px;font-weight:800;background:#ecfdf5;color:#047857;border-radius:12px;padding:16px;text-align:center">+${points} points</div>
  <p style="margin:16px 0 0;font-size:15px">Your points balance is now <strong>${totalPoints}</strong>.</p>
  <p style="margin:12px 0 0;font-size:13px;color:#64748b">${
    isNewMember
      ? `An ALEOS account has been created for you with this email. ${loginText} with this email to add your name and see your points.`
      : `${loginText} to see all your points.`
  }</p>
</div>`
}

// GET /admin/merchants?status=pending&search=&page=1&limit=20
// search matches part of the business name, owner, city, email or Merchant ID, or part of the mobile number
export async function listMerchants(req, res) {
  const filter = req.query.status ? { status: req.query.status } : {}
  const search = String(req.query.search || '').trim().slice(0, 100)
  if (search) {
    const contains = { $regex: escapeRegex(search), $options: 'i' }
    filter.$or = [
      { businessName: contains },
      { ownerName: contains },
      { city: contains },
      { email: contains },
      { merchantId: contains },
      ...(/^\d+$/.test(search) ? [{ mobile: { $regex: escapeRegex(search) } }] : []),
    ]
  }
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const [merchants, total] = await Promise.all([
    Merchant.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Merchant.countDocuments(filter),
  ])
  res.json({
    success: true,
    count: merchants.length,
    merchants,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  })
}

// GET /admin/master-merchant — the company's ALEOS merchant account (created the first time), with a few totals
export async function getMasterMerchantForAdmin(req, res) {
  const merchant = await getMasterMerchant()
  const [txTotals, referrals] = await Promise.all([
    Transaction.aggregate([
      { $match: { merchant: merchant._id } },
      // totalPoints = everything the shop gave on the bill; older bills only have pointsEarned
      { $group: { _id: null, count: { $sum: 1 }, points: { $sum: { $ifNull: ['$totalPoints', '$pointsEarned'] } } } },
    ]),
    Member.countDocuments({ referredBy: merchant.merchantId }),
  ])
  res.json({
    success: true,
    merchant,
    summary: { pointsGiven: txTotals[0]?.points ?? 0, billsCount: txTotals[0]?.count ?? 0, referrals },
  })
}

// POST /admin/master-merchant/session — a merchant login for the master account, so the admin can use the
// normal merchant dashboard for it (no email OTP: the admin login already proves who this is)
export async function openMasterMerchantSession(req, res) {
  const merchant = await getMasterMerchant()
  res.json({ success: true, token: signToken(merchant._id, 'merchant'), merchant })
}

// GET /admin/merchants/:id — everything about one merchant for the admin profile page
export async function getMerchantProfile(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Merchant not found')
  const merchant = await Merchant.findById(req.params.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')

  const byMerchant = { merchant: merchant._id }
  const [transactions, txTotals, redemptions, redeemTotals, withdrawals, withdrawTotals, payments, referrals] =
    await Promise.all([
      Transaction.find(byMerchant).populate('member', 'name email').sort({ date: -1 }).limit(20),
      Transaction.aggregate([
        { $match: byMerchant },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            points: { $sum: { $ifNull: ['$totalPoints', '$pointsEarned'] } },
            sales: { $sum: '$purchaseAmount' },
          },
        },
      ]),
      Redemption.find(byMerchant).populate('member', 'name email').sort({ createdAt: -1 }).limit(200),
      Redemption.aggregate([{ $match: byMerchant }, { $group: { _id: null, count: { $sum: 1 }, points: { $sum: '$points' } } }]),
      WalletWithdrawal.find(byMerchant).sort({ createdAt: -1 }).limit(200),
      WalletWithdrawal.aggregate([
        { $match: byMerchant },
        { $group: { _id: null, count: { $sum: 1 }, points: { $sum: '$points' }, amount: { $sum: '$amount' }, fees: { $sum: '$fee' } } },
      ]),
      WalletPayment.find(byMerchant).sort({ createdAt: -1 }),
      merchant.merchantId ? Member.countDocuments({ referredBy: merchant.merchantId }) : 0,
    ])

  res.json({
    success: true,
    merchant,
    summary: {
      pointsGiven: txTotals[0]?.points ?? 0,
      salesRecorded: txTotals[0]?.sales ?? 0,
      billsCount: txTotals[0]?.count ?? 0,
      pointsRedeemed: redeemTotals[0]?.points ?? 0,
      redemptionsCount: redeemTotals[0]?.count ?? 0,
      pointsWithdrawn: withdrawTotals[0]?.points ?? 0,
      amountWithdrawn: withdrawTotals[0]?.amount ?? 0,
      withdrawalFees: withdrawTotals[0]?.fees ?? 0,
      amountRecharged: payments.reduce((sum, p) => sum + p.rechargeAmount, 0),
      rechargeFees: payments.reduce((sum, p) => sum + p.convenienceFee, 0),
      referrals,
    },
    transactions,
    redemptions,
    withdrawals,
    payments,
    // Same passbook the merchant sees on their own dashboard
    passbook: await buildPassbook(merchant),
  })
}

// PATCH /admin/merchants/:id/status  { status: 'approved' | 'rejected' | 'pending' }
export async function updateMerchantStatus(req, res) {
  const merchant = await Merchant.findById(req.params.id)
  if (!merchant) throw new ApiError(404, 'Merchant not found')
  if (merchant.isMaster) throw new ApiError(400, 'The ALEOS master merchant is always approved')
  const wasApproved = merchant.status === 'approved'
  merchant.status = req.body.status
  // Only validate the status — older merchants were saved before trade license / bank details were required
  await merchant.save({ validateModifiedOnly: true })

  // Email the merchant only when they newly become approved. A failed email is logged
  // but doesn't undo the approval.
  if (merchant.status === 'approved' && !wasApproved) {
    try {
      await sendMail({
        to: merchant.email,
        subject: `${merchant.businessName} is approved on ALEOS`,
        text: `Hi ${merchant.ownerName}, good news! ${merchant.businessName} has been approved as an ALEOS merchant${merchant.merchantId ? ` (Merchant ID: ${merchant.merchantId})` : ''}. You can now start issuing reward points to members.`,
        html: approvalEmailHtml(merchant),
      })
    } catch (err) {
      console.error(`Approval email to ${merchant.email} failed: ${err.message}`)
    }
  }

  res.json({ success: true, merchant })
}

function approvalEmailHtml(merchant) {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="font-size:20px;font-weight:800;color:#1d4ed8;margin-bottom:16px">ALEOS</div>
  <p style="margin:0 0 12px;font-size:15px">Hi ${escapeHtml(merchant.ownerName)},</p>
  <p style="margin:0 0 12px;font-size:15px">Good news! <strong>${escapeHtml(merchant.businessName)}</strong> has been approved as an ALEOS merchant.</p>
  <div style="font-size:15px;font-weight:700;background:#ecfdf5;color:#047857;border-radius:12px;padding:16px;text-align:center">✅ Application approved</div>
  ${merchant.merchantId ? `<p style="margin:16px 0 0;font-size:15px">Your Merchant ID: <strong style="font-family:monospace;letter-spacing:1px">${escapeHtml(merchant.merchantId)}</strong></p>` : ''}
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">You can now start issuing reward points to members. Reply to this email if you have any questions.</p>
</div>`
}
