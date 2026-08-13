import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './store.js';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, expectedHex] = String(stored || '').split(':');
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

export function ensureAuthState() {
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.sessions)) db.sessions = [];
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  if (!db.users.some((user) => user.role === 'admin')) {
    db.users.push({
      id: 'admin',
      username,
      displayName: 'Quản trị viên',
      unitName: '',
      role: 'admin',
      active: true,
      passwordHash: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

export function createSession(user) {
  const rawToken = randomBytes(32).toString('hex');
  db.sessions = (db.sessions || []).filter((session) => new Date(session.expiresAt).getTime() > Date.now());
  db.sessions.push({
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    userId: user.id,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString()
  });
  return rawToken;
}

function tokenFromRequest(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

export function optionalAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (token) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = (db.sessions || []).find((row) => row.tokenHash === tokenHash && new Date(row.expiresAt).getTime() > Date.now());
    const user = session ? db.users.find((row) => row.id === session.userId && row.active !== false) : null;
    if (user) {
      req.user = user;
      req.session = session;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Vui lòng đăng nhập' });
  return next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Vui lòng đăng nhập' });
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Chỉ Admin được thực hiện thao tác này' });
  return next();
}

export function requireWeighInAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Vui lòng đăng nhập' });
  if (!['admin', 'weigh_in'].includes(req.user.role)) return res.status(403).json({ message: 'Tài khoản không có quyền kiểm tra cân' });
  return next();
}

export function canAccessAthlete(user, athlete) {
  return user?.role === 'admin' || (user?.role === 'unit_owner' && athlete?.ownerId === user.id);
}
