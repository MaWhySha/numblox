// Numblox · Configuración global

export const CONFIG = {
    GAME: {
        LANES: 5,
        SPAWN_INTERVAL: 2500, // Milisegundos entre cada número
        FALL_SPEED: 2.5,
        MAX_LIVES: 5,
        MIN_DIGIT: 0,         // Solo caen burbujas del 0 al 9
        MAX_DIGIT: 9,
        DANGER_LINE_RATIO: 0.12, // Altura de la línea roja (fracción desde arriba del tablero)
        DANGER_SECONDS: 5        // Segundos de margen tocando la línea antes de perder
    },
    GFX: {
        GLOBAL_SCALE: 1.0,     // Aumenta o disminuye para escalar los objetos
        SHAPE_TYPE: 'circle',  // 'circle' o 'rect' (también define el área de toque)
        BORDER_WIDTH: 4,

        // Diseño base de la burbuja (se usa cuando NO hay sprite en la nube)
        DEFAULT_BUBBLE_FILL: '#ffffff',
        DEFAULT_BUBBLE_BORDER: '#000000',
        DEFAULT_TEXT_COLOR: '#000000',
        USE_NUMBER_COLORS: false, // true = usa COLORS en lugar del relleno blanco

        LIFE_SIZE: 36,         // Tamaño estándar (px CSS) de cada vida. Subir PNG de 128x128

        // Interruptor general: false = ignora todos los sprites de Firebase
        USE_SPRITES: true,

        COLORS: {
            1: '#ff4d6d', 2: '#ff9f4d', 3: '#ffe14d',
            4: '#9dff4d', 5: '#4dffb8', 6: '#4dd2ff',
            7: '#4d79ff', 8: '#a94dff', 9: '#ff4dde',
            0: '#00f5d4'
        }
    },
    ASSETS: {
        COLLECTION: 'visuals',     // Firestore: visuals/<clave> (una imagen optimizada por documento)
        MAX_FILE_MB: 10,           // Peso máximo del archivo original; se comprime automáticamente al subirlo
        BOOT_TIMEOUT_MS: 3000      // Espera máxima por los sprites antes de mostrar el juego
    }
};

// Claves de las vidas: life1 ... life5
export const LIFE_KEYS = Array.from({ length: CONFIG.GAME.MAX_LIVES }, (_, i) => `life${i + 1}`);

// Catálogo de elementos personalizables (alimenta el panel y el motor de assets)
// kind: 'background' (cubre el área sin deformar) | 'sprite' (PNG con transparencia)
export const SPRITE_SLOTS = [
    {
        key: 'bgMenu', group: 'Pantallas', kind: 'background',
        label: 'Fondo de la pantalla de inicio',
        hint: 'Imagen completa · recomendado 1920×1080'
    },
    {
        key: 'bgModes', group: 'Pantallas', kind: 'background',
        label: 'Fondo de selección de modos',
        hint: 'Imagen completa · recomendado 1920×1080'
    },
    {
        key: 'bgGameLeft', group: 'Modo Clásico', kind: 'background',
        label: 'Fondo zona de juego (izquierda)',
        hint: 'Recomendado 1344×1080 · se centra y recorta sin deformar'
    },
    {
        key: 'bgGameRight', group: 'Modo Clásico', kind: 'background',
        label: 'Fondo panel lateral (derecha)',
        hint: 'Recomendado 576×1080 · se centra y recorta sin deformar'
    },
    ...Array.from({ length: 10 }, (_, n) => ({
        key: `bubble${n}`, group: 'Burbujas numéricas', kind: 'sprite',
        label: `Burbuja ${n}`,
        hint: 'PNG transparente · 256×256'
    })),
    ...LIFE_KEYS.map((key, i) => ({
        key, group: 'Vidas', kind: 'sprite',
        label: `Vida ${i + 1}`,
        hint: 'PNG transparente cuadrado · 128×128'
    })),
    {
        key: 'btnPlay', group: 'Botones', kind: 'sprite',
        label: 'Botón JUGAR',
        hint: 'PNG transparente · recomendado 600×200 (conserva su proporción)'
    }
];