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
    this.entities = [];

    this.player = null;

    this.canvas.width = 1920;
    this.canvas.height = 1080;

    this.isSpaceHeld = false;
    this.gameRunning = false;
    this.escMenuOpen = false;
    this.escMenu = document.querySelector('#esc-menu');
    this.pingElement = document.querySelector('#ping-value');
    this.ping = 0;

    // Set up ping measurement immediately
    this.socket.on('pong-check', () => {
      this.ping = Date.now() - this.pingStart;
      this.#updatePingDisplay();
    });
    this.#startPingInterval();
  }

  async start(playerName) {
    await this.#loadData();
    this.#joinPlayer(playerName);
    this.#render();

    this.socket.on('update', (data) => {
      this.running = true;
      this.entities = data.entities || [];
      this.player = this.entities.find(
        (el) => el.type === 'player' && el.playerId == this.socket.id
      );
      this.leaderboard = data.leaderboard || [];
    });

    this.socket.on('ded', () => {
      document.querySelector('#deathscreen').style.display = 'flex';
    });

    document.addEventListener('keydown', (e) => {
      if (this.escMenuOpen) return;
      if (e.keyCode == 32 && !this.isSpaceHeld) {
        this.isSpaceHeld = true;
        this.speedMusic.currentTime = 0;
        this.speedMusic.volume = 0.1;
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
      if (this.escMenuOpen || !this.player) return;
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.socket.emit('change-dir', {
        mouseX: mouseX,
        mouseY: mouseY,
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

    const players = [];

    // First pass: render all entities (points, tails, player bodies)
    for (const entity of this.entities) {
      if (entity.type === 'point') {
        this.ctx.fillStyle = entity.color;
        this.ctx.fillRect(entity.x, entity.y, entity.size, entity.size);
      } else if (entity.type === 'tail') {
        this.ctx.fillStyle = entity.color;
        this.ctx.fillRect(entity.x, entity.y, entity.size, entity.size);
      } else if (entity.type === 'player') {
        this.ctx.fillStyle = entity.color;
        this.ctx.fillRect(entity.x, entity.y, entity.size, entity.size);
        players.push(entity);
      }
    }

    // Second pass: render nicknames ABOVE everything
    for (const entity of players) {
      if (entity.name) {
        const fontSize = Math.max(12, entity.size * 0.8);
        const nameOffset = entity.size + 8;

        this.ctx.save();
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.lineWidth = 2;

        const textX = entity.x + entity.size / 2;
        const textY = entity.y - nameOffset;

        this.ctx.strokeText(entity.name, textX, textY);
        this.ctx.fillText(entity.name, textX, textY);
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
      htmlString += `<div><b>${index + 1}.</b> ${player.name || 'Brak'}: ${
        player.points
      }</div>`;
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
      this.entities = data.entities || [];
      this.canvas.width = data.width;
      this.canvas.height = data.height;
      console.log('zaladowano.');
      return true;
    } else {
      return this.#loadData();
    }
  }

  #startPingInterval() {
    setInterval(() => {
      this.pingStart = Date.now();
      this.socket.emit('ping-check');
    }, 2000);
  }

  #updatePingDisplay() {
    if (!this.pingElement) return;

    let color;
    if (this.ping < 100) {
      color = '#22c55e'; // green
    } else if (this.ping <= 200) {
      color = '#eab308'; // yellow
    } else {
      color = '#ef4444'; // red
    }

    this.pingElement.style.color = color;
    this.pingElement.textContent = `${this.ping} ms`;
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
    this.entities = [];
    this.player = null;
    if (this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }
}
