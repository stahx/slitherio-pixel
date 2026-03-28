import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

import GameServer from './class/GameServer.js';

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

const app = express();

app.use(cors());
app.use(express.static('../frontend/src'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const gameConfig = {
  MAP_WIDTH: 4000,
  MAP_HEIGHT: 4000,
  POINTS_AMOUNT: 400,
  NORMAL_SPEED: 1.3,
  BOOST_SPEED: 2.3,
  TICK_RATE: 60,
  FOG_RADIUS: 2000,
};

const game = new GameServer(io, gameConfig);
game.start();

app.get('/version', (req, res) => {
  return res.json({ version: rootPkg.version });
});

app.get('/health', (req, res) => {
  return res.status(200).send('OK');
});

app.get('/state', (req, res) => {
  if (game.running) return res.status(200).send(true);
  return res.status(400).send(false);
});

app.get('/game-data', (req, res) => {
  if (game.running) {
    return res.json({
      entities: game.entities,
      width: game.config.MAP_WIDTH,
      height: game.config.MAP_HEIGHT,
    });
  }
  return res.status(400).send(false);
});

server.listen(port, host, (err) => {
  if (err) return console.log(err);
  console.log(`server listening at http://${host}:${port}`);
});
