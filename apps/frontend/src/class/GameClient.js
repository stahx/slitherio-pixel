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
    this.themeToggle = document.querySelector('#theme-toggle');
    this.pingElement = document.querySelector('#ping-value');
    this.fpsElement = document.querySelector('#fps-value');
    this._fpsFrameCount = 0;
    this._fpsLastTime = 0;
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
    this.#createMinimap();
    this.#initCanvas();
    if (this.isMobile) this.#createMobileControls();
    this.#syncThemeToggleVisibility();
  }

  #syncThemeToggleVisibility() {
    if (!this.themeToggle) return;
    const show = !this.gameRunning || this.escMenuOpen;
    this.themeToggle.style.display = show ? 'flex' : 'none';
  }

  #createMinimap() {
    const wrapper = document.createElement('div');
    wrapper.id = 'minimap-wrapper';
    const mc = document.createElement('canvas');
    mc.id = 'minimap';
    const size = this.isMobile ? 100 : 160;
    mc.width = size;
    mc.height = size;
    wrapper.appendChild(mc);
    document.body.appendChild(wrapper);

    const toggle = document.createElement('button');
    toggle.id = 'minimap-toggle';
    toggle.textContent = 'M';
    document.body.appendChild(toggle);

    this.minimapWrapper = wrapper;
    this.minimapCanvas = mc;
    this.minimapCtx = mc.getContext('2d');
    this.minimapToggle = toggle;
    this.minimapVisible = true;

    mc.addEventListener('click', () => {
      this.minimapVisible = false;
      wrapper.style.display = 'none';
      toggle.style.display = 'flex';
    });

    toggle.addEventListener('click', () => {
      this.minimapVisible = true;
      wrapper.style.display = 'block';
      toggle.style.display = 'none';
    });
  }

  #drawMinimap() {
    if (!this.minimapVisible || !this.gameRunning) return;

    const mc = this.minimapCanvas;
    const mctx = this.minimapCtx;
    const w = mc.width;
    const h = mc.height;
    const scaleX = w / this.worldWidth;
    const scaleY = h / this.worldHeight;

    mctx.clearRect(0, 0, w, h);

    const cs = getComputedStyle(document.documentElement);
    const surfaceColor = cs.getPropertyValue('--canvas-tile-fill').trim() || '#121214';
    mctx.fillStyle = surfaceColor;
    mctx.fillRect(0, 0, w, h);

    mctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    mctx.lineWidth = 1;
    mctx.strokeRect(0, 0, w, h);

    for (const entity of this.entityMap.values()) {
      const mx = entity.x * scaleX;
      const my = entity.y * scaleY;

      if (entity.type === 'point') {
        const c = entity.color || '#ffffff';
        const r = parseInt(c.slice(1, 3), 16) || 255;
        const g = parseInt(c.slice(3, 5), 16) || 255;
        const b = parseInt(c.slice(5, 7), 16) || 255;
        mctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
        mctx.fillRect(mx, my, 2, 2);
      } else if (entity.type === 'tail') {
        mctx.fillStyle = entity.color;
        mctx.fillRect(mx, my, 2, 2);
      } else if (entity.type === 'player') {
        mctx.fillStyle = entity.color;
        mctx.fillRect(mx - 1, my - 1, 3, 3);
      }
    }

    if (this.player) {
      const px = this.player.x * scaleX;
      const py = this.player.y * scaleY;
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(px - 2, py - 2, 5, 5);

      const vx = this.cameraX * scaleX;
      const vy = this.cameraY * scaleY;
      const vw = this.canvas.width * scaleX;
      const vh = this.canvas.height * scaleY;
      mctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      mctx.lineWidth = 1;
      mctx.strokeRect(vx, vy, vw, vh);
    }
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
    this.#syncThemeToggleVisibility();
    if (this.minimapVisible) {
      this.minimapWrapper.style.display = 'block';
      this.minimapToggle.style.display = 'none';
    } else {
      this.minimapWrapper.style.display = 'none';
      this.minimapToggle.style.display = 'flex';
    }
  }

  #createMobileControls() {
    const joystickZone = document.createElement('div');
    joystickZone.id = 'joystick-zone';
    const outer = document.createElement('div');
    outer.id = 'joystick-outer';
    const inner = document.createElement('div');
    inner.id = 'joystick-inner';
    document.body.appendChild(joystickZone);
    document.body.appendChild(outer);
    document.body.appendChild(inner);

    const boostBtn = document.createElement('div');
    boostBtn.id = 'boost-button';
    boostBtn.textContent = 'BOOST';
    document.body.appendChild(boostBtn);

    this.joystickZone = joystickZone;
    this.joystickOuter = outer;
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
    const joystickOuter = this.joystickOuter;
    const maxDist = 55;
    let lastDirEmit = 0;
    let originX = 0;
    let originY = 0;

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
        originX = touch.clientX;
        originY = touch.clientY;
        joystickOuter.style.left = `${originX - 70}px`;
        joystickOuter.style.top = `${originY - 70}px`;
        joystickOuter.style.opacity = '1';
        knob.style.left = `${originX}px`;
        knob.style.top = `${originY}px`;
        knob.style.transform = 'translate(-50%, -50%)';
      },
      { passive: false },
    );

    zone.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
          if (touch.identifier !== this.joystickTouchId) continue;
          let dx = touch.clientX - originX;
          let dy = touch.clientY - originY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clampedDist = Math.min(dist, maxDist);
          const angle = Math.atan2(dy, dx);
          const knobX = Math.cos(angle) * clampedDist;
          const knobY = Math.sin(angle) * clampedDist;
          knob.style.left = `${originX + knobX}px`;
          knob.style.top = `${originY + knobY}px`;
          knob.style.transform = 'translate(-50%, -50%)';
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
        joystickOuter.style.opacity = '0';
        knob.style.transform = 'translate(-50%, -50%)';
        knob.style.left = `${originX}px`;
        knob.style.top = `${originY}px`;
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

  #resetState() {
    this.entityMap.clear();
    this.prevPositions.clear();
    this.targetPositions.clear();
    this.leaderboard = [];
    this.player = null;
    this.isSpaceHeld = false;
    this._uiDirty = false;
    this._fpsFrameCount = 0;
    this._fpsLastTime = 0;
    this.minimapVisible = true;
  }

  #joinPlayer(name) {
    this.#resetState();
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
            color: e.c,
            playerId: e.p,
            name: e.n,
            points: e.pt,
          };
          if (e.s !== undefined) entity.size = e.s;
          if (e.a !== undefined) entity.angle = e.a;
          this.entityMap.set(e.i, entity);

          const sz = typeMap[e.t] === 'tail' ? 0 : (e.s || 10);
          const ang = e.a !== undefined ? e.a : 0;
          this.prevPositions.set(e.i, { x: e.x, y: e.y, size: sz, angle: ang });
          this.targetPositions.set(e.i, { x: e.x, y: e.y, size: sz, angle: ang });

          if (entity.type === 'player' && entity.playerId == this.socket.id) {
            this.player = entity;
          }
        }
      }

      if (data.u) {
        const alphaCatchUp = Math.min(
          1,
          (performance.now() - this.lastUpdateTime) / SERVER_TICK_MS,
        );
        const W = this.worldWidth;
        const H = this.worldHeight;
        for (const upd of data.u) {
          const entity = this.entityMap.get(upd.i);
          if (!entity) continue;

          const prevT = this.targetPositions.get(upd.i) || {
            x: entity.x,
            y: entity.y,
            size: entity.size,
          };
          const prevP = this.prevPositions.get(upd.i);

          let snapX = prevT.x;
          let snapY = prevT.y;
          let snapSize = prevT.size;
          let snapAngle = prevT.angle || 0;
          if (prevP) {
            snapX = this.#lerp(prevP.x, prevT.x, alphaCatchUp);
            snapY = this.#lerp(prevP.y, prevT.y, alphaCatchUp);
            if (entity.type !== 'tail') {
              snapSize = this.#lerp(prevP.size, prevT.size, alphaCatchUp);
            }
            if (prevP.angle !== undefined && prevT.angle !== undefined) {
              snapAngle = this.#angleLerp(prevP.angle, prevT.angle, alphaCatchUp);
            }
          }

          this.prevPositions.set(upd.i, {
            x: snapX,
            y: snapY,
            size: entity.type === 'tail' ? 0 : snapSize,
            angle: snapAngle,
          });

          let targetUwX = prevT.x;
          let targetUwY = prevT.y;
          if (entity.type === 'tail') {
            if (upd.x !== undefined) targetUwX = upd.x;
            if (upd.y !== undefined) targetUwY = upd.y;
          } else {
            if (upd.x !== undefined) {
              targetUwX = this.#liftCanonicalNear(snapX, upd.x, W);
            }
            if (upd.y !== undefined) {
              targetUwY = this.#liftCanonicalNear(snapY, upd.y, H);
            }
          }

          const newTarget = {
            x: targetUwX,
            y: targetUwY,
            size:
              entity.type === 'tail'
                ? 0
                : upd.s !== undefined
                  ? upd.s
                  : prevT.size,
            angle: upd.a !== undefined ? upd.a : (prevT.angle || 0),
          };
          this.targetPositions.set(upd.i, newTarget);

          if (upd.x !== undefined) entity.x = upd.x;
          if (upd.y !== undefined) entity.y = upd.y;
          if (upd.s !== undefined && entity.type !== 'tail') entity.size = upd.s;
          if (upd.a !== undefined) entity.angle = upd.a;

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
    this._fpsFrameCount++;
    if (this._fpsLastTime === 0) {
      this._fpsLastTime = timestamp;
    } else {
      const elapsed = timestamp - this._fpsLastTime;
      if (elapsed >= 500) {
        const fps = Math.round((this._fpsFrameCount / elapsed) * 1000);
        if (this.fpsElement) this.fpsElement.textContent = `${fps} fps`;
        this._fpsFrameCount = 0;
        this._fpsLastTime = timestamp;
      }
    }

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

  #angleLerp(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  #torusLerp(a, b, t, period) {
    let d = b - a;
    if (d > period / 2) d -= period;
    if (d < -period / 2) d += period;
    return a + d * t;
  }

  #liftCanonicalNear(snapUw, canon, period) {
    return canon + Math.round((snapUw - canon) / period) * period;
  }

  #forEachTorusCopy(px, py, size, camX, camY, camR, camB, fn) {
    const W = this.worldWidth;
    const H = this.worldHeight;
    const camCx = (camX + camR) / 2;
    const camCy = (camY + camB) / 2;
    const baseX = px + Math.round((camCx - px) / W) * W;
    const baseY = py + Math.round((camCy - py) / H) * H;
    for (let kx = -1; kx <= 1; kx++) {
      for (let ky = -1; ky <= 1; ky++) {
        const x = baseX + kx * W;
        const y = baseY + ky * H;
        if (x + size <= camX || x >= camR || y + size <= camY || y >= camB) continue;
        fn(x, y);
      }
    }
  }

  #drawTiledBackground(camX, camY, camR, camB) {
    const W = this.worldWidth;
    const H = this.worldHeight;
    const cs = getComputedStyle(document.documentElement);
    const tileFill =
      cs.getPropertyValue('--canvas-tile-fill').trim() || '#121214';
    const gridStroke =
      cs.getPropertyValue('--canvas-grid').trim() ||
      'rgba(255, 255, 255, 0.035)';
    const wrapBorder =
      cs.getPropertyValue('--canvas-wrap-border').trim() ||
      'rgba(251, 146, 60, 0.95)';
    const wrapWarn =
      cs.getPropertyValue('--canvas-wrap-warning').trim() ||
      'rgba(249, 115, 22, 0.22)';
    const WARN = 220;
    const minKx = Math.floor(camX / W) - 1;
    const maxKx = Math.ceil(camR / W) + 1;
    const minKy = Math.floor(camY / H) - 1;
    const maxKy = Math.ceil(camB / H) + 1;
    for (let kx = minKx; kx <= maxKx; kx++) {
      for (let ky = minKy; ky <= maxKy; ky++) {
        const ox = kx * W;
        const oy = ky * H;
        this.ctx.fillStyle = tileFill;
        this.ctx.fillRect(ox, oy, W, H);
      }
    }
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(camX, camY, camR - camX, camB - camY);
    this.ctx.clip();
    for (let kx = minKx; kx <= maxKx; kx++) {
      for (let ky = minKy; ky <= maxKy; ky++) {
        const ox = kx * W;
        const oy = ky * H;
        let g = this.ctx.createLinearGradient(ox, oy, ox + WARN, oy);
        g.addColorStop(0, wrapWarn);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        this.ctx.fillStyle = g;
        this.ctx.fillRect(ox, oy, WARN, H);
        g = this.ctx.createLinearGradient(ox + W - WARN, oy, ox + W, oy);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, wrapWarn);
        this.ctx.fillStyle = g;
        this.ctx.fillRect(ox + W - WARN, oy, WARN, H);
        g = this.ctx.createLinearGradient(ox, oy, ox, oy + WARN);
        g.addColorStop(0, wrapWarn);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        this.ctx.fillStyle = g;
        this.ctx.fillRect(ox, oy, W, WARN);
        g = this.ctx.createLinearGradient(ox, oy + H - WARN, ox, oy + H);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, wrapWarn);
        this.ctx.fillStyle = g;
        this.ctx.fillRect(ox, oy + H - WARN, W, WARN);
      }
    }
    this.ctx.restore();
    this.ctx.strokeStyle = wrapBorder;
    this.ctx.lineWidth = 5;
    this.ctx.lineJoin = 'miter';
    for (let kx = minKx; kx <= maxKx; kx++) {
      for (let ky = minKy; ky <= maxKy; ky++) {
        const ox = kx * W;
        const oy = ky * H;
        this.ctx.strokeRect(ox + 2.5, oy + 2.5, W - 5, H - 5);
      }
    }
    const step = 160;
    const gx0 = Math.floor(camX / step) * step;
    const gy0 = Math.floor(camY / step) * step;
    this.ctx.strokeStyle = gridStroke;
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

  #findPlayerByPlayerId(playerId) {
    for (const e of this.entityMap.values()) {
      if (e.type === 'player' && e.playerId === playerId) return e;
    }
    return null;
  }

  #getRenderPos(entity, alpha) {
    if (entity.type === 'tail') {
      const owner = this.#findPlayerByPlayerId(entity.playerId);
      const osize = owner ? this.#getRenderPos(owner, alpha).size : 10;
      const prev = this.prevPositions.get(entity.id);
      const target = this.targetPositions.get(entity.id);
      if (!prev || !target) {
        return { x: entity.x, y: entity.y, size: osize };
      }
      const W = this.worldWidth;
      const H = this.worldHeight;
      const tx = this.#torusLerp(prev.x, target.x, alpha, W);
      const ty = this.#torusLerp(prev.y, target.y, alpha, H);
      if (!owner) return { x: tx, y: ty, size: osize };
      const refPos = this.#getRenderPos(owner, alpha);
      return {
        x: tx + Math.round((refPos.x - tx) / W) * W,
        y: ty + Math.round((refPos.y - ty) / H) * H,
        size: osize,
      };
    }

    const prev = this.prevPositions.get(entity.id);
    const target = this.targetPositions.get(entity.id);
    if (!prev || !target)
      return { x: entity.x, y: entity.y, size: entity.size, angle: entity.angle || 0 };
    return {
      x: this.#lerp(prev.x, target.x, alpha),
      y: this.#lerp(prev.y, target.y, alpha),
      size: this.#lerp(prev.size, target.size, alpha),
      angle: this.#angleLerp(prev.angle || 0, target.angle || 0, alpha),
    };
  }

  #darkenColor(hex, factor) {
    if (!hex || hex.length < 7) return hex || '#000000';
    const r = Math.max(0, Math.round(parseInt(hex.slice(1, 3), 16) * factor));
    const g = Math.max(0, Math.round(parseInt(hex.slice(3, 5), 16) * factor));
    const b = Math.max(0, Math.round(parseInt(hex.slice(5, 7), 16) * factor));
    return `#${(r | 0).toString(16).padStart(2, '0')}${(g | 0).toString(16).padStart(2, '0')}${(b | 0).toString(16).padStart(2, '0')}`;
  }

  #lightenColor(hex, factor) {
    if (!hex || hex.length < 7) return hex || '#ffffff';
    const ri = parseInt(hex.slice(1, 3), 16) || 0;
    const gi = parseInt(hex.slice(3, 5), 16) || 0;
    const bi = parseInt(hex.slice(5, 7), 16) || 0;
    const r = Math.min(255, Math.round(ri + (255 - ri) * factor));
    const g = Math.min(255, Math.round(gi + (255 - gi) * factor));
    const b = Math.min(255, Math.round(bi + (255 - bi) * factor));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  #drawSnakeSegment(cx, cy, radius, color, borderColor) {
    const r = Math.max(1, Math.floor(radius));
    const px = Math.floor(radius * 0.25);

    this.ctx.fillStyle = borderColor;
    this.ctx.fillRect(cx - r, cy - r + px, r * 2, r * 2 - px * 2);
    this.ctx.fillRect(cx - r + px, cy - r, r * 2 - px * 2, r * 2);

    const inner = Math.max(1, r - px);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(cx - inner, cy - inner, inner * 2, inner * 2);
  }

  #drawSnakeBody(segments, color, size, camX, camY, camR, camB) {
    if (segments.length === 0) return;

    const radius = size * 0.55;
    const borderColor = this.#darkenColor(color, 0.6);
    const bodyColor = color;
    const bellyColor = this.#lightenColor(color, 0.25);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const cx = seg.x + size / 2;
      const cy = seg.y + size / 2;

      this.#forEachTorusCopy(seg.x, seg.y, size, camX, camY, camR, camB, (x, y) => {
        const drawCx = x + size / 2;
        const drawCy = y + size / 2;
        this.#drawSnakeSegment(drawCx, drawCy, radius, bodyColor, borderColor);
      });
    }

    const gapThreshold = size * 3;
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i];
      const b = segments[i + 1];
      const acx = a.x + size / 2;
      const acy = a.y + size / 2;
      const bcx = b.x + size / 2;
      const bcy = b.y + size / 2;

      const W = this.worldWidth;
      const H = this.worldHeight;
      let dx = bcx - acx;
      let dy = bcy - acy;
      if (dx > W / 2) dx -= W;
      if (dx < -W / 2) dx += W;
      if (dy > H / 2) dy -= H;
      if (dy < -H / 2) dy += H;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > gapThreshold || dist < 0.5) continue;

      const steps = Math.max(1, Math.ceil(dist / (size * 0.4)));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const mx = acx + dx * t;
        const my = acy + dy * t;

        this.#forEachTorusCopy(mx - size / 2, my - size / 2, size, camX, camY, camR, camB, (x, y) => {
          this.#drawSnakeSegment(x + size / 2, y + size / 2, radius * 0.9, bodyColor, borderColor);
        });
      }
    }

    const bellyRadius = Math.max(1, Math.floor(radius * 0.35));
    const px = Math.max(1, Math.floor(radius * 0.25));
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      this.#forEachTorusCopy(seg.x, seg.y, size, camX, camY, camR, camB, (x, y) => {
        const drawCx = x + size / 2;
        const drawCy = y + size / 2;
        this.ctx.fillStyle = bellyColor;
        this.ctx.fillRect(drawCx - bellyRadius, drawCy - bellyRadius + px, bellyRadius * 2, bellyRadius * 2 - px);
      });
    }
  }

  #drawSnakeHead(headPos, size, color, entity, angle, camX, camY, camR, camB) {
    const radius = size * 0.6;
    const borderColor = this.#darkenColor(color, 0.6);

    this.#forEachTorusCopy(headPos.x, headPos.y, size, camX, camY, camR, camB, (x, y) => {
      const cx = x + size / 2;
      const cy = y + size / 2;

      this.#drawSnakeSegment(cx, cy, radius, color, borderColor);

      const eyeOffset = radius * 0.4;
      const eyeSize = Math.max(2, Math.floor(radius * 0.35));
      const pupilSize = Math.max(1, Math.floor(eyeSize * 0.5));

      const perpX = -Math.sin(angle);
      const perpY = Math.cos(angle);
      const fwdX = Math.cos(angle);
      const fwdY = Math.sin(angle);

      const eyeFwd = radius * 0.25;
      for (let side = -1; side <= 1; side += 2) {
        const ex = cx + perpX * eyeOffset * side + fwdX * eyeFwd;
        const ey = cy + perpY * eyeOffset * side + fwdY * eyeFwd;

        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(
          Math.floor(ex - eyeSize / 2),
          Math.floor(ey - eyeSize / 2),
          eyeSize,
          eyeSize,
        );

        const px = ex + fwdX * pupilSize * 0.3;
        const py = ey + fwdY * pupilSize * 0.3;
        this.ctx.fillStyle = '#111111';
        this.ctx.fillRect(
          Math.floor(px - pupilSize / 2),
          Math.floor(py - pupilSize / 2),
          pupilSize,
          pupilSize,
        );
      }
    });
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

    const snakeTails = new Map();
    const playerEntities = new Map();
    const playerPositions = new Map();
    const labelInfos = [];
    const labeledPlayerIds = new Set();

    for (const entity of this.entityMap.values()) {
      if (entity.type === 'point') {
        const pos = this.#getRenderPos(entity, alpha);
        this.#forEachTorusCopy(pos.x, pos.y, pos.size, camX, camY, camR, camB, (x, y) => {
          const px = Math.floor(pos.size * 0.2);
          const innerSize = pos.size - px * 2;
          this.ctx.fillStyle = this.#darkenColor(entity.color, 0.7);
          this.ctx.fillRect(x + px, y, innerSize, pos.size);
          this.ctx.fillRect(x, y + px, pos.size, innerSize);
          this.ctx.fillStyle = entity.color;
          this.ctx.fillRect(x + px, y + px, innerSize, innerSize);
          this.ctx.fillStyle = this.#lightenColor(entity.color, 0.4);
          const hl = Math.max(1, Math.floor(pos.size * 0.25));
          this.ctx.fillRect(x + px + 1, y + px + 1, hl, hl);
        });
        continue;
      }

      if (entity.type === 'tail') {
        const pid = entity.playerId;
        if (!snakeTails.has(pid)) snakeTails.set(pid, []);
        const pos = this.#getRenderPos(entity, alpha);
        snakeTails.get(pid).push({ id: entity.id, x: pos.x, y: pos.y, size: pos.size });
        continue;
      }

      if (entity.type === 'player') {
        const pos = this.#getRenderPos(entity, alpha);
        playerEntities.set(entity.playerId, entity);
        playerPositions.set(entity.playerId, pos);
      }
    }

    for (const [playerId, tails] of snakeTails) {
      tails.sort((a, b) => a.id - b.id);

      const playerEntity = playerEntities.get(playerId);
      const headPos = playerPositions.get(playerId);
      if (!playerEntity || !headPos) {
        for (const seg of tails) {
          this.#forEachTorusCopy(seg.x, seg.y, seg.size, camX, camY, camR, camB, (x, y) => {
            this.ctx.fillStyle = '#888888';
            this.ctx.fillRect(x, y, seg.size, seg.size);
          });
        }
        continue;
      }

      const color = playerEntity.color;
      const size = headPos.size;
      this.#drawSnakeBody(tails, color, size, camX, camY, camR, camB);

      this.#drawSnakeHead(headPos, size, color, playerEntity, headPos.angle, camX, camY, camR, camB);

      if (playerEntity.name && !labeledPlayerIds.has(playerEntity.id)) {
        labeledPlayerIds.add(playerEntity.id);
        this.#forEachTorusCopy(headPos.x, headPos.y, size, camX, camY, camR, camB, (x, y) => {
          if (!labeledPlayerIds.has(playerEntity.id + '_label')) {
            labeledPlayerIds.add(playerEntity.id + '_label');
            labelInfos.push({ entity: playerEntity, x, y, size });
          }
        });
      }
    }

    for (const [playerId, entity] of playerEntities) {
      if (snakeTails.has(playerId)) continue;
      const headPos = playerPositions.get(playerId);
      const color = entity.color;
      const size = headPos.size;

      this.#drawSnakeHead(headPos, size, color, entity, headPos.angle, camX, camY, camR, camB);

      if (entity.name && !labeledPlayerIds.has(entity.id)) {
        labeledPlayerIds.add(entity.id);
        this.#forEachTorusCopy(headPos.x, headPos.y, size, camX, camY, camR, camB, (x, y) => {
          if (!labeledPlayerIds.has(entity.id + '_label')) {
            labeledPlayerIds.add(entity.id + '_label');
            labelInfos.push({ entity, x, y, size });
          }
        });
      }
    }

    for (const { entity, x, y, size } of labelInfos) {
      const fontSize = Math.max(12, size * 0.8);
      const nameOffset = size + 8;

      this.ctx.save();
      this.ctx.font = `bold ${fontSize}px Arial`;
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'bottom';
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      this.ctx.lineWidth = 3;

      const textX = x + size / 2;
      const textY = y - nameOffset;

      this.ctx.strokeText(entity.name, textX, textY);
      this.ctx.fillText(entity.name, textX, textY);
      this.ctx.restore();
    }

    this.ctx.restore();
    this.#drawMinimap();
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
    this.#syncThemeToggleVisibility();
  }

  resumeGame() {
    this.escMenuOpen = false;
    this.escMenu.style.display = 'none';
    this.#syncThemeToggleVisibility();
  }

  returnToMenu() {
    this.gameRunning = false;
    this.escMenuOpen = false;
    this.escMenu.style.display = 'none';
    this.game.style.display = 'none';
    this.leaderboardElement.style.display = 'none';
    this.menu.style.display = 'flex';
    this.#syncThemeToggleVisibility();
    this.#hideMobileControls();
    this.minimapWrapper.style.display = 'none';
    this.minimapToggle.style.display = 'none';
    this.#resetState();
    clearInterval(this.pingIntervalId);
    this.socket.disconnect();
    this.socket = io('');
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
