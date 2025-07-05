import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { WebSocket, WebSocketServer } from 'ws';
import http from 'http';
import mongoose from 'mongoose';
import { CodeBlock } from './src/models/codeblock.js';

// MongoDB connection with improved settings
const MONGODB_URL = process.env.MONGODB_URL ;
console.log(MONGODB_URL);
// Configure Mongoose connection settings
mongoose.set('bufferCommands', false); // Disable command buffering
mongoose.set('bufferTimeoutMS', 30000); // Increase buffer timeout

const connectWithRetry = async () => {
  return await mongoose.connect(MONGODB_URL, {
    
    maxPoolSize: 10, // Maintain up to 10 socket connections
    minPoolSize: 2, // Maintain at least 2 socket connections
  })
  .then(() => console.log('MongoDB connected for WebSocket server'))
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    console.log('Retrying connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

// Start initial connection
connectWithRetry();

const server = http.createServer();
const wss = new WebSocketServer({ server, path: '/api/live' });

const rooms = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const shareId = url.searchParams.get('shareId');
  
  if (!shareId) {
    ws.close(4000, 'Missing shareId');
    return;
  }

  // Skip DB lookup if room already exists
  if (!rooms.has(shareId)) {
    rooms.set(shareId, {
      connections: new Set(),
      content: '',
    });
    
    // Only query DB if we don't have the content
    CodeBlock.findOne({ shareId })
      .then(file => {
        if (file) {
          rooms.get(shareId).content = file.content;
          ws.send(JSON.stringify({
            type: 'init',
            content: file.content
          }));
        }
      })
      .catch(console.error);
  } else {
    // Use cached content
    ws.send(JSON.stringify({
      type: 'init',
      content: rooms.get(shareId).content
    }));
  }

  const room = rooms.get(shareId);
  room.connections.add(ws);

  ws.on('message', async (buffer) => {
    try {
      const message = JSON.parse(buffer.toString());
      
      if (message.type === 'content-update') {
        room.content = message.content;
        
        // Broadcast to all other clients
        room.connections.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'content-update',
              content: message.content
            }));
          }
        });

        // Skip DB update if content hasn't changed significantly
        const shouldUpdateDB = room.lastSavedContent !== message.content;
        room.lastSavedContent = message.content;

        if (shouldUpdateDB) {
          clearTimeout(room.saveTimeout);
          room.saveTimeout = setTimeout(async () => {
            try {
              // Use lean() for faster operations
              await CodeBlock.findOneAndUpdate(
                { shareId },
                { content: message.content },
                { 
                  new: true,
                  lean: true,
                  maxTimeMS: 5000 // 5s timeout for this operation
                }
              );
            } catch (error) {
              console.error('Database update error:', error.message);
            }
          }, 1500); // Increased debounce time
        }
      }
    } catch (error) {
      console.error('Error handling message:', error.message);
    }
  });

  ws.on('close', () => {
    if (rooms.has(shareId)) {
      const room = rooms.get(shareId);
      room.connections.delete(ws);
      
      if (room.connections.size === 0) {
        clearTimeout(room.saveTimeout);
        // Save final state before deleting room
        CodeBlock.findOneAndUpdate(
          { shareId },
          { content: room.content },
          { lean: true }
        ).catch(console.error);
        rooms.delete(shareId);
      }
    }
  });
});
// Health check endpoint
server.on('request', (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Server is up');
  }
});

// Periodically check DB connection
setInterval(() => {
  try {
    mongoose.connection.db.admin().ping((err, result) => {
      if (err || !result) {
        console.error('DB health check failed:', err);
      }
    });
  } catch (error) {
    console.error('Health check error:', error);
  }
}, 30000); // Every 30 seconds
const PORT = process.env.PORT || 10000; // 10000 is Render’s default fallback


server.listen(PORT, '0.0.0.0', () =>
  console.log(`WebSocket server running on port ${PORT}`)
);