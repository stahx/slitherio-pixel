class Game {
  constructor() {
    this.speedMusic = new Audio('./assets/pixel-jump.mp3');
    this.loading = document.querySelector('#loading');
    this.game = document.querySelector('#game');
    this.menu = document.querySelector('#menu');
    this.playerPoints = document.querySelector('#points-amount');
    this.name = document.querySelector('#player-name');
    this.leaderBoard = document.querySelector('#leaderboard');
    this.canvas = document.querySelector('#canvas');
    this.ctx = this.canvas.getContext('2d');

    this.socket = io('');

    this.fps = 300;

    this.players = [];
    this.points = [];

    this.player = {};

    this.canvas.width = 1920;
    this.canvas.height = 1080;

    this.isSpaceHeld = false;
  }

  async start(playerName) {
    await this.#loadData();
    this.#joinPlayer(playerName);
    this.#render();

    this.socket.on('update', (data) => {
      this.running = true;
      this.players = data.players;
      this.points = data.points;
      this.player = data.players.find((el) => el.id == this.socket.id);
    });

    this.socket.on('ded', () => {
      document.querySelector('#deathscreen').style.display = 'flex';
    });

    document.addEventListener('keydown', (e) => {
      if (e.keyCode == 32 && !this.isSpaceHeld) {
        this.isSpaceHeld = true;
        this.speedMusic.currentTime = 0;
        this.speedMusic.play();
        this.socket.emit('player-speed', true);
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.keyCode == 32) {
        this.isSpaceHeld = false;
        this.socket.emit('player-speed', false);
      }
    });

    document.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.player.mouseX = e.clientX - rect.left;
      this.player.mouseY = e.clientY - rect.top;

      this.socket.emit('change-dir', {
        mouseX: this.player.mouseX,
        mouseY: this.player.mouseY,
      });
    });

    this.loading.style.display = 'none';
    this.menu.style.display = 'none';
    this.leaderBoard.style.display = 'block';
    this.game.style.display = 'block';
  }

  #joinPlayer(name) {
    this.socket.emit('player-join', { name });
  }

  #render() {
    requestAnimationFrame(() => this.#renderFrame());
    requestAnimationFrame(() => this.#updateUI());
    requestAnimationFrame(() => this.#cameraFollow());
  }

  #renderFrame() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const point of this.points) {
      this.ctx.fillStyle = point.color;
      this.ctx.fillRect(point.x, point.y, point.size, point.size);
    }
    for (const player of this.players) {
      this.ctx.fillStyle = player.color;
      this.ctx.fillRect(player.x, player.y, player.size, player.size);

      for (const tailpart of player.tail) {
        this.ctx.fillStyle = player.color;
        this.ctx.fillRect(tailpart[0], tailpart[1], player.size, player.size);
      }
    }

    requestAnimationFrame(() => this.#renderFrame());
  }

  #cameraFollow() {
    const windowX = window.innerWidth;
    const windowY = window.innerHeight;

    if (
      this.player &&
      this.player.x !== undefined &&
      this.player.y !== undefined
    ) {
      this.canvas.style.left = `${-(this.player.x - windowX / 2)}px`;
      this.canvas.style.top = `${-(this.player.y - windowY / 2)}px`;
    }
    requestAnimationFrame(() => this.#cameraFollow());
  }

  #updateUI() {
    let htmlString = ``;
    for (const [index, player] of this.players
      .sort((a, b) => b.points - a.points)
      .entries()) {
      const elements = this.leaderBoard.getElementsByTagName('*');
      if (elements.length < 9) {
        htmlString += `<div><b>${index + 1}.</b> ${player.name || 'Brak'}: ${
          player.points
        }</div>`;
      }
    }
    this.leaderBoard.innerHTML = htmlString;

    if (this.player) {
      this.playerPoints.innerHTML = this.player.points || 0;
      this.name.innerHTML = this.player.name || 'Brak';

      const windowX = window.innerWidth;
      const windowY = window.innerHeight;

      const playerName = document.querySelector('#player-name-floating');
      if (this.player.x !== undefined && this.player.y !== undefined) {
        playerName.style.left = `${-(this.player.x - windowX / 2)}px`;
        playerName.style.top = `${-(this.player.y - windowY / 2)}px`;
      }
      playerName.innerHTML = this.player.name;
    }

    requestAnimationFrame(() => this.#updateUI());
  }

  async #loadData() {
    console.log('ladowanie..');
    const req = await axios.get('/state');
    if (req.status == 200) {
      const { data } = await axios.get('/game-data');
      this.players = data.players;
      this.points = data.points;
      this.canvas.width = data.width;
      this.canvas.height = data.height;
      console.log('zaladowano.');
      return true;
    } else {
      return this.#loadData();
    }
  }
}
