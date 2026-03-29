import Player from './Player.js';
import { getRandomPosition, getRandomColor } from '../helpers/index.js';

const BOT_NAMES = [
  'Snek', 'Pixel', 'Viper', 'Zigzag', 'Glitch',
  'Byte', 'Slither', 'Noodle', 'Coil', 'Fang',
  'Blitz', 'Dash', 'Turbo', 'Nitro', 'Ghost',
  'Shadow', 'Spark', 'Bolt', 'Razor', 'Storm',
];

let _botIdCounter = 0;

export default class BotManager {
  constructor(gameServer) {
    this.game = gameServer;
    this.bots = new Set();
  }

  isBot(playerId) {
    return this.bots.has(playerId);
  }

  reconcile() {
    const humanCount = this.game.humanSockets.size;
    const desired = humanCount > 0
      ? Math.max(0, this.game.config.MIN_PLAYERS - humanCount)
      : 0;
    const current = this.bots.size;

    if (current < desired) {
      for (let i = 0; i < desired - current; i++) {
        this.#spawn();
      }
    } else if (current > desired) {
      let toRemove = current - desired;
      for (const botId of this.bots) {
        if (toRemove <= 0) break;
        this.remove(botId);
        toRemove--;
      }
    }
  }

  remove(botId) {
    this.game.removePlayerEntities(botId);
    this.bots.delete(botId);
  }

  tick() {
    const W = this.game.config.MAP_WIDTH;
    const H = this.game.config.MAP_HEIGHT;
    const now = Date.now();

    for (const botId of this.bots) {
      const player = this.game.players.get(botId);
      if (!player) continue;

      if (now < player._botRetargetAt) {
        player.speed = now < player._botBoostUntil;
        continue;
      }

      player._botRetargetAt = now + 400 + Math.random() * 800;

      const pcx = player.x + player.size / 2;
      const pcy = player.y + player.size / 2;

      const danger = this.#scanDanger(player, pcx, pcy);

      if (danger) {
        this.#evade(player, pcx, pcy, danger, now);
      } else {
        this.#seek(player, pcx, pcy, W, H, now);
      }

      player.speed = now < player._botBoostUntil;
    }
  }

  #spawn() {
    const botId = `bot:${++_botIdCounter}`;
    const position = getRandomPosition(
      this.game.config.MAP_WIDTH,
      this.game.config.MAP_HEIGHT
    );
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

    const playerEntity = new Player(position.x, position.y, {
      playerId: botId,
      name,
      color: getRandomColor(),
      size: 10,
      points: 0,
    });

    playerEntity.mouseX = position.x;
    playerEntity.mouseY = position.y;
    playerEntity._botWanderAngle = Math.random() * Math.PI * 2;
    playerEntity._botBoostUntil = 0;
    playerEntity._botRetargetAt = 0;

    this.game.players.set(botId, playerEntity);
    this.game.allEntities.set(playerEntity.id, playerEntity);
    this.game.tails.set(botId, []);
    this.bots.add(botId);
  }

  #scanDanger(player, pcx, pcy) {
    const dangerRadius = player.size + 80;
    const nearby = this.game.getNearbyCellsTorus(player.x, player.y, dangerRadius);

    let closestDist = Infinity;
    let closestTail = null;

    for (const entity of nearby) {
      if (entity.type !== 'tail' || entity.playerId === player.playerId) continue;
      const dist = this.game.torusDistSq(pcx, pcy, entity.x, entity.y);
      if (dist < closestDist) {
        closestDist = dist;
        closestTail = entity;
      }
    }

    if (!closestTail) return null;

    return { entity: closestTail, distSq: closestDist };
  }

  #evade(player, pcx, pcy, danger, now) {
    const W = this.game.config.MAP_WIDTH;
    const H = this.game.config.MAP_HEIGHT;

    let dx = danger.entity.x - pcx;
    let dy = danger.entity.y - pcy;
    if (dx > W / 2) dx -= W;
    else if (dx < -W / 2) dx += W;
    if (dy > H / 2) dy -= H;
    else if (dy < -H / 2) dy += H;

    const awayAngle = Math.atan2(-dy, -dx);
    const jitter = (Math.random() - 0.5) * 0.6;
    const escapeAngle = awayAngle + jitter;

    player._botWanderAngle = escapeAngle;
    player.mouseX = pcx + Math.cos(escapeAngle) * 250;
    player.mouseY = pcy + Math.sin(escapeAngle) * 250;
    player._botBoostUntil = now + 400 + Math.random() * 600;
  }

  #seek(player, pcx, pcy, W, H, now) {
    let bestPoint = null;
    let bestScore = -Infinity;

    for (const point of this.game.points.values()) {
      const distSq = this.game.torusDistSq(pcx, pcy, point.x, point.y);
      if (distSq > 500 * 500) continue;

      const value = Math.max(1, Math.floor(point.size / 8));
      const dist = Math.sqrt(distSq);
      const score = value / (dist + 1);

      if (score > bestScore) {
        bestScore = score;
        bestPoint = point;
      }
    }

    if (bestPoint) {
      let dx = bestPoint.x - pcx;
      let dy = bestPoint.y - pcy;
      if (dx > W / 2) dx -= W;
      else if (dx < -W / 2) dx += W;
      if (dy > H / 2) dy -= H;
      else if (dy < -H / 2) dy += H;
      player.mouseX = pcx + dx;
      player.mouseY = pcy + dy;
      player._botBoostUntil = 0;
    } else {
      player._botWanderAngle += (Math.random() - 0.5) * 0.6;
      player.mouseX = pcx + Math.cos(player._botWanderAngle) * 200;
      player.mouseY = pcy + Math.sin(player._botWanderAngle) * 200;
      player._botBoostUntil = 0;
    }
  }
}
