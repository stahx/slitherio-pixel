import Player from './Player.js';
import Tail from './Tail.js';
import Point from './Point.js';
import Config from './Config.js';
import BotManager from './BotManager.js';

import {
  getRandomPosition,
  getRandomSize,
  getRandomColor,
  calculatePlayerNewSize,
} from '../helpers/index.js';

const GRID_CELL_SIZE = 100;

class GameServer {
  constructor(io, config) {
    this.io = io;
    this.config = new Config(config);

    this.running = false;

    this.players = new Map();
    this.tails = new Map();
    this.points = new Map();
    this.allEntities = new Map();

    this.lastLeaderboard = '';
    this.updateCounter = 0;

    this.playerState = new Map();
    this.spectators = new Map();

    this.grid = new Map();

    this.botManager = new BotManager(this);

    this.io.on('connection', (socket) => {
      const initialSnapshot = [];
      for (const e of this.allEntities.values()) {
        initialSnapshot.push(this.#serializeEntity(e));
      }
      socket.emit('update', { a: initialSnapshot });
      const spectatorMap = new Map();
      for (const e of this.allEntities.values()) {
        spectatorMap.set(e.id, {
          x: Math.round(e.x),
          y: Math.round(e.y),
          s: Math.round(e.size),
          pt: e.points,
        });
      }
      this.spectators.set(socket.id, spectatorMap);

      socket.on('player-join', (data) => {
        const playerExists = this.#getPlayerEntity(socket.id);
        if (playerExists) {
          return;
        }

        const position = getRandomPosition(
          this.config.MAP_WIDTH,
          this.config.MAP_HEIGHT
        );

        const playerEntity = new Player(position.x, position.y, {
          playerId: socket.id,
          name: data.name.slice(0, 15),
          color: getRandomColor(),
          size: 10,
          points: 0,
        });

        this.players.set(socket.id, playerEntity);
        this.allEntities.set(playerEntity.id, playerEntity);
        this.tails.set(socket.id, []);
        this.playerState.set(socket.id, new Map());
        this.spectators.delete(socket.id);
        this.botManager.reconcile();
        this.#emitUpdate();
      });

      socket.on('player-speed', (data) => {
        const player = this.#getPlayerEntity(socket.id);
        if (player) {
          player.speed = data;
        }
      });

      socket.on('change-dir', (data) => {
        const player = this.#getPlayerEntity(socket.id);
        if (player) {
          player.mouseX = data.mouseX;
          player.mouseY = data.mouseY;
        }
      });

      socket.on('disconnect', () => {
        this.playerState.delete(socket.id);
        this.spectators.delete(socket.id);
        this.removePlayerEntities(socket.id);
        this.botManager.reconcile();
        this.#emitUpdate();
      });

      socket.on('ping-check', () => {
        socket.emit('pong-check');
      });
    });
  }

  get entities() {
    return Array.from(this.allEntities.values());
  }

  start() {
    this.#mainLoop();
    this.#generatePoints(this.config.POINTS_AMOUNT);
    this.botManager.reconcile();

    this.running = true;
  }

  #mainLoop() {
    const MAX_ROTATION_SPEED = 0.08; // radians per tick - lower = slower turning

    setInterval(() => {
      this.#rebuildGrid();

      const players = this.#getPlayerEntities();

      for (const player of players) {
        const pcx = player.x + player.size / 2;
        const pcy = player.y + player.size / 2;
        let aimDx = player.mouseX - pcx;
        let aimDy = player.mouseY - pcy;
        const MW = this.config.MAP_WIDTH;
        const MH = this.config.MAP_HEIGHT;
        if (aimDx > MW / 2) aimDx -= MW;
        else if (aimDx < -MW / 2) aimDx += MW;
        if (aimDy > MH / 2) aimDy -= MH;
        else if (aimDy < -MH / 2) aimDy += MH;

        player.diffX = aimDx;
        player.diffY = aimDy;

        let pointDist = Math.sqrt(
          player.diffX * player.diffX + player.diffY * player.diffY
        );

        // Calculate target angle from mouse position
        const targetAngle = Math.atan2(player.diffY, player.diffX);

        // Calculate angle difference (shortest path)
        let angleDiff = targetAngle - player.currentAngle;

        // Normalize to -PI to PI range
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        // Limit rotation speed
        if (angleDiff > MAX_ROTATION_SPEED) {
          angleDiff = MAX_ROTATION_SPEED;
        } else if (angleDiff < -MAX_ROTATION_SPEED) {
          angleDiff = -MAX_ROTATION_SPEED;
        }

        // Apply limited rotation
        player.currentAngle += angleDiff;

        // Use the limited angle for movement direction
        player.diffX = Math.cos(player.currentAngle);
        player.diffY = Math.sin(player.currentAngle);

        if (player.speed && player.points <= 0) {
          player.speed = false;
          if (!this.botManager.isBot(player.playerId)) {
            this.io.to(player.playerId).emit('boost-stop');
          }
        }

        if (player.speed) {
          if (!player._boostTick) player._boostTick = 0;
          player._boostTick++;
          if (player._boostTick % 10 === 0) {
            player.points = Math.max(0, player.points - 1);
            const tailArr = this.tails.get(player.playerId);
            if (tailArr && tailArr.length > 0) {
              const shed = tailArr.shift();
              this.allEntities.delete(shed.id);
              this.#generatePoint(shed.x, shed.y);
            }
          }
        } else {
          player._boostTick = 0;
        }

        const moveX = player.speed
          ? player.diffX * this.config.BOOST_SPEED
          : player.diffX * this.config.NORMAL_SPEED;
        const moveY = player.speed
          ? player.diffY * this.config.BOOST_SPEED
          : player.diffY * this.config.NORMAL_SPEED;

        player.x += moveX;
        player.y += moveY;

        if (player.x + player.size >= this.config.MAP_WIDTH) {
          player.x = 0;
        }
        if (player.x < 0) {
          player.x = this.config.MAP_WIDTH - player.size;
        }

        if (player.y + player.size >= this.config.MAP_HEIGHT) {
          player.y = 0;
        }
        if (player.y < 0) {
          player.y = this.config.MAP_HEIGHT - player.size;
        }

        player.mouseX += moveX;
        player.mouseY += moveY;

        if (!player.tailCounter) {
          player.tailCounter = 0;
        }
        player.tailCounter++;

        const tailEntities = this.#getTailEntities(player.playerId);
        const tailLimit = tailEntities.length > player.points * 2;
        const shouldAddTail = player.tailCounter % 5 === 0;

        if (pointDist > 0 && !tailLimit && shouldAddTail) {
          const tailEntity = new Tail(player.x, player.y, {
            playerId: player.playerId,
            color: player.color,
          });
          this.tails.get(player.playerId).push(tailEntity);
          this.allEntities.set(tailEntity.id, tailEntity);
        }

        if (tailLimit && tailEntities.length > 0) {
          const tailArr = this.tails.get(player.playerId);
          const removed = tailArr.shift();
          this.allEntities.delete(removed.id);
        }

        this.#detectPointCollisions(player);
        this.#detectTailCollisions(player);

        player.size = calculatePlayerNewSize(player);
      }

      this.botManager.tick();

      this.#emitUpdate();
    }, 1000 / this.config.TICK_RATE);
  }

