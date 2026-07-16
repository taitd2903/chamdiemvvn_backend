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

app.use((req, res, next) => {
  res.on('finish', () => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && res.statusCode < 500) {
      schedulePersistState(db);
    }
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'vovinam-realtime-backend' });
});

app.get('/api/state', (req, res) => {
  res.json(getGlobalState());
});

app.use('/api/settings', settingsRouter(io));
app.use('/api/areas', areasRouter(io));
app.use('/api/contents', contentsRouter());
app.use('/api/athletes', athletesRouter());
app.use('/api/registrations', registrationsRouter());
app.use('/api/forms', formsRouter(io));
app.use('/api/fighting', fightingRouter(io));

await initPersistence(db);

setupSocket(io);

server.listen(port, () => {
  console.log(`Vovinam realtime backend running at http://localhost:${port}`);
});
