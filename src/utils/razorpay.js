// Bank account check through RazorpayX Fund Account Validation ("penny drop"): Razorpay sends ₹1 to the
// account and reports whether it's active, plus the account holder's name as the bank has it.
// Needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAYX_ACCOUNT_NUMBER (your RazorpayX account the ₹1 is
// paid from) in .env, and BANK_CHECK_MODE=razorpay to switch it on. Until then every check is a DUMMY that
// passes straight away (RazorpayX access isn't enabled on the account yet).
const keyId = process.env.RAZORPAY_KEY_ID?.trim()
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
const payoutAccountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER?.trim()

const keysPresent = Boolean(keyId && keySecret && payoutAccountNumber)
export const isRazorpayConfigured = keysPresent && process.env.BANK_CHECK_MODE?.trim() === 'razorpay'

if (isRazorpayConfigured) console.log('Bank check: RazorpayX fund account validation enabled')
else if (process.env.BANK_CHECK_MODE?.trim() === 'razorpay') {
  console.log('Bank check: BANK_CHECK_MODE=razorpay but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAYX_ACCOUNT_NUMBER are missing — using DUMMY checks')
} else console.log('Bank check: DUMMY mode — every bank account passes (set BANK_CHECK_MODE=razorpay for real checks)')

async function razorpay(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.description || `Razorpay request failed (${res.status})`)
  return data
}

// Turns Razorpay's validation object into { id, status: 'pending' | 'verified' | 'failed', registeredName, reason }
function readValidation(validation) {
  const results = validation.results || validation.validation_results || {}
  let status = 'pending'
  if (validation.status === 'failed') status = 'failed'
  else if (validation.status === 'completed') status = results.account_status === 'active' ? 'verified' : 'failed'

  return {
    id: validation.id,
    status,
    registeredName: results.registered_name || null,
    reason:
      status === 'failed'
        ? validation.status_details?.description || 'The bank account could not be verified. Please check the details.'
        : null,
  }
}

// Creates the contact + fund account Razorpay needs, then starts the ₹1 transfer. Usually still 'pending' here.
export async function startBankValidation({ name, email, mobile, ifsc, accountNumber, referenceId }) {
  const contact = await razorpay('/contacts', {
    method: 'POST',
    body: { name, email, contact: mobile, type: 'vendor', reference_id: referenceId },
  })
  const fundAccount = await razorpay('/fund_accounts', {
    method: 'POST',
    body: { contact_id: contact.id, account_type: 'bank_account', bank_account: { name, ifsc, account_number: accountNumber } },
  })
  const validation = await razorpay('/fund_accounts/validations', {
    method: 'POST',
    body: {
      account_number: payoutAccountNumber,
      fund_account: { id: fundAccount.id },
      amount: 100, // paise = ₹1
      currency: 'INR',
      notes: { purpose: 'ALEOS merchant bank verification', reference: referenceId },
    },
  })
  return readValidation(validation)
}

export async function getBankValidation(id) {
  return readValidation(await razorpay(`/fund_accounts/validations/${id}`))
}
