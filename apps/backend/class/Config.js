export default class Config {
  constructor(config) {
    const {
      MAP_WIDTH,
      MAP_HEIGHT,
      POINTS_AMOUNT,
      NORMAL_SPEED,
      BOOST_SPEED,
      TICK_RATE,
      FOG_RADIUS,
      MIN_PLAYERS = 5,
    } = config;

    this.MAP_WIDTH = MAP_WIDTH;
    this.MAP_HEIGHT = MAP_HEIGHT;
    this.POINTS_AMOUNT = POINTS_AMOUNT;
    this.NORMAL_SPEED = NORMAL_SPEED;
    this.BOOST_SPEED = BOOST_SPEED;
    this.TICK_RATE = TICK_RATE;
    this.FOG_RADIUS = FOG_RADIUS;
    this.MIN_PLAYERS = MIN_PLAYERS;
  }
}
