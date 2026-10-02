import { CONFIG } from './config.js';
import { saveGameMetrics } from './firebase.js';

class NumbloxGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.lives = CONFIG.GAME.MAX_LIVES;
        this.score = 0;
        this.correctAnswers = 0;
        this.wrongAnswers = 0;

        this.bubbles = [];
        this.targetResult = 0;
        this.spawnTimer = null;
        this.laneWidth = 0;
        this.animationFrame = null;

        this.init();
    }

    init() {
        window.addEventListener('resize', () => this.resizeCanvas());
        document.getElementById('btnPlay').addEventListener('click', () => this.startGame());
        this.canvas.addEventListener('pointerdown', (e) => this.handleInput(e));
    }

    resizeCanvas() {
        const zone = document.getElementById('gameZone');
        this.canvas.width = zone.clientWidth;
        this.canvas.height = zone.clientHeight;
        this.laneWidth = this.canvas.width / CONFIG.GAME.LANES;
    }

    startGame() {
        document.getElementById('menuScreen').classList.remove('active');
        document.getElementById('gameScreen').classList.add('active');

        this.resizeCanvas();
        this.resetStats();
        this.generateEquation();

        if (this.spawnTimer) clearInterval(this.spawnTimer);
        this.spawnTimer = setInterval(() => this.spawnBubble(), CONFIG.GAME.SPAWN_INTERVAL);

        if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
        this.gameLoop();
    }

    resetStats() {
        this.lives = CONFIG.GAME.MAX_LIVES;
        this.score = 0;
        this.correctAnswers = 0;
        this.wrongAnswers = 0;
        this.bubbles = [];
        this.updateUI();
    }

    generateEquation() {
        const numA = Math.floor(Math.random() * 5) + 1;
        const numB = Math.floor(Math.random() * 5) + 1;
        this.targetResult = numA + numB;
        document.getElementById('targetEquation').innerText = `${numA} + ${numB} = ?`;
    }

    spawnBubble() {
        const lane = Math.floor(Math.random() * CONFIG.GAME.LANES);
        const baseRadius = Math.min(this.laneWidth * 0.35, 45); // Ajuste dinámico por pantalla
        const x = (lane * this.laneWidth) + (this.laneWidth / 2);

        // 40% probabilidad de que sea la respuesta correcta
        let value = (Math.random() < 0.4) ? this.targetResult : Math.floor(Math.random() * 18) + 1;

        // Obtener un color del 0 al 9 usando el último dígito del valor
        const colorKey = value % 10;

        this.bubbles.push({
            id: Date.now(),
            lane: lane,
            x: x,
            y: -baseRadius,
            radius: baseRadius,
            value: value,
            color: CONFIG.GFX.COLORS[colorKey] || '#ffffff'
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
            }
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Dibujar columnas (guías visuales opcionales)
        this.ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        this.ctx.lineWidth = 2;
        for (let i = 1; i < CONFIG.GAME.LANES; i++) {
            this.ctx.beginPath();
            this.ctx.moveTo(i * this.laneWidth, 0);
            this.ctx.lineTo(i * this.laneWidth, this.canvas.height);
            this.ctx.stroke();
        }

        // Dibujar burbujas/bloques
        for (let b of this.bubbles) {
            let r = b.radius * CONFIG.GFX.GLOBAL_SCALE;

            if (CONFIG.GFX.USE_SPRITES) {
                // Lógica futura para imágenes
                // this.ctx.drawImage(img, b.x - r, b.y - r, r*2, r*2);
            } else {
                this.ctx.beginPath();
                if (CONFIG.GFX.SHAPE_TYPE === 'circle') {
                    this.ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
                } else {
                    this.ctx.rect(b.x - r, b.y - r, r * 2, r * 2);
                }

                this.ctx.fillStyle = b.color;
                this.ctx.fill();

                this.ctx.lineWidth = CONFIG.GFX.BORDER_WIDTH;
                this.ctx.strokeStyle = CONFIG.GFX.BORDER_COLOR;
                this.ctx.stroke();

                this.ctx.fillStyle = CONFIG.GFX.TEXT_COLOR;
                this.ctx.font = `bold ${r}px sans-serif`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(b.value, b.x, b.y);
            }
        }
    }

    gameLoop() {
        this.updatePhysics();
        this.draw();
        this.animationFrame = requestAnimationFrame(() => this.gameLoop());
    }

    handleInput(e) {
        const rect = this.canvas.getBoundingClientRect();
        // Soporte para touch o mouse
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);

        const clickX = clientX - rect.left;
        const clickY = clientY - rect.top;

        // Detectar colisión click -> burbuja desde arriba hacia abajo (últimas renderizadas)
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
        if (bubble.value === this.targetResult) {
            this.score += 10;
            this.correctAnswers++;
            this.generateEquation();
        } else {
            this.lives--;
            this.wrongAnswers++;
        }

        this.bubbles.splice(index, 1);
        this.updateUI();

        if (this.lives <= 0) {
            this.endGame();
        }
    }

    updateUI() {
        document.getElementById('scoreText').innerText = this.score;
        const heartsRow = document.getElementById('heartsRow');
        heartsRow.innerHTML = '';
        for (let i = 0; i < this.lives; i++) {
            let heart = document.createElement('div');
            heart.className = 'heart-icon';
            heartsRow.appendChild(heart);
        }
    }

    endGame() {
        clearInterval(this.spawnTimer);
        cancelAnimationFrame(this.animationFrame);

        saveGameMetrics({
            score: this.score,
            correctAnswers: this.correctAnswers,
            wrongAnswers: this.wrongAnswers
        });

        setTimeout(() => {
            alert(`¡Juego terminado! Puntos: ${this.score}`);
            document.getElementById('gameScreen').classList.remove('active');
            document.getElementById('menuScreen').classList.add('active');
        }, 100);
    }
}

// Iniciar cuando el DOM cargue
window.addEventListener('DOMContentLoaded', () => {
    new NumbloxGame();
});