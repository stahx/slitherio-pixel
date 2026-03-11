export const getRandomColor = () => {
	return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
};

export const getRandomSize = (min, max) => {
	return Math.floor(Math.random() * (max - min) + min);
};

export const getRandomPosition = (MAP_WIDTH, MAP_HEIGHT) => {
	return {
		x: Math.floor(Math.random() * MAP_WIDTH),
		y: Math.floor(Math.random() * MAP_HEIGHT),
	};
};
