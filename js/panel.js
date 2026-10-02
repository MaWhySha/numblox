// Numblox · Panel de personalización (oculto por defecto)
// Abrir: añade ?admin al final de la URL (aparece el botón ⚙) o usa el atajo Alt + Shift + C.
// El editor NO existe en la página hasta que Firestore confirma que la cuenta es la autorizada.
import { CONFIG, SPRITE_SLOTS, LIFE_KEYS, EXPLOSION_KEYS, EXPLOSION_GROUP, AUDIO_SLOTS, AUDIO_GROUP } from './config.js';
import { assets } from './assets.js';
import { loginAdmin, logoutAdmin, onAdminChange, verifyAdmin, uploadSprite, uploadAudio, resetSprite } from './firebase.js';

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

export function initAdminPanel() {
    const $ = (id) => document.getElementById(id);
    const el = {
        toggle: $('adminToggle'), panel: $('adminPanel'), close: $('adminClose'),
        loginView: $('adminLogin'), google: $('adminGoogle'), loginError: $('adminLoginError'),
        editor: $('adminEditor'), user: $('adminUser'), logout: $('adminLogout'),
        slots: $('adminSlots')
    };
    const rows = new Map(); // clave -> { thumb, status, bar, reset, input, root }
    const previewStoppers = []; // Una función "detener" por cada fila de audio
    const unsubscribers = [];   // Suscripciones de las filas del editor (se cancelan al desmontarlo)
    function stopPreview() { previewStoppers.forEach((stop) => stop()); }

    /* ---------- Abrir / cerrar ---------- */
    const params = new URLSearchParams(window.location.search);
    if (params.has('admin') || window.location.hash === '#admin') el.toggle.hidden = false;

    const openPanel = () => { el.panel.classList.add('open'); el.panel.setAttribute('aria-hidden', 'false'); };
    const closePanel = () => { stopPreview(); el.panel.classList.remove('open'); el.panel.setAttribute('aria-hidden', 'true'); };
    const togglePanel = () => (el.panel.classList.contains('open') ? closePanel() : openPanel());

    el.toggle.addEventListener('click', togglePanel);
    el.close.addEventListener('click', closePanel);
    el.panel.addEventListener('pointerdown', (e) => { if (e.target === el.panel) closePanel(); });
    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.shiftKey && e.code === 'KeyC') { e.preventDefault(); togglePanel(); }
        if (e.key === 'Escape') closePanel();
    });

    /* ---------- Login ---------- */
    el.google.addEventListener('click', async () => {
        el.loginError.textContent = '';
        try {
            await loginAdmin();
        } catch (err) {
            el.loginError.textContent = friendlyAuthError(err);
        }
    });
    el.logout.addEventListener('click', () => logoutAdmin());

    // El editor permanece cerrado hasta que Firestore confirme que la cuenta es la autorizada.
    // Cualquier otra cuenta de Google se desconecta al instante.
    let authRun = 0;
    onAdminChange(async (user) => {
        const run = ++authRun;
        unmountEditor(); // Por defecto no hay editor en la página
        el.editor.hidden = true;
        el.loginView.hidden = false;
        el.user.textContent = '';
        if (!user) return; // (el mensaje de error, si lo hay, se conserva)

        el.loginError.textContent = 'Verificando permisos…';
        let allowed = false;
        let failed = false;
        try {
            allowed = await verifyAdmin();
        } catch (err) {
            failed = true;
        }
        if (run !== authRun) return; // Llegó otro cambio de sesión mientras verificaba

        if (allowed) {
            mountEditor(); // Solo aquí se construye el editor
            el.loginError.textContent = '';
            el.loginView.hidden = true;
            el.editor.hidden = false;
            el.user.textContent = user.email || 'Administrador';
        } else {
            el.loginError.textContent = failed
                ? 'No se pudo verificar tu cuenta. Revisa tu conexión e inténtalo de nuevo.'
                : 'Esta cuenta no está autorizada como administrador.';
            await logoutAdmin();
            // Tras cerrar sesión, onAdminChange(null) se ejecuta de nuevo y deja el mensaje visible
        }
    });

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
    }

    // El editor se construye solo para el administrador verificado y se destruye al cerrar sesión
    function mountEditor() {
        unmountEditor();
        buildSlots();
        rows.forEach((_, key) => refreshRow(key));
    }

    function unmountEditor() {
        stopPreview();
        unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
        previewStoppers.length = 0;
        rows.clear();
        el.slots.innerHTML = '';
    }

    assets.subscribe((keys) => keys.forEach(refreshRow)); // Previews en vivo (sin filas = no hace nada)
}