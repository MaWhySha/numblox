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
        DANGER_SECONDS: 5,       // Segundos de margen tocando la línea antes de perder

        // Modo Velocidad: el intervalo entre apariciones se acorta con el tiempo jugado
        SPEED_MODE: {
            STEP_SECONDS: 10,    // Cada cuántos segundos acelera
            FACTOR: 0.9,         // En cada paso, el intervalo se multiplica por este valor
            MIN_INTERVAL: 600    // Límite: nunca aparece más rápido que esto (ms)
        }
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

        EXPLOSION_FRAMES: 5,     // Frames de la animación al tocar una burbuja (4 a 5)
        EXPLOSION_FRAME_MS: 70,  // Duración de cada frame
        EXPLOSION_SCALE: 1.6,    // Tamaño de la explosión respecto a la burbuja

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
    AUDIO: {
        MAX_BYTES: 700 * 1024,   // Cabe en un documento de Firestore (≈ 1 min a 96 kbps)
        VOLUME: 0.5,             // Música de fondo (0 a 1)
        SFX_VOLUME: 0.8          // Sonido de explosión (0 a 1)
    },
    ASSETS: {
        COLLECTION: 'visuals',     // Firestore: visuals/<clave> (una imagen optimizada por documento)
        MAX_FILE_MB: 10,           // Peso máximo del archivo original; se comprime automáticamente al subirlo
        BOOT_TIMEOUT_MS: 3000      // Espera máxima por los sprites antes de mostrar el juego
    }
};

// Claves de las vidas: life1 ... life5
export const LIFE_KEYS = Array.from({ length: CONFIG.GAME.MAX_LIVES }, (_, i) => `life${i + 1}`);

// Audios personalizables (cada uno se guarda como un documento, igual que las imágenes)
export const AUDIO_KEY = 'audioBgm';   // Música de fondo: bucle, solo durante la partida
export const SFX_KEY = 'audioPop';     // Sonido de explosión: al tocar una burbuja
export const AUDIO_GROUP = 'Audio';
export const AUDIO_SLOTS = [
    {
        key: AUDIO_KEY,
        label: 'Música de fondo (zona de juego)',
        hint: 'Suena en bucle solo durante la partida (≈ 1 minuto a 96 kbps).'
    },
    {
        key: SFX_KEY,
        label: 'Sonido de explosión de burbujas',
        hint: 'Suena junto con la animación al tocar una burbuja. Mejor corto (menos de 2 segundos).'
    }
];
export const AUDIO_KEYS = AUDIO_SLOTS.map((s) => s.key);

// Frames de la explosión: explosion1 ... explosionN (iguales para todas las burbujas)
export const EXPLOSION_KEYS = Array.from({ length: CONFIG.GFX.EXPLOSION_FRAMES }, (_, i) => `explosion${i + 1}`);
export const EXPLOSION_GROUP = 'Animación de explosión';

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
        label: 'Fondo de selección de modos y de ritmo',
        hint: 'Imagen completa · recomendado 1920×1080 · se usa en ambas pantallas'
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
    ...EXPLOSION_KEYS.map((key, i) => ({
        key, group: EXPLOSION_GROUP, kind: 'sprite',
        label: `Frame ${i + 1}`,
        hint: 'PNG transparente · 256×256 · igual para todas las burbujas'
    })),
    {
        key: 'btnPlay', group: 'Botones', kind: 'sprite',
        label: 'Botón JUGAR',
        hint: 'PNG transparente · recomendado 600×200 (conserva su proporción)'
    }
];