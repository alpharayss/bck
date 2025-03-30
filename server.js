const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { Storage } = require('@google-cloud/storage');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Initialize Google Cloud Storage
const storage = new Storage({
  keyFilename: './rapterx-key.json',
  projectId: 'node-js-455307',
});
const bucketName = 'rapterx-bucket';

// Store meetings and participants
const meetings = new Map(); // meetingId -> Set of participantIds
const sockets = new Map(); // socketId -> meetingId

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('create-meeting', () => {
    const meetingId = generateMeetingId();
    meetings.set(meetingId, new Set([socket.id]));
    sockets.set(socket.id, meetingId);
    socket.emit('meeting-created', meetingId);
  });

  socket.on('join-meeting', (meetingId) => {
    if (!meetings.has(meetingId)) {
      socket.emit('error', 'Meeting not found');
      return;
    }

    const participants = meetings.get(meetingId);
    participants.add(socket.id);
    sockets.set(socket.id, meetingId);

    // Notify the new participant about existing participants
    socket.emit('meeting-joined', {
      id: meetingId,
      participants: Array.from(participants).filter(id => id !== socket.id),
    });

    // Notify all other participants about the new participant
    participants.forEach(participantId => {
      if (participantId !== socket.id) {
        io.to(participantId).emit('participant-joined', {
          participantId: socket.id,
        });
      }
    });
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('leave-meeting', (meetingId) => {
    if (meetings.has(meetingId)) {
      const participants = meetings.get(meetingId);
      participants.delete(socket.id);

      // Notify remaining participants
      participants.forEach(participantId => {
        io.to(participantId).emit('participant-left', socket.id);
      });

      if (participants.size === 0) {
        meetings.delete(meetingId);
      }
    }
    sockets.delete(socket.id);
  });

  socket.on('disconnect', () => {
    const meetingId = sockets.get(socket.id);
    if (meetingId && meetings.has(meetingId)) {
      const participants = meetings.get(meetingId);
      participants.delete(socket.id);

      // Notify remaining participants
      participants.forEach(participantId => {
        io.to(participantId).emit('participant-left', socket.id);
      });

      if (participants.size === 0) {
        meetings.delete(meetingId);
      }
    }
    sockets.delete(socket.id);
    console.log('Client disconnected:', socket.id);
  });
});

function generateMeetingId() {
  return Math.floor(100 + Math.random() * 900).toString(); // 3-digit code
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});