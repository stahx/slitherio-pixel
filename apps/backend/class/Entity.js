let _nextId = 1;

class Entity {
  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.id = options.id || _nextId++;
  }

  get type() {
    return this.constructor.name.toLowerCase();
  }
}

export default Entity;
