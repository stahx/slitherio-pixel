import Player from './Player.js';
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

    this.players = [];
    this.points = [];

    this.io.on('connection', (socket) => {
      socket.on('player-join', (data) => {
        const playerExists = this.players.filter((el) => el.id == socket.id)[0];
        if (playerExists) {
          return;
        }

        const position = getRandomPosition(
          this.config.MAP_WIDTH,
          this.config.MAP_HEIGHT
        );

        this.players.push(
          new Player(
            socket.id,
            position.x,
            position.y,
            data.name.slice(0, 15),
            getRandomColor()
          )
        );

        this.#emitUpdate();
      });

      socket.on('player-speed', (data) => {
        for (const player of this.players) {
          if (player.id == socket.id) {
            player.speed = data;
          }
        }
      });

      socket.on('change-dir', (data) => {
        for (const player of this.players) {
          if (player.id == socket.id) {
            player.mouseX = data.mouseX;
            player.mouseY = data.mouseY;
          }
        }
      });

      socket.on('disconnect', () => {
        this.players = this.players.filter((el) => el.id != socket.id);
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
      for (const player of this.players) {
        player.diffX = player.mouseX - player.x;
        player.diffY = player.mouseY - player.y;

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

        if (player.x >= this.config.MAP_WIDTH) {
          player.x = 0;
        }
        if (player.x < 0) {
          player.x = this.config.MAP_WIDTH;
        }

        if (player.y >= this.config.MAP_HEIGHT) {
          player.y = 0;
        }
        if (player.y < 0) {
          player.y = this.config.MAP_HEIGHT;
        }

        player.mouseX += moveX;
        player.mouseY += moveY;

        const tailLimit = player.tail.length > player.points * 10;
        if (player.diffX + player.diffY != 0 && !tailLimit) {
          player.tail.push([player.x, player.y]);
        }

        if (tailLimit) {
          player.tail.shift();
        }

        //* pick points
        for (const point of this.points) {
          if (
            (player.x >= point.x || player.x + player.size >= point.x) &&
            (player.y >= point.y || player.y + player.size >= point.y) &&
            player.x <= point.x + point.size &&
            player.y <= point.y + point.size
          ) {
            this.#pickPoint(player, point);
          }
        }

        //* touch other player tail
        for (const player2 of this.players) {
          if (player.id != player2.id) {
            for (const tailPart of player2.tail) {
              if (
                (player.x >= tailPart[0] ||
                  player.x + player.size >= tailPart[0]) &&
                (player.y >= tailPart[1] ||
                  player.y + player.size >= tailPart[1]) &&
                player.x <= tailPart[0] + player2.size &&
                player.y <= tailPart[1] + player2.size
              ) {
                this.#killPlayer(player);
              }
            }
          }
        }

        player.size = calculatePlayerNewSize(player);
      }
      this.#emitUpdate();
    }, 1000 / this.config.TICK_RATE);
  }

  #killPlayer(player) {
    const spawnPoints = player.points;
    const tail = player.tail.splice(0, spawnPoints);

    for (const point of tail) {
      this.#generatePoint(point[0], point[1]);
    }

    this.io.to(player.id).emit('ded');
    this.players = this.players.filter((el) => el.id != player.id);
  }

  #pickPoint(player, point) {
    this.points = this.points.filter((el) => el != point);
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
    this.points.push(new Point(position.x, position.y, size, getRandomColor()));
  }

  #getLeaderboard() {
    return this.players
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
      .map((el) => {
        return { name: el.name, points: el.points };
      });
  }

  #emitUpdate(playerUpdates, pointUpdates) {
    for (const player of this.players) {
      const playerX = player.x;
      const playerY = player.y;

      const visiblePlayers = this.players
        .filter((p) => {
          if (p.id === player.id) return true;
          const distX = p.x - playerX;
          const distY = p.y - playerY;
          const distance = Math.sqrt(distX * distX + distY * distY);
          return distance <= this.config.FOG_RADIUS;
        })
        .map((el) => {
          return {
            id: el.id,
            x: el.x,
            y: el.y,
            size: el.size,
            tail: el.tail.filter((t) => {
              const tailDistX = t[0] - playerX;
              const tailDistY = t[1] - playerY;
              const tailDistance = Math.sqrt(
                tailDistX * tailDistX + tailDistY * tailDistY
              );
              return tailDistance <= this.config.FOG_RADIUS;
            }),
            points: el.points,
            color: el.color,
            name: el.name,
          };
        });

      const visiblePoints = this.points.filter((p) => {
        const distX = p.x - playerX;
        const distY = p.y - playerY;
        const distance = Math.sqrt(distX * distX + distY * distY);
        return distance <= this.config.FOG_RADIUS;
      });

      this.io.to(player.id).emit('update', {
        players: visiblePlayers,
        leaderboard: this.#getLeaderboard(),
        points: visiblePoints,
      });
    }
  }
}

export default GameServer;
