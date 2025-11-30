class GameClient {
  constructor() {
    this.speedMusic = new Audio('../assets/pixel-jump.mp3');
    this.soundMusic = new Audio('../assets/pixel-song.mp3');

    this.soundButton = document.querySelector('#sound-button');
    this.loading = document.querySelector('#loading');
    this.game = document.querySelector('#game');
    this.menu = document.querySelector('#menu');
    this.playerPoints = document.querySelector('#points-amount');
    this.name = document.querySelector('#player-name');
    this.leaderboardElement = document.querySelector('#leaderboard');
    this.leaderboardContent = document.querySelector('#leaderboard-content');
    this.canvas = document.querySelector('#canvas');
    this.ctx = this.canvas.getContext('2d');

    this.socket = io('');
    this.fps = 300;

    this.leaderboard = [];
    this.players = [];
    this.points = [];

    this.player = {};

    this.canvas.width = 1920;
    this.canvas.height = 1080;

    this.isSpaceHeld = false;
    this.gameRunning = false;
    this.escMenuOpen = false;
    this.escMenu = document.querySelector('#esc-menu');
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
      this.leaderboard = data.leaderboard;
    });

    this.socket.on('ded', () => {
      document.querySelector('#deathscreen').style.display = 'flex';
    });

    document.addEventListener('keydown', (e) => {
      if (this.escMenuOpen) return;
      if (e.keyCode == 32 && !this.isSpaceHeld) {
        this.isSpaceHeld = true;
        this.speedMusic.currentTime = 0;
        this.speedMusic.play();
        this.socket.emit('player-speed', true);
      }
    });

    document.addEventListener('keyup', (e) => {
      if (this.escMenuOpen) return;
      if (e.keyCode == 32) {
        this.isSpaceHeld = false;
        this.socket.emit('player-speed', false);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.escMenuOpen) return;
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
    this.leaderboardElement.style.display = 'block';
    this.game.style.display = 'block';
    this.gameRunning = true;
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
        this.ctx.fillStyle = tailpart.color;
        this.ctx.fillRect(tailpart[0], tailpart[1], player.size, player.size);
      }

      if (player.name) {
        const fontSize = Math.max(12, player.size * 0.8);
        const nameOffset = player.size + 8;

        this.ctx.save();
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.lineWidth = 2;

        const textX = player.x + player.size / 2;
        const textY = player.y - nameOffset;

        this.ctx.strokeText(player.name, textX, textY);
        this.ctx.fillText(player.name, textX, textY);
        this.ctx.restore();
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

    for (const [index, player] of this.leaderboard.entries()) {
      const elements = this.leaderboardContent.getElementsByTagName('*');
      if (elements.length < 11) {
        htmlString += `<div><b>${index + 1}.</b> ${player.name || 'Brak'}: ${
          player.points
        }</div>`;
      }
    }
    this.leaderboardContent.innerHTML = htmlString;

    if (this.player) {
      this.playerPoints.innerHTML = this.player.points || 0;
      this.name.innerHTML = this.player.name || 'Brak';
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

  async toggleMusic() {
    if (this.soundButton.querySelector('.on').style.display === 'block') {
      this.soundButton.querySelector('.on').style.display = 'none';
      this.soundButton.querySelector('.off').style.display = 'block';
      this.#pauseSound();
    } else {
      this.soundButton.querySelector('.on').style.display = 'block';
      this.soundButton.querySelector('.off').style.display = 'none';
      this.#playSound();
    }
  }

  async #pauseSound() {
    this.soundMusic.pause();
  }

  async #playSound() {
    this.soundMusic.currentTime = 0;
    this.soundMusic.loop = true;
    this.soundMusic.volume = 0.1;
    this.soundMusic.muted = false;
    this.soundMusic.play();
  }

  isGameRunning() {
    return this.gameRunning;
  }

  toggleEscMenu() {
    if (!this.gameRunning) return;

    this.escMenuOpen = !this.escMenuOpen;
    if (this.escMenuOpen) {
      this.escMenu.style.display = 'flex';
    } else {
      this.escMenu.style.display = 'none';
    }
  }

  resumeGame() {
    this.escMenuOpen = false;
    this.escMenu.style.display = 'none';
  }

  returnToMenu() {
    this.gameRunning = false;
    this.escMenuOpen = false;
    this.escMenu.style.display = 'none';
    this.game.style.display = 'none';
    this.menu.style.display = 'flex';
    this.socket.disconnect();
    this.socket = io('');
    this.players = [];
    this.points = [];
    this.player = {};
    if (this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
