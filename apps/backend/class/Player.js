import Entity from './Entity.js';

class Player extends Entity {
  constructor(x, y, options = {}) {
    super(x, y, options);
    this.playerId = options.playerId || this.id;
    this.name = options.name || '';
    this.color = options.color || '#ffffff';
    this.size = options.size || 10;
    this.points = options.points || 0;
    this.speed = options.speed || false;
    this.mouseX = options.mouseX || 0;
    this.mouseY = options.mouseY || 0;
    this.diffX = options.diffX || 0;
    this.diffY = options.diffY || 0;
    this.tailCounter = options.tailCounter || 0;
    this.currentAngle = options.currentAngle || Math.random() * Math.PI * 2;
  }
}

export default Player;
