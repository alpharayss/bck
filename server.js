const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const meetings = new Map();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  // Create meeting
  socket.on('createMeeting', ({ name }, callback) => {
    const meetingId = uuidv4().slice(0, 8);
    const hostId = uuidv4();
    
    meetings.set(meetingId, {
      hostId,
      participants: new Map([[hostId, { 
        id: hostId, 
        name, 
        socketId: socket.id,
        isHost: true 
      }]]),
    });
    
    socket.join(meetingId);
    callback({ meetingId, hostId });
  });

  // Join meeting
  socket.on('joinMeeting', ({ meetingId, name }, callback) => {
    if (!meetings.has(meetingId)) {
      return callback({ error: 'Meeting not found' });
    }

    const meeting = meetings.get(meetingId);
    const participantId = uuidv4();
    
    meeting.participants.set(participantId, {
      id: participantId,
      name,
      socketId: socket.id,
      isHost: false
    });

    socket.join(meetingId);
    callback({ participantId });

    // Notify existing participants
    socket.to(meetingId).emit('newParticipant', participantId);
    
    // Send list of existing participants to new joiner
    socket.emit('existingParticipants', {
      participants: Array.from(meeting.participants.values())
    });
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('iceCandidate', (data) => {
    socket.to(data.to).emit('iceCandidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    meetings.forEach((meeting, meetingId) => {
      meeting.participants.forEach((participant, participantId) => {
        if (participant.socketId === socket.id) {
          meeting.participants.delete(participantId);
          io.to(meetingId).emit('participantLeft', participantId);
        }
      });
    });
  });
});

const PORT = process.env.PORT || 3000; // Change this from 80 to 3000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

