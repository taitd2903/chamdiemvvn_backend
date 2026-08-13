import { Router } from 'express';
import { hashPassword, publicUser, requireAdmin } from '../auth.js';
import { db, makeId, touch } from '../store.js';

export function usersRouter() {
  const router = Router();
  router.use(requireAdmin);

  router.get('/', (req, res) => res.json(db.users.filter((user) => ['unit_owner', 'weigh_in'].includes(user.role)).map(publicUser)));

  router.post('/', (req, res) => {
    const username = String(req.body.username || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || '').trim();
    const unitName = String(req.body.unitName || '').trim();
    const role = req.body.role === 'weigh_in' ? 'weigh_in' : 'unit_owner';
    if (!username || !password || !displayName || (role === 'unit_owner' && !unitName)) return res.status(400).json({ message: 'Vui lòng nhập đủ thông tin tài khoản' });
    if (password.length < 6) return res.status(400).json({ message: 'Mật khẩu cần ít nhất 6 ký tự' });
    if (db.users.some((user) => user.username === username)) return res.status(409).json({ message: 'Tên đăng nhập đã tồn tại' });
    const user = {
      id: makeId(), username, displayName, unitName: role === 'weigh_in' ? '' : unitName, role, active: true,
      passwordHash: hashPassword(password), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    db.users.push(user);
    return res.status(201).json(publicUser(user));
  });

  router.patch('/:id/password', (req, res) => {
    const user = db.users.find((row) => row.id === req.params.id && ['unit_owner', 'weigh_in'].includes(row.role));
    if (!user) return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    const password = String(req.body.password || '');
    if (password.length < 6) return res.status(400).json({ message: 'Mật khẩu cần ít nhất 6 ký tự' });
    user.passwordHash = hashPassword(password);
    touch(user);
    db.sessions = db.sessions.filter((session) => session.userId !== user.id);
    return res.json(publicUser(user));
  });

  router.patch('/:id/status', (req, res) => {
    const user = db.users.find((row) => row.id === req.params.id && ['unit_owner', 'weigh_in'].includes(row.role));
    if (!user) return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
    user.active = Boolean(req.body.active);
    touch(user);
    if (!user.active) db.sessions = db.sessions.filter((session) => session.userId !== user.id);
    return res.json(publicUser(user));
  });

  return router;
}