  #rebuildGrid() {
    this.grid.clear();
    for (const entity of this.allEntities.values()) {
      if (entity.type === 'player') continue;
      const cellX = Math.floor(entity.x / GRID_CELL_SIZE);
      const cellY = Math.floor(entity.y / GRID_CELL_SIZE);
      const key = cellX + ',' + cellY;
      let cell = this.grid.get(key);
      if (!cell) {
        cell = [];
        this.grid.set(key, cell);
      }
      cell.push(entity);
    }
  }

  #getNearbyCells(x, y, radius) {
    const result = [];
    const minCX = Math.floor((x - radius) / GRID_CELL_SIZE);
    const maxCX = Math.floor((x + radius) / GRID_CELL_SIZE);
    const minCY = Math.floor((y - radius) / GRID_CELL_SIZE);
    const maxCY = Math.floor((y + radius) / GRID_CELL_SIZE);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const cell = this.grid.get(cx + ',' + cy);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            result.push(cell[i]);
          }
        }
      }
    }
    return result;
  }

  #aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return (
      ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
    );
  }

  #aabbOverlapTorus(ax, ay, aw, ah, bx, by, bw, bh, W, H) {
    for (let kx = -1; kx <= 1; kx++) {
      for (let ky = -1; ky <= 1; ky++) {
        const px = bx + kx * W;
        const py = by + ky * H;
        if (this.#aabbOverlap(ax, ay, aw, ah, px, py, bw, bh)) return true;
      }
    }
    return false;
  }

  getNearbyCellsTorus(x, y, radius) {
    const W = this.config.MAP_WIDTH;
    const H = this.config.MAP_HEIGHT;
    const seen = new Set();
    const out = [];
    const pushChunk = (cx, cy) => {
      const chunk = this.#getNearbyCells(cx, cy, radius);
      for (let i = 0; i < chunk.length; i++) {
        const e = chunk[i];
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    };
    for (let kx = -1; kx <= 1; kx++) {
      for (let ky = -1; ky <= 1; ky++) {
        pushChunk(x + kx * W, y + ky * H);
      }
    }
    return out;
  }

  #killPlayer(player) {
    const spawnPoints = player.points;
    const tailEntities = this.#getTailEntities(player.playerId);
    const allSegments = [{ x: player.x, y: player.y }, ...tailEntities];
    const count = allSegments.length;

    for (let i = 0; i < spawnPoints; i++) {
      const idx = count > 1 ? Math.round((i / (spawnPoints - 1 || 1)) * (count - 1)) : 0;
      const seg = allSegments[Math.min(idx, count - 1)];
      this.#generatePoint(seg.x, seg.y);
    }

    if (this.botManager.isBot(player.playerId)) {
      this.botManager.remove(player.playerId);
      this.botManager.reconcile();
    } else {
      this.io.to(player.playerId).emit('ded');
      this.removePlayerEntities(player.playerId);
    }
  }

  #detectPointCollisions(player) {
    const W = this.config.MAP_WIDTH;
    const H = this.config.MAP_HEIGHT;
    const pw = player.size;
    for (const point of this.points.values()) {
      if (
        this.#aabbOverlapTorus(
          player.x,
          player.y,
          pw,
          pw,
          point.x,
          point.y,
          point.size,
          point.size,
          W,
          H,
        )
      ) {
        this.#pickPoint(player, point);
        break;
      }
    }
  }

  #detectTailCollisions(player) {
    const W = this.config.MAP_WIDTH;
    const H = this.config.MAP_HEIGHT;
    const pw = player.size;
    const nearby = this.getNearbyCellsTorus(
      player.x,
      player.y,
      player.size + 25,
    );

    for (const tailEntity of nearby) {
      if (tailEntity.type !== 'tail') continue;
      if (tailEntity.playerId === player.playerId) {
        continue;
      }

      const tailPlayer = this.#getPlayerEntity(tailEntity.playerId);
      if (!tailPlayer) continue;

      const tw = tailPlayer.size;
      if (
        this.#aabbOverlapTorus(
          player.x,
          player.y,
          pw,
          pw,
          tailEntity.x,
          tailEntity.y,
          tw,
          tw,
          W,
          H,
        )
      ) {
        this.#killPlayer(player);
        break;
      }
    }
  }

  #pickPoint(player, point) {
    this.points.delete(point.id);
    this.allEntities.delete(point.id);
    // Bigger points give more points (size 8 = 1pt, size 16 = 2pts, size 24 = 3pts)
    const pointValue = Math.max(1, Math.floor(point.size / 8));
    player.points += pointValue;
    this.#generatePoint();
  }

  #generatePoints(amount) {
    for (let x = 0; x <= amount; x++) {
      this.#generatePoint();
    }
  }

  #generatePoint(x, y) {
    const position =
      x && y
        ? { x, y }
        : getRandomPosition(this.config.MAP_WIDTH, this.config.MAP_HEIGHT);
    const size = getRandomSize(8, 25);
    const pointEntity = new Point(position.x, position.y, {
      size,
      color: getRandomColor(),
    });
    this.points.set(pointEntity.id, pointEntity);
    this.allEntities.set(pointEntity.id, pointEntity);
  }

  #getPlayerEntities() {
    return Array.from(this.players.values());
  }

  #getPlayerEntity(playerId) {
    return this.players.get(playerId);
  }

  #getTailEntities(playerId) {
    return this.tails.get(playerId) || [];
  }

  #getPointEntities() {
    return Array.from(this.points.values());
  }

  removePlayerEntities(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      this.allEntities.delete(player.id);
      this.players.delete(playerId);
    }
    const playerTails = this.tails.get(playerId);
    if (playerTails) {
      for (const tail of playerTails) {
        this.allEntities.delete(tail.id);
      }
      this.tails.delete(playerId);
    }
  }

  #getLeaderboard() {
    return this.#getPlayerEntities()
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
      .map((el) => {
        return { name: el.name, points: el.points };
      });
  }

  torusDistSq(px, py, ex, ey) {
    const W = this.config.MAP_WIDTH;
    const H = this.config.MAP_HEIGHT;
    let dx = ex - px;
    let dy = ey - py;
    if (dx > W / 2) dx -= W;
    else if (dx < -W / 2) dx += W;
    if (dy > H / 2) dy -= H;
    else if (dy < -H / 2) dy += H;
    return dx * dx + dy * dy;
  }

  #serializeEntity(e) {
    const base = {
      i: e.id,
      t: e.type === 'point' ? 0 : e.type === 'tail' ? 1 : 2,
      x: Math.round(e.x),
      y: Math.round(e.y),
      c: e.color,
    };
    if (e.type !== 'tail') {
      base.s = Math.round(e.size);
    }
    if (e.type === 'player') {
      base.p = e.playerId;
      base.n = e.name;
      base.pt = e.points;
      base.a = Math.round(e.currentAngle * 1000) / 1000;
      if (e.speed) base.b = 1;
    } else if (e.type === 'tail') {
      base.p = e.playerId;
    }
    return base;
  }

  #emitUpdate() {
    const players = this.#getPlayerEntities();
    this.updateCounter++;

    let leaderboard = null;
    if (this.updateCounter % 10 === 0) {
      const newLeaderboard = this.#getLeaderboard();
      const leaderboardStr = JSON.stringify(newLeaderboard);
      if (leaderboardStr !== this.lastLeaderboard) {
        this.lastLeaderboard = leaderboardStr;
        leaderboard = newLeaderboard;
      }
    }

    const R = this.config.FOG_RADIUS;
    const FOG_RADIUS_SQ = R * R;

    for (const player of players) {
      if (this.botManager.isBot(player.playerId)) continue;
      const prevVisible = this.playerState.get(player.playerId);
      if (!prevVisible) continue;

      const playerX = player.x;
      const playerY = player.y;

      const added = [];
      const updated = [];
      const removed = [];

      const currentVisible = new Map();

      for (const entity of this.allEntities.values()) {
        if (
          this.torusDistSq(playerX, playerY, entity.x, entity.y) > FOG_RADIUS_SQ
        )
          continue;

        currentVisible.set(entity.id, entity);

        if (!prevVisible.has(entity.id)) {
          added.push(this.#serializeEntity(entity));
        } else if (entity.type !== 'point') {
          const prev = prevVisible.get(entity.id);
          const rx = Math.round(entity.x);
          const ry = Math.round(entity.y);
          if (entity.type === 'tail') {
            if (prev.x !== rx || prev.y !== ry) {
              updated.push({ i: entity.id, x: rx, y: ry });
            }
          } else {
            const rs = Math.round(entity.size);
            const ra = entity.type === 'player' ? Math.round(entity.currentAngle * 1000) / 1000 : undefined;
            const rb = entity.type === 'player' ? (entity.speed ? 1 : 0) : undefined;
            if (
              prev.x !== rx ||
              prev.y !== ry ||
              prev.s !== rs ||
              (entity.type === 'player' && (prev.pt !== entity.points || prev.a !== ra || prev.b !== rb))
            ) {
              const upd = { i: entity.id, x: rx, y: ry };
              if (prev.s !== rs) upd.s = rs;
              if (entity.type === 'player') {
                if (prev.pt !== entity.points) upd.pt = entity.points;
                upd.a = ra;
                upd.b = rb;
              }
              updated.push(upd);
            }
          }
        }
      }

      for (const [id] of prevVisible) {
        if (!currentVisible.has(id)) {
          removed.push(id);
        }
      }

      const newPrevMap = new Map();
      for (const [id, entity] of currentVisible) {
        if (entity.type === 'tail') {
          newPrevMap.set(id, {
            x: Math.round(entity.x),
            y: Math.round(entity.y),
            s: 0,
            pt: entity.points,
          });
        } else {
          const entry = {
            x: Math.round(entity.x),
            y: Math.round(entity.y),
            s: Math.round(entity.size),
            pt: entity.points,
          };
          if (entity.type === 'player') {
            entry.a = Math.round(entity.currentAngle * 1000) / 1000;
            entry.b = entity.speed ? 1 : 0;
          }
          newPrevMap.set(id, entry);
        }
      }
      this.playerState.set(player.playerId, newPrevMap);

      const updateData = {};
      if (added.length) updateData.a = added;
      if (updated.length) updateData.u = updated;
      if (removed.length) updateData.r = removed;
      if (leaderboard) updateData.l = leaderboard;

      if (added.length || updated.length || removed.length || leaderboard) {
        this.io.to(player.playerId).emit('update', updateData);
      }
    }

    for (const [socketId, prevVisible] of this.spectators) {
      const added = [];
      const updated = [];
      const removed = [];
      const currentVisible = new Map();

      for (const entity of this.allEntities.values()) {
        currentVisible.set(entity.id, entity);

        if (!prevVisible.has(entity.id)) {
          added.push(this.#serializeEntity(entity));
        } else if (entity.type !== 'point') {
          const prev = prevVisible.get(entity.id);
          const rx = Math.round(entity.x);
          const ry = Math.round(entity.y);
          if (entity.type === 'tail') {
            if (prev.x !== rx || prev.y !== ry) {
              updated.push({ i: entity.id, x: rx, y: ry });
            }
          } else {
            const rs = Math.round(entity.size);
            const ra = entity.type === 'player' ? Math.round(entity.currentAngle * 1000) / 1000 : undefined;
            const rb = entity.type === 'player' ? (entity.speed ? 1 : 0) : undefined;
            if (
              prev.x !== rx ||
              prev.y !== ry ||
              prev.s !== rs ||
              (entity.type === 'player' && (prev.pt !== entity.points || prev.a !== ra || prev.b !== rb))
            ) {
              const upd = { i: entity.id, x: rx, y: ry };
              if (prev.s !== rs) upd.s = rs;
              if (entity.type === 'player') {
                if (prev.pt !== entity.points) upd.pt = entity.points;
                upd.a = ra;
                upd.b = rb;
              }
              updated.push(upd);
            }
          }
        }
      }

      for (const [id] of prevVisible) {
        if (!currentVisible.has(id)) {
          removed.push(id);
        }
      }

      const newPrevMap = new Map();
      for (const [id, entity] of currentVisible) {
        if (entity.type === 'tail') {
          newPrevMap.set(id, {
            x: Math.round(entity.x),
            y: Math.round(entity.y),
            s: 0,
            pt: entity.points,
          });
        } else {
          const entry = {
            x: Math.round(entity.x),
            y: Math.round(entity.y),
            s: Math.round(entity.size),
            pt: entity.points,
          };
          if (entity.type === 'player') {
            entry.a = Math.round(entity.currentAngle * 1000) / 1000;
            entry.b = entity.speed ? 1 : 0;
          }
          newPrevMap.set(id, entry);
        }
      }
      this.spectators.set(socketId, newPrevMap);

      const updateData = {};
      if (added.length) updateData.a = added;
      if (updated.length) updateData.u = updated;
      if (removed.length) updateData.r = removed;

      if (added.length || updated.length || removed.length) {
        this.io.to(socketId).emit('update', updateData);
      }
    }
  }
}

export default GameServer;
