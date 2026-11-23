import mongoose from 'mongoose'
import Member from '../models/Member.js'
import Merchant from '../models/Merchant.js'
import Redemption from '../models/Redemption.js'
import SalesPerson from '../models/SalesPerson.js'
import {
  getSettings,
  SIGNUP_RECHARGE_MAX,
  SIGNUP_RECHARGE_MAX_OPTIONS,
  SIGNUP_RECHARGE_MIN,
  signupRechargeOptionsOf,
} from '../models/Setting.js'
import Transaction from '../models/Transaction.js'
import ApiError from '../utils/ApiError.js'
import { escapeRegex } from '../utils/html.js'
import { buildMemberPassbook } from './member.controller.js'

// GET /admin/stats
export async function getStats(req, res) {
  const [totalMembers, totals, totalTransactions, totalMerchants, pendingMerchants] = await Promise.all([
    Member.countDocuments(),
    Member.aggregate([{ $group: { _id: null, points: { $sum: '$totalPoints' }, spent: { $sum: '$totalSpent' } } }]),
    Transaction.countDocuments(),
    Merchant.countDocuments(),
    Merchant.countDocuments({ status: 'pending' }),
  ])

  res.json({
    success: true,
    stats: {
      totalMembers,
      totalTransactions,
      totalMerchants,
      pendingMerchants,
      networkTotalPoints: totals[0]?.points ?? 0,
      networkTotalSpent: totals[0]?.spent ?? 0,
    },
  })
}

// GET /admin/members?search=&page=1&limit=20
export async function listMembers(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const search = String(req.query.search || '').trim().slice(0, 100)

  // Part of the name, email or referral code, or part of the mobile number
  const contains = { $regex: escapeRegex(search), $options: 'i' }
  const filter = search
    ? {
        $or: [
          { name: contains },
          { email: contains },
          { referralCode: contains },
          ...(/^\d+$/.test(search) ? [{ mobile: { $regex: escapeRegex(search) } }] : []),
        ],
      }
    : {}

  const [members, total] = await Promise.all([
    Member.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Member.countDocuments(filter),
  ])

  res.json({ success: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), members })
}

async function findMember(id) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Member not found')
  const member = await Member.findById(id)
  if (!member) throw new ApiError(404, 'Member not found')
  return member
}

// GET /admin/members/:id — one member's details, totals, who referred them and who they referred
export async function getMember(req, res) {
  const member = await findMember(req.params.id)
  const byMember = { member: member._id }

  const [earnedTotals, usedTotals, referrals, referringMember, referringMerchant, addedBy] = await Promise.all([
    Transaction.aggregate([
      { $match: { ...byMember, pointsEarned: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          points: { $sum: '$pointsEarned' },
          bills: { $sum: { $cond: [{ $eq: ['$kind', 'referral'] }, 0, 1] } },
          referralPoints: { $sum: { $cond: [{ $eq: ['$kind', 'referral'] }, '$pointsEarned', 0] } },
        },
      },
    ]),
    Redemption.aggregate([{ $match: byMember }, { $group: { _id: null, points: { $sum: '$points' }, count: { $sum: 1 } } }]),
    Member.find({ referredBy: member.referralCode }).select('name email mobile totalPoints createdAt').sort({ createdAt: -1 }),
    // Who referred them: a member's code, or a shop's Merchant ID
    member.referredBy ? Member.findOne({ referralCode: member.referredBy }).select('name email referralCode') : null,
    member.referredBy ? Merchant.findOne({ merchantId: member.referredBy }).select('businessName merchantId isMaster') : null,
    member.createdByMerchant ? Merchant.findById(member.createdByMerchant).select('businessName merchantId') : null,
  ])

  res.json({
    success: true,
    member,
    summary: {
      pointsEarned: earnedTotals[0]?.points ?? 0,
      billsCount: earnedTotals[0]?.bills ?? 0,
      referralPoints: earnedTotals[0]?.referralPoints ?? 0,
      pointsUsed: usedTotals[0]?.points ?? 0,
      redemptionsCount: usedTotals[0]?.count ?? 0,
      referrals: referrals.length,
    },
    referredBy: referringMember
      ? { kind: 'member', id: referringMember._id, name: referringMember.name || referringMember.email, code: member.referredBy }
      : referringMerchant
        ? {
            kind: 'merchant',
            id: referringMerchant._id,
            name: referringMerchant.businessName,
            code: member.referredBy,
            isMaster: referringMerchant.isMaster,
          }
        : member.referredBy
          ? { kind: 'code', code: member.referredBy }
          : null,
    addedBy: addedBy ? { id: addedBy._id, name: addedBy.businessName, merchantId: addedBy.merchantId } : null,
    referrals,
  })
}

