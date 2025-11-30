class Entity {
  constructor(x, y, options = {}) {
    this.x = x;
    this.y = y;
    this.id =
      options.id ||
      `${this.constructor.name.toLowerCase()}-${Date.now()}-${Math.random()}`;
  }

  get type() {
    return this.constructor.name.toLowerCase();
  }
}

export default Entity;
