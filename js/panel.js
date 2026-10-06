// Numblox · Inicio de sesión (alumno / administrador) y panel de personalización
//  - initAuth(): botón "Iniciar sesión" y su ventana. Alumno = cualquier cuenta de Google (se guarda su registro).
//    Administrador = solo la cuenta autorizada en las reglas de Firestore.
//  - El editor NO existe en la página: se construye únicamente cuando Firestore confirma que la
//    cuenta es la autorizada (openEditor) y se destruye por completo al cerrarlo o cerrar sesión.
import {
    CONFIG, SPRITE_SLOTS, LIFE_KEYS, EXPLOSION_KEYS, EXPLOSION_GROUP, AUDIO_SLOTS, AUDIO_GROUP,
    DEFAULT_WORDS, MAX_WORDS, normalizeWord, isValidWord, maskWord
} from './config.js';
import { assets } from './assets.js';
import {
    loginWithGoogle, logout, onAuthChange, verifyAdmin, registerStudent,
    uploadSprite, uploadAudio, resetSprite, subscribeWords, saveWords, resetWords
} from './firebase.js';

const SPRITE_TYPES = ['image/png', 'image/webp'];
const BACKGROUND_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function validateFile(slot, file) {
    const allowed = slot.kind === 'background' ? BACKGROUND_TYPES : SPRITE_TYPES;
    if (!allowed.includes(file.type)) {
        return slot.kind === 'background'
            ? 'Formato no válido. Usa PNG, JPG o WebP.'
            : 'El sprite debe ser PNG (o WebP) con transparencia.';
    }
    if (file.size > CONFIG.ASSETS.MAX_FILE_MB * 1024 * 1024) {
        return `La imagen supera los ${CONFIG.ASSETS.MAX_FILE_MB} MB.`;
    }
    return null;
}

function validateAudio(file) {
    if (!file.type.startsWith('audio/')) return 'El archivo debe ser de audio (MP3, OGG, M4A…).';
    if (file.size > CONFIG.AUDIO.MAX_BYTES) {
        return `El audio pesa ${Math.round(file.size / 1024)} KB y el máximo es ${Math.round(CONFIG.AUDIO.MAX_BYTES / 1024)} KB. Recórtalo o comprímelo (64–96 kbps).`;
    }
    return null;
}

function friendlyError(err) {
    const code = err && err.code ? err.code : '';
    if (code === 'storage/unauthorized' || code === 'permission-denied') {
        return 'Sin permisos. Revisa tu sesión y las reglas de Firebase.';
    }
    if (code === 'storage/canceled') return 'Subida cancelada.';
    if (code === 'storage/retry-limit-exceeded') return 'Conexión inestable. Inténtalo de nuevo.';
    return (err && err.message) || 'Error inesperado.';
}

const EDITOR_TEMPLATE = `
    <div class="admin-overlay open" id="adminPanel" aria-hidden="false">
        <div class="admin-sheet" role="dialog" aria-modal="true" aria-labelledby="adminTitle">
            <header class="admin-header">
                <h2 id="adminTitle">Panel de edición</h2>
                <button id="adminClose" class="admin-icon-btn" aria-label="Cerrar">✕</button>
            </header>
            <section class="admin-section">
                <div class="admin-userbar">
                    <span id="adminUser"></span>
                    <button id="adminLogout" class="admin-btn">Cerrar sesión</button>
                </div>
                <p class="admin-note">Haz clic en una miniatura o arrastra una imagen sobre la fila. Se optimiza sola y se publica al instante para todos.</p>
                <div id="adminSlots"></div>
            </section>
        </div>
    </div>`;

let mounted = null;  // Editor montado (null = no existe nada del editor en la página)
let opening = false;

// Destruye todo el editor: el contenedor queda vacío
export function closeEditor() {
    if (!mounted) return;
    mounted.cleanup();
    mounted = null;
    const host = document.getElementById('editorRoot');
    if (host) host.innerHTML = '';
}

// Construye el editor SOLO si el servidor confirma (otra vez) que la cuenta actual es la administradora.
export async function openEditor(label) {
    if (mounted) return true;
    if (opening) return false;
    opening = true;
    try {
        let allowed = false;
        try { allowed = await verifyAdmin(); } catch (err) { allowed = false; } // Ante la duda, cerrado
        if (!allowed) return false;
        const host = document.getElementById('editorRoot');
        if (!host) return false;
        host.innerHTML = EDITOR_TEMPLATE;
        mounted = { cleanup: buildEditor(host, label) };
        return true;
    } finally {
        opening = false;
    }
}