// GET /admin/members/:id/passbook?page=1&limit=20 — the same points ledger the member sees
export async function getMemberPassbook(req, res) {
  const member = await findMember(req.params.id)
  res.json({ success: true, ...(await buildMemberPassbook(member, req.query)) })
}

// Settings as sent to the admin dashboard (sign-up options filled in with the defaults if never saved)
function settingsJson(settings) {
  return { ...settings.toObject(), signupRechargeOptions: signupRechargeOptionsOf(settings) }
}

// GET /admin/settings
export async function getAdminSettings(req, res) {
  res.json({ success: true, settings: settingsJson(await getSettings()) })
}

// PATCH /admin/settings  { withdrawalFeePercent?, signupRechargeOptions?: [1000, 2000, 3000] }
export async function updateAdminSettings(req, res) {
  const settings = await getSettings()
  if (req.body.withdrawalFeePercent !== undefined) {
    const percent = Number(req.body.withdrawalFeePercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new ApiError(400, 'Withdrawal fee must be between 0% and 100%')
    }
    settings.withdrawalFeePercent = Math.round(percent * 100) / 100
  }
  if (req.body.signupRechargeOptions !== undefined) {
    const raw = req.body.signupRechargeOptions
    if (!Array.isArray(raw) || raw.length === 0) throw new ApiError(400, 'Add at least one sign-up recharge amount')
    const values = raw.map(Number)
    const min = SIGNUP_RECHARGE_MIN.toLocaleString('en-IN')
    const max = SIGNUP_RECHARGE_MAX.toLocaleString('en-IN')
    if (values.some((v) => !Number.isInteger(v) || v < SIGNUP_RECHARGE_MIN || v > SIGNUP_RECHARGE_MAX)) {
      throw new ApiError(400, `Each sign-up recharge must be a whole amount from ₹${min} to ₹${max}`)
    }
    // Same amount twice is just one option; show them lowest first
    const options = [...new Set(values)].sort((a, b) => a - b)
    if (options.length > SIGNUP_RECHARGE_MAX_OPTIONS) {
      throw new ApiError(400, `You can offer at most ${SIGNUP_RECHARGE_MAX_OPTIONS} sign-up recharge amounts`)
    }
    settings.signupRechargeOptions = options
  }
  await settings.save()
  res.json({ success: true, settings: settingsJson(settings) })
}

// GET /admin/sales-persons?search=&page=1&limit=20
export async function listSalesPersons(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20))
  const search = String(req.query.search || '').trim().slice(0, 100)

  // Part of the name, or part of the mobile number
  const filter = search
    ? {
        $or: [
          { name: { $regex: escapeRegex(search), $options: 'i' } },
          ...(/^\d+$/.test(search) ? [{ mobile: { $regex: escapeRegex(search) } }] : []),
        ],
      }
    : {}

  const [salesPersons, total] = await Promise.all([
    SalesPerson.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    SalesPerson.countDocuments(filter),
  ])

  res.json({ success: true, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), salesPersons })
}

// POST /admin/sales-persons  { name, mobile }
export async function createSalesPerson(req, res) {
  const name = String(req.body.name ?? '').trim()
  const mobile = String(req.body.mobile ?? '').replace(/\D/g, '')
  if (!name) throw new ApiError(400, 'Name is required')
  if (!/^\d{10}$/.test(mobile)) throw new ApiError(400, 'Mobile must be a 10-digit number')
  if (await SalesPerson.exists({ mobile })) throw new ApiError(409, 'A sales person with this mobile number already exists')

  const salesPerson = await SalesPerson.create({ name, mobile })
  res.status(201).json({ success: true, salesPerson })
}

// DELETE /admin/sales-persons/:id
export async function deleteSalesPerson(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Sales person not found')
  const salesPerson = await SalesPerson.findByIdAndDelete(req.params.id)
  if (!salesPerson) throw new ApiError(404, 'Sales person not found')
  res.json({ success: true, message: 'Sales person removed' })
}

// DELETE /admin/members/:id
export async function deleteMember(req, res) {
  const member = await Member.findByIdAndDelete(req.params.id)
  if (!member) throw new ApiError(404, 'Member not found')
  await Transaction.deleteMany({ member: member._id })
  res.json({ success: true, message: 'Member and their transactions deleted' })
}
