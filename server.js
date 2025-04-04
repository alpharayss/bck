require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const redisAdapter = require('socket.io-redis');
const rateLimit = require('express-rate-limit');

const app = express();

// Enable CORS with dynamic origins
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json());

// Rate limiting API calls
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use('/api/', apiLimiter);

const server = http.createServer(app);

// Setup Socket.IO with Redis adapter for horizontal scaling
const io = socketIo(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  pingTimeout: 10000,
  pingInterval: 5000
});

// Redis adapter for distributed scaling
if (process.env.REDIS_URL) {
  io.adapter(redisAdapter(process.env.REDIS_URL));
}

const meetings = new Map();

// Helper to generate meeting IDs
const generateMeetingId = () => {
  return uuidv4().substring(0, 8).toUpperCase();
};

// API Security Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// API endpoint to create a meeting
app.post('/api/meetings', (req, res) => {
  try {
    const meetingId = generateMeetingId();
    meetings.set(meetingId, {
      participants: new Map(),
      createdAt: new Date(),
      metadata: {
        creator: req.ip,
        userAgent: req.get('User-Agent')
      }
    });
    res.json({ 
      meetingId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h expiry
    });
  } catch (err) {
    console.error('Meeting creation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get meeting info
app.get('/api/meetings/:id', (req, res) => {
  try {
    const meeting = meetings.get(req.params.id);
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    const participants = [];
    meeting.participants.forEach((state, id) => {
      participants.push({ id, state });
    });

    res.json({
      id: req.params.id,
      participantCount: participants.length,
      participants,
      createdAt: meeting.createdAt
    });
  } catch (err) {
    console.error('Meeting info error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// WebSocket authentication and connection handling
io.use((socket, next) => {
  if (process.env.REQUIRE_AUTH === 'true') {
    const { token } = socket.handshake.auth;
    if (token !== process.env.AUTH_TOKEN) {
      return next(new Error('Authentication error'));
    }
  }
  next();
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  let connectionTimer;
  const startConnectionTimer = () => {
    connectionTimer = setTimeout(() => {
      socket.disconnect(true);
    }, 30000); // 30s timeout
  };

  socket.on('ping', () => {
    clearTimeout(connectionTimer);
    startConnectionTimer();
    socket.emit('pong');
  });

  startConnectionTimer();

  socket.on('join-meeting', ({ meetingId }, callback) => {
    try {
      if (!meetingId || typeof meetingId !== 'string') {
        throw new Error('Invalid meeting ID');
      }

      const meeting = meetings.get(meetingId);
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      meeting.participants.set(socket.id, 'connecting');
      socket.join(meetingId);

      socket.to(meetingId).emit('participant-joined', {
        id: socket.id,
        state: 'connecting'
      });

      const others = [];
      meeting.participants.forEach((state, id) => {
        if (id !== socket.id) others.push({ id, state });
      });

      callback({
        status: 'success',
        meetingId,
        participants: others
      });
    } catch (err) {
      console.error('Join meeting error:', err.message);
      callback({ 
        status: 'error',
        error: err.message 
      });
    }
  });

  socket.on('offer', ({ to, offer }, callback) => {
    try {
      if (!to || !offer) {
        throw new Error('Invalid offer data');
      }
      socket.to(to).emit('offer', { 
        from: socket.id, 
        offer 
      });
      callback({ status: 'success' });
    } catch (err) {
      callback({ status: 'error', error: err.message });
    }
  });

  socket.on('answer', ({ to, answer }, callback) => {
    try {
      if (!to || !answer) {
        throw new Error('Invalid answer data');
      }
      socket.to(to).emit('answer', { 
        from: socket.id, 
        answer 
      });
      callback({ status: 'success' });
    } catch (err) {
      callback({ status: 'error', error: err.message });
    }
  });

  socket.on('ice-candidate', ({ to, candidate }, callback) => {
    try {
      if (!to || !candidate) {
        throw new Error('Invalid candidate data');
      }
      socket.to(to).emit('ice-candidate', { 
        from: socket.id, 
        candidate 
      });
      callback({ status: 'success' });
    } catch (err) {
      callback({ status: 'error', error: err.message });
    }
  });

  socket.on('connection-state', ({ state, meetingId }, callback) => {
    try {
      const meeting = meetings.get(meetingId);
      if (meeting && meeting.participants.has(socket.id)) {
        meeting.participants.set(socket.id, state);
        socket.to(meetingId).emit('participant-updated', {
          id: socket.id,
          state
        });
      }
      callback({ status: 'success' });
    } catch (err) {
      callback({ status: 'error', error: err.message });
    }
  });

  socket.on('disconnect', () => {
    clearTimeout(connectionTimer);
    meetings.forEach((meeting, meetingId) => {
      if (meeting.participants.has(socket.id)) {
        meeting.participants.delete(socket.id);
        io.to(meetingId).emit('participant-left', socket.id);

        if (meeting.participants.size === 0) {
          setTimeout(() => {
            if (meetings.get(meetingId)?.participants.size === 0) {
              meetings.delete(meetingId);
            }
          }, 300000); // 5 minute delay
        }
      }
    });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    meetingCount: meetings.size,
    uptime: process.uptime()
  });
});

// Listen to Cloud Run on port 8080
const PORT = process.env.PORT || 8080; 
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Periodically clean up old meetings
setInterval(() => {
  const now = new Date();
  meetings.forEach((meeting, id) => {
    if (now - meeting.createdAt > 24 * 60 * 60 * 1000) {
      meetings.delete(id);
    }
  });
}, 60 * 60 * 1000); // Every hour
