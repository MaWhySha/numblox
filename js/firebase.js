import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
    collection, addDoc, serverTimestamp, doc, onSnapshot, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
    getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { CONFIG, SPRITE_SLOTS } from './config.js';
import { prepareImage } from './image-utils.js';

const firebaseConfig = {
    apiKey: "AIzaSyC446mPO5t6O6Y2QW7uBQsq4FlbaY9H3xA",
    authDomain: "numblox-9a63b.firebaseapp.com",
    projectId: "numblox-9a63b",
    storageBucket: "numblox-9a63b.firebasestorage.app",
    messagingSenderId: "256574752909",
    appId: "1:256574752909:web:b3674d3404521c8e283ac4"
};

const app = initializeApp(firebaseConfig);
// Caché local: tras la primera visita solo se descargan los sprites que cambiaron (menos lecturas y carga más rápida)
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const auth = getAuth(app);

/* ---------------- MÉTRICAS (sin cambios) ---------------- */
export async function saveGameMetrics(metrics) {
    try {
        const docRef = await addDoc(collection(db, "student_sessions"), {
            score: metrics.score || 0,
            correctAnswers: metrics.correctAnswers || 0,
            wrongAnswers: metrics.wrongAnswers || 0,
            timestamp: serverTimestamp()
        });
        console.log("Datos guardados en Firestore, ID:", docRef.id);
    } catch (err) {
        console.error("Error al guardar en Firebase:", err);
    }
}

/* ---------------- PERSONALIZACIÓN EN TIEMPO REAL ----------------
   Colección "visuals": un documento por elemento personalizado.
   visuals/<clave> -> { url: "data:image/webp;base64,...", updatedAt }
   Sin documento = diseño base. */
const visualsCol = () => collection(db, CONFIG.ASSETS.COLLECTION);

export function subscribeVisuals(onData, onError) {
    return onSnapshot(
        visualsCol(),
        (snap) => {
            const map = {};
            snap.forEach((d) => { map[d.id] = d.data(); });
            onData(map);
        },
        (err) => {
            console.error("Error leyendo personalización:", err);
            if (onError) onError(err);
        }
    );
}

// Optimiza la imagen en el navegador y la guarda en Firestore (gratis, sin Storage)
export async function uploadSprite(key, file, onProgress) {
    const slot = SPRITE_SLOTS.find((s) => s.key === key);
    const kind = slot ? slot.kind : 'sprite';
    if (onProgress) onProgress(0.1);
    const url = await prepareImage(file, kind);
    if (onProgress) onProgress(0.6);
    await setDoc(doc(db, CONFIG.ASSETS.COLLECTION, key), { url, updatedAt: Date.now() });
    if (onProgress) onProgress(1);
    return { url };
}

function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo.'));
        reader.readAsDataURL(file);
    });
}

// Guarda un audio (MP3/OGG/M4A…) como data URL en el mismo documento-por-clave que las imágenes
export async function uploadAudio(key, file, onProgress) {
    if (file.size > CONFIG.AUDIO.MAX_BYTES) {
        throw new Error(`El audio pesa ${Math.round(file.size / 1024)} KB y el máximo es ${Math.round(CONFIG.AUDIO.MAX_BYTES / 1024)} KB.`);
    }
    if (onProgress) onProgress(0.2);
    const url = await readAsDataURL(file);
    if (url.length > 990000) throw new Error('El audio es demasiado pesado para la base de datos.');
    if (onProgress) onProgress(0.6);
    await setDoc(doc(db, CONFIG.ASSETS.COLLECTION, key), { url, updatedAt: Date.now() });
    if (onProgress) onProgress(1);
    return { url };
}

// Restablecer: borra el documento y el juego vuelve al diseño base
export async function resetSprite(key) {
    await deleteDoc(doc(db, CONFIG.ASSETS.COLLECTION, key));
}

/* ---------------- AUTENTICACIÓN DEL ADMINISTRADOR ---------------- */
export const loginAdmin = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logoutAdmin = () => signOut(auth);
export const onAdminChange = (callback) => onAuthStateChanged(auth, callback);