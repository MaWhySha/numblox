import {
    CONFIG, EXPLOSION_KEYS, AUDIO_KEY, SFX_KEY, MENU_KEY, AUDIO_VOWELS_KEY,
    VOWELS, DEFAULT_WORDS, normalizeWord, isValidWord
} from './config.js';
import { saveGameMetrics, subscribeWords } from './firebase.js';
import { assets, bindDomSkins } from './assets.js';
import { initAuth } from './panel.js';

// Convierte una data URL (data:audio/...;base64,XXXX) en bytes para decodificarla
function dataUrlToArrayBuffer(dataUrl) {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

class NumbloxGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.lives = CONFIG.GAME.MAX_LIVES;
        this.prevLives = this.lives;
        this.score = 0;
        this.correctAnswers = 0;
        this.wrongAnswers = 0;

        this.bubbles = [];
        this.nextBubbleId = 0;
        this.targetResult = 0;
        this.spawnTimer = null;
        this.laneWidth = 0;
        this.animationFrame = null;
        this.playing = false;
        this.lineY = 0;           // Posición de la línea roja
        this.dangerElapsed = 0;   // ms acumulados con alguna burbuja tocando la línea
        this.lastFrame = 0;
        this.explosions = [];
        this.nextEquationFromBoard = true; // Alterna: tablero / aleatorio
        this.digitBag = [];       // Ronda de aparición: los 10 dígitos barajados
        this.needTarget = false;  // true = la respuesta pedida aún no está en pantalla
        this.missedSpawns = 0;    // Apariciones seguidas que no fueron la respuesta pedida
        this.speedMode = false;   // false = Zen, true = Velocidad
        this.elapsedMs = 0;       // Tiempo jugado (para acelerar en modo Velocidad)
        this.music = null;
        this.musicUrl = null;
        this.audioCtx = null;      // Web Audio: sonido de explosión con baja latencia y sin cortes al solaparse
        this.sfxBuffer = null;
        this.sfxUrl = null;
        this.sfxLoading = false;
        this.leaveTimer = null;    // Temporizador que retira la pantalla anterior tras el fundido
        this.menuMusic = null;     // Música del menú (inicio, modos y ritmo)
        this.menuMusicUrl = null;
        this.inMenu = true;        // false mientras se está en la pantalla de juego
        this.unlockArmed = false;  // Esperando el primer toque del usuario para poder sonar

        // Modo Vocales
        this.selectedMode = 'numbers'; // 'numbers' | 'vowels': lo elige el jugador en la pantalla de modos
        this.mode = 'numbers';         // Modo de la partida en curso
        this.words = DEFAULT_WORDS.slice();
        this.wordsSubscribed = false;
        this.wordBag = [];             // Palabras barajadas: salen todas antes de repetir
        this.currentWord = null;
        this.found = new Set();        // Vocales de la palabra ya marcadas como correctas
        this.wordIndex = 0;            // Nº de palabra (para saber qué errores son de la palabra actual)
        this.celebrating = false;      // true durante la pausa en que la palabra completa se ilumina
        this.celebrateTimer = null;

        this.init();
    }

    init() {
        window.addEventListener('resize', () => { if (this.playing) this.resizeCanvas(); });

        // Flujo: Menú -> Selección de modos -> Selección de ritmo -> Partida
        document.getElementById('btnPlay').addEventListener('click', () => this.showScreen('modesScreen'));
        document.getElementById('btnModeClassic').addEventListener('click', () => {
            this.selectedMode = 'numbers';
            this.syncMusic();
            this.showScreen('difficultyScreen');
        });
        document.getElementById('btnModeVowels').addEventListener('click', () => {
            this.selectedMode = 'vowels';
            this.ensureWordsSub();
            this.syncMusic();
            this.showScreen('difficultyScreen');
        });
        document.getElementById('btnBackToMenu').addEventListener('click', () => this.showScreen('menuScreen'));
        document.getElementById('btnZen').addEventListener('click', () => this.startGame(false));
        document.getElementById('btnSpeed').addEventListener('click', () => this.startGame(true));
        document.getElementById('btnBackToModes').addEventListener('click', () => this.showScreen('modesScreen'));
        document.getElementById('btnGameOverBack').addEventListener('click', () => {
            this.hideGameOver();
            this.showScreen('menuScreen');
        });
        // Seguir jugando: nueva partida con el mismo ritmo (Zen o Velocidad)
        document.getElementById('btnGameOverRetry').addEventListener('click', () => {
            this.startGame(this.speedMode);
        });
        this.canvas.addEventListener('pointerdown', (e) => this.handleInput(e));

        // Personalización dinámica
        bindDomSkins();
        initAuth();
        assets.subscribe(() => {
            this.renderLives(); // Las vidas se redibujan si cambia un sprite
            this.syncMusic();   // y la música se actualiza si cambia el audio
            this.syncSfx();     // igual que el sonido de explosión
            this.syncMenuMusic(); // y la música del menú
        });
        window.__numbloxReady = true; // Señal para el aviso de diagnóstico del index.html
        this.boot();
    }

    // Espera (con límite) a que lleguen los sprites para evitar el "parpadeo" del diseño base
    async boot() {
        assets.start();
        await Promise.race([
            assets.ready,
            new Promise((resolve) => setTimeout(resolve, CONFIG.ASSETS.BOOT_TIMEOUT_MS))
        ]);
        document.body.classList.remove('booting');
    }

    // Fundido cruzado: la pantalla nueva aparece (de transparente a opaca) ENCIMA de la anterior,
    // que se queda visible debajo hasta que termina el fundido. Así nunca se ve un fondo negro intermedio.
    showScreen(id) {
        document.body.classList.toggle('playing', id === 'gameScreen');
        if (id !== 'gameScreen') this.stopMusic(); // La música del juego solo suena en la zona de juego

        // La música del menú suena en todo el menú y se pausa al entrar a jugar
        this.inMenu = id !== 'gameScreen';
        if (this.inMenu) this.playMenuMusic(); else this.stopMenuMusic();

        const screens = Array.from(document.querySelectorAll('.screen'));
        const next = screens.find((s) => s.id === id);
        if (!next) return;

        const current = screens.find((s) => s.classList.contains('active'));
        clearTimeout(this.leaveTimer);
        screens.forEach((s) => s.classList.remove('leaving'));
        if (current === next) return; // Ya está en esa pantalla: nada que animar

        if (current) {
            current.classList.remove('active');
            current.classList.add('leaving'); // Sigue visible debajo mientras entra la nueva
        }
        next.classList.add('active');
        this.leaveTimer = setTimeout(() => {
            screens.forEach((s) => s.classList.remove('leaving'));
        }, 450); // Un poco más que la duración del fundido (0,4 s)
    }

    resizeCanvas() {
        const zone = document.getElementById('gameZone');
        this.canvas.width = zone.clientWidth;
        this.canvas.height = zone.clientHeight;
        this.laneWidth = this.canvas.width / CONFIG.GAME.LANES;
        this.lineY = this.canvas.height * CONFIG.GAME.DANGER_LINE_RATIO;
    }

    startGame(speedMode = false) {
        this.speedMode = speedMode;
        this.mode = this.selectedMode;
        clearTimeout(this.celebrateTimer);
        this.celebrating = false;
        this.hideGameOver();
        this.showScreen('gameScreen');
        this.playing = true;

        this.resizeCanvas();
        this.resetStats();
        this.lastFrame = 0;
        this.elapsedMs = 0;
        this.setupModeUI();
        if (this.mode === 'vowels') {
            this.startNewWord();
            this.spawnRow();           // Primera fila de 5 burbujas
        } else {
            this.generateEquation();
        }

        this.scheduleSpawn();
        this.ensureAudioCtx(); // Dentro del clic del jugador: el navegador permite el audio
        this.syncSfx();
        this.syncMusic();
        this.playMusic();

        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.gameLoop();
    }

    // Intervalo entre apariciones: fijo en Zen; en modo Velocidad se acorta con el tiempo jugado
    currentSpawnInterval() {
        const vowels = this.mode === 'vowels';
        const base = vowels ? CONFIG.VOWELS.SPAWN_INTERVAL : CONFIG.GAME.SPAWN_INTERVAL;
        if (!this.speedMode) return base;
        const { STEP_SECONDS, FACTOR, MIN_INTERVAL } = CONFIG.GAME.SPEED_MODE;
        const min = vowels ? CONFIG.VOWELS.MIN_INTERVAL : MIN_INTERVAL;
        const steps = this.elapsedMs / (STEP_SECONDS * 1000);
        return Math.max(min, base * Math.pow(FACTOR, steps));
    }

    scheduleSpawn() {
        clearTimeout(this.spawnTimer);
        this.spawnTimer = setTimeout(() => {
            if (!this.playing) return;
            if (!this.celebrating) {    // Durante la celebración no aparecen filas nuevas
                if (this.mode === 'vowels') this.spawnRow(); else this.spawnBubble();
            }
            this.scheduleSpawn();
        }, this.currentSpawnInterval());
    }

    // Música: un solo audio en bucle, únicamente durante la partida
    syncMusic() {
        // Modo Vocales: su propia música; si no hay, la misma del modo Números
        const key = (this.selectedMode === 'vowels' && assets.getUrl(AUDIO_VOWELS_KEY)) ? AUDIO_VOWELS_KEY : AUDIO_KEY;
        const url = assets.getUrl(key);
        if (url === this.musicUrl) return;
        this.stopMusic();
        this.musicUrl = url;
        if (!url) { this.music = null; return; }
        this.music = new Audio(url);
        this.music.loop = true;
        this.music.volume = CONFIG.AUDIO.VOLUME;
        if (this.playing) this.playMusic();
    }

    ensureAudioCtx() {
        if (!this.audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            this.audioCtx = new Ctx();
        }
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume().catch(() => { });
    }

    // Decodifica el sonido de explosión una sola vez (cuando cambia el audio en la nube)
    syncSfx() {
        const url = assets.getUrl(SFX_KEY);
        if (url !== this.sfxUrl) {
            this.sfxUrl = url;
            this.sfxBuffer = null;
            this.sfxLoading = false;
        }
        if (!url || this.sfxBuffer || this.sfxLoading || !this.audioCtx) return; // Sin contexto aún: carga al iniciar partida

        this.sfxLoading = true;
        try {
            this.audioCtx.decodeAudioData(dataUrlToArrayBuffer(url))
                .then((buffer) => { if (url === this.sfxUrl) this.sfxBuffer = buffer; })
                .catch((err) => console.warn('No se pudo decodificar el sonido de explosión:', err))
                .finally(() => { this.sfxLoading = false; });
        } catch (err) {
            console.warn('Sonido de explosión no válido:', err);
            this.sfxLoading = false;
        }
    }

    playPopSound() {
        if (!this.sfxBuffer || !this.audioCtx) return;
        const source = this.audioCtx.createBufferSource();
        source.buffer = this.sfxBuffer;
        const gain = this.audioCtx.createGain();
        gain.gain.value = CONFIG.AUDIO.SFX_VOLUME;
        source.connect(gain);
        gain.connect(this.audioCtx.destination);
        source.start();
    }

    playMusic() {
        if (!this.music) return;
        const p = this.music.play();
        if (p && p.catch) p.catch(() => { }); // Si el navegador bloquea el audio, el juego sigue en silencio
    }

    // Música del menú: en bucle desde que se abre la página. Los navegadores solo permiten
    // reproducir audio tras el primer toque o tecla del usuario; si bloquean el inicio
    // automático, arranca en cuanto el usuario toca cualquier cosa (sin salirse del menú).
    syncMenuMusic() {
        const url = assets.getUrl(MENU_KEY);
        if (url === this.menuMusicUrl) return;
        this.stopMenuMusic();
        this.menuMusicUrl = url;
        if (!url) { this.menuMusic = null; return; }
        this.menuMusic = new Audio(url);
        this.menuMusic.loop = true;
        this.menuMusic.volume = CONFIG.AUDIO.VOLUME;
        this.playMenuMusic();
    }

    playMenuMusic() {
        if (!this.menuMusic || !this.inMenu) return; // Durante la partida no suena
        const p = this.menuMusic.play();
        if (p && p.catch) p.catch(() => this.armMenuMusicUnlock());
    }

    stopMenuMusic() {
        if (this.menuMusic) this.menuMusic.pause(); // Pausa: al volver al menú sigue donde iba
    }

    armMenuMusicUnlock() {
        if (this.unlockArmed) return;
        this.unlockArmed = true;
        const unlock = () => {
            document.removeEventListener('click', unlock);
            document.removeEventListener('keydown', unlock);
            this.unlockArmed = false;
            this.playMenuMusic(); // Solo suena si sigue en el menú
        };
        document.addEventListener('click', unlock);
        document.addEventListener('keydown', unlock);
    }

    stopMusic() {
        if (!this.music) return;
        this.music.pause();
        this.music.currentTime = 0;
    }

    resetStats() {
        this.lives = CONFIG.GAME.MAX_LIVES;
        this.prevLives = this.lives;
        this.score = 0;
        this.correctAnswers = 0;
        this.wrongAnswers = 0;
        this.bubbles = [];
        this.dangerElapsed = 0;
        this.explosions = [];
        this.nextEquationFromBoard = true;
        this.digitBag = [];
        this.needTarget = false;
        this.missedSpawns = 0;
        this.wordIndex = 0;
        this.wordBag = [];
        this.currentWord = null;
        this.found = new Set();
        this.updateUI();
    }

    // Etiqueta y estilo del recuadro de la derecha según el modo
    setupModeUI() {
        const vowels = this.mode === 'vowels';
        document.getElementById('cloudLabel').innerText = vowels ? 'Completa la palabra:' : 'Encuentra la respuesta:';
        const word = document.getElementById('targetEquation');
        word.classList.toggle('word-display', vowels);
        word.classList.remove('word-celebrate');
    }

    // El número objetivo alterna entre dos tipos de turno:
    //  - "Tablero": sale de una burbuja que YA está en pantalla (respuesta asegurada).
    //  - "Aleatorio": sale de cualquier dígito, sin garantía de que aparezca pronto;
    //    mientras tanto las burbujas se van acumulando (esa es la tensión).
    // Así no se puede acertar tocando "lo único que hay".
    generateEquation() {
        const wantsBoard = this.nextEquationFromBoard;

        if (wantsBoard && this.bubbles.length > 0) {
            const pool = this.bubbles.map((b) => b.value);
            this.targetResult = pool[Math.floor(Math.random() * pool.length)];
            this.nextEquationFromBoard = false;   // Siguiente turno: aleatorio
        } else {
            const { MIN_DIGIT, MAX_DIGIT } = CONFIG.GAME;
            this.targetResult = MIN_DIGIT + Math.floor(Math.random() * (MAX_DIGIT - MIN_DIGIT + 1));
            if (!wantsBoard) this.nextEquationFromBoard = true; // Siguiente turno: tablero
            // (si tocaba "tablero" pero no había burbujas, el turno "tablero" se conserva para la próxima)
        }

        // Ayuda 1: mientras más llena está la fila más alta, más probable es que el número pedido sea
        // uno de los que están en ella (al acertarlo, la fila baja). Con la fila vacía no hace nada.
        if (CONFIG.GAME.EASE_WITH_STACK && this.bubbles.length > 0) {
            const { lane, level } = this.stackPressure();
            if (Math.random() < level) {
                const inLane = this.bubbles.filter((b) => b.lane === lane).map((b) => b.value);
                this.targetResult = inLane[Math.floor(Math.random() * inLane.length)];
            }
        }

        // Garantía: si la respuesta no está en pantalla, puede salir sola en las próximas
        // apariciones; si pasan TARGET_GUARANTEE_SPAWNS sin que salga, la siguiente es sí o sí ella.
        this.needTarget = !this.bubbles.some((b) => b.value === this.targetResult);
        this.missedSpawns = 0;
        if (this.bubbles.length === 0) this.spawnBubble(); // Tablero vacío: no se queda sin nada en pantalla

        document.getElementById('targetEquation').innerText = this.buildEquationText(this.targetResult);
    }

    // Cuántas burbujas caben en una fila antes de tocar la línea roja (≈ 6)
    laneCapacity() {
        if (CONFIG.GAME.LANE_CAPACITY) return CONFIG.GAME.LANE_CAPACITY;
        const r = Math.min(this.laneWidth * 0.35, 45) * CONFIG.GFX.GLOBAL_SCALE;
        const usable = this.canvas.height - 5 - this.lineY;
        return Math.max(1, Math.floor(usable / (2 * r + 2)));
    }

    // Fila más llena y qué tan cerca está de la línea: level 0 = vacía … 1 = al límite
    stackPressure() {
        const counts = new Array(CONFIG.GAME.LANES).fill(0);
        for (const b of this.bubbles) counts[b.lane]++;
        const max = Math.max(...counts);
        return { lane: counts.indexOf(max), max, level: Math.min(1, max / this.laneCapacity()) };
    }

    // Suma o resta con números de un solo dígito: nunca hay negativos ni cifras de dos dígitos.
    // Aplica igual en modo Zen y en modo Velocidad.
    buildEquationText(result) {
        const { MAX_DIGIT, SUBTRACT_CHANCE } = CONFIG.GAME;
        if (Math.random() < SUBTRACT_CHANCE) {
            const b = Math.floor(Math.random() * (MAX_DIGIT - result + 1)); // 0 .. (9 - resultado)
            return `${result + b} − ${b} = ?`;                              // p. ej. 9 − 0 = ?
        }
        const a = Math.floor(Math.random() * (result + 1));                 // 0 .. resultado
        return `${a} + ${result - a} = ?`;
    }

    // Saca un dígito concreto de la ronda en curso (para que la ronda de 10 no se desbalancee)
    takeDigit(digit) {
        const idx = this.digitBag.indexOf(digit);
        if (idx !== -1) this.digitBag.splice(idx, 1);
        return digit;
    }

    // Rondas de aparición: cada ronda trae los 10 dígitos exactamente una vez, en orden aleatorio
    nextDigit() {
        if (this.digitBag.length === 0) {
            const { MIN_DIGIT, MAX_DIGIT } = CONFIG.GAME;
            const round = [];
            for (let d = MIN_DIGIT; d <= MAX_DIGIT; d++) round.push(d);
            for (let i = round.length - 1; i > 0; i--) { // Barajado Fisher-Yates
                const j = Math.floor(Math.random() * (i + 1));
                [round[i], round[j]] = [round[j], round[i]];
            }
            this.digitBag = round;
        }
        return this.digitBag.pop();
    }

    /* ===================== MODO VOCALES ===================== */

    // La lista de palabras se lee de Firestore solo cuando se entra a este modo (1 lectura)
    ensureWordsSub() {
        if (this.wordsSubscribed) return;
        this.wordsSubscribed = true;
        subscribeWords((list) => {
            const clean = Array.from(new Set((list || []).map(normalizeWord).filter(isValidWord)));
            this.words = clean.length ? clean : DEFAULT_WORDS.slice(); // Lista vacía = lista básica
            this.wordBag = [];
        });
    }

    // Palabras al azar: salen todas antes de repetir (y nunca la misma dos veces seguidas)
    pickWord() {
        if (this.wordBag.length === 0) {
            const bag = this.words.slice();
            for (let i = bag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [bag[i], bag[j]] = [bag[j], bag[i]];
            }
            if (bag.length > 1 && bag[bag.length - 1] === this.currentWord) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
            this.wordBag = bag;
        }
        return this.wordBag.pop();
    }

    startNewWord() {
        this.currentWord = this.pickWord();
        this.found = new Set();
        this.wordIndex++;
        this.renderWord();
        const el = document.getElementById('targetEquation');   // Entrada suave de la palabra nueva
        el.classList.remove('word-enter');
        void el.offsetWidth;
        el.classList.add('word-enter');
    }

    neededVowels() {
        return new Set(this.currentWord.split('').filter((ch) => VOWELS.includes(ch)));
    }

    // Palabra sin vocales; las ya encontradas se ven en su lugar ("C A S _")
    renderWord() {
        const html = this.currentWord.split('').map((ch) => {
            if (!VOWELS.includes(ch)) return `<span class="w-letter">${ch}</span>`;
            return this.found.has(ch) ? `<span class="w-found">${ch}</span>` : '<span class="w-blank">_</span>';
        }).join('');
        document.getElementById('targetEquation').innerHTML = html;
    }

    // Nivel (altura) de una burbuja en la pila. Una "fila" es lo que ve el niño: las burbujas
    // alineadas en horizontal, aunque vengan de apariciones distintas.
    levelOf(b) {
        const r = b.radius * CONFIG.GFX.GLOBAL_SCALE;
        const floor = this.canvas.height - r - 5;
        return Math.round((floor - b.y) / (2 * r + 2));
    }

    // Niveles (filas visibles) que tienen alguna vocal marcada como correcta
    markedLevels() {
        const levels = new Set();
        for (const b of this.bubbles) if (b.mark === 'correct') levels.add(this.levelOf(b));
        return levels;
    }

    // Cada aparición = 5 burbujas a la vez, una por columna, con las 5 vocales en orden aleatorio.
    // Así siempre hay en cada aparición la vocal que se busca.
    spawnRow() {
        const lanes = CONFIG.GAME.LANES;
        const letters = VOWELS.slice();
        for (let i = letters.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letters[i], letters[j]] = [letters[j], letters[i]];
        }
        const radius = Math.min(this.laneWidth * 0.35, 45);
        for (let lane = 0; lane < lanes; lane++) {
            this.bubbles.push({
                id: this.nextBubbleId++,
                lane: lane,
                x: (lane * this.laneWidth) + (this.laneWidth / 2),
                y: -radius,
                radius: radius,
                value: letters[lane % letters.length],
                settled: false,
                kind: 'vowel',
                mark: null         // null | 'correct' (verde) | 'wrong' (roja, solo hasta completar la palabra)
            });
        }
    }

    // Tocar una vocal NO la borra: solo la marca (✓ verde, o roja si es un error)
    handleVowelTap(b) {
        if (this.celebrating) return;   // Mientras la palabra se ilumina no se puede tocar nada
        const needed = this.neededVowels();
        const v = b.value;

        if (b.mark === 'correct') {          // Tocar una correcta la desmarca (por si cambió de idea)
            b.mark = null;
            this.found.delete(v);
            this.renderWord();
            return;
        }

        if (needed.has(v) && !this.found.has(v)) {   // Correcta (o una roja que ahora sí sirve)
            b.mark = 'correct';
            this.found.add(v);
            this.renderWord();
            if (this.found.size === needed.size) this.completeWord();
            return;
        }

        if (b.mark === 'wrong') return;                       // Ya estaba en rojo
        if (needed.has(v) && this.found.has(v)) return;       // Esa vocal ya está marcada en otra fila: se ignora, sin castigo

        b.mark = 'wrong';                    // Error: se pone roja y no pasa al panel de la palabra
        this.wrongAnswers++;
        if (CONFIG.VOWELS.WRONG_COSTS_LIFE) {
            this.lives--;
            this.updateUI();
            if (this.lives <= 0) this.endGame();
        }
    }

    // Palabra completa: primero se queda unos segundos iluminada (con efecto pop) en su panel
    // para que el niño vea cuál era; después se borran las filas y aparece la siguiente.
    completeWord() {
        this.celebrating = true;
        this.score += CONFIG.VOWELS.POINTS_PER_VOWEL * this.neededVowels().size;
        this.correctAnswers++;
        this.updateUI();
        document.getElementById('targetEquation').classList.add('word-celebrate');
        clearTimeout(this.celebrateTimer);
        this.celebrateTimer = setTimeout(() => this.finishWord(), CONFIG.VOWELS.CELEBRATION_MS);
    }

    // Se borran las filas con vocales correctas, con UN solo sonido de pop. Las vocales en rojo se
    // quedan, pero vuelven a verse normales: ya se pueden usar en la palabra siguiente.
    finishWord() {
        this.celebrating = false;
        if (!this.playing) return;
        document.getElementById('targetEquation').classList.remove('word-celebrate');

        // Se borran las filas VISIBLES donde hay una vocal correcta: todas las burbujas a esa altura
        // (también las que antes estuvieron en rojo y ya volvieron a verse normales), salvo las rojas de ahora.
        const levels = this.markedLevels();
        const removed = this.bubbles.filter((b) => levels.has(this.levelOf(b)) && b.mark !== 'wrong');
        removed.forEach((b) => this.spawnExplosion(b));
        this.playPopSound();
        const gone = new Set(removed);
        this.bubbles = this.bubbles.filter((b) => !gone.has(b));
        this.bubbles.forEach((b) => { if (b.mark === 'wrong') b.mark = null; });

        this.startNewWord();
    }

    spawnBubble() {
        const lane = Math.floor(Math.random() * CONFIG.GAME.LANES);
        const baseRadius = Math.min(this.laneWidth * 0.35, 45); // Ajuste dinámico por pantalla
        const x = (lane * this.laneWidth) + (this.laneWidth / 2);
        // Ayuda 2: con cada burbuja más hacia la línea, sube la probabilidad de que la que aparece sea la respuesta
        const eased = CONFIG.GAME.EASE_WITH_STACK && Math.random() < this.stackPressure().level;
        const mustBeTarget = eased || (this.needTarget && this.missedSpawns >= CONFIG.GAME.TARGET_GUARANTEE_SPAWNS);
        const value = mustBeTarget ? this.takeDigit(this.targetResult) : this.nextDigit();

        this.bubbles.push({
            id: this.nextBubbleId++,
            lane: lane,
            x: x,
            y: -baseRadius,
            radius: baseRadius,
            value: value,
            settled: false // true cuando ya no puede seguir cayendo (apilada)
        });

        if (this.needTarget) {
            if (value === this.targetResult) this.needTarget = false; // La respuesta ya está en pantalla
            else this.missedSpawns++;
        }
    }

    updatePhysics() {
        for (let i = 0; i < this.bubbles.length; i++) {
            let b = this.bubbles[i];
            let scaledRadius = b.radius * CONFIG.GFX.GLOBAL_SCALE;
            let targetY = this.canvas.height - scaledRadius - 5; // Suelo

            // Colisión con otras burbujas en el mismo carril
            for (let j = 0; j < this.bubbles.length; j++) {
                let other = this.bubbles[j];
                let otherScaled = other.radius * CONFIG.GFX.GLOBAL_SCALE;

                if (other.id !== b.id && other.lane === b.lane && other.y > b.y) {
                    let stackY = other.y - otherScaled - scaledRadius - 2;
                    if (stackY < targetY) targetY = stackY;
                }
            }

            if (b.y < targetY) {
                b.y += CONFIG.GAME.FALL_SPEED;
                b.settled = false;
            } else {
                b.settled = true;
            }
        }
    }

    // Dibuja una imagen dentro de una caja w×h conservando su proporción (sin deformar)
    drawImageContain(img, x, y, w, h) {
        const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        this.ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }

    drawBubble(b, markedLevels) {
        const ctx = this.ctx;
        const r = b.radius * CONFIG.GFX.GLOBAL_SCALE;
        const sprite = assets.getImage(b.kind === 'vowel' ? `vowel${b.value}` : `bubble${b.value}`);

        // Halo verde: esta burbuja se borrará junto con su fila (la que se ve) al completar la palabra
        if (b.kind === 'vowel' && b.mark !== 'wrong' && markedLevels && markedLevels.has(this.levelOf(b))) {
            ctx.beginPath();
            ctx.arc(b.x, b.y, r + 7, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(46, 204, 113, 0.28)';
            ctx.fill();
        }

        if (sprite) {
            // Con sprite personalizado: solo se dibuja la imagen (sin círculo ni texto)
            this.drawImageContain(sprite, b.x - r, b.y - r, r * 2, r * 2);
        } else {
            // Diseño base: círculo blanco con borde negro y su número o letra
            ctx.beginPath();
            if (CONFIG.GFX.SHAPE_TYPE === 'circle') {
                ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
            } else {
                ctx.rect(b.x - r, b.y - r, r * 2, r * 2);
            }

            ctx.fillStyle = CONFIG.GFX.USE_NUMBER_COLORS
                ? (CONFIG.GFX.COLORS[b.value] || CONFIG.GFX.DEFAULT_BUBBLE_FILL)
                : CONFIG.GFX.DEFAULT_BUBBLE_FILL;
            ctx.fill();

            ctx.lineWidth = CONFIG.GFX.BORDER_WIDTH;
            ctx.strokeStyle = CONFIG.GFX.DEFAULT_BUBBLE_BORDER;
            ctx.stroke();

            ctx.fillStyle = CONFIG.GFX.DEFAULT_TEXT_COLOR;
            ctx.font = `bold ${r}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.value, b.x, b.y);
        }

        if (b.mark) this.drawMark(b, r);
    }

    // Marca del modo Vocales: aro verde con palomita (correcta) o burbuja roja (error)
    drawMark(b, r) {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (b.mark === 'correct') {
            ctx.beginPath();
            ctx.arc(b.x, b.y, r + 2, 0, Math.PI * 2);
            ctx.lineWidth = 6;
            ctx.strokeStyle = '#2ecc71';
            ctx.stroke();

            const bx = b.x + r * 0.72, by = b.y - r * 0.72, br = r * 0.34;   // Insignia con palomita
            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fillStyle = '#2ecc71';
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(bx - br * 0.5, by);
            ctx.lineTo(bx - br * 0.1, by + br * 0.4);
            ctx.lineTo(bx + br * 0.55, by - br * 0.35);
            ctx.lineWidth = Math.max(3, br * 0.3);
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        } else {
            // Error: la burbuja se pone roja (sin X)
            ctx.beginPath();
            ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(231, 76, 60, 0.55)';
            ctx.fill();
            ctx.lineWidth = 5;
            ctx.strokeStyle = '#e74c3c';
            ctx.stroke();
        }
        ctx.restore();
    }

    draw() {
        // El canvas es transparente: el fondo de la zona izquierda lo pone el CSS/sprite
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Guías de carriles
        this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        this.ctx.lineWidth = 2;
        for (let i = 1; i < CONFIG.GAME.LANES; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * this.laneWidth, 0);
            this.ctx.lineTo(i * this.laneWidth, this.canvas.height);
            this.ctx.stroke();
        }

        this.drawDangerLine();
        const markedLevels = this.bubbles.length ? this.markedLevels() : new Set(); // Filas que se borrarán
        for (let b of this.bubbles) this.drawBubble(b, markedLevels);
        this.drawExplosions();
        this.drawDangerCountdown();
    }

    // Explosión al tocar una burbuja: mismos frames para todas, centrados donde estaba la burbuja
    spawnExplosion(b) {
        if (!EXPLOSION_KEYS.some((k) => assets.getImage(k))) return; // Sin frames = sin animación
        this.explosions.push({
            x: b.x,
            y: b.y,
            r: b.radius * CONFIG.GFX.GLOBAL_SCALE,
            start: performance.now()
        });
    }

    drawExplosions() {
        if (this.explosions.length === 0) return;
        const now = performance.now();
        const frameMs = CONFIG.GFX.EXPLOSION_FRAME_MS;
        const frames = EXPLOSION_KEYS.map((k) => assets.getImage(k)).filter(Boolean); // Solo frames subidos, en orden

        this.explosions = this.explosions.filter((e) => Math.floor((now - e.start) / frameMs) < frames.length);
        for (const e of this.explosions) {
            const img = frames[Math.floor((now - e.start) / frameMs)];
            const half = e.r * CONFIG.GFX.EXPLOSION_SCALE;
            this.drawImageContain(img, e.x - half, e.y - half, half * 2, half * 2);
        }
    }

    // Una burbuja apilada que toca la línea inicia la cuenta regresiva; si se libera, se reinicia
    updateDanger(dt) {
        if (this.celebrating) return;   // La cuenta de la línea roja se congela mientras se celebra la palabra
        const scale = CONFIG.GFX.GLOBAL_SCALE;
        const touching = this.bubbles.some((b) => b.settled && (b.y - b.radius * scale) <= this.lineY);

        if (touching) {
            this.dangerElapsed += dt;
            if (this.dangerElapsed >= CONFIG.GAME.DANGER_SECONDS * 1000) this.endGame('stack');
        } else {
            this.dangerElapsed = 0;
        }
    }

    drawDangerLine() {
        const ctx = this.ctx;
        const inDanger = this.dangerElapsed > 0;
        const pulse = Math.abs(Math.sin(performance.now() / 150));

        // Zona de peligro
        ctx.fillStyle = inDanger ? `rgba(255, 0, 0, ${0.1 + pulse * 0.15})` : 'rgba(255, 60, 60, 0.07)';
        ctx.fillRect(0, 0, this.canvas.width, this.lineY);

        // Línea roja
        ctx.save();
        ctx.setLineDash([14, 8]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ff2d2d';
        ctx.globalAlpha = inDanger ? 0.5 + pulse * 0.5 : 1;
        ctx.beginPath();
        ctx.moveTo(0, this.lineY);
        ctx.lineTo(this.canvas.width, this.lineY);
        ctx.stroke();
        ctx.restore();
    }

    drawDangerCountdown() {
        if (this.dangerElapsed <= 0) return;
        const ctx = this.ctx;
        const remaining = Math.max(1, Math.ceil((CONFIG.GAME.DANGER_SECONDS * 1000 - this.dangerElapsed) / 1000));

        ctx.save();
        ctx.font = `bold ${Math.min(this.lineY * 0.8, 56)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#ff2d2d';
        ctx.fillStyle = '#ffffff';
        ctx.strokeText(remaining, this.canvas.width / 2, this.lineY / 2);
        ctx.fillText(remaining, this.canvas.width / 2, this.lineY / 2);
        ctx.restore();
    }

    gameLoop(now = performance.now()) {
        if (!this.playing) return;
        const dt = Math.min(now - (this.lastFrame || now), 100); // Limita saltos si la pestaña estuvo oculta
        this.lastFrame = now;
        this.elapsedMs += dt;

        this.updatePhysics();
        this.updateDanger(dt);
        this.draw();

        if (!this.playing) return; // El juego pudo terminar en este cuadro
        this.animationFrame = requestAnimationFrame((t) => this.gameLoop(t));
    }

    handleInput(e) {
        if (!this.playing) return;
        const rect = this.canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // De la burbuja más reciente (arriba) hacia atrás
        for (let i = this.bubbles.length - 1; i >= 0; i--) {
            let b = this.bubbles[i];
            let r = b.radius * CONFIG.GFX.GLOBAL_SCALE;

            let isHit = false;
            if (CONFIG.GFX.SHAPE_TYPE === 'circle') {
                isHit = Math.hypot(clickX - b.x, clickY - b.y) <= r;
            } else {
                isHit = (clickX >= b.x - r && clickX <= b.x + r && clickY >= b.y - r && clickY <= b.y + r);
            }

            if (isHit) {
                if (this.mode === 'vowels') this.handleVowelTap(b);
                else this.processHit(b, i);
                break;
            }
        }
    }

    processHit(bubble, index) {
        const correct = bubble.value === this.targetResult;
        this.spawnExplosion(bubble);
        this.playPopSound(); // El sonido va junto con la animación
        this.bubbles.splice(index, 1); // Primero se quita, para que la nueva ecuación use solo lo que queda

        if (correct) {
            this.score += 10;
            this.correctAnswers++;
            this.generateEquation();
        } else {
            this.lives--;
            this.wrongAnswers++;
        }

        this.updateUI();

        if (this.lives <= 0) {
            this.endGame();
        }
    }

    // Siempre se dibujan las 5 vidas; las perdidas quedan atenuadas (misma forma, sprite o base)
    renderLives() {
        const row = document.getElementById('heartsRow');
        row.style.setProperty('--life-size', `${CONFIG.GFX.LIFE_SIZE}px`);
        row.innerHTML = '';

        for (let i = 0; i < CONFIG.GAME.MAX_LIVES; i++) {
            const slot = document.createElement('div');
            slot.className = 'life-slot';

            const img = assets.getImage(`life${i + 1}`);
            if (img) {
                slot.style.backgroundImage = `url("${img.src}")`;
            } else {
                slot.classList.add('default');
            }

            if (i >= this.lives) {
                slot.classList.add('lost');
                if (i < this.prevLives) slot.classList.add('just-lost'); // animación al perderla
            }
            row.appendChild(slot);
        }
        this.prevLives = this.lives;
    }

    updateUI() {
        document.getElementById('scoreText').innerText = this.score;
        this.renderLives();
    }

    // Dibuja el tablero congelado hasta que acaben las explosiones (máx. 1.5 s) y llama a done()
    playOutExplosions(done) {
        const startedAt = performance.now();
        const step = () => {
            this.draw();
            if (this.explosions.length > 0 && performance.now() - startedAt < 1500) {
                requestAnimationFrame(step);
            } else {
                done();
            }
        };
        requestAnimationFrame(step);
    }

    endGame(reason) {
        this.playing = false;
        clearTimeout(this.spawnTimer);
        clearTimeout(this.celebrateTimer);
        this.celebrating = false;
        cancelAnimationFrame(this.animationFrame);
        this.stopMusic();

        saveGameMetrics({
            score: this.score,
            correctAnswers: this.correctAnswers,
            wrongAnswers: this.wrongAnswers
        });

        // Deja terminar las explosiones en curso (p. ej. la de la última vida) y luego muestra el mensaje
        this.playOutExplosions(() => this.showGameOver(reason));
    }

    // Panel al perder (reemplaza al alert): fondo personalizable + mini botón para regresar
    showGameOver(reason) {
        document.getElementById('gameOverTitle').innerText = reason === 'stack'
            ? '¡Las burbujas llegaron a la línea roja!'
            : '¡Juego terminado!';
        document.getElementById('gameOverScore').innerText = `Puntos: ${this.score}`;
        document.getElementById('gameOverDetail').innerText =
            `${this.mode === 'vowels' ? 'Palabras' : 'Aciertos'}: ${this.correctAnswers} · Errores: ${this.wrongAnswers}`;
        const panel = document.getElementById('gameOverPanel');
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
    }

    hideGameOver() {
        const panel = document.getElementById('gameOverPanel');
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
    }
}

// Iniciar cuando el DOM esté listo (funciona aunque el módulo cargue tarde)
const startGame = () => new NumbloxGame();
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startGame);
} else {
    startGame();
}