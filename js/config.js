export const CONFIG = {
    GAME: {
        LANES: 5,
        SPAWN_INTERVAL: 2500, // Milisegundos entre cada número
        FALL_SPEED: 2.5,
        MAX_LIVES: 5
    },
    GFX: {
        GLOBAL_SCALE: 1.0,         // Aumenta o disminuye para escalar los objetos
        SHAPE_TYPE: 'circle',      // Opciones: 'circle' o 'rect'
        BORDER_WIDTH: 4,           // Borde grueso para visibilidad
        BORDER_COLOR: '#ffffff',
        TEXT_COLOR: '#ffffff',

        // false = Dibuja formas vectoriales; true = Intenta cargar imágenes
        USE_SPRITES: false,

        COLORS: {
            1: '#ff4d6d', 2: '#ff9f4d', 3: '#ffe14d',
            4: '#9dff4d', 5: '#4dffb8', 6: '#4dd2ff',
            7: '#4d79ff', 8: '#a94dff', 9: '#ff4dde',
            0: '#00f5d4'
        }
    }
};