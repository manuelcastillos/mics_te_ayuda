// ============================================================
// MICS TE AYUDA — Configuración
// Modo DEMO: funciona sin API keys usando Leaflet + OpenStreetMap
// Para producción: ver README.md para configurar Firebase
// ============================================================

// Coordenadas de FACIMAR (Facultad de Ciencias del Mar, UV - Montemar)
const FACIMAR_LAT = -32.957119;
const FACIMAR_LNG = -71.549831;

// Modo producción: si es false, intentará conectar a Firebase
const DEMO_MODE = false;

// Para que funcione, pega aquí el objeto de configuración que te da la consola de Firebase
const FIREBASE_CONFIG = {
    apiKey: "TU-API-KEY",
    authDomain: "TU-PROYECTO.firebaseapp.com",
    projectId: "TU-PROYECTO",
    storageBucket: "TU-PROYECTO.firebasestorage.app",
    messagingSenderId: "TU-ID",
    appId: "TU-APP-ID"
};
