import Player from './Player.js';
import Point from './Point.js';

import {
	getRandomPosition,
	getRandomSize,
	getRandomColor,
	calculatePlayerNewSize,
} from '../helpers/index.js';

class GameServer {
	constructor(io, config) {
		this.io = io;
		this.config = config;

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

				if (player.diffX + player.diffY != 0) {
					player.tail.push({
						x: player.x,
						y: player.y,
						color: getRandomColor(),
					});
				}

				if (player.tail.length > player.points * 10) {
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
								(player.x >= tailPart.x ||
									player.x + player.size >= tailPart.x) &&
								(player.y >= tailPart.y ||
									player.y + player.size >= tailPart.y) &&
								player.x <= tailPart.x + player2.size &&
								player.y <= tailPart.y + player2.size
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
			this.#generatePoint(point.x, point.y);
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

	#emitUpdate() {
		this.io.emit('update', {
			players: this.players.map((el) => ({
				id: el.id,
				x: el.x,
				y: el.y,
				size: el.size,
				tail: el.tail.map((el) => ({
					x: el.x,
					y: el.y,
					color: el.color,
				})),
				points: el.points,
				color: el.color,
			})),
			points: this.points,
		});
	}
}

export default GameServer;
