// Numblox · Motor de assets dinámicos
// Escucha Firestore en tiempo real, precarga las imágenes y avisa a quien lo necesite.
import { CONFIG } from './config.js';
import { subscribeVisuals } from './firebase.js';

class AssetManager {
    constructor() {
        this.entries = {};          // clave -> { url, path, updatedAt }
        this.images = new Map();    // clave -> HTMLImageElement ya cargada
        this.listeners = new Set();
        this.started = false;
        this._firstSync = true;
        this.ready = new Promise((resolve) => { this._resolveReady = resolve; });
    }

    start() {
        if (this.started) return;
        this.started = true;

        if (!CONFIG.GFX.USE_SPRITES) {
            this._resolveReady();
            return;
        }
        subscribeVisuals(
            (map) => this._sync(map),
            () => this._resolveReady() // Si falla la lectura, el juego usa el diseño base
        );
    }

    // --- API pública ---
    getImage(key) { return this.images.get(key) || null; }
    getEntry(key) { return this.entries[key] || null; }
    getUrl(key) { return this.entries[key] ? this.entries[key].url : null; }
    isCustom(key) { return Boolean(this.entries[key]); }

    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    // --- Interno ---
    _emit(keys) {
        this.listeners.forEach((cb) => cb(keys));
    }

    _sync(map) {
        const removed = [];
        const loads = [];

        // Sprites eliminados (Restablecer por defecto)
        for (const key of Object.keys(this.entries)) {
            if (!map[key] || !map[key].url) {
                delete this.entries[key];
                this.images.delete(key);
                removed.push(key);
            }
        }

        // Sprites nuevos o reemplazados
        for (const [key, entry] of Object.entries(map)) {
            if (!entry || !entry.url) continue;
            const prev = this.entries[key];
            this.entries[key] = entry;
            if (!prev || prev.url !== entry.url) loads.push(this._load(key, entry.url));
        }

        if (removed.length) this._emit(removed);

        if (this._firstSync) {
            this._firstSync = false;
            Promise.all(loads).then(() => this._resolveReady());
        }
    }

    _load(key, url) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                // Ignorar si mientras cargaba llegó otra versión o se eliminó
                if (this.entries[key] && this.entries[key].url === url) {
                    this.images.set(key, img); // Mantiene la imagen anterior hasta que la nueva esté lista
                    this._emit([key]);
                }
                resolve();
            };
            img.onerror = () => {
                console.warn(`No se pudo cargar el sprite "${key}"`);
                if (this.entries[key] && this.entries[key].url === url) {
                    this.images.delete(key);
                    this._emit([key]);
                }
                resolve();
            };
            img.src = url;
        });
    }
}

export const assets = new AssetManager();

/* ------------------------------------------------------------------
   Aplicación de skins a elementos del DOM (fondos y botón JUGAR)
------------------------------------------------------------------- */
const BACKGROUND_TARGETS = {
    bgMenu: 'menuScreen',
    bgModes: 'modesScreen',
    bgGameLeft: 'gameZone',
    bgGameRight: 'uiPanel'
};

function applyBackground(key, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const img = assets.getImage(key);
    if (img) {
        el.style.backgroundImage = `url("${img.src}")`;
        el.classList.add('has-skin');      // cover + centrado: sin deformar ni salirse
    } else {
        el.style.backgroundImage = '';     // vuelve al fondo base definido en CSS
        el.classList.remove('has-skin');
    }
}

function applyPlayButton() {
    const btn = document.getElementById('btnPlay');
    if (!btn) return;
    const img = assets.getImage('btnPlay');
    if (img) {
        btn.classList.add('btn-sprite');
        btn.style.backgroundImage = `url("${img.src}")`;
        btn.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    } else {
        btn.classList.remove('btn-sprite');
        btn.style.backgroundImage = '';
        btn.style.aspectRatio = '';
    }
}

export function bindDomSkins() {
    const applyAll = () => {
        for (const [key, id] of Object.entries(BACKGROUND_TARGETS)) applyBackground(key, id);
        applyPlayButton();
    };
    applyAll();
    assets.subscribe(applyAll);
}