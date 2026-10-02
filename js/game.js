import { CONFIG } from './config.js';
import { saveGameMetrics } from './firebase.js';
import { assets, bindDomSkins } from './assets.js';
import { initAdminPanel } from './panel.js';

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

        this.init();
    }

    init() {
        window.addEventListener('resize', () => { if (this.playing) this.resizeCanvas(); });

        // Flujo: Menú -> Selección de modos -> Modo Clásico
        document.getElementById('btnPlay').addEventListener('click', () => this.showScreen('modesScreen'));
        document.getElementById('btnModeClassic').addEventListener('click', () => this.startGame());
        document.getElementById('btnBackToMenu').addEventListener('click', () => this.showScreen('menuScreen'));
        this.canvas.addEventListener('pointerdown', (e) => this.handleInput(e));

        // Personalización dinámica
        bindDomSkins();
        initAdminPanel();
        assets.subscribe(() => this.renderLives()); // Las vidas se redibujan si cambia un sprite
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

    showScreen(id) {
        document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
        document.body.classList.toggle('playing', id === 'gameScreen');
    }

    resizeCanvas() {
        const zone = document.getElementById('gameZone');
        this.canvas.width = zone.clientWidth;
        this.canvas.height = zone.clientHeight;
        this.laneWidth = this.canvas.width / CONFIG.GAME.LANES;
        this.lineY = this.canvas.height * CONFIG.GAME.DANGER_LINE_RATIO;
    }

    startGame() {
        this.showScreen('gameScreen');
        this.playing = true;

        this.resizeCanvas();
        this.resetStats();
        this.lastFrame = 0;
        this.spawnBubble();      // Primera burbuja: la ecuación sale de lo que hay en el tablero
        this.generateEquation();

        if (this.spawnTimer) clearInterval(this.spawnTimer);
        this.spawnTimer = setInterval(() => this.spawnBubble(), CONFIG.GAME.SPAWN_INTERVAL);

        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.gameLoop();
    }

    resetStats() {
        this.lives = CONFIG.GAME.MAX_LIVES;
        this.prevLives = this.lives;
        this.score = 0;
        this.correctAnswers = 0;
        this.wrongAnswers = 0;
        this.bubbles = [];
        this.dangerElapsed = 0;
        this.updateUI();
    }

    // El número objetivo se elige entre las burbujas que YA están en el tablero
    // (así siempre hay una respuesta disponible sin esperar a que caiga).
    generateEquation() {
        if (this.bubbles.length === 0) this.spawnBubble(); // Tablero vacío: aparece una de inmediato
        const pool = this.bubbles.map((b) => b.value);
        this.targetResult = pool[Math.floor(Math.random() * pool.length)];

        const numA = Math.floor(Math.random() * (this.targetResult + 1));
        const numB = this.targetResult - numA;
        document.getElementById('targetEquation').innerText = `${numA} + ${numB} = ?`;
    }

    spawnBubble() {
        const { MIN_DIGIT, MAX_DIGIT } = CONFIG.GAME;
        const lane = Math.floor(Math.random() * CONFIG.GAME.LANES);
        const baseRadius = Math.min(this.laneWidth * 0.35, 45); // Ajuste dinámico por pantalla
        const x = (lane * this.laneWidth) + (this.laneWidth / 2);
        const value = MIN_DIGIT + Math.floor(Math.random() * (MAX_DIGIT - MIN_DIGIT + 1));

        this.bubbles.push({
            id: this.nextBubbleId++,
            lane: lane,
            x: x,
            y: -baseRadius,
            radius: baseRadius,
            value: value,
            settled: false // true cuando ya no puede seguir cayendo (apilada)
        });
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

    drawBubble(b) {
        const r = b.radius * CONFIG.GFX.GLOBAL_SCALE;
        const sprite = assets.getImage(`bubble${b.value}`);

        // Con sprite personalizado: solo se dibuja la imagen (sin círculo ni texto)
        if (sprite) {
            this.drawImageContain(sprite, b.x - r, b.y - r, r * 2, r * 2);
            return;
        }

        // Diseño base: círculo blanco con borde negro y su número
        this.ctx.beginPath();
        if (CONFIG.GFX.SHAPE_TYPE === 'circle') {
            this.ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        } else {
            this.ctx.rect(b.x - r, b.y - r, r * 2, r * 2);
        }

        this.ctx.fillStyle = CONFIG.GFX.USE_NUMBER_COLORS
            ? (CONFIG.GFX.COLORS[b.value] || CONFIG.GFX.DEFAULT_BUBBLE_FILL)
            : CONFIG.GFX.DEFAULT_BUBBLE_FILL;
        this.ctx.fill();

        this.ctx.lineWidth = CONFIG.GFX.BORDER_WIDTH;
        this.ctx.strokeStyle = CONFIG.GFX.DEFAULT_BUBBLE_BORDER;
        this.ctx.stroke();

        this.ctx.fillStyle = CONFIG.GFX.DEFAULT_TEXT_COLOR;
        this.ctx.font = `bold ${r}px sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(b.value, b.x, b.y);
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
        for (let b of this.bubbles) this.drawBubble(b);
        this.drawDangerCountdown();
    }

    // Una burbuja apilada que toca la línea inicia la cuenta regresiva; si se libera, se reinicia
    updateDanger(dt) {
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
                this.processHit(b, i);
                break;
            }
        }
    }

    processHit(bubble, index) {
        const correct = bubble.value === this.targetResult;
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

    endGame(reason) {
        this.playing = false;
        clearInterval(this.spawnTimer);
        cancelAnimationFrame(this.animationFrame);

        saveGameMetrics({
            score: this.score,
            correctAnswers: this.correctAnswers,
            wrongAnswers: this.wrongAnswers
        });

        setTimeout(() => {
            alert(reason === 'stack'
                ? `¡Las burbujas llegaron a la línea roja! Puntos: ${this.score}`
                : `¡Juego terminado! Puntos: ${this.score}`);
            this.showScreen('menuScreen');
        }, 100);
    }
}

// Iniciar cuando el DOM esté listo (funciona aunque el módulo cargue tarde)
const startGame = () => new NumbloxGame();
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startGame);
} else {
    startGame();
}