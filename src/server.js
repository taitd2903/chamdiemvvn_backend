import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import { areasRouter } from './routes/areas.js';
import { contentsRouter } from './routes/contents.js';
import { athletesRouter } from './routes/athletes.js';
import { registrationsRouter } from './routes/registrations.js';
import { formsRouter } from './routes/forms.js';
import { fightingRouter } from './routes/fighting.js';
import { settingsRouter } from './routes/settings.js';
import { db, getGlobalState } from './store.js';
import { initPersistence, schedulePersistState } from './persistence.js';
import { setupSocket } from './socket.js';
import { ensureAuthState, optionalAuth, requireAdmin } from './auth.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { drawsRouter } from './routes/draws.js';
import { weighInsRouter } from './routes/weighIns.js';
import { publicRouter } from './routes/public.js';
import { getPublicTournamentState } from './services/publicStats.js';

const app = express();
const server = http.createServer(app);
const port = Number(process.env.PORT || 5001);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const io = new Server(server, {
  cors: {
    origin: clientOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

app.use(cors({ origin: clientOrigin }));
app.use(express.json());
app.use(optionalAuth);

app.use((req, res, next) => {
  res.on('finish', () => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && res.statusCode < 500) {
      schedulePersistState(db);
      io.emit('public:tournament', getPublicTournamentState());
    }
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'vovinam-realtime-backend' });
});

app.get('/api/state', (req, res) => {
  if (!req.user) return res.status(401).json({ message: 'Vui lòng đăng nhập' });
  if (req.user.role === 'weigh_in') return res.status(403).json({ message: 'Tài khoản kiểm tra cân không có quyền xem dữ liệu quản trị' });
  const state = getGlobalState();
  if (req.user.role === 'unit_owner') {
    const athletes = state.athletes.filter((athlete) => athlete.ownerId === req.user.id);
    const athleteIds = new Set(athletes.map((athlete) => athlete.id));
    return res.json({ ...state, areas: [], athletes, registrations: state.registrations.filter((row) => athleteIds.has(row.athleteId)), formEntries: [], fightMatches: [] });
  }
  return res.json(state);
});

app.use('/api/auth', authRouter());
app.use('/api/public', publicRouter());
app.use('/api/users', usersRouter());
app.use('/api/draws', drawsRouter());
app.use('/api/weigh-ins', weighInsRouter(io));
const requireAdminForChanges = (req, res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : requireAdmin(req, res, next);

app.use('/api/settings', requireAdmin, settingsRouter(io));
app.use('/api/areas', requireAdminForChanges, areasRouter(io));
app.use('/api/contents', requireAdminForChanges, contentsRouter());
app.use('/api/athletes', athletesRouter());
app.use('/api/registrations', registrationsRouter());
app.use('/api/forms', requireAdmin, formsRouter(io));
app.use('/api/fighting', requireAdmin, fightingRouter(io));

await initPersistence(db);
ensureAuthState();

setupSocket(io);

server.listen(port, () => {
  console.log(`Vovinam realtime backend running at http://localhost:${port}`);
});
