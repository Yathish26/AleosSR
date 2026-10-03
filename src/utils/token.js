import jwt from 'jsonwebtoken'

export function signToken(id, role) {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' })
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET)
}
