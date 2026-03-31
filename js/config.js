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
// Estos valores se inyectan automáticamente desde los Secrets de GitHub durante el despliegue
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAFu993bWK7CsGaFEp6PnAp8tGEMLPUcoA",
    authDomain: "mics-te-ayuda.firebaseapp.com",
    projectId: "mics-te-ayuda",
    storageBucket: "mics-te-ayuda.firebasestorage.app",
    messagingSenderId: "194692607089",
    appId: "1:194692607089:web:90e62a7de9d84a793f7fd0"
};