function buildEditor(host, label) {
    const $ = (id) => host.querySelector('#' + id);
    const el = { panel: $('adminPanel'), close: $('adminClose'), user: $('adminUser'), logout: $('adminLogout'), slots: $('adminSlots') };
    const rows = new Map(); // clave -> { thumb, status, bar, reset, input, root }
    const previewStoppers = []; // Una función "detener" por cada fila de audio
    const unsubscribers = [];   // Suscripciones del editor (se cancelan al destruirlo)
    function stopPreview() { previewStoppers.forEach((stop) => stop()); }

    el.user.textContent = label || 'Administrador';
    el.close.addEventListener('click', closeEditor);
    el.panel.addEventListener('pointerdown', (e) => { if (e.target === el.panel) closeEditor(); });
    const onKey = (e) => { if (e.key === 'Escape') closeEditor(); };
    document.addEventListener('keydown', onKey);
    el.logout.addEventListener('click', () => logout()); // El observador de sesión destruye el editor

    /* ---------- Construcción de la lista ---------- */
    function setStatus(key, text, type) {
        const row = rows.get(key);
        if (!row) return;
        row.status.textContent = text || '';
        row.status.className = `slot-status ${type || ''}`;
    }

    function setBusy(key, busy) {
        const row = rows.get(key);
        if (!row) return;
        row.root.classList.toggle('busy', busy);
        row.input.disabled = busy;
        row.reset.disabled = busy || !assets.isCustom(key);
        if (!busy) row.bar.style.width = '0%';
    }

    function refreshRow(key) {
        const row = rows.get(key);
        if (!row) return;
        const url = assets.getUrl(key);
        row.thumb.classList.toggle('is-default', !url);
        row.preview.style.backgroundImage = url ? `url("${url}")` : '';
        row.reset.disabled = !url || row.root.classList.contains('busy');
    }

    async function handleUpload(slot, file) {
        const error = validateFile(slot, file);
        if (error) { setStatus(slot.key, error, 'error'); return; }
        setBusy(slot.key, true);
        setStatus(slot.key, 'Subiendo… 0%');
        try {
            await uploadSprite(
                slot.key, file,
                (p) => {
                    const row = rows.get(slot.key);
                    row.bar.style.width = `${Math.round(p * 100)}%`;
                    setStatus(slot.key, `Optimizando y subiendo… ${Math.round(p * 100)}%`);
                }
            );
            setStatus(slot.key, '✔ Guardado y publicado', 'ok');
        } catch (err) {
            setStatus(slot.key, friendlyError(err), 'error');
        } finally {
            setBusy(slot.key, false);
            refreshRow(slot.key);
        }
    }

    async function handleReset(slot) {
        if (!confirm(`¿Restablecer "${slot.label}" al diseño por defecto? Se eliminará la imagen de la nube.`)) return;
        setBusy(slot.key, true);
        setStatus(slot.key, 'Eliminando…');
        try {
            await resetSprite(slot.key);
            setStatus(slot.key, '✔ Restablecido', 'ok');
        } catch (err) {
            setStatus(slot.key, friendlyError(err), 'error');
        } finally {
            setBusy(slot.key, false);
            refreshRow(slot.key);
        }
    }

    function buildRow(slot) {
        const root = document.createElement('div');
        root.className = 'slot-row';
        root.innerHTML = `
            <div class="slot-thumb is-default"><i class="slot-preview"></i></div>
            <div class="slot-info">
                <strong class="slot-label"></strong>
                <span class="slot-hint"></span>
                <span class="slot-status"></span>
                <div class="slot-progress"><i></i></div>
            </div>
            <div class="slot-actions">
                <label class="admin-btn">Subir imagen<input type="file" hidden></label>
                <button type="button" class="admin-btn danger">Restablecer por defecto</button>
            </div>`;

        root.querySelector('.slot-label').textContent = slot.label;
        root.querySelector('.slot-hint').textContent = slot.hint;

        const input = root.querySelector('input');
        input.accept = (slot.kind === 'background' ? BACKGROUND_TYPES : SPRITE_TYPES).join(',');
        const reset = root.querySelector('.danger');

        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            input.value = ''; // Permite volver a elegir el mismo archivo
            if (file) handleUpload(slot, file);
        });
        reset.addEventListener('click', () => handleReset(slot));

        // Más visual: clic en la miniatura o arrastrar y soltar una imagen sobre la fila
        root.querySelector('.slot-thumb').addEventListener('click', () => { if (!input.disabled) input.click(); });
        root.addEventListener('dragover', (e) => { e.preventDefault(); root.classList.add('drag'); });
        root.addEventListener('dragleave', () => root.classList.remove('drag'));
        root.addEventListener('drop', (e) => {
            e.preventDefault();
            root.classList.remove('drag');
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (file && !input.disabled) handleUpload(slot, file);
        });

        rows.set(slot.key, {
            root, input, reset,
            thumb: root.querySelector('.slot-thumb'),
            preview: root.querySelector('.slot-preview'),
            status: root.querySelector('.slot-status'),
            bar: root.querySelector('.slot-progress i')
        });
        return root;
    }

    // Atajo: una sola imagen para las 5 vidas
    function buildAllLivesRow() {
        const root = document.createElement('div');
        root.className = 'slot-row slot-row-all';
        root.innerHTML = `
            <div class="slot-info">
                <strong>Usar la misma imagen en las 5 vidas</strong>
                <span class="slot-hint">PNG transparente cuadrado · 128×128. Luego puedes cambiar cada vida por separado.</span>
                <span class="slot-status"></span>
            </div>
            <div class="slot-actions">
                <label class="admin-btn">Subir para todas<input type="file" hidden accept="${SPRITE_TYPES.join(',')}"></label>
            </div>`;
        const input = root.querySelector('input');
        const status = root.querySelector('.slot-status');
        const say = (text, type) => { status.textContent = text; status.className = `slot-status ${type || ''}`; };

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            const slot = SPRITE_SLOTS.find((s) => s.key === LIFE_KEYS[0]);
            const error = validateFile(slot, file);
            if (error) { say(error, 'error'); return; }
            input.disabled = true;
            try {
                for (let i = 0; i < LIFE_KEYS.length; i++) {
                    say(`Subiendo ${i + 1}/${LIFE_KEYS.length}…`);
                    await uploadSprite(LIFE_KEYS[i], file);
                }
                say('✔ Aplicada a las 5 vidas', 'ok');
            } catch (err) {
                say(friendlyError(err), 'error');
            } finally {
                input.disabled = false;
            }
        });
        return root;
    }

    // Animación de explosión: subir varios frames de una vez + vista previa
    function buildExplosionRow() {
        const root = document.createElement('div');
        root.className = 'slot-row slot-row-all';
        root.innerHTML = `
            <div class="slot-info">
                <strong>Animación de explosión (todas las burbujas)</strong>
                <span class="slot-hint">Se reproduce al tocar cualquier burbuja. Sube de 4 a ${EXPLOSION_KEYS.length} imágenes a la vez: se asignan a los frames en orden de nombre (1.png, 2.png…) y reemplazan la animación completa. También puedes cambiar cada frame por separado.</span>
                <span class="slot-status"></span>
            </div>
            <div class="slot-actions">
                <div class="slot-thumb explosion-preview"><i class="slot-preview"></i></div>
                <label class="admin-btn">Subir frames<input type="file" hidden multiple accept="${SPRITE_TYPES.join(',')}"></label>
                <button type="button" class="admin-btn">▶ Probar animación</button>
            </div>`;

        const input = root.querySelector('input');
        const playBtn = root.querySelector('button');
        const preview = root.querySelector('.slot-preview');
        const status = root.querySelector('.slot-status');
        const say = (text, type) => { status.textContent = text; status.className = `slot-status ${type || ''}`; };

        playBtn.addEventListener('click', () => {
            const frames = EXPLOSION_KEYS.map((k) => assets.getImage(k)).filter(Boolean);
            if (!frames.length) { say('Aún no hay frames subidos.', 'error'); return; }
            say('');
            let i = 0;
            preview.style.backgroundImage = `url("${frames[0].src}")`;
            const timer = setInterval(() => {
                i++;
                if (i >= frames.length) { clearInterval(timer); preview.style.backgroundImage = ''; return; }
                preview.style.backgroundImage = `url("${frames[i].src}")`;
            }, CONFIG.GFX.EXPLOSION_FRAME_MS * 3); // Más lenta que en el juego para poder verla
        });

        input.addEventListener('change', async () => {
            const files = Array.from(input.files || [])
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            input.value = '';
            if (!files.length) return;
            if (files.length > EXPLOSION_KEYS.length) {
                say(`Máximo ${EXPLOSION_KEYS.length} imágenes.`, 'error');
                return;
            }
            const slot = SPRITE_SLOTS.find((s) => s.key === EXPLOSION_KEYS[0]);
            for (const f of files) {
                const error = validateFile(slot, f);
                if (error) { say(`${f.name}: ${error}`, 'error'); return; }
            }
            const leftovers = EXPLOSION_KEYS.slice(files.length).filter((k) => assets.isCustom(k));
            if (leftovers.length && !confirm(`Se reemplazará toda la animación y se borrarán ${leftovers.length} frame(s) sobrante(s). ¿Continuar?`)) return;

            input.disabled = true;
            try {
                for (let i = 0; i < files.length; i++) {
                    say(`Subiendo frame ${i + 1}/${files.length}…`);
                    await uploadSprite(EXPLOSION_KEYS[i], files[i]);
                }
                for (const key of leftovers) await resetSprite(key);
                say(`✔ Animación guardada (${files.length} frames)`, 'ok');
            } catch (err) {
                say(friendlyError(err), 'error');
            } finally {
                input.disabled = false;
            }
        });
        return root;
    }

    // Fila de audio (música de fondo, sonido de explosión…): subir, escuchar y restablecer
    function buildAudioRow(slot) {
        const key = slot.key;
        const kb = Math.round(CONFIG.AUDIO.MAX_BYTES / 1024);
        const root = document.createElement('div');
        root.className = 'slot-row slot-row-all';
        root.innerHTML = `
            <div class="slot-info">
                <strong class="audio-label"></strong>
                <span class="slot-hint audio-hint"></span>
                <span class="slot-hint audio-state"></span>
                <span class="slot-status"></span>
                <div class="slot-progress"><i></i></div>
            </div>
            <div class="slot-actions">
                <label class="admin-btn">Subir audio<input type="file" hidden accept="audio/*"></label>
                <button type="button" class="admin-btn" data-act="play">▶ Escuchar</button>
                <button type="button" class="admin-btn danger" data-act="reset">Restablecer por defecto</button>
            </div>`;
        root.querySelector('.audio-label').textContent = slot.label;
        root.querySelector('.audio-hint').textContent =
            `${slot.hint} MP3, OGG o M4A de hasta ${kb} KB; si pesa más, recórtalo o comprímelo.`;

        const input = root.querySelector('input');
        const playBtn = root.querySelector('[data-act="play"]');
        const resetBtn = root.querySelector('[data-act="reset"]');
        const state = root.querySelector('.audio-state');
        const status = root.querySelector('.slot-status');
        const bar = root.querySelector('.slot-progress i');
        let preview = null;

        const say = (text, type) => { status.textContent = text; status.className = `slot-status ${type || ''}`; };
        const refresh = () => {
            const has = assets.isCustom(key);
            state.textContent = has ? '● Audio personalizado activo' : '○ Sin audio asignado';
            playBtn.disabled = !has;
            resetBtn.disabled = !has;
        };
        const stop = () => {
            if (preview) { preview.pause(); preview = null; }
            playBtn.textContent = '▶ Escuchar';
        };
        previewStoppers.push(stop);

        playBtn.addEventListener('click', () => {
            if (preview) { stop(); return; }
            const url = assets.getUrl(key);
            if (!url) return;
            stopPreview(); // Detiene cualquier otra vista previa
            preview = new Audio(url);
            preview.volume = CONFIG.AUDIO.VOLUME;
            preview.addEventListener('ended', stop);
            preview.play().catch(() => { say('El navegador no pudo reproducir este audio.', 'error'); stop(); });
            playBtn.textContent = '■ Detener';
        });

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            const error = validateAudio(file);
            if (error) { say(error, 'error'); return; }
            stop();
            input.disabled = true;
            resetBtn.disabled = true;
            say('Subiendo… 0%');
            try {
                await uploadAudio(key, file, (p) => {
                    bar.style.width = `${Math.round(p * 100)}%`;
                    say(`Subiendo… ${Math.round(p * 100)}%`);
                });
                say('✔ Guardado y publicado', 'ok');
            } catch (err) {
                say(friendlyError(err), 'error');
            } finally {
                input.disabled = false;
                bar.style.width = '0%';
                refresh();
            }
        });

        resetBtn.addEventListener('click', async () => {
            if (!confirm(`¿Restablecer "${slot.label}"? Se eliminará de la nube.`)) return;
            stop();
            resetBtn.disabled = true;
            say('Eliminando…');
            try {
                await resetSprite(key);
                say('✔ Restablecido', 'ok');
            } catch (err) {
                say(friendlyError(err), 'error');
            } finally {
                refresh();
            }
        });

        unsubscribers.push(assets.subscribe((keys) => { if (keys.includes(key)) refresh(); }));
        refresh();
        return root;
    }

    // Herramienta de palabras del modo Vocales: el juego les quita las vocales solo y las usa al azar
    function buildWordsSection() {
        const section = document.createElement('section');
        section.className = 'slot-group';
        const title = document.createElement('h3');
        title.textContent = 'Palabras del modo Vocales';
        section.appendChild(title);

        const root = document.createElement('div');
        root.className = 'slot-row slot-row-all';
        root.innerHTML = `
            <div class="slot-info">
                <strong>Lista de palabras (4 a 6 letras)</strong>
                <span class="slot-hint">Escribe una o varias palabras separadas por espacio, coma o salto de línea. Se quitan los acentos solos; la Ñ sí se admite. El juego les oculta las vocales y las usa al azar, todas antes de repetir. Si la lista queda vacía, se usa la lista básica.</span>
                <textarea class="words-input" rows="2" placeholder="casa, mesa, gato"></textarea>
                <div class="words-actions">
                    <button type="button" class="admin-btn primary" data-act="add">Agregar palabras</button>
                    <button type="button" class="admin-btn danger" data-act="reset">Restablecer lista por defecto</button>
                </div>
                <span class="slot-status"></span>
                <span class="slot-hint words-count"></span>
                <div class="words-list"></div>
            </div>`;
        section.appendChild(root);

        const input = root.querySelector('.words-input');
        const addBtn = root.querySelector('[data-act="add"]');
        const resetBtn = root.querySelector('[data-act="reset"]');
        const status = root.querySelector('.slot-status');
        const count = root.querySelector('.words-count');
        const list = root.querySelector('.words-list');
        let custom = [];   // Lista guardada en Firestore (vacía = se usa la básica)

        const say = (text, type) => { status.textContent = text; status.className = `slot-status ${type || ''}`; };
        const base = () => (custom.length ? custom.slice() : DEFAULT_WORDS.slice());

        function render() {
            const words = base();
            count.textContent = custom.length
                ? `${words.length} palabras en la lista personalizada (máximo ${MAX_WORDS}).`
                : `Usando la lista básica (${words.length} palabras). Al agregar o quitar una, se crea tu lista personalizada a partir de ella.`;
            resetBtn.disabled = custom.length === 0;
            list.innerHTML = '';
            words.forEach((word) => {
                const chip = document.createElement('span');
                chip.className = 'word-chip';
                const masked = document.createElement('b');
                masked.textContent = maskWord(word);
                const full = document.createElement('small');
                full.textContent = word;
                const del = document.createElement('button');
                del.type = 'button';
                del.textContent = '✕';
                del.setAttribute('aria-label', `Quitar ${word}`);
                del.addEventListener('click', () => removeWord(word));
                chip.appendChild(masked);
                chip.appendChild(full);
                chip.appendChild(del);
                list.appendChild(chip);
            });
        }

        async function persist(words, okText) {
            addBtn.disabled = true;
            try {
                if (words.length === 0) await resetWords();      // Sin palabras = lista básica
                else await saveWords(words);
                say(okText, 'ok');
            } catch (err) {
                say(friendlyError(err), 'error');
            } finally {
                addBtn.disabled = false;
            }
        }

        async function addWords() {
            const parts = input.value.split(/[\s,;]+/).map(normalizeWord).filter(Boolean);
            const words = base();
            const added = [], invalid = [];
            for (const w of parts) {
                if (!isValidWord(w)) invalid.push(w);
                else if (!words.includes(w) && !added.includes(w)) added.push(w);
            }
            if (!parts.length) { say('Escribe al menos una palabra.', 'error'); return; }
            if (words.length + added.length > MAX_WORDS) { say(`Máximo ${MAX_WORDS} palabras.`, 'error'); return; }
            if (!added.length) {
                say(invalid.length ? `No válidas (4 a 6 letras y al menos una vocal): ${invalid.join(', ')}` : 'Esas palabras ya están en la lista.', 'error');
                return;
            }
            await persist([...words, ...added], `✔ Agregadas: ${added.join(', ')}` + (invalid.length ? ` · No válidas: ${invalid.join(', ')}` : ''));
            input.value = '';
        }

        async function removeWord(word) {
            const left = base().filter((w) => w !== word);
            await persist(left, left.length ? `✔ Quitada: ${word}` : '✔ Lista vacía: se usará la lista básica');
        }

        addBtn.addEventListener('click', addWords);
        resetBtn.addEventListener('click', async () => {
            if (!confirm('¿Volver a la lista básica de palabras? Se perderá tu lista personalizada.')) return;
            await persist([], '✔ Lista restablecida a la básica');
        });

        unsubscribers.push(subscribeWords((words) => { custom = words; render(); }));
        render();
        return section;
    }

    function buildSlots() {
        const groups = [...new Set(SPRITE_SLOTS.map((s) => s.group))];
        for (const group of groups) {
            const section = document.createElement('section');
            section.className = 'slot-group';
            const title = document.createElement('h3');
            title.textContent = group;
            section.appendChild(title);
            if (group === 'Vidas') section.appendChild(buildAllLivesRow());
            if (group === EXPLOSION_GROUP) section.appendChild(buildExplosionRow());
            SPRITE_SLOTS.filter((s) => s.group === group).forEach((slot) => section.appendChild(buildRow(slot)));
            el.slots.appendChild(section);
        }

        const audioSection = document.createElement('section');
        audioSection.className = 'slot-group';
        const audioTitle = document.createElement('h3');
        audioTitle.textContent = AUDIO_GROUP;
        audioSection.appendChild(audioTitle);
        AUDIO_SLOTS.forEach((slot) => audioSection.appendChild(buildAudioRow(slot)));
        el.slots.appendChild(audioSection);

        el.slots.appendChild(buildWordsSection());
    }

    buildSlots();
    rows.forEach((_, key) => refreshRow(key));
    unsubscribers.push(assets.subscribe((keys) => keys.forEach(refreshRow))); // Previews en vivo

    return function cleanup() {
        document.removeEventListener('keydown', onKey);
        stopPreview();
        unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
        previewStoppers.length = 0;
        rows.clear();
    };
}

