require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store active meetings
const meetings = new Map();

// REST API Endpoints
app.post('/api/meetings', (req, res) => {
  const meetingId = generateMeetingId();
  meetings.set(meetingId, {
    participants: new Set(),
    createdAt: new Date()
  });
  res.json({ meetingId });
});

app.get('/api/meetings/:id', (req, res) => {
  const meeting = meetings.get(req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.json({
    id: req.params.id,
    participantCount: meeting.participants.size,
    createdAt: meeting.createdAt
  });
});

// WebSocket Connection
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

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

  socket.on('disconnect', () => {
    meetings.forEach((meeting, meetingId) => {
      if (meeting.participants.has(socket.id)) {
        meeting.participants.delete(socket.id);
        io.to(meetingId).emit('participant-left', socket.id);
      }
    });
  });
});

function generateMeetingId() {
  return uuidv4().substring(0, 8); // 8-character ID
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});