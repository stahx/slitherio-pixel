import Entity from './Entity.js';

class Tail extends Entity {
  constructor(x, y, options = {}) {
    super(x, y, options);
    this.playerId = options.playerId;
    this.color = options.color || '#ffffff';
  }
}

export default Tail;
