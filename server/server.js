require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// CORS - allow client origin from env in prod; default to *
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// DEV: Inject a fake user into req.user for quick local testing
if (process.env.DEV_INJECT_USER === 'true') {
  app.use((req, res, next) => {
    req.user = { id: process.env.DEV_USER_ID || '000000000000000000000000' };
    next();
  });
}

// --- MongoDB Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://ritvikrajipl:7BpA6PRvWMJiVY1z@cluster0.lcrcado.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- Simple Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: Date.now() });
});

// --- Routes
const txns = require('./routes/transactions');
const insights = require('./routes/insights');
const advisor = require('./routes/advisor');
const authRoutes = require('./routes/auth');
const plannerRoutes = require('./routes/planner');
const adminRoutes = require('./routes/admin');


app.use('/api/auth', authRoutes);
app.use('/api/transactions', txns);
app.use('/api/insights', insights);
app.use('/api/advisor', advisor);
app.use('/api/planner', plannerRoutes);
app.use('/api/admin', adminRoutes)

// --- Kafka producer bootstrap (Day 1 changes)
const { startProducer, disconnectProducer } = require('./kafka/producer');
// Prediction publisher (Day 2)
const { startPredProducer, disconnectPredProducer } = require('./kafka/publisherPredictions');
// Socket.IO prediction bridge
const { startPredictionBridge } = require('./ws/predictionBridge');

const { Server: IOServer } = require('socket.io');

async function startServer() {
  // Attempt to connect to Kafka producer, but don't crash the server if kafka is unavailable.
  try {
    await startProducer();
  } catch (err) {
    console.warn('Kafka producer failed to start (continuing in degraded mode):', err.message || err);
  }

  // Also start prediction producer so consumers can publish prediction events (non-blocking)
  try {
    await startPredProducer();
  } catch (err) {
    console.warn('Prediction producer failed to start (continuing in degraded mode):', err.message || err);
  }

  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

  // -------- Socket.IO for real-time pushes ----------
  const io = new IOServer(server, {
    cors: { origin: CLIENT_ORIGIN, methods: ['GET','POST'] }
  });

  io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  try {
    const decoded = jwt.verify(token, "secretkey");
    // your backend used decoded.user earlier
    socket.user = decoded.user || decoded; // save the user object on socket
    return next();
  } catch (err) {
    console.warn('socket auth failed', err.message);
    return next(new Error('Authentication error'));
  }
});

// Connection handler
io.on('connection', (socket) => {
  // server-verified user id (string)
  const verifiedUserId = String(socket.user?.id || socket.user?._id || '');

  console.log('socket connected', socket.id, 'user:', verifiedUserId);

  // Auto-join the server-verified user room (recommended)
  if (verifiedUserId) {
    socket.join(`user:${verifiedUserId}`);
    console.log(`socket ${socket.id} auto-joined room user:${verifiedUserId}`);
  }

  // Optional: keep a safe 'join' handler for backwards compatibility
  // but validate the payload against the verified token!
  socket.on('join', ({ userId } = {}) => {
    // Only allow join if the userId matches the verified token user id.
    if (!userId) return;
    if (String(userId) !== verifiedUserId) {
      console.warn(`socket ${socket.id} tried to join user:${userId} but token user is ${verifiedUserId}`);
      return; // ignore or optionally send an error ack
    }
    socket.join(`user:${verifiedUserId}`);
    console.log(`socket ${socket.id} joined (via join event) room user:${verifiedUserId}`);
  });

  socket.on('leave', ({ userId } = {}) => {
    if (!userId) return;
    if (String(userId) !== verifiedUserId) return; // validate
    socket.leave(`user:${verifiedUserId}`);
  });

  socket.on('disconnect', (reason) => {
    console.log(`socket ${socket.id} disconnected:`, reason);
  });
});

  // Start prediction bridge that listens to finpilot.predictions and emits to sockets
  startPredictionBridge(io).catch(err => {
    console.warn('predictionBridge failed to start:', err.message || err);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down server...');
    server.close(async () => {
      try {
        // disconnect kafka producers
        try { await disconnectProducer(); } catch (e) { console.warn('Error during producer disconnect:', e?.message || e); }
        try { await disconnectPredProducer(); } catch (e) { console.warn('Error during pred producer disconnect:', e?.message || e); }
      } catch (e) {
        console.warn('Error during producer disconnect:', e.message || e);
      } finally {
        // close mongoose connection
        try { await mongoose.disconnect(); } catch(e){/* ignore */ }
        console.log('Shutdown complete.');
        process.exit(0);
      }
    });

    // If still not closed after 10s, force exit
    setTimeout(() => {
      console.warn('Forcing shutdown.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});


