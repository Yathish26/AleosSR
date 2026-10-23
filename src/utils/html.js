// For using typed search text inside a MongoDB $regex without its symbols (. * + ? ( ) …) acting as pattern syntax
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// For putting user-entered text (names, shop names) into HTML emails safely
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
