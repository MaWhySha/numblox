import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC446mPO5t6O6Y2QW7uBQsq4FlbaY9H3xA",
    authDomain: "numblox-9a63b.firebaseapp.com",
    projectId: "numblox-9a63b",
    storageBucket: "numblox-9a63b.firebasestorage.app",
    messagingSenderId: "256574752909",
    appId: "1:256574752909:web:b3674d3404521c8e283ac4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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