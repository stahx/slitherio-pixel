import Entity from './Entity.js';

class Tail extends Entity {
  constructor(x, y, options = {}) {
    super(x, y, options);
    this.playerId = options.playerId;
    this.color = options.color || '#ffffff';
    this.size = options.size || 10;
  }
}

export default Tail;
