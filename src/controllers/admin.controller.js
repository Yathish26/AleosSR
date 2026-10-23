import mongoose from 'mongoose'
import Member from '../models/Member.js'
import Merchant from '../models/Merchant.js'
import Redemption from '../models/Redemption.js'
import { getSettings } from '../models/Setting.js'
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

// GET /admin/settings
export async function getAdminSettings(req, res) {
  res.json({ success: true, settings: await getSettings() })
}

// PATCH /admin/settings  { withdrawalFeePercent }
export async function updateAdminSettings(req, res) {
  const settings = await getSettings()
  if (req.body.withdrawalFeePercent !== undefined) {
    const percent = Number(req.body.withdrawalFeePercent)
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new ApiError(400, 'Withdrawal fee must be between 0% and 100%')
    }
    settings.withdrawalFeePercent = Math.round(percent * 100) / 100
  }
  await settings.save()
  res.json({ success: true, settings })
}

// DELETE /admin/members/:id
export async function deleteMember(req, res) {
  const member = await Member.findByIdAndDelete(req.params.id)
  if (!member) throw new ApiError(404, 'Member not found')
  await Transaction.deleteMany({ member: member._id })
  res.json({ success: true, message: 'Member and their transactions deleted' })
}
