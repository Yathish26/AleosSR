import ApiError from '../utils/ApiError.js'
import { verifyToken } from '../utils/token.js'

// Verifies the Bearer token and, if roles are given, that the user has one of them.
export function protect(...roles) {
  return (req, res, next) => {
    const header = req.headers.authorization || ''
    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'Not authorized, token missing')

    let payload
    try {
      payload = verifyToken(token)
    } catch {
      throw new ApiError(401, 'Not authorized, token invalid or expired')
    }

    if (roles.length && !roles.includes(payload.role)) throw new ApiError(403, 'Forbidden')

    req.user = payload
    next()
  }
}
