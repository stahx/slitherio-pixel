export const calculatePlayerSize = (player) => {
  return player.points * 10;
};

export const calculatePlayerSpeed = (player) => {
  return player.speed ? 2.3 : 1.3;
};

export const calculatePlayerDirection = (player) => {
  return player.direction;
};

export const calculatePlayerPosition = (player) => {
  return player.position;
};

export const calculatePlayerNewSize = (player) => {
  return player.size < 49
    ? (player.points < 10 ? 10 : player.points) * 1.05
    : player.size;
};
