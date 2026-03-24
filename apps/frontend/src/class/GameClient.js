const SERVER_TICK_MS = 1000 / 60;

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

    this.leaderboard = [];
    this.entityMap = new Map();
    this.prevPositions = new Map();
    this.targetPositions = new Map();
    this.lastUpdateTime = performance.now();

    this.player = null;
    this._uiDirty = false;

    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    this.worldWidth = 4000;
    this.worldHeight = 4000;

    this.cameraX = 0;
    this.cameraY = 0;

    this.spectatorX = 2000;
    this.spectatorY = 2000;
    this.spectatorDX =
      (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 0.3);
    this.spectatorDY =
      (Math.random() > 0.5 ? 1 : -1) * (0.2 + Math.random() * 0.2);

    this.isSpaceHeld = false;
    this.gameRunning = false;
    this.escMenuOpen = false;
    this.escMenu = document.querySelector('#esc-menu');
    this.pingElement = document.querySelector('#ping-value');
    this.ping = 0;

    this.isMobile = !window.matchMedia('(any-pointer: fine)').matches;
    this.joystickActive = false;
    this.joystickTouchId = null;

    this._resizeTimeout = null;
    window.addEventListener('resize', () => {
      if (this._resizeTimeout) return;
      this._resizeTimeout = setTimeout(() => {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this._resizeTimeout = null;
      }, 100);
    });

    this.socket.on('pong-check', () => {
      this.ping = Date.now() - this.pingStart;
      this.#updatePingDisplay();
    });
    this.#startPingInterval();
    this.#setupUpdateHandler();
    this.#initCanvas();
    if (this.isMobile) this.#createMobileControls();
  }

  async #initCanvas() {
    await this.#loadData();
    this.#render();
  }

  async start(playerName) {
    this.#joinPlayer(playerName);

    if (!this._inputsBound) {
      this._inputsBound = true;

      if (this.isMobile) {
        this.#bindMobileInput();
      } else {
        let lastDirEmit = 0;
        document.addEventListener('mousemove', (e) => {
          if (this.escMenuOpen || !this.player) return;
          const now = performance.now();
          if (now - lastDirEmit < 33) return;
          lastDirEmit = now;
          const { mouseX, mouseY } = this.#clientToWrappedWorld(
            e.clientX,
            e.clientY,
          );
          this.socket.emit('change-dir', { mouseX, mouseY });
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
      }
    }

    this.loading.style.display = 'none';
    this.menu.style.display = 'none';
    this.leaderboardElement.style.display = 'block';
    this.game.style.display = 'block';
    this.gameRunning = true;
    this.#showMobileControls();
  }

  #createMobileControls() {
    const joystickZone = document.createElement('div');
    joystickZone.id = 'joystick-zone';
    const outer = document.createElement('div');
    outer.id = 'joystick-outer';
    const inner = document.createElement('div');
    inner.id = 'joystick-inner';
    joystickZone.appendChild(outer);
    joystickZone.appendChild(inner);
    document.body.appendChild(joystickZone);

    const boostBtn = document.createElement('div');
    boostBtn.id = 'boost-button';
    boostBtn.textContent = 'BOOST';
    document.body.appendChild(boostBtn);

    this.joystickZone = joystickZone;
    this.joystickInner = inner;
    this.boostButton = boostBtn;
  }

  #showMobileControls() {
    if (!this.isMobile) return;
    this.joystickZone.style.display = 'block';
    this.boostButton.style.display = 'block';
  }

  #hideMobileControls() {
    if (!this.isMobile) return;
    this.joystickZone.style.display = 'none';
    this.boostButton.style.display = 'none';
  }

  #bindMobileInput() {
    const zone = this.joystickZone;
    const knob = this.joystickInner;
    const radius = 70;
    const maxDist = radius - 25;
    let lastDirEmit = 0;

    const emitDirection = (angle) => {
      if (this.escMenuOpen || !this.player) return;
      const now = performance.now();
      if (now - lastDirEmit < 33) return;
      lastDirEmit = now;
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const dirLen = 200;
      const rawX = centerX + Math.cos(angle) * dirLen + this.cameraX;
      const rawY = centerY + Math.sin(angle) * dirLen + this.cameraY;
      const mouseX = this.#wrapCoord(rawX, this.worldWidth);
      const mouseY = this.#wrapCoord(rawY, this.worldHeight);
      this.socket.emit('change-dir', { mouseX, mouseY });
    };

    zone.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (this.joystickTouchId !== null) return;
        const touch = e.changedTouches[0];
        this.joystickTouchId = touch.identifier;
        this.joystickActive = true;
      },
      { passive: false },
    );

    zone.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
          if (touch.identifier !== this.joystickTouchId) continue;
          const rect = zone.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          let dx = touch.clientX - cx;
          let dy = touch.clientY - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clampedDist = Math.min(dist, maxDist);
          const angle = Math.atan2(dy, dx);
          const knobX = Math.cos(angle) * clampedDist;
          const knobY = Math.sin(angle) * clampedDist;
          knob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
          if (clampedDist > 5) emitDirection(angle);
        }
      },
      { passive: false },
    );

    const resetJoystick = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier !== this.joystickTouchId) continue;
        this.joystickTouchId = null;
        this.joystickActive = false;
        knob.style.transform = 'translate(-50%, -50%)';
      }
    };

    zone.addEventListener('touchend', resetJoystick, { passive: false });
    zone.addEventListener('touchcancel', resetJoystick, { passive: false });

    const boost = this.boostButton;
    boost.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (this.escMenuOpen || this.isSpaceHeld) return;
        this.isSpaceHeld = true;
        boost.classList.add('active');
        this.speedMusic.currentTime = 0;
        this.speedMusic.volume = 0.1;
        this.speedMusic.play();
        this.socket.emit('player-speed', true);
      },
      { passive: false },
    );

    const stopBoost = (e) => {
      e.preventDefault();
      if (!this.isSpaceHeld) return;
      this.isSpaceHeld = false;
      boost.classList.remove('active');
      this.socket.emit('player-speed', false);
    };

    boost.addEventListener('touchend', stopBoost, { passive: false });
    boost.addEventListener('touchcancel', stopBoost, { passive: false });
  }

  #joinPlayer(name) {
    this.socket.emit('player-join', { name });
  }

  #setupUpdateHandler() {
    const typeMap = ['point', 'tail', 'player'];

    this.socket.on('ded', () => {
      document.querySelector('#deathscreen').style.display = 'flex';
    });

    this.socket.on('update', (data) => {
      const now = performance.now();

      if (data.a) {
        for (const e of data.a) {
          const entity = {
            id: e.i,
            type: typeMap[e.t],
            x: e.x,
            y: e.y,
            size: e.s,
            color: e.c,
            playerId: e.p,
            name: e.n,
            points: e.pt,
          };
          this.entityMap.set(e.i, entity);

          this.prevPositions.set(e.i, { x: e.x, y: e.y, size: e.s });
          this.targetPositions.set(e.i, { x: e.x, y: e.y, size: e.s });

          if (entity.type === 'player' && entity.playerId == this.socket.id) {
            this.player = entity;
          }
        }
      }

      if (data.u) {
        for (const upd of data.u) {
          const entity = this.entityMap.get(upd.i);
          if (!entity) continue;

          const prev = this.targetPositions.get(upd.i) || {
            x: entity.x,
            y: entity.y,
            size: entity.size,
          };
          this.prevPositions.set(upd.i, {
            x: prev.x,
            y: prev.y,
            size: prev.size,
          });

          const newTarget = {
            x: upd.x !== undefined ? upd.x : prev.x,
            y: upd.y !== undefined ? upd.y : prev.y,
            size: upd.s !== undefined ? upd.s : prev.size,
          };
          this.targetPositions.set(upd.i, newTarget);

          if (upd.pt !== undefined) {
            entity.points = upd.pt;
            if (this.player && entity.id === this.player.id) {
              this._uiDirty = true;
            }
          }
        }
      }

      if (data.r) {
        for (const id of data.r) {
          if (this.player && id === this.player.id) {
            this.player = null;
          }
          this.entityMap.delete(id);
          this.prevPositions.delete(id);
          this.targetPositions.delete(id);
        }
      }

      if (data.l) {
        this.leaderboard = data.l;
        this._uiDirty = true;
      }

      this.lastUpdateTime = now;
    });
  }

  #render() {
    requestAnimationFrame((ts) => this.#gameLoop(ts));
  }

  #gameLoop(timestamp) {
    const alpha = Math.min(
      1,
      (performance.now() - this.lastUpdateTime) / SERVER_TICK_MS,
    );

    if (!this.player) {
      this.spectatorX += this.spectatorDX;
      this.spectatorY += this.spectatorDY;
      if (this.spectatorX < 500 || this.spectatorX > this.worldWidth - 500)
        this.spectatorDX *= -1;
      if (this.spectatorY < 500 || this.spectatorY > this.worldHeight - 500)
        this.spectatorDY *= -1;
    }

    this.#cameraFollow(alpha);
    this.#renderFrame(alpha);
    if (this.gameRunning && this._uiDirty) this.#updateUI();

    requestAnimationFrame((ts) => this.#gameLoop(ts));
  }

  #lerp(a, b, t) {
    return a + (b - a) * t;
  }

  #wrapCoord(v, period) {
    return ((v % period) + period) % period;
  }

  #clientToWrappedWorld(clientX, clientY) {
    return {
      mouseX: this.#wrapCoord(clientX + this.cameraX, this.worldWidth),
      mouseY: this.#wrapCoord(clientY + this.cameraY, this.worldHeight),
    };
  }

  #torusLerp(a, b, t, period) {
    let d = b - a;
    if (d > period / 2) d -= period;
    if (d < -period / 2) d += period;
    return a + d * t;
  }

  #forEachTorusCopy(px, py, size, camX, camY, camR, camB, fn) {
    const W = this.worldWidth;
    const H = this.worldHeight;
    const minKx = Math.floor((camX - px - size) / W) - 1;
    const maxKx = Math.ceil((camR - px) / W) + 1;
    const minKy = Math.floor((camY - py - size) / H) - 1;
    const maxKy = Math.ceil((camB - py) / H) + 1;
    for (let kx = minKx; kx <= maxKx; kx++) {
      for (let ky = minKy; ky <= maxKy; ky++) {
        const x = px + kx * W;
        const y = py + ky * H;
        if (x + size <= camX || x >= camR || y + size <= camY || y >= camB) continue;
        fn(x, y);
      }
    }
  }

  #drawTiledBackground(camX, camY, camR, camB) {
    const W = this.worldWidth;
    const H = this.worldHeight;
    const minKx = Math.floor(camX / W) - 1;
    const maxKx = Math.ceil(camR / W) + 1;
    const minKy = Math.floor(camY / H) - 1;
    const maxKy = Math.ceil(camB / H) + 1;
    for (let kx = minKx; kx <= maxKx; kx++) {
      for (let ky = minKy; ky <= maxKy; ky++) {
        const ox = kx * W;
        const oy = ky * H;
        this.ctx.fillStyle = 'rgb(18, 18, 18)';
        this.ctx.fillRect(ox, oy, W, H);
      }
    }
    const step = 160;
    const gx0 = Math.floor(camX / step) * step;
    const gy0 = Math.floor(camY / step) * step;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    for (let x = gx0; x <= camR + step; x += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, camY);
      this.ctx.lineTo(x, camB);
      this.ctx.stroke();
    }
    for (let y = gy0; y <= camB + step; y += step) {
      this.ctx.beginPath();
      this.ctx.moveTo(camX, y);
      this.ctx.lineTo(camR, y);
      this.ctx.stroke();
    }
  }

  #getRenderPos(entity, alpha) {
    const prev = this.prevPositions.get(entity.id);
    const target = this.targetPositions.get(entity.id);
    if (!prev || !target)
      return { x: entity.x, y: entity.y, size: entity.size };
    const W = this.worldWidth;
    const H = this.worldHeight;
    return {
      x: this.#torusLerp(prev.x, target.x, alpha, W),
      y: this.#torusLerp(prev.y, target.y, alpha, H),
      size: this.#lerp(prev.size, target.size, alpha),
    };
  }

  #renderFrame(alpha) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.ctx.save();
    this.ctx.translate(-this.cameraX, -this.cameraY);

    const camX = this.cameraX;
    const camY = this.cameraY;
    const camR = camX + this.canvas.width;
    const camB = camY + this.canvas.height;

    this.#drawTiledBackground(camX, camY, camR, camB);

    const players = [];
    const labeledPlayerIds = new Set();

    for (const entity of this.entityMap.values()) {
      const pos = this.#getRenderPos(entity, alpha);
      const { size } = pos;
      this.#forEachTorusCopy(
        pos.x,
        pos.y,
        size,
        camX,
        camY,
        camR,
        camB,
        (x, y) => {
          this.ctx.fillStyle = entity.color;
          this.ctx.fillRect(x, y, size, size);
          if (
            entity.type === 'player' &&
            entity.name &&
            !labeledPlayerIds.has(entity.id)
          ) {
            labeledPlayerIds.add(entity.id);
            players.push({ entity, x, y, size });
          }
        },
      );
    }

    for (const { entity, x, y, size } of players) {
      if (entity.name) {
        const fontSize = Math.max(12, size * 0.8);
        const nameOffset = size + 8;

        this.ctx.save();
        this.ctx.font = `${fontSize}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        this.ctx.lineWidth = 2;

        const textX = x + size / 2;
        const textY = y - nameOffset;

        this.ctx.strokeText(entity.name, textX, textY);
        this.ctx.fillText(entity.name, textX, textY);
        this.ctx.restore();
      }
    }

    this.ctx.restore();
  }

  #cameraFollow(alpha) {
    let camX, camY;
    if (this.player) {
      const pos = this.#getRenderPos(this.player, alpha);
      camX = pos.x;
      camY = pos.y;
    } else {
      camX = this.spectatorX;
      camY = this.spectatorY;
    }

    this.cameraX = camX - this.canvas.width / 2;
    this.cameraY = camY - this.canvas.height / 2;
  }

  #updateUI() {
    let htmlString = '';
    for (const [index, player] of this.leaderboard.entries()) {
      htmlString += `<div><b>${index + 1}.</b> ${player.name || 'Brak'}: ${player.points}</div>`;
    }
    this.leaderboardContent.innerHTML = htmlString;

    if (this.player) {
      this.playerPoints.innerHTML = this.player.points || 0;
      this.name.innerHTML = this.player.name || 'Brak';
    }

    this._uiDirty = false;
  }

  async #loadData() {
    const req = await axios.get('/state');
    if (req.status == 200) {
      const { data } = await axios.get('/game-data');
      this.worldWidth = data.width;
      this.worldHeight = data.height;
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      return true;
    } else {
      return this.#loadData();
    }
  }

  #startPingInterval() {
    this.pingIntervalId = setInterval(() => {
      this.pingStart = Date.now();
      this.socket.emit('ping-check');
    }, 2000);
  }

  #updatePingDisplay() {
    if (!this.pingElement) return;

    let color;
    if (this.ping < 100) {
      color = '#22c55e';
    } else if (this.ping <= 200) {
      color = '#eab308';
    } else {
      color = '#ef4444';
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
    this.leaderboardElement.style.display = 'none';
    this.menu.style.display = 'flex';
    this.#hideMobileControls();
    clearInterval(this.pingIntervalId);
    this.socket.disconnect();
    this.socket = io('');
    this.entityMap.clear();
    this.prevPositions.clear();
    this.targetPositions.clear();
    this.player = null;
    this.spectatorX = Math.random() * this.worldWidth;
    this.spectatorY = Math.random() * this.worldHeight;
    this.spectatorDX =
      (Math.random() > 0.5 ? 1 : -1) * (0.3 + Math.random() * 0.3);
    this.spectatorDY =
      (Math.random() > 0.5 ? 1 : -1) * (0.2 + Math.random() * 0.2);
    this.socket.on('pong-check', () => {
      this.ping = Date.now() - this.pingStart;
      this.#updatePingDisplay();
    });
    this.#startPingInterval();
    this.#setupUpdateHandler();
  }
}
