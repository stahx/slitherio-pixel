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
        this.#removePlayerEntities(socket.id);
        this.#emitUpdate();
      });
    });
  }

  start() {
    this.#mainLoop();
    this.#generatePoints(this.config.POINTS_AMOUNT);

    this.running = true;
  }

  #mainLoop() {
    setInterval(() => {
      const players = this.#getPlayerEntities();

      for (const player of players) {
        player.diffX = player.mouseX - player.x - player.size / 2;
        player.diffY = player.mouseY - player.y - player.size / 2;

        let pointDist = Math.sqrt(
          player.diffX * player.diffX + player.diffY * player.diffY
        );

        if (pointDist > 0) {
          player.diffX *= 1 / pointDist;
          player.diffY *= 1 / pointDist;
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
        const tailLimit = tailEntities.length > player.points * 3;
        const shouldAddTail = player.tailCounter % 3 === 0;

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
    player.points++;
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
    const size = getRandomSize(10, 20);
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

  #emitUpdate() {
    const players = this.#getPlayerEntities();

    for (const player of players) {
      const playerX = player.x;
      const playerY = player.y;

      const visibleEntities = this.entities.filter((entity) => {
        const distX = entity.x - playerX;
        const distY = entity.y - playerY;
        const distance = Math.sqrt(distX * distX + distY * distY);
        return distance <= 1500;
      });

      this.io.to(player.playerId).emit('update', {
        entities: visibleEntities.map((e) => ({
          id: e.id,
          type: e.type,
          x: e.x,
          y: e.y,
          size: e.size,
          color: e.color,
          playerId: e.playerId,
          name: e.name,
          points: e.points,
        })),
        leaderboard: this.#getLeaderboard(),
      });
    }
  }
}

export default GameServer;
