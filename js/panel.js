// Numblox · Panel de personalización (oculto por defecto)
// Abrir: botón ⚙ discreto (esquina inferior izquierda) o atajo Alt + Shift + C
import { CONFIG, SPRITE_SLOTS, LIFE_KEYS } from './config.js';
import { assets } from './assets.js';
import { loginAdmin, logoutAdmin, onAdminChange, uploadSprite, resetSprite } from './firebase.js';

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

    /* ---------- Abrir / cerrar ---------- */
    const openPanel = () => { el.panel.classList.add('open'); el.panel.setAttribute('aria-hidden', 'false'); };
    const closePanel = () => { el.panel.classList.remove('open'); el.panel.setAttribute('aria-hidden', 'true'); };
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

    function buildSlots() {
        const groups = [...new Set(SPRITE_SLOTS.map((s) => s.group))];
        for (const group of groups) {
            const section = document.createElement('section');
            section.className = 'slot-group';
            const title = document.createElement('h3');
            title.textContent = group;
            section.appendChild(title);
            if (group === 'Vidas') section.appendChild(buildAllLivesRow());
            SPRITE_SLOTS.filter((s) => s.group === group).forEach((slot) => section.appendChild(buildRow(slot)));
            el.slots.appendChild(section);
        }
    }

    buildSlots();
    rows.forEach((_, key) => refreshRow(key));
    assets.subscribe((keys) => keys.forEach(refreshRow)); // Previews en vivo
}