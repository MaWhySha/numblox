// Numblox · Panel de personalización (oculto por defecto)
// Abrir: botón ⚙ discreto (esquina inferior izquierda) o atajo Alt + Shift + C
import { CONFIG, SPRITE_SLOTS, LIFE_KEYS, EXPLOSION_KEYS, EXPLOSION_GROUP, AUDIO_KEY, AUDIO_GROUP } from './config.js';
import { assets } from './assets.js';
import { loginAdmin, logoutAdmin, onAdminChange, uploadSprite, uploadAudio, resetSprite } from './firebase.js';

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
    let previewAudio = null; // Audio de la vista previa del panel
    let previewBtn = null;

    function stopPreview() {
        if (previewAudio) { previewAudio.pause(); previewAudio = null; }
        if (previewBtn) previewBtn.textContent = '▶ Escuchar';
    }

    /* ---------- Abrir / cerrar ---------- */
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

    onAdminChange((user) => {
        el.loginView.hidden = Boolean(user);
        el.editor.hidden = !user;
        el.user.textContent = user ? (user.email || 'Administrador') : '';
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

    // Música de fondo: un solo audio, suena únicamente durante la partida
    function buildAudioRow() {
        const root = document.createElement('div');
        root.className = 'slot-row slot-row-all';
        root.innerHTML = `
            <div class="slot-info">
                <strong>Música de fondo (zona de juego)</strong>
                <span class="slot-hint">Suena en bucle solo durante la partida. MP3, OGG o M4A de hasta ${Math.round(CONFIG.AUDIO.MAX_BYTES / 1024)} KB (≈ 1 minuto a 96 kbps). Si pesa más, recórtalo o comprímelo.</span>
                <span class="slot-hint audio-state"></span>
                <span class="slot-status"></span>
                <div class="slot-progress"><i></i></div>
            </div>
            <div class="slot-actions">
                <label class="admin-btn">Subir audio<input type="file" hidden accept="audio/*"></label>
                <button type="button" class="admin-btn" data-act="play">▶ Escuchar</button>
                <button type="button" class="admin-btn danger" data-act="reset">Restablecer por defecto</button>
            </div>`;

        const input = root.querySelector('input');
        const playBtn = root.querySelector('[data-act="play"]');
        const resetBtn = root.querySelector('[data-act="reset"]');
        const state = root.querySelector('.audio-state');
        const status = root.querySelector('.slot-status');
        const bar = root.querySelector('.slot-progress i');
        previewBtn = playBtn;

        const say = (text, type) => { status.textContent = text; status.className = `slot-status ${type || ''}`; };
        const refresh = () => {
            const has = assets.isCustom(AUDIO_KEY);
            state.textContent = has ? '● Audio personalizado activo' : '○ Sin audio (el juego suena en silencio)';
            playBtn.disabled = !has;
            resetBtn.disabled = !has;
        };

        playBtn.addEventListener('click', () => {
            if (previewAudio) { stopPreview(); return; }
            const url = assets.getUrl(AUDIO_KEY);
            if (!url) return;
            previewAudio = new Audio(url);
            previewAudio.volume = CONFIG.AUDIO.VOLUME;
            previewAudio.addEventListener('ended', stopPreview);
            previewAudio.play().catch(() => { say('El navegador no pudo reproducir este audio.', 'error'); stopPreview(); });
            playBtn.textContent = '■ Detener';
        });

        input.addEventListener('change', async () => {
            const file = input.files && input.files[0];
            input.value = '';
            if (!file) return;
            const error = validateAudio(file);
            if (error) { say(error, 'error'); return; }
            stopPreview();
            input.disabled = true;
            resetBtn.disabled = true;
            say('Subiendo… 0%');
            try {
                await uploadAudio(AUDIO_KEY, file, (p) => {
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
            if (!confirm('¿Restablecer la música? El juego quedará sin audio y se eliminará de la nube.')) return;
            stopPreview();
            resetBtn.disabled = true;
            say('Eliminando…');
            try {
                await resetSprite(AUDIO_KEY);
                say('✔ Restablecido', 'ok');
            } catch (err) {
                say(friendlyError(err), 'error');
            } finally {
                refresh();
            }
        });

        assets.subscribe((keys) => { if (keys.includes(AUDIO_KEY)) refresh(); });
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
        audioSection.appendChild(buildAudioRow());
        el.slots.appendChild(audioSection);
    }

    buildSlots();
    rows.forEach((_, key) => refreshRow(key));
    assets.subscribe((keys) => keys.forEach(refreshRow)); // Previews en vivo
}