// server.js (updated)
// Entry point that starts Express, Mongo, Socket.IO, Kafka producers & consumers
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

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
app.use('/api/admin', adminRoutes);

// --- Kafka producers / consumers / bridges
// core kafka producer (for generic events)
let startProducer, disconnectProducer;
try {
  ({ startProducer, disconnectProducer } = require('./kafka/producer'));
} catch (e) {
  console.warn('Could not load ./kafka/producer (may be missing).', e.message || e);
  startProducer = async () => { console.log('[producer] noop start'); };
  disconnectProducer = async () => { /* noop */ };
}

// prediction publisher (wraps predictions; envelopes)
let startPredProducer, disconnectPredProducer;
try {
  ({ startPredProducer, disconnectPredProducer } = require('./kafka/publisherPredictions'));
} catch (e) {
  console.warn('Could not load ./kafka/publisherPredictions (may be missing).', e.message || e);
  startPredProducer = async () => { console.log('[pred-producer] noop start'); };
  disconnectPredProducer = async () => { /* noop */ };
}

// prediction bridge (requires io)
let startPredictionBridge;
try {
  ({ startPredictionBridge } = require('./ws/predictionBridge'));
} catch (e) {
  console.warn('Could not load ./ws/predictionBridge (may be missing).', e.message || e);
  startPredictionBridge = async (io) => { console.log('[pred-bridge] noop start'); };
}

// model registry consumer
let startModelRegistryConsumer;
try {
  ({ startModelRegistryConsumer } = require('./consumers/model_registry_consumer'));
} catch (e) {
  console.warn('Could not load ./consumers/model_registry_consumer (may be missing).', e.message || e);
  startModelRegistryConsumer = async () => { console.log('[model-reg-consumer] noop start'); };
}

// transactions consumer (ingest -> ML -> publish predictions)
let startTransactionsConsumer;
try {
  ({ startConsumer: startTransactionsConsumer } = require('./consumers/transactions_consumer'));
} catch (e) {
  // some older versions may export startConsumer() under a different name or auto-run on import.
  try {
    // try requiring as module which may auto-start
    require('./consumers/transactions_consumer');
    console.log('[transactions_consumer] module required (may have auto-started)');
    startTransactionsConsumer = async () => { console.log('[transactions_consumer] assumed started (module auto-start)'); };
  } catch (e2) {
    console.warn('Could not load ./consumers/transactions_consumer (may be missing).', e2.message || e2);
    startTransactionsConsumer = async () => { console.log('[transactions_consumer] noop start'); };
  }
}

const { Server: IOServer } = require('socket.io');

async function startServer() {
  // Start core kafka producer first (best-effort)
  try {
    await startProducer();
  } catch (err) {
    console.warn('[server] startProducer failed (continuing in degraded mode):', err && err.message ? err.message : err);
  }

  // Start prediction producer (so other services can publish predictions)
  try {
    await startPredProducer();
  } catch (err) {
    console.warn('[server] startPredProducer failed (continuing in degraded mode):', err && err.message ? err.message : err);
  }

  // Start transactions consumer (ingest -> ML -> prediction publish)
  try {
    await startTransactionsConsumer();
  } catch (err) {
    console.warn('[server] transactions consumer failed to start (continuing):', err && err.message ? err.message : err);
  }

  // Start model registry consumer
  try {
    await startModelRegistryConsumer();
  } catch (err) {
    console.warn('[server] model registry consumer failed to start (continuing):', err && err.message ? err.message : err);
  }

  // Start Express server and Socket.IO AFTER we started producers/consumers where possible
  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

  // -------- Socket.IO for real-time pushes ----------
  const io = new IOServer(server, {
    cors: { origin: CLIENT_ORIGIN, methods: ['GET','POST'] }
  });

  // Socket auth middleware: require token in handshake auth
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "secretkey");
      socket.user = decoded.user || decoded; // save the user object for handlers
      return next();
    } catch (err) {
      console.warn('socket auth failed', err.message);
      return next(new Error('Authentication error'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    const verifiedUserId = String(socket.user?.id || socket.user?._id || '');
    console.log('socket connected', socket.id, 'user:', verifiedUserId);

    // Auto-join the server-verified user room
    if (verifiedUserId) {
      socket.join(`user:${verifiedUserId}`);
      console.log(`socket ${socket.id} auto-joined room user:${verifiedUserId}`);
    }

    // Backwards-compatible join/leave handlers but validated
    socket.on('join', ({ userId } = {}) => {
      if (!userId) return;
      if (String(userId) !== verifiedUserId) {
        console.warn(`socket ${socket.id} attempted to join user:${userId} but token user is ${verifiedUserId}`);
        return;
      }
      socket.join(`user:${verifiedUserId}`);
      console.log(`socket ${socket.id} joined (via join event) room user:${verifiedUserId}`);
    });

    socket.on('leave', ({ userId } = {}) => {
      if (!userId) return;
      if (String(userId) !== verifiedUserId) return;
      socket.leave(`user:${verifiedUserId}`);
    });

    socket.on('disconnect', (reason) => {
      console.log(`socket ${socket.id} disconnected:`, reason);
    });
  });

  // Start prediction bridge (connects Kafka -> Socket.IO)
  let bridgeHandle = null;
  try {
    // startPredictionBridge may return an object with a stop() function; await if it's async
    const maybe = await startPredictionBridge(io);
    bridgeHandle = maybe || null;
  } catch (err) {
    console.warn('[server] predictionBridge failed to start:', err && err.message ? err.message : err);
  }

  // Graceful shutdown - attempt to stop/cleanup everything we started
  const shutdown = async () => {
    console.log('Shutting down server...');
    server.close(async () => {
      try {
        // Stop bridge if it returned a stop function
        try {
          if (bridgeHandle && typeof bridgeHandle.stop === 'function') {
            await bridgeHandle.stop();
            console.log('[server] predictionBridge stopped');
          }
        } catch (e) {
          console.warn('[server] error stopping predictionBridge:', e && e.message ? e.message : e);
        }

        // Disconnect kafka producers (best-effort)
        try { await disconnectPredProducer(); } catch (e) { console.warn('[server] Error during pred-producer disconnect:', e?.message || e); }
        try { await disconnectProducer(); } catch (e) { console.warn('[server] Error during producer disconnect:', e?.message || e); }

        // Note: many consumer modules run independently; if they export stop functions you could call them here.
      } catch (e) {
        console.warn('[server] error during shutdown:', e && e.message ? e.message : e);
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