/* =============================================================
   INICIO DE SESIÓN: ALUMNO O ADMINISTRADOR
============================================================= */
function friendlyAuthError(err) {
    switch (err && err.code) {
        case 'auth/popup-closed-by-user':
        case 'auth/cancelled-popup-request': return 'Se cerró la ventana de Google.';
        case 'auth/popup-blocked': return 'El navegador bloqueó la ventana. Permite las ventanas emergentes.';
        case 'auth/unauthorized-domain': return 'Dominio no autorizado: agrégalo en Authentication > Settings > Authorized domains.';
        case 'auth/network-request-failed': return 'Sin conexión.';
        default: return 'No se pudo iniciar sesión con Google.';
    }
}

export function initAuth() {
    const $ = (id) => document.getElementById(id);
    const el = {
        btn: $('loginBtn'), modal: $('authModal'), close: $('authClose'),
        choose: $('authChoose'), welcome: $('authWelcome'),
        student: $('authStudent'), admin: $('authAdmin'), msg: $('authMsg'),
        title: $('authWelcomeTitle'), sub: $('authWelcomeSub'), actions: $('authWelcomeActions'),
        play: $('authPlay'), logout: $('authLogout')
    };

    let session = null;     // { user, role: 'student' | 'admin' } o null
    let loggingIn = false;  // Mientras corre un inicio de sesión, el observador espera
    let run = 0;

    const firstName = (user) => (user.displayName || user.email || '').split(/[\s@]/)[0] || 'jugador';

    const openModal = () => { el.modal.classList.add('open'); el.modal.setAttribute('aria-hidden', 'false'); };
    const closeModal = () => { el.modal.classList.remove('open'); el.modal.setAttribute('aria-hidden', 'true'); };
    const showView = (name) => { el.choose.hidden = name !== 'choose'; el.welcome.hidden = name !== 'welcome'; };
    const setMsg = (text, type) => { el.msg.textContent = text || ''; el.msg.className = `auth-msg ${type || ''}`; };
    const setBusy = (busy) => { el.student.disabled = busy; el.admin.disabled = busy; };

    function updateButton() {
        if (!session) { el.btn.textContent = 'Iniciar sesión'; return; }
        el.btn.textContent = `${session.role === 'admin' ? '🛠️' : '👤'} ${firstName(session.user)}`;
    }

    function renderWelcome(justRegistered) {
        const { user, role } = session;
        el.title.textContent = role === 'admin' ? `¡Hola, ${firstName(user)}!` : `¡Bienvenido, ${firstName(user)}!`;
        el.sub.textContent = role === 'admin'
            ? 'Sesión de administrador activa.'
            : (justRegistered ? 'Tu cuenta quedó registrada. ¡A jugar!' : 'Tu sesión está iniciada. ¡A jugar!');

        // El acceso al editor se crea solo para el administrador verificado
        el.actions.innerHTML = '';
        if (role === 'admin') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'auth-option secondary';
            btn.textContent = '🛠️ Abrir panel de edición';
            btn.addEventListener('click', async () => {
                closeModal();
                await openEditor(user.email || firstName(user));
            });
            el.actions.appendChild(btn);
        }
    }

    // Decide el rol de la cuenta (siempre consultando al servidor) y actualiza la interfaz
    async function processUser(user, intent) {
        const myRun = ++run;
        closeEditor();     // Por defecto no hay editor en la página
        session = null;
        updateButton();
        if (!user) { showView('choose'); return; }

        let isAdmin = false;
        let failed = false;
        try { isAdmin = await verifyAdmin(); } catch (err) { failed = true; }
        if (myRun !== run) return;

        // Eligió "administrador" pero la cuenta no está autorizada: se desconecta y no ve nada
        if (intent === 'admin' && !isAdmin) {
            setMsg(failed
                ? 'No se pudo verificar tu cuenta. Revisa tu conexión e inténtalo de nuevo.'
                : 'Esta cuenta no está autorizada como administrador.', 'error');
            await logout();
            session = null;
            updateButton();
            showView('choose');
            return;
        }

        session = { user, role: isAdmin ? 'admin' : 'student' };
        updateButton();

        let registered = false;
        if (intent === 'student') {
            try { await registerStudent(user); registered = true; }
            catch (err) { console.warn('No se pudo registrar al alumno:', err); }
        }
        if (myRun !== run) return;

        setMsg('');
        renderWelcome(registered);
        showView('welcome');

        if (intent === 'admin') {   // Administrador verificado: abre el editor directamente
            closeModal();
            await openEditor(user.email || firstName(user));
        }
    }

    async function startLogin(intent) {
        if (loggingIn) return;
        loggingIn = true;
        setBusy(true);
        setMsg('Conectando con Google…', 'info');
        try {
            const cred = await loginWithGoogle();
            setMsg('Verificando…', 'info');
            await processUser(cred.user, intent);
        } catch (err) {
            setMsg(friendlyAuthError(err), 'error');
        } finally {
            loggingIn = false;
            setBusy(false);
        }
    }

    /* ---------- Eventos ---------- */
    el.btn.addEventListener('click', () => {
        setMsg('');
        showView(session ? 'welcome' : 'choose');
        openModal();
    });
    el.close.addEventListener('click', closeModal);
    el.play.addEventListener('click', closeModal);
    el.modal.addEventListener('pointerdown', (e) => { if (e.target === el.modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    el.student.addEventListener('click', () => startLogin('student'));
    el.admin.addEventListener('click', () => startLogin('admin'));
    el.logout.addEventListener('click', async () => {
        await logout();   // El observador limpia la sesión y destruye el editor
        closeModal();
    });

    // Sesión restaurada al recargar o cierre de sesión (los inicios de sesión nuevos los maneja startLogin)
    onAuthChange((user) => {
        if (loggingIn) return;
        processUser(user, null);
    });
}