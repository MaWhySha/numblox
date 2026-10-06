// Numblox · Configuración global

export const CONFIG = {
    GAME: {
        LANES: 5,
        SPAWN_INTERVAL: 2500, // Milisegundos entre cada número
        FALL_SPEED: 2.5,
        MAX_LIVES: 5,
        MIN_DIGIT: 0,         // Solo caen burbujas del 0 al 9
        MAX_DIGIT: 9,
        EASE_WITH_STACK: true,       // Ayuda: mientras más llena está una fila, más fácil se pone (ver game.js)
        LANE_CAPACITY: null,         // Burbujas que caben en una fila antes de la línea roja (null = se calcula, ≈ 6)
        SUBTRACT_CHANCE: 0.5,        // Probabilidad de que la operación sea una resta (el resto, suma)
        TARGET_GUARANTEE_SPAWNS: 3,  // Si la respuesta no está en pantalla: tras estas apariciones sin ella, la siguiente es sí o sí la respuesta
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
    VOWELS: {                    // Modo Vocales
        SPAWN_INTERVAL: 6000,    // ms entre filas de 5 burbujas (Zen)
        MIN_INTERVAL: 2500,      // Límite en modo Velocidad (ms)
        WRONG_COSTS_LIFE: true,  // Marcar una vocal equivocada resta una vida (false = solo se marca con X)
        POINTS_PER_VOWEL: 10     // Puntos por cada vocal de la palabra completada
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
export const MENU_KEY = 'audioMenu';   // Música del menú: bucle, en inicio, modos y ritmo
export const AUDIO_VOWELS_KEY = 'audioBgmVowels'; // Música del modo Vocales (si falta, se usa AUDIO_KEY)
export const AUDIO_KEY = 'audioBgm';   // Música de fondo: bucle, solo durante la partida
export const SFX_KEY = 'audioPop';     // Sonido de explosión: al tocar una burbuja
export const AUDIO_GROUP = 'Audio';
export const AUDIO_SLOTS = [
    {
        key: MENU_KEY,
        label: 'Música del menú (inicio, modos y ritmo)',
        hint: 'Suena en bucle desde que se entra a la página y en todo el menú; se detiene al empezar a jugar.'
    },
    {
        key: AUDIO_VOWELS_KEY,
        label: 'Música del modo Vocales',
        hint: 'Suena en bucle durante las partidas de Vocales. Si no subes ninguna, usa la música del modo Números.'
    },
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

/* ---------------- MODO VOCALES: letras y palabras ---------------- */
export const VOWELS = ['A', 'E', 'I', 'O', 'U'];
export const MAX_WORDS = 300; // Debe coincidir con firestore.rules

// Mayúsculas y sin acentos (la Ñ se conserva): "Lápiz" -> "LAPIZ", "niño" -> "NIÑO"
export function normalizeWord(raw) {
    const upper = String(raw).trim().toUpperCase().replace(/Ñ/g, '\u0001');
    return upper.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0001/g, 'Ñ');
}

// Válida: 4 a 6 letras (A-Z y Ñ) y al menos una vocal
export function isValidWord(word) {
    return /^[A-ZÑ]{4,6}$/.test(word) && /[AEIOU]/.test(word);
}

// Cómo la ve el niño: las vocales se ocultan ("CASA" -> "C _ S _")
export function maskWord(word) {
    return word.split('').map((ch) => (VOWELS.includes(ch) ? '_' : ch)).join(' ');
}

// Lista básica: se usa mientras no se personalice desde el editor
export const DEFAULT_WORDS = [
    'CASA', 'MESA', 'GATO', 'PATO', 'LUNA', 'SOPA', 'ROSA', 'MONO', 'PERRO', 'LIBRO',
    'PLATO', 'VASO', 'MANO', 'PELO', 'DEDO', 'BOCA', 'NARIZ', 'FLOR', 'NUBE', 'CAMA',
    'SILLA', 'TAZA', 'LECHE', 'QUESO', 'FRESA', 'MANGO', 'LIMON', 'PERA', 'BALON', 'MUÑECA',
    'PIÑA', 'CARRO', 'TREN', 'AVION', 'BARCO', 'PAJARO', 'LEON', 'VACA', 'CERDO', 'PATA',
    'OREJA', 'CABEZA', 'PIES', 'LAPIZ', 'COLOR', 'PAPEL', 'ROJO', 'AZUL', 'VERDE', 'NEGRO',
    'BLANCO', 'OSITO', 'TORO', 'LOBO', 'RANA', 'ZORRO', 'SAPO', 'CAMION', 'BANCO', 'PUERTA',
    'TECHO', 'PARED', 'GORRO', 'ZAPATO', 'BOTAS', 'CALLE', 'DULCE', 'PASTEL', 'NIÑO', 'NIÑA'
];

// Catálogo de elementos personalizables (alimenta el panel y el motor de assets)
// kind: 'background' (cubre el área sin deformar) | 'sprite' (PNG con transparencia)
export const SPRITE_SLOTS = [
    {
        key: 'bgMenu', group: 'Pantallas', kind: 'background',
        label: 'Fondo de la pantalla de inicio',
        hint: 'Imagen completa · recomendado 1920×1080'
    },
    {
        key: 'logoMenu', group: 'Pantallas', kind: 'sprite',
        label: 'Logo del menú (cuadro sobre el título)',
        hint: 'PNG transparente · recomendado 512×512 (cuadrado, o la proporción que quieras)'
    },
    {
        key: 'bgModes', group: 'Pantallas', kind: 'background',
        label: 'Fondo de selección de modos y de ritmo',
        hint: 'Imagen completa · recomendado 1920×1080 · se usa en ambas pantallas'
    },
    ...[
        ['cardClassic', 'Clásico'],
        ['cardVowels', 'Vocales'],
        ['cardChallenge', 'Desafío (próximamente)'],
        ['cardZen', 'Zen'],
        ['cardSpeed', 'Velocidad']
    ].map(([key, name]) => ({
        key, group: 'Tarjetas de modos', kind: 'sprite',
        label: `Tarjeta: ${name}`,
        hint: 'PNG transparente · recomendado 400×300 · reemplaza toda la tarjeta y conserva su proporción'
    })),
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
    {
        key: 'bgGameOver', group: 'Modo Clásico', kind: 'background',
        label: 'Fondo del panel al perder',
        hint: 'Recomendado 800×600 · se centra y recorta sin deformar (el texto y el botón van encima)'
    },
    ...Array.from({ length: 10 }, (_, n) => ({
        key: `bubble${n}`, group: 'Burbujas numéricas', kind: 'sprite',
        label: `Burbuja ${n}`,
        hint: 'PNG transparente · 256×256'
    })),
    ...VOWELS.map((v) => ({
        key: `vowel${v}`, group: 'Vocales', kind: 'sprite',
        label: `Vocal ${v}`,
        hint: 'PNG transparente · 256×256 · burbuja del modo Vocales'
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