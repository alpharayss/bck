const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Storage } = require('@google-cloud/storage');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  },
});

const storage = new Storage({
  keyFilename: './rapterx-key.json', // Path to your service account key file
  projectId: 'node-js-455307',
});
const bucketName = 'rapterx-bucket'; // Your actual Cloud Storage bucket name




io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('offer', (offer) => {
    socket.broadcast.emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    socket.broadcast.emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate) => {
    socket.broadcast.emit('ice-candidate', candidate);
  });

  socket.on('audio-upload', async (data) => {
    try {
      const fileName = `${Date.now()}-recording.wav`;
      const file = storage.bucket(bucketName).file(fileName);

      // Simulate receiving audio data (in a real app, you'd stream it via WebRTC)
      // For simplicity, assume the client sends the file path or data
      const audioStream = require('fs').createReadStream('path/to/local/recording.wav'); // Replace with actual stream
      audioStream.pipe(file.createWriteStream());

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 24 * 60 * 60 * 1000, // 24-hour URL
      });

      socket.emit('audio-url', url);
    } catch (err) {
      console.error('Upload error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});