import express from 'express';
import http from 'http';
import { matchRouter } from './routes/matches.js';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from './arcjet.js';

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST|| '0.0.0.0';

const app = express();
const server = http.createServer(app);
// Use JSON middleware to parse incoming request bodies
app.use(express.json());

// Root GET route returning a short message
app.get('/', (req, res) => {
  res.send('Welcome to the Match Studio API!');
});

app.use(securityMiddleware());

app.use('/matches', matchRouter);

const { broadcastMatchCreated } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;

server.listen(PORT, HOST, () => {
  const baseURL = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

  console.log(`Server is running on ${baseURL}`);
  console.log(`WebSocket Server is running on ${baseURL.replace('http', 'ws')}/ws`);
});
// Dev server triggered reload
