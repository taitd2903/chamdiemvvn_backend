import { Router } from 'express';
import { createSession, hashPassword, publicUser, verifyPassword } from '../auth.js';
import { db } from '../store.js';

export function authRouter() {
  const router = Router();

  router.post('/login', (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = db.users.find((row) => row.username === username && row.active !== false);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
    }
    return res.json({ token: createSession(user), user: publicUser(user) });
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ' });
    return res.json(publicUser(req.user));
  });

  router.post('/logout', (req, res) => {
    if (req.session) db.sessions = db.sessions.filter((row) => row !== req.session);
    return res.status(204).send();
  });

  router.patch('/password', (req, res) => {
    if (!req.user) return res.status(401).json({ message: 'Vui lòng đăng nhập' });
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (!verifyPassword(currentPassword, req.user.passwordHash)) return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'Mật khẩu mới cần ít nhất 6 ký tự' });
    req.user.passwordHash = hashPassword(newPassword);
    req.user.updatedAt = new Date().toISOString();
    db.sessions = db.sessions.filter((row) => row === req.session);
    return res.json(publicUser(req.user));
  });

  return router;
}
