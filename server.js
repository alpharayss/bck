require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Configure Socket.io
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In-memory database (for production use MongoDB)
const meetings = new Map();

// Utility function
const generateMeetingId = () => {
  return uuidv4().substring(0, 8).toUpperCase();
};

// REST API Endpoints

// Create a new meeting
app.post('/api/meetings', (req, res) => {
  const meetingId = generateMeetingId();
  meetings.set(meetingId, {
    participants: new Set(),
    createdAt: new Date()
  });
  res.json({ meetingId });
});

// Get meeting info
app.get('/api/meetings/:id', (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.json({
    id: req.params.id,
    participantCount: meeting.participants.size,
    createdAt: meeting.createdAt
  });
});

// WebSocket Connection Handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Join meeting room
  socket.on('join-meeting', ({ meetingId }) => {
    if (!meetings.has(meetingId)) {
      socket.emit('error', 'Meeting not found');
      return;
    }

    const meeting = meetings.get(meetingId);
    meeting.participants.add(socket.id);
    socket.join(meetingId);

    socket.emit('meeting-joined', {
      meetingId,
      participants: Array.from(meeting.participants)
    });

    socket.to(meetingId).emit('participant-joined', socket.id);
  });

  // Handle signaling for WebRTC
  socket.on('offer', ({ to, offer }) => {
    socket.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    socket.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    socket.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    meetings.forEach((meeting, meetingId) => {
      if (meeting.participants.has(socket.id)) {
        meeting.participants.delete(socket.id);
        io.to(meetingId).emit('participant-left', socket.id);
      }
    });
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});