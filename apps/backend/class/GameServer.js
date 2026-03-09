import Player from './Player.js';
import Tail from './Tail.js';
import Point from './Point.js';
import Config from './Config.js';

import {
  getRandomPosition,
  getRandomSize,
  getRandomColor,
  calculatePlayerNewSize,
} from '../helpers/index.js';

class GameServer {
  constructor(io, config) {
    this.io = io;
    this.config = new Config(config);

    this.running = false;

    this.entities = [];
    this.lastLeaderboard = '';
    this.updateCounter = 0;

    this.playerState = new Map();

    this.io.on('connection', (socket) => {
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

        this.entities.push(playerEntity);
        this.playerState.set(socket.id, new Map());
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
        this.#removePlayerEntities(socket.id);
        this.#emitUpdate();
      });

      socket.on('ping-check', () => {
        socket.emit('pong-check');
      });
    });
  }

  start() {
    this.#mainLoop();
    this.#generatePoints(this.config.POINTS_AMOUNT);

    this.running = true;
  }

  #mainLoop() {
    const MAX_ROTATION_SPEED = 0.08; // radians per tick - lower = slower turning

    setInterval(() => {
      const players = this.#getPlayerEntities();

      for (const player of players) {
        player.diffX = player.mouseX - player.x - player.size / 2;
        player.diffY = player.mouseY - player.y - player.size / 2;

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
            size: player.size,
          });
          this.entities.push(tailEntity);
        }

        if (tailLimit && tailEntities.length > 0) {
          this.entities = this.entities.filter(
            (e) => e.id !== tailEntities[0].id
          );
        }

        this.#detectPointCollisions(player);
        this.#detectTailCollisions(player);

        player.size = calculatePlayerNewSize(player);
      }
      this.#emitUpdate();
    }, 1000 / this.config.TICK_RATE);
  }

  #killPlayer(player) {
    const spawnPoints = player.points;
    const tailEntities = this.#getTailEntities(player.playerId);
    const tailToSpawn = tailEntities.slice(0, spawnPoints);

    for (const tailEntity of tailToSpawn) {
      this.#generatePoint(tailEntity.x, tailEntity.y);
    }

    this.io.to(player.playerId).emit('ded');
    this.#removePlayerEntities(player.playerId);
  }

  #detectPointCollisions(player) {
    const points = this.#getPointEntities();

    for (const point of points) {
      if (
        (player.x >= point.x || player.x + player.size >= point.x) &&
        (player.y >= point.y || player.y + player.size >= point.y) &&
        player.x <= point.x + point.size &&
        player.y <= point.y + point.size
      ) {
        this.#pickPoint(player, point);
        break;
      }
    }
  }

  #detectTailCollisions(player) {
    const allTailEntities = this.entities.filter((e) => e.type === 'tail');

    for (const tailEntity of allTailEntities) {
      if (tailEntity.playerId === player.playerId) {
        continue;
      }

      const tailPlayer = this.#getPlayerEntity(tailEntity.playerId);
      if (!tailPlayer) continue;

      if (
        (player.x >= tailEntity.x || player.x + player.size >= tailEntity.x) &&
        (player.y >= tailEntity.y || player.y + player.size >= tailEntity.y) &&
        player.x <= tailEntity.x + tailPlayer.size &&
        player.y <= tailEntity.y + tailPlayer.size
      ) {
        this.#killPlayer(player);
        break;
      }
    }
  }

  #pickPoint(player, point) {
    this.entities = this.entities.filter((e) => e.id !== point.id);
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
    this.entities.push(pointEntity);
  }

  #getPlayerEntities() {
    return this.entities.filter((e) => e.type === 'player');
  }

  #getPlayerEntity(playerId) {
    return this.entities.find(
      (e) => e.type === 'player' && e.playerId === playerId
    );
  }

  #getTailEntities(playerId) {
    return this.entities.filter(
      (e) => e.type === 'tail' && e.playerId === playerId
    );
  }

  #getPointEntities() {
    return this.entities.filter((e) => e.type === 'point');
  }

  #removePlayerEntities(playerId) {
    this.entities = this.entities.filter(
      (e) =>
        !(e.type === 'player' && e.playerId === playerId) &&
        !(e.type === 'tail' && e.playerId === playerId)
    );
  }

  #getLeaderboard() {
    return this.#getPlayerEntities()
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
      .map((el) => {
        return { name: el.name, points: el.points };
      });
  }

  #serializeEntity(e) {
    const base = {
      i: e.id,
      t: e.type === 'point' ? 0 : e.type === 'tail' ? 1 : 2,
      x: Math.round(e.x),
      y: Math.round(e.y),
      s: Math.round(e.size),
      c: e.color,
    };
    if (e.type === 'player') {
      base.p = e.playerId;
      base.n = e.name;
      base.pt = e.points;
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

    const FOG_RADIUS_SQ = 1500 * 1500;

    for (const player of players) {
      const prevVisible = this.playerState.get(player.playerId);
      if (!prevVisible) continue;

      const playerX = player.x;
      const playerY = player.y;

      const added = [];
      const updated = [];
      const removed = [];

      const currentVisible = new Map();

      for (const entity of this.entities) {
        const distX = entity.x - playerX;
        const distY = entity.y - playerY;
        if (distX * distX + distY * distY > FOG_RADIUS_SQ) continue;

        currentVisible.set(entity.id, entity);

        if (!prevVisible.has(entity.id)) {
          added.push(this.#serializeEntity(entity));
        } else if (entity.type !== 'point') {
          const prev = prevVisible.get(entity.id);
          const rx = Math.round(entity.x);
          const ry = Math.round(entity.y);
          const rs = Math.round(entity.size);
          if (prev.x !== rx || prev.y !== ry || prev.s !== rs || (entity.type === 'player' && prev.pt !== entity.points)) {
            const upd = { i: entity.id, x: rx, y: ry };
            if (prev.s !== rs) upd.s = rs;
            if (entity.type === 'player' && prev.pt !== entity.points) upd.pt = entity.points;
            updated.push(upd);
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
        newPrevMap.set(id, {
          x: Math.round(entity.x),
          y: Math.round(entity.y),
          s: Math.round(entity.size),
          pt: entity.points,
        });
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
  }
}

export default GameServer;
