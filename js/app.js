// ============================================================
// MICS TE AYUDA — app.js
// Leaflet.js + OpenStreetMap + Firebase Realtime Database
// ============================================================

// ---- Estado global ----
let myUserId     = null; // Se asignará vía Firebase Auth
let selectedMicro = null;
let watchId       = null;
let startTime     = null;
let trackingTimer = null;
let leafletMap    = null;
let myMarker      = null;
let activeFilter  = 'all';
let arrivedAtFacimar = false;
let lastSyncTime     = null;
let heatmapLayer     = null;
let heatmapActive    = false;
let observerMode     = false; // Modo solo-ver: conecta a Firebase pero no publica posición
let listenerActive   = false; 
let pendingListenerInit = false; 
let hasCenteredOnThisSession = false; // Flag to center map once GPS is found
let sedeMarkers = []; // Array para guardar los marcadores de las sedes universitarias

const DEMO_MODE      = false; // Falso para producción con Firebase
let currentAlert     = null;  // Alerta comunitaria activa (Fauna, Taco, etc.)

// ---- Inicialización de Firebase ----
let db = null;
let serverTimeOffset = 0;

try {
    if (typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey !== "TU-API-KEY") {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        
        // Monitorear estado de conexión en tiempo real
        db.ref('.info/connected').on('value', (snap) => {
            const connected = snap.val() === true;
            setConnStatus(connected);
        });

        // Autenticación Anónima
        firebase.auth().signInAnonymously()
            .then((result) => {
                myUserId = result.user.uid;
                console.log('[MICS] Autenticado anónimamente ✅ ID:', myUserId);
                
                // Limpieza automática al desconectar o cerrar la app
                db.ref("viajeros/" + myUserId).onDisconnect().remove();
                
                db.ref('.info/serverTimeOffset').on('value', function(snapshot) {
                    serverTimeOffset = snapshot.val() || 0;
                });

                // ---- FIX: iniciar listener si el mapa ya existe,
                // o marcar como pendiente para cuando el mapa se abra ----
                if (leafletMap) {
                    initRealTimeUpdates();
                } else {
                    pendingListenerInit = true; // se iniciará en initMapIfNeeded
                }
            })
            .catch((error) => {
                console.error('[MICS] Error en Auth:', error.code, error.message);
                showToast('❌ Error de conexión con el servidor');
                setConnStatus(false);
            });
    }
} catch(e) {
    console.error('[MICS] Error al inicializar Firebase:', e);
}

// Fallback: si Firebase no carga, generar un ID local
if (!db) {
    myUserId = 'user_' + Math.random().toString(36).substr(2, 9);
}

// Colores por micro
const COLORS = {
    '601': '#e63946',
    '302': '#2a6fdb',
    'default': '#a78bfa'
};

function getColor(micro) {
    return COLORS[micro] || COLORS['default'];
}

// Generador de SVG para la micro (vista de lado) o Avatar
function getBusIconHTML(color, count = 1, avatar = '🚌') {
    const isBus = !avatar || avatar === '🚌';
    
    if (isBus) {
        const badgeHTML = count > 1 ? `
      <circle cx="95" cy="5" r="15" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
      <text x="95" y="10" font-family="sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="middle">${count}</text>
      ` : '';

        return `<svg style="filter: drop-shadow(0px 3px 5px rgba(0,0,0,0.5)); overflow:visible;" viewBox="-5 -5 115 65" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
      <path d="M 8,15 Q 8,8 15,8 L 80,8 Q 95,8 96,25 L 96,48 Q 96,52 92,52 L 8,52 Q 4,52 4,48 Z" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
      <rect x="12" y="14" width="18" height="18" rx="2" fill="#ffffff" />
      <rect x="34" y="14" width="22" height="18" rx="2" fill="#ffffff" />
      <rect x="60" y="14" width="16" height="18" rx="2" fill="#ffffff" />
      <path d="M 80,14 L 87,14 Q 91,14 93.5,28 L 80,28 Z" fill="#ffffff"/>
      <circle cx="25" cy="52" r="8" fill="#222" stroke="#ffffff" stroke-width="2"/>
      <circle cx="75" cy="52" r="8" fill="#222" stroke="#ffffff" stroke-width="2"/>
      <circle cx="25" cy="52" r="3" fill="#ccc"/>
      <circle cx="75" cy="52" r="3" fill="#ccc"/>
      <rect x="94" y="42" width="4" height="6" rx="1" fill="#facc15" />
      <rect x="2" y="36" width="3" height="8" rx="1" fill="#ef4444" />
      ${badgeHTML}
    </svg>`;
    } else {
        const badgeHTML = count > 1 ? `
        <div style="position:absolute; top:-6px; right:-6px; background:#ef4444; color:white; border-radius:50%; width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3); z-index:10;">
            ${count}
        </div>` : '';
        return `
        <div style="position:relative; width:100%; height:100%; border-radius:50%; background:${color}; border:2px solid white; display:flex; align-items:center; justify-content:center; font-size:24px; filter:drop-shadow(0px 3px 5px rgba(0,0,0,0.5));">
            ${avatar}
            ${badgeHTML}
        </div>`;
    }
}

// Radio de llegada a FACIMAR (metros)
const ARRIVAL_RADIUS_M = 30;

// ---- Fórmula Haversine: distancia entre dos coords en metros ----
function getDistanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000; // radio Tierra en metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---- Datos de demo: viajeros simulados ----
// Rutas aproximadas: 601 baja por Av. España, 302 por Av. Argentina
const DEMO_ROUTES = {
    '601': [
        { lat: -33.0170, lng: -71.5520 }, // Viña Centro
        { lat: -33.0050, lng: -71.5500 }, // 15 Norte
        { lat: -32.9850, lng: -71.5480 }, // Las Salinas
        { lat: -32.9700, lng: -71.5450 }, // Reñaca
        { lat: FACIMAR_LAT, lng: FACIMAR_LNG } // Montemar (FACIMAR)
    ],
    '302': [
        { lat: -33.0440, lng: -71.6190 }, // Valparaíso
        { lat: -33.0250, lng: -71.5700 }, // Av. España
        { lat: -33.0100, lng: -71.5550 }, // Libertad
        { lat: -32.9800, lng: -71.5470 }, // Reñaca
        { lat: FACIMAR_LAT, lng: FACIMAR_LNG } // Montemar (FACIMAR)
    ]
};

// Estado de los viajeros demo
let demoTravelers = [
    { id: 'demo_1', micro: '601', progress: 0.15, name: 'Viajero A' },
    { id: 'demo_2', micro: '601', progress: 0.45, name: 'Viajero B' },
    { id: 'demo_3', micro: '302', progress: 0.30, name: 'Viajero C' },
    { id: 'demo_4', micro: '302', progress: 0.70, name: 'Viajero D' },
    { id: 'demo_5', micro: '601', progress: 0.80, name: 'Viajero E' }
];

let demoMarkerRefs = {}; // Leaflet markers por id

// ---- Navegación entre pantallas ----
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        if (id === 'map-screen') {
            initMapIfNeeded();
            // Si ya tenemos GPS, centrar de inmediato
            if (window.latestPos && leafletMap) {
                const { latitude, longitude } = window.latestPos.coords;
                leafletMap.setView([latitude, longitude], 15);
                hasCenteredOnThisSession = true;
            } else {
                hasCenteredOnThisSession = false; // Reset para centrar cuando llegue el primer punto
            }
        } else {
            hasCenteredOnThisSession = false; // Reset al salir del mapa
        }
    }
}
window.showScreen = showScreen;

function startApp() {
    showScreen('main-screen');
    startBackgroundLocation();
}
window.startApp = startApp;

// Track background location implicitly so proximity works without explicit sharing
let backgroundWatchId = null;
function startBackgroundLocation() {
    if (!navigator.geolocation) return;
    if (backgroundWatchId !== null) return;
    
    // Iniciar el listener de ubicación
    backgroundWatchId = navigator.geolocation.watchPosition(
        (pos) => {
            window.latestPos = pos;
            checkProximityAlert(window.latestActiveUsersList || []);
        },
        (err) => console.log('[MICS] Background location err:', err.message),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
    );
}

// Global list for active users so checkProximityAlert can be triggered reliably
window.latestActiveUsersList = [];

// ---- Interpolación de posición en ruta ----
function interpolateRoute(route, progress) {
    if (progress >= 1) return route[route.length - 1];
    const segCount   = route.length - 1;
    const rawSeg     = progress * segCount;
    const segIdx     = Math.min(Math.floor(rawSeg), segCount - 1);
    const segProg    = rawSeg - segIdx;
    const a = route[segIdx];
    const b = route[segIdx + 1] || route[segIdx];
    return {
        lat: a.lat + (b.lat - a.lat) * segProg,
        lng: a.lng + (b.lng - a.lng) * segProg
    };
}

// ---- Gestión del Mapa (Usuarios Reales) ----
let remoteMarkers = {}; 

function timeAgo(timestamp) {
    if (!timestamp) return '';
    const diffMin = Math.floor((Date.now() - timestamp) / 60000);
    if (diffMin < 1) return 'ahora mismo';
    if (diffMin === 1) return 'hace 1 min';
    return `hace ${diffMin} min`;
}

function updateMapMarkers(activeUsers) {
    // 1. Agrupar viajeros por proximidad (< 150m) si son de la misma micro
    let clusters = [];
    activeUsers.forEach(u => {
        if (activeFilter !== 'all' && u.micro !== activeFilter) return;
        let added = false;
        for (let c of clusters) {
            if (c.micro === u.micro && getDistanceMeters(c.lat, c.lng, u.lat, u.lng) < 150) {
                c.count++;
                if (u.id === myUserId) c.includesMe = true;
                if (u.lastUpdate > c.lastUpdate) c.lastUpdate = u.lastUpdate; // Timestamp más reciente
                added = true;
                break;
            }
        }
        if (!added) {
            clusters.push({ 
                id: u.id, micro: u.micro, lat: u.lat, lng: u.lng, 
                count: 1, lastUpdate: u.lastUpdate || 0,
                includesMe: (u.id === myUserId),
                avatar: u.avatar || '🚌',
                alert: u.alert || null
            });
        }
    });

    const activeClusterIds = new Set(clusters.map(c => c.id));

    // Eliminar clusters obsoletos
    Object.keys(remoteMarkers).forEach(id => {
        if (!activeClusterIds.has(id)) {
            leafletMap.removeLayer(remoteMarkers[id]);
            delete remoteMarkers[id];
        }
    });

    // Crear o actualizar clusters
    clusters.forEach(c => {
        // Si no estamos en modo observador y el cluster me incluye, actualizamos el myMarker local en lugar de uno remoto
        if (!observerMode && c.includesMe) {
            if (myMarker) {
                const color = getColor(c.micro);
                const isBus = !c.avatar || c.avatar === '🚌';
                const sizeHeight = isBus ? 36 : 42;
                const sizeWidth = isBus ? sizeHeight * 1.6 : 42;
                const icon = L.divIcon({
                    className: '',
                    html: `
                        <div style="position:relative; width:${sizeWidth}px;height:${sizeHeight}px;filter:drop-shadow(0 0 6px ${color})">
                            ${getBusIconHTML(color, c.count, c.avatar)}
                            ${c.alert ? `<div class="marker-alert-badge">${c.alert}</div>` : ''}
                        </div>`,
                    iconSize: [sizeWidth, sizeHeight],
                    iconAnchor: [sizeWidth/2, sizeHeight/2]
                });
                myMarker.setIcon(icon);
                
                let popupText = `<strong>📍 Tú</strong><br>Micro ${c.micro}`;
                if (c.count > 1) {
                    popupText += `<br>¡Vas junto a ${c.count - 1} colega(s)! 🙌`;
                }
                myMarker.setPopupContent(popupText);
            }
            return; // No dibujar remoteMarker para evitar doble ícono encima de miMarker
        }

        const color = getColor(c.micro);
        const isBus = !c.avatar || c.avatar === '🚌';
        // Ligeramente más grande si es cluster para que se vea bien
        const sizeHeight = isBus && c.count > 1 ? 28 : (isBus ? 24 : 36); 
        const sizeWidth = isBus ? sizeHeight * 1.6 : 36;
        const icon = L.divIcon({
            className: '',
            html: `
                <div style="position:relative; width:${sizeWidth}px;height:${sizeHeight}px;">
                    ${getBusIconHTML(color, c.count, c.avatar)}
                    ${c.alert ? `<div class="marker-alert-badge">${c.alert}</div>` : ''}
                </div>`,
            iconSize: [sizeWidth, sizeHeight],
            iconAnchor: [sizeWidth/2, sizeHeight/2]
        });

        let popupText = `🚌 Micro ${c.micro} · ${timeAgo(c.lastUpdate)}`;
        if (c.alert) popupText += `<br>🚨 <strong>Reporta: ${c.alert.length > 2 ? c.alert : 'Evento'}</strong>`;
        if (c.count > 1) popupText = `🚌 Micro ${c.micro} · ${c.count} personas juntas.`;

        if (remoteMarkers[c.id]) {
            remoteMarkers[c.id].setLatLng([c.lat, c.lng]);
            remoteMarkers[c.id].setOpacity(1);
            remoteMarkers[c.id].setPopupContent(popupText);
            remoteMarkers[c.id].setIcon(icon);
        } else {
            remoteMarkers[c.id] = L.marker([c.lat, c.lng], { icon })
                .addTo(leafletMap)
                .bindPopup(popupText);
        }
    });
}

// ---- Inicializar mapa Leaflet ----
function initMapIfNeeded() {
    if (leafletMap) {
        leafletMap.invalidateSize();
        return;
    }

    leafletMap = L.map('map', {
        center: [FACIMAR_LAT, FACIMAR_LNG],
        zoom: 13,
        zoomControl: true,
        attributionControl: true
    });

    // Tiles claros de CartoDB (Voyager)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(leafletMap);

    // ---- Marcadores de Sedes UV ----
    const sedes = [
        { lat: FACIMAR_LAT, lng: FACIMAR_LNG, label: "FACIMAR UV", icon: "🎓", color: "#00b4d8" },
        { lat: CIAE_LAT, lng: CIAE_LNG, label: "CIAE UV", icon: "🏢", color: "#facc15" },
        { lat: CIENCIAS_LAT, lng: CIENCIAS_LNG, label: "CIENCIAS UV", icon: "🔬", color: "#10b981" },
        { lat: SALUD_LAT, lng: SALUD_LNG, label: "SALUD UV", icon: "🩺", color: "#ef4444" }
    ];

    sedes.forEach((sede, index) => {
        // Círculo de zona de llegada
        L.circle([sede.lat, sede.lng], {
            radius: ARRIVAL_RADIUS_M,
            color: sede.color,
            fillColor: sede.color,
            fillOpacity: 0.08,
            weight: 2,
            dashArray: '6 4'
        }).addTo(leafletMap);

        // Ícono grande con animación
        const custom_icon = L.divIcon({
            className: '',
            html: `
                <div style="position:relative;width:48px;height:48px;">
                    <div style="
                        position:absolute;inset:0;
                        background:${sede.color}33;
                        border:2px solid ${sede.color};
                        border-radius:50%;
                        animation:facimar-pulse 2s ease-out infinite;
                        animation-delay: ${index * 0.4}s;
                    "></div>
                    <div style="
                        position:absolute;inset:8px;
                        background:#0d1b2e;
                        border:2px solid ${sede.color};
                        border-radius:50%;
                        display:flex;align-items:center;justify-content:center;
                        font-size:18px;
                    ">${sede.icon}</div>
                </div>`,
            iconSize: [48, 48],
            iconAnchor: [24, 24]
        });

        const marker = L.marker([sede.lat, sede.lng], { icon: custom_icon })
            .addTo(leafletMap)
            .bindPopup(`
                <div style="font-family:sans-serif; text-align:center;">
                    <strong>📍 ${sede.label}</strong>
                </div>`);
        
        sedeMarkers.push(marker); // Guardar para ocultar después
        
        if (sede.label === "FACIMAR UV") {
            marker.openPopup();
        }
    });

    // Añadir keyframe de animación al DOM
    if (!document.getElementById('facimar-style')) {
        const s = document.createElement('style');
        s.id = 'facimar-style';
        s.textContent = `
            @keyframes facimar-pulse {
                0%   { transform:scale(1);   opacity:0.9; }
                70%  { transform:scale(2.2); opacity:0;   }
                100% { transform:scale(1);   opacity:0;   }
            }`;
        document.head.appendChild(s);
    }
    
    // ---- Capa de Calor (Heatmap) ----
    heatmapLayer = L.heatLayer([], {
        radius: 35,
        blur: 15,
        maxZoom: 14,
        gradient: {0.4: 'blue', 0.65: 'lime', 1: 'yellow'}
    }); // No añadir al mapa aún

    // Iniciar escucha de datos reales
    if (db) {
        // Si auth ya completó (myUserId disponible), iniciar listener; si pendiente, también
        if (myUserId || pendingListenerInit) {
            initRealTimeUpdates();
        }
        // Si auth aún no terminó, el callback de auth llamará initRealTimeUpdates()
        // porque leafletMap ya estará definido
    } else {
        setInterval(updateDemoSimulation, 2000);
    }

    // Badge de modo observador
    const badge = document.getElementById('observer-badge');
    if (badge) badge.style.display = observerMode ? 'flex' : 'none';
}

// ---- Límite máximo de viajeros en Firebase ----
const MAX_VIAJEROS = 500; // Incrementado drásticamente para evitar borrado prematuro

// ---- Conexión: actualizar el punto en la UI ----
function setConnStatus(online) {
    const dot = document.getElementById('conn-status');
    if (!dot) return;
    dot.className = 'conn-dot ' + (online ? 'conn-online' : 'conn-offline');
    dot.title = online ? 'Conectado ✅' : 'Sin conexión ❌';
}

// ---- ETA a FACIMAR basado en posición actual ----
function updateETA(lat, lng) {
    const distKm = getDistanceMeters(lat, lng, FACIMAR_LAT, FACIMAR_LNG) / 1000;
    // Velocidad promedio de micro en Viña: ~25 km/h en ruta urbana
    const etaMin = Math.ceil((distKm / 25) * 60);

    const badge = document.getElementById('eta-badge');
    const val   = document.getElementById('eta-value');

    if (!badge || !val) return;

    if (distKm < 0.05) { // Ya llegó
        badge.style.display = 'none';
        return;
    }

    badge.style.display = 'flex';
    val.textContent = etaMin <= 1 ? '~1 min' : `~${etaMin} min`;
}

// ---- Señal de proximidad ----
const PROXIMITY_RADIUS_M = 100;  // metros
let proximityAlertActive = false; // evitar spam de alertas
let proximityAlertTimeout = null;

function checkProximityAlert(activeUsersList) {
    // Asegurar que tenemos coordenadas
    if (!window.latestPos) {
        clearProximityUI();
        return;
    }

    const myLat = window.latestPos.coords.latitude;
    const myLng = window.latestPos.coords.longitude;

    const nearby = activeUsersList.filter(u => {
        if (u.id === myUserId) return false;
        return getDistanceMeters(myLat, myLng, u.lat, u.lng) <= PROXIMITY_RADIUS_M;
    });

    if (nearby.length > 0) {
        const micros = [...new Set(nearby.map(u => u.micro))].join(', ');
        const msg = `¡${nearby.length > 1 ? nearby.length + ' compañeros' : 'Compañero'} a menos de 100m! Micro: ${micros}`;
        
        // Banner sobre el mapa
        const mapBanner = document.getElementById('map-proximity-banner');
        const mapMsg    = document.getElementById('map-proximity-msg');
        if (mapBanner) { mapBanner.classList.remove('hidden'); if (mapMsg) mapMsg.textContent = msg; }

        // Banner en pantalla principal
        const alertEl = document.getElementById('proximity-alert');
        const msgEl   = document.getElementById('proximity-msg');
        if (alertEl) { alertEl.classList.remove('hidden'); if (msgEl) msgEl.textContent = msg; }

        if (!proximityAlertActive) {
            proximityAlertActive = true;
            if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);

            // Auto-reset visibilidad del banner después de 30s
            clearTimeout(proximityAlertTimeout);
            proximityAlertTimeout = setTimeout(() => {
                proximityAlertActive = false;
                clearProximityUI();
            }, 30000);
        }
    } else {
        clearProximityUI();
    }
}

function clearProximityUI() {
    proximityAlertActive = false;
    const alertEl   = document.getElementById('proximity-alert');
    const mapBanner = document.getElementById('map-proximity-banner');
    if (alertEl)   alertEl.classList.add('hidden');
    if (mapBanner) mapBanner.classList.add('hidden');
}

function closeProximityAlert() {
    clearTimeout(proximityAlertTimeout);
    clearProximityUI();
    // No alertar de nuevo por 30s
    proximityAlertTimeout = setTimeout(() => { proximityAlertActive = false; }, 30000);
    proximityAlertActive = true;
}
window.closeProximityAlert = closeProximityAlert;

function initRealTimeUpdates() {
    if (!db || !myUserId) {
        // Auth aún no completó: marcar como pendiente
        pendingListenerInit = true;
        console.warn('[MICS] initRealTimeUpdates: auth no lista, diferido.');
        return;
    }

    // Guard: solo registrar el listener UNA VEZ
    if (listenerActive) {
        console.log('[MICS] Listener ya activo, no se duplica.');
        return;
    }
    listenerActive = true;
    pendingListenerInit = false;

    console.log('[MICS] 🔴 Iniciando listener de /viajeros...');
    
    db.ref("viajeros").on("value", (snapshot) => {
        let counts = {};
        const now = Date.now() + serverTimeOffset;
        const activeUsersList = [];

        snapshot.forEach((child) => {
            const data = child.val();
            if (!data || data.lat == null || data.lng == null) return;

            const lastUpdate = data.lastUpdate || now; // Si no tiene timestamp asume actual
            
            // Incluir viajeros activos en los últimos 15 minutos
            if (now - lastUpdate < 900000) {
                activeUsersList.push({ id: child.key, ...data });
                counts[data.micro] = (counts[data.micro] || 0) + 1;
            }
        });

        console.log(`[MICS] Snapshot recibido: ${activeUsersList.length} viajero(s) activo(s)`);

        const tcount = document.getElementById('travelers-count');
        if (tcount) tcount.textContent = activeUsersList.length;
        
        // Actualizar breakdown dinámicamente
        const container = document.querySelector('.travelers-breakdown');
        if (container) {
            container.innerHTML = '';
            if (Object.keys(counts).length === 0) {
                container.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">Nadie en camino ahora</span>';
            } else {
                Object.keys(counts).sort().forEach(m => {
                    const color = getColor(m);
                    const tag = document.createElement('span');
                    tag.className = 'tag';
                    tag.style.background = `${color}22`;
                    tag.style.color = color;
                    tag.style.border = `1px solid ${color}44`;
                    tag.textContent = `${m}: ${counts[m]}`;
                    container.appendChild(tag);
                });
            }
        }

        if (leafletMap) {
            updateMapMarkers(activeUsersList);
            updateHeatmap(activeUsersList);
        }

        window.latestActiveUsersList = activeUsersList;
        checkProximityAlert(activeUsersList);

    }, (error) => {
        console.error('[MICS] Error leyendo /viajeros:', error.code, error.message);
        showToast('⚠️ Sin permiso para leer el mapa. Revisa las reglas de Firebase.');
        listenerActive = false; // Permitir reintentar
    });
}

function updateHeatmap(users) {
    if (!heatmapLayer) return;
    const points = users
        .filter(u => activeFilter === 'all' || u.micro === activeFilter)
        .map(u => [u.lat, u.lng, 0.8]); // lat, lng, intensidad
    heatmapLayer.setLatLngs(points);
}

function toggleHeatmap() {
    if (!leafletMap || !heatmapLayer) return;
    
    heatmapActive = !heatmapActive;
    const btn = document.getElementById('btn-heatmap');
    
    if (heatmapActive) {
        heatmapLayer.addTo(leafletMap);
        btn.classList.add('active');
        showToast('🔥 Modo Densidad ACTIVADO');
    } else {
        leafletMap.removeLayer(heatmapLayer);
        btn.classList.remove('active');
        showToast('📍 Modo Densidad DESACTIVADO');
    }
}
window.toggleHeatmap = toggleHeatmap;

function updateDemoSimulation() {
    if (!leafletMap) return;

    // Actualizar progreso de cada viajero demo
    const activeDemoUsers = [];
    demoTravelers.forEach(u => {
        u.progress += 0.005; // Avanzar un poco
        if (u.progress > 1) u.progress = 0; // Reiniciar si llega a FACIMAR

        const route = DEMO_ROUTES[u.micro] || DEMO_ROUTES['601'];
        const pos = interpolateRoute(route, u.progress);
        activeDemoUsers.push({ id: u.id, micro: u.micro, lat: pos.lat, lng: pos.lng });
        
        const color = getColor(u.micro);
        const sizeHeight = 24;
        const sizeWidth = sizeHeight * 1.6;
        const icon = L.divIcon({
            className: '',
            html: `<div style="width:${sizeWidth}px;height:${sizeHeight}px;">${getBusIconHTML(color)}</div>`,
            iconSize: [sizeWidth, sizeHeight],
            iconAnchor: [sizeWidth/2, sizeHeight/2]
        });

        if (demoMarkerRefs[u.id]) {
            demoMarkerRefs[u.id].setLatLng([pos.lat, pos.lng]);
        } else {
            demoMarkerRefs[u.id] = L.marker([pos.lat, pos.lng], { icon })
                .addTo(leafletMap)
                .bindPopup(`🚌 ${u.micro}`);
        }

        // Respetar filtro
        if (activeFilter !== 'all' && u.micro !== activeFilter) {
            demoMarkerRefs[u.id].setOpacity(0);
        } else {
            demoMarkerRefs[u.id].setOpacity(1);
        }
    });

    document.getElementById('travelers-count').textContent = demoTravelers.length;
    updateHeatmap(activeDemoUsers);
}

// ---- Reloj en tiempo real ----
function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-CL', { hour12: false });
    const clockMain = document.getElementById('app-clock-main');
    const clockMap = document.getElementById('app-clock-map');
    if (clockMain) clockMain.textContent = timeStr;
    if (clockMap) clockMap.textContent = timeStr;
}
setInterval(updateClock, 1000);

// ---- Selección de micro e inicio de tracking ----
function requestCustomMicro() {
    document.getElementById('custom-micro-area').classList.remove('hidden');
    document.getElementById('custom-micro-name').focus();
    // Resetear opacidad de botones
    document.querySelectorAll('.micro-btn').forEach(b => b.style.opacity = '0.4');
    document.getElementById('btn-otro').style.opacity = '1';
}
window.requestCustomMicro = requestCustomMicro;

function confirmCustomMicro() {
    const val = document.getElementById('custom-micro-name').value.trim().toLowerCase();
    if (!val) {
        showToast('⚠️ Por favor escribe el número de la micro');
        return;
    }
    
    // Validación: Solo números o la palabra "tren"
    const isNumber = /^\d+$/.test(val);
    const isTren = (val === 'tren');
    
    if (!isNumber && !isTren) {
        showToast('⚠️ Solo se permiten números o la palabra "tren"');
        return;
    }

    document.getElementById('custom-micro-area').classList.add('hidden');
    selectMicro(val.toUpperCase());
}
window.confirmCustomMicro = confirmCustomMicro;

function selectMicro(micro) {
    selectedMicro = micro;
    const label = (micro === '601' || micro === '302' || micro === 'TREN') ? `${micro}` : `${micro}`;

    document.querySelectorAll('.micro-btn').forEach(b => b.style.opacity = '0.4');
    const specificBtn = document.getElementById(`btn-${micro.toLowerCase()}`);
    if (specificBtn) specificBtn.style.opacity = '1';
    else document.getElementById('btn-otro').style.opacity = '1';

    document.getElementById('status-icon').textContent = '📡';
    document.getElementById('status-title').textContent = `${label} seleccionada`;
    document.getElementById('status-subtitle').textContent = 'Solicitando acceso a tu GPS...';
    
    startTracking(micro);
}
window.selectMicro = selectMicro;

// ---- Variables del tracker ----
let watchPublishInterval = null;

// ---- Iniciar tracking GPS ----
function startTracking(micro) {
    if (!navigator.geolocation) {
        showToast('⚠️ Tu navegador no soporta geolocalización.');
        return;
    }
    if (!myUserId) {
        showToast('⚠️ Conectando al servidor... intenta en unos segundos.');
        return;
    }

    showToast('📡 Pidiendo señal GPS...');

    let isFirstPosition = true;
    window.latestPos = null;

    // Llamada rápida forzada previa al watch (hack para despertar la API más velozmente)
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            if (isFirstPosition) {
                showTrackingUI(micro);
                isFirstPosition = false;
                publishMyPosition(pos.coords.latitude, pos.coords.longitude, micro);
            }
            window.latestPos = pos;
        },
        (err) => console.log('getCurrentPos info:', err.message),
        { enableHighAccuracy: false, timeout: 5000, maximumAge: Infinity }
    );

    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            if (isFirstPosition) {
                showTrackingUI(micro);
                isFirstPosition = false;
                publishMyPosition(pos.coords.latitude, pos.coords.longitude, micro);
            }
            window.latestPos = pos;
        },
        (err) => {
            console.error('Error watchPosition:', err.message);
            if (isFirstPosition) {
                showToast('❌ GPS sin respuesta: ¿Tienes la ubicación activada y con permisos otorgados a tu navegador web?');
                stopTracking(); // Limpiar UI falso
                isFirstPosition = false;
            }
        },
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
    );

    // Publicar la posición en Firebase cada 15 segundos en lugar de 3 minutos
    watchPublishInterval = setInterval(() => {
        if (window.latestPos && !arrivedAtFacimar) {
            publishMyPosition(window.latestPos.coords.latitude, window.latestPos.coords.longitude, micro);
        }
    }, 15000);
}

// ---- Demo tracking (sin GPS real) ----
function startDemoTracking(micro) {
    showTrackingUI(micro);
    const route = DEMO_ROUTES[micro] || DEMO_ROUTES['601'];
    let step = 0;

    const interval = setInterval(() => {
        const pos = route[Math.min(step, route.length - 1)];
        document.getElementById('tracking-coords').textContent = 
            `📍 ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)} (simulado)`;
        
        if (leafletMap) {
            const color = COLORS[micro];
            const sizeHeight = 32;
            const sizeWidth = sizeHeight * 1.6;
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:${sizeWidth}px;height:${sizeHeight}px;">${getBusIconHTML(color)}</div>`,
                iconSize: [sizeWidth, sizeHeight],
                iconAnchor: [sizeWidth/2, sizeHeight/2]
            });

            if (myMarker) leafletMap.removeLayer(myMarker);
            myMarker = L.marker([pos.lat, pos.lng], { icon })
                .addTo(leafletMap)
                .bindPopup('📍 Tú (simulado)');
            
            leafletMap.panTo([pos.lat, pos.lng]);
        }
        
        lastSyncTime = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('status-subtitle').textContent = `Última actualización: ${lastSyncTime}`;

        // Geovalla demo: detener al llegar al último punto (FACIMAR)
        if (step >= route.length - 1) {
            clearInterval(interval);
            watchId = null;
            arrivedAtFacimar = true;
            showToast('🎓 ¡Llegaste a FACIMAR! Seguimiento detenido automáticamente.');
            setTimeout(() => {
                stopTracking();
                arrivedAtFacimar = false;
            }, 2500);
            return;
        }
        step++;
    }, 180000); // 3 minutos

    watchId = interval;
}

// ---- Mostrar UI de tracking activo ----
function showTrackingUI(micro) {
    document.getElementById('selector-section').classList.add('hidden');
    document.getElementById('tracking-section').classList.remove('hidden');
    document.getElementById('tracking-micro').textContent = `${micro}`;

    const btnStopMap = document.getElementById('btn-stop-map');
    if (btnStopMap) btnStopMap.classList.add('active');

    document.getElementById('status-icon').textContent = '🚌';
    document.getElementById('status-title').textContent = '¡Compartiendo posición!';
    document.getElementById('status-subtitle').textContent = 'Tus colegas te ven en el mapa en vivo';

    startTime = Date.now();
    updateTrackingTime();
    trackingTimer = setInterval(updateTrackingTime, 30000);

    showToast('✅ ¡Estás en el mapa! Tus colegas pueden verte.');
}

// ---- Modo Observador: ver sin compartir ----
function startObserving() {
    observerMode = true;
    showToast('👁️ Modo observador — ves a todos, sin compartir tu posición');
    showScreen('map-screen');

    // Asegurar que la escucha de Firebase está activa
    if (!DEMO_MODE && db && leafletMap) {
        initRealTimeUpdates();
    }

    // Mostrar badge
    const badge = document.getElementById('observer-badge');
    if (badge) badge.style.display = 'flex';
}
window.startObserving = startObserving;

// ---- Publicar posición (Firebase o Local) ----
function publishMyPosition(lat, lng, micro) {
    lastSyncTime = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    const coordEl = document.getElementById('tracking-coords');
    const subEl   = document.getElementById('status-subtitle');

    if (coordEl) coordEl.textContent = `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (subEl)   subEl.textContent   = `Última sincronización: ${lastSyncTime}`;

    // Actualizar ETA
    updateETA(lat, lng);

    // Dibujar mi propio marcador
    if (leafletMap) {
        const color = getColor(micro);
        // Obtener el avatar seleccionado
        const selAvatarOpt = document.querySelector('input[name="avatar"]:checked');
        const myAvatar = selAvatarOpt ? selAvatarOpt.value : '🚌';
        const isBus = !myAvatar || myAvatar === '🚌';
        
        const sizeHeight = isBus ? 36 : 42;
        const sizeWidth = isBus ? sizeHeight * 1.6 : 42;
        const icon = L.divIcon({
            className: '',
            html: `
                <div style="width:${sizeWidth}px;height:${sizeHeight}px;filter:drop-shadow(0 0 6px ${color}); position:relative;">
                    ${getBusIconHTML(color, 1, myAvatar)}
                    ${currentAlert ? `<div class="marker-alert-badge">${currentAlert}</div>` : ''}
                </div>`,
            iconSize: [sizeWidth, sizeHeight],
            iconAnchor: [sizeWidth/2, sizeHeight/2]
        });

        if (myMarker) leafletMap.removeLayer(myMarker);
        myMarker = L.marker([lat, lng], { icon }).addTo(leafletMap)
            .bindPopup(`<strong>📍 Tú</strong><br>Micro ${micro}${currentAlert ? '<br>⚠️ Reportando: ' + currentAlert : ''}<br><small>${lastSyncTime}</small>`);

        // Centrar automáticamente la primera vez que recibimos señal en esta sesión de mapa
        if (!hasCenteredOnThisSession) {
            leafletMap.setView([lat, lng], 15);
            hasCenteredOnThisSession = true;
        }
    }

    // Enviar a Firebase si está activo
    if (db && myUserId) {
        const selAvatarOpt = document.querySelector('input[name="avatar"]:checked');
        const myAvatar = selAvatarOpt ? selAvatarOpt.value : '🚌';
        
        db.ref("viajeros/" + myUserId).set({
            lat, lng, micro, avatar: myAvatar,
            alert: currentAlert,
            lastUpdate: firebase.database.ServerValue.TIMESTAMP
        }).then(() => {
            console.log('[MICS] Posición publicada en Firebase ✅');
            // enforceViajerosCap se llama menos frecuente (cada 100 llamadas o manual) 
            // no es necesario acá ya que existe onDisconnect()
        }).catch(err => {
            console.error('[MICS] Error subiendo posición:', err);
            showToast('⚠️ Error sincronizando posición');
        });
    }

    // ---- Geovalla: detener automáticamente al llegar a FACIMAR ----
    if (!arrivedAtFacimar) {
        const dist = getDistanceMeters(lat, lng, FACIMAR_LAT, FACIMAR_LNG);
        if (dist <= ARRIVAL_RADIUS_M) {
            arrivedAtFacimar = true;
            showToast('🎓 ¡Llegaste a FACIMAR! Seguimiento detenido automáticamente.');
            if (db && myUserId) {
                db.ref("viajeros/" + myUserId).remove();
            }
            setTimeout(() => {
                stopTracking();
                arrivedAtFacimar = false;
                showScreen('main-screen');
            }, 2000);
        }
    }
}

// ---- Purgar viajeros más antiguos si se supera el límite ----
function enforceViajerosCap() {
    db.ref("viajeros").once("value", (snapshot) => {
        const all = [];
        snapshot.forEach((child) => {
            all.push({ key: child.key, lastUpdate: child.val().lastUpdate || 0 });
        });

        if (all.length > MAX_VIAJEROS) {
            // Ordenar por lastUpdate ascendente (más antiguos primero)
            all.sort((a, b) => a.lastUpdate - b.lastUpdate);
            const toRemove = all.slice(0, all.length - MAX_VIAJEROS);
            toRemove.forEach(entry => {
                if (entry.key !== myUserId) { // No eliminar el propio registro
                    db.ref("viajeros/" + entry.key).remove()
                      .catch(err => console.warn("No se pudo purgar:", err));
                }
            });
            console.log(`[MICS] Límite enforced: ${toRemove.length} entrada(s) antigua(s) eliminada(s).`);
        }
    });
}

// ---- Detener tracking ----
function stopTracking() {
    if (watchId !== null) {
        if (typeof watchId === 'number' && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchId);
        } else {
            clearInterval(watchId);
        }
        watchId = null;
    }
    if (watchPublishInterval !== null) {
        clearInterval(watchPublishInterval);
        watchPublishInterval = null;
    }
    clearInterval(trackingTimer);

    if (myMarker && leafletMap) { leafletMap.removeLayer(myMarker); myMarker = null; }

    // Eliminar mi entrada de Firebase inmediatamente
    if (db && myUserId) {
        db.ref("viajeros/" + myUserId).remove()
          .catch(err => console.warn('[MICS] No se pudo eliminar posición:', err));
    }

    window.latestPos = null;
    clearProximityUI();
    const etaBadge = document.getElementById('eta-badge');
    if (etaBadge) etaBadge.style.display = 'none';

    selectedMicro = null;
    document.getElementById('selector-section').classList.remove('hidden');
    document.getElementById('tracking-section').classList.add('hidden');

    const btnStopMap = document.getElementById('btn-stop-map');
    if (btnStopMap) btnStopMap.classList.remove('active');

    document.querySelectorAll('.micro-btn').forEach(b => b.style.opacity = '1');
    document.getElementById('status-icon').textContent = '📍';
    document.getElementById('status-title').textContent = '¿Estás en la micro?';
    document.getElementById('status-subtitle').textContent = 'Comparte tu posición para ayudar a tus colegas';

    currentAlert = null;
    document.getElementById('btn-report-main')?.classList.remove('active');
    document.getElementById('report-fab-container')?.classList.remove('active');

    showToast('👋 ¡Gracias! Tu posición fue retirada del mapa.');
}
window.stopTracking = stopTracking;

// ---- Reportes Comunitarios ----
function toggleReportMenu() {
    const container = document.getElementById('report-fab-container');
    const btn = document.getElementById('btn-report-main');
    container.classList.toggle('active');
    btn.classList.toggle('active');
}
window.toggleReportMenu = toggleReportMenu;

async function sendReport(emoji, type) {
    // Si es "Todo despejado", reseteamos
    if (emoji === '✅') {
        currentAlert = null;
        showToast('✅ Has limpiado tus reportes');
    } else {
        currentAlert = emoji;
        showToast(`📢 Reporte enviado: ${type} ${emoji}`);
    }

    // Cerrar menú
    toggleReportMenu();

    // Si estamos trackeando, forzar actualización en Firebase
    if (window.latestPos && selectedMicro) {
        publishMyPosition(window.latestPos.coords.latitude, window.latestPos.coords.longitude, selectedMicro);
    } else {
        // Si no estamos trackeando, avisar que necesita activar GPS o estar en micro
        if (emoji !== '✅') {
            showToast('📍 Nota: Tu reporte solo se verá si estás compartiendo tu posición.');
        }
    }
}
window.sendReport = sendReport;

// ---- Centrar mapa en mi posición ----
function centerOnMe() {
    if (!leafletMap) return;
    if (window.latestPos) {
        const { latitude, longitude } = window.latestPos.coords;
        leafletMap.flyTo([latitude, longitude], 16, { animate: true, duration: 1 });
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((pos) => {
            leafletMap.flyTo([pos.coords.latitude, pos.coords.longitude], 16, { animate: true, duration: 1 });
        }, () => showToast('⚠️ No se pudo obtener tu posición'));
    } else {
        showToast('⚠️ GPS no disponible');
    }
}
window.centerOnMe = centerOnMe;

function confirmStopTracking() {
    if (confirm('¿Deseas dejar de compartir tu ubicación?')) {
        stopTracking();
        showScreen('main-screen');
    }
}
window.confirmStopTracking = confirmStopTracking;

// ---- Timer de tracking ----
function updateTrackingTime() {
    if (!startTime) return;
    const mins = Math.floor((Date.now() - startTime) / 60000);
    document.getElementById('tracking-time').textContent = `Activo hace ${mins} min`;
}

// ---- Filtro del mapa ----
function filterMap(filter) {
    activeFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    const fb = document.getElementById(`filter-${filter}`);
    if (fb) fb.classList.add('active');
    
    // Forzar actualización inmediata para que el usuario vea el cambio
    if (!DEMO_MODE && db) {
        // En modo Firebase la escucha de snapshots lo hará solo
    } else {
        updateDemoSimulation();
    }
}
window.filterMap = filterMap;

// ---- Toast ----
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3500);
}
window.showToast = showToast;

// Carga inicial (Firebase se encarga del resto tras initMap)
updateClock();

// ---- SHARE APP (Web Share API & Fallback Modal) ----
function openShareOptions() {
    const shareData = {
        title: 'MICS Te Ayuda',
        text: '¡Descarga MICS Te Ayuda para ver las micros hacia FACIMAR en tiempo real!',
        url: 'https://manuelcastillos.github.io/mics_te_ayuda/'
    };

    if (navigator.share) {
        navigator.share(shareData)
                 .then(() => console.log('Contenido compartido con éxito'))
                 .catch((err) => console.log('La acción de compartir fue cancelada o falló:', err));
    } else {
        // Mostrar Modal con QR si el explorador (o desktop) rechaza invocar las opciones nativas
        document.getElementById('share-modal-overlay').classList.remove('hidden');
        document.getElementById('share-modal').classList.remove('hidden');
    }
}
window.openShareOptions = openShareOptions;

function closeShareModal() {
    document.getElementById('share-modal-overlay').classList.add('hidden');
    document.getElementById('share-modal').classList.add('hidden');
}
window.closeShareModal = closeShareModal;

// ---- Service Worker Registration (PWA) ----
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swPath = window.location.pathname.includes('/mics_te_ayuda/') ? '/mics_te_ayuda/sw.js' : 'sw.js';
        navigator.serviceWorker.register(swPath).then(reg => {
            console.log('[PWA] Service Worker registrado', reg);
            
            // Forzar revisión de actualización en el servidor cada vez que se carga la página
            reg.update();
            
            // Detectar si el explorador descarga un service worker nuevo
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showToast('🔄 Nueva actualización (v24) detectada. Reiniciando App...');
                        setTimeout(() => window.location.reload(true), 2500);
                    }
                });
            });
        }).catch(err => console.error('[PWA] Error registrando SW', err));

        // Refrescar ante cualquier reclamo de controller nuevo
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                window.location.reload();
                refreshing = true;
            }
        });
    });
}

// ---- Instalación PWA (Añadir a Inicio) ----
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.onclick = () => {
            installBtn.classList.add('hidden');
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    console.log('Usuario aceptó instalar PWA');
                } else {
                    console.log('Usuario rechazó PWA');
                }
                deferredPrompt = null;
            });
        };
    }
});


// ============================================================
// 🌊 MÓDULO OCEANOGRÁFICO — v21
// Fuentes: Open-Meteo Marine + Weather API (sin API key, gratis)
//          WMS tiles: NOAA CoastWatch ERDDAP (TSM + Clorofila)
//          Windy embed modal
// ============================================================

// --- Coordenadas FACIMAR / Montemar ---
const OCEAN_LAT = FACIMAR_LAT;   // -32.957119
const OCEAN_LNG = FACIMAR_LNG;   // -71.549831

// ---- Convertir grados a dirección de brújula ----
function degreesToCompass(deg) {
    if (deg == null) return '–';
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                  'S','SSO','SO','OSO','O','ONO','NO','NNO'];
    return dirs[Math.round(deg / 22.5) % 16];
}

// ---- Clasificar altura de ola ----
function waveDescription(h) {
    if (h == null) return '';
    if (h < 0.5) return '(calma)';
    if (h < 1.2) return '(leve)';
    if (h < 2.5) return '(moderado)';
    if (h < 4.0) return '(fuerte)';
    return '(muy fuerte)';
}

// ---- Obtener emoji para viento (escala Beaufort simplificada) ----
function windEmoji(spd) {
    if (spd == null) return '💨';
    if (spd < 10) return '🍃';
    if (spd < 25) return '💨';
    if (spd < 50) return '🌬️';
    return '🌀';
}

// ---- Interpretar código WMO de tiempo ----
function weatherCodeToDescription(code) {
    if (code == null) return { text: 'Sin datos', icon: '❓' };
    if (code === 0)                   return { text: 'Despejado',          icon: '☀️' };
    if (code === 1)                   return { text: 'Mainly clear',       icon: '🌤️' };
    if (code === 2)                   return { text: 'Parcial. nublado',   icon: '⛅' };
    if (code === 3)                   return { text: 'Cubierto',           icon: '☁️' };
    if ([45,48].includes(code))       return { text: 'Niebla',             icon: '🌫️' };
    if (code >= 51 && code <= 55)     return { text: 'Llovizna',          icon: '🌦️' };
    if (code >= 61 && code <= 65)     return { text: 'Lluvia',             icon: '🌧️' };
    if (code >= 71 && code <= 77)     return { text: 'Nieve',              icon: '❄️' };
    if (code >= 80 && code <= 82)     return { text: 'Chubascos',          icon: '🌦️' };
    if (code >= 85 && code <= 86)     return { text: 'Nieve/chubascos',    icon: '🌨️' };
    if (code >= 95 && code <= 99)     return { text: 'Tormenta',           icon: '⛈️' };
    return { text: 'Variable',        icon: '🌈' };
}

// ---- Clasificar cobertura nubosa ----
function cloudCoverText(pct) {
    if (pct == null) return { text: '–', icon: '❓' };
    if (pct <= 10)   return { text: `Despejado (${pct}%)`,          icon: '☀️' };
    if (pct <= 30)   return { text: `Pocas nubes (${pct}%)`,        icon: '🌤️' };
    if (pct <= 60)   return { text: `Parcialmnte nublado (${pct}%)`, icon: '⛅' };
    if (pct <= 85)   return { text: `Muy nublado (${pct}%)`,        icon: '🌥️' };
    return              { text: `Cubierto (${pct}%)`,                icon: '☁️' };
}

// ---- FETCH datos marinos de Open-Meteo ----
async function fetchOceanData() {
    const DOT = document.getElementById('ocean-status-dot');
    if (DOT) DOT.className = 'ocean-dot ocean-dot-loading';

    const MARINE_URL = `https://marine-api.open-meteo.com/v1/marine?` +
        `latitude=${OCEAN_LAT}&longitude=${OCEAN_LNG}` +
        `&current=wave_height,wave_direction,wave_period,` +
        `swell_wave_height,swell_wave_direction,swell_wave_period,` +
        `sea_surface_temperature,ocean_current_velocity,ocean_current_direction` +
        `&wind_speed_unit=kmh&length_unit=metric&timezone=America%2FSantiago`;

    const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?` +
        `latitude=${OCEAN_LAT}&longitude=${OCEAN_LNG}` +
        `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,` +
        `cloud_cover,weather_code,relative_humidity_2m,apparent_temperature,uv_index` +
        `&wind_speed_unit=kmh&timezone=America%2FSantiago`;

    try {
        const [marineResp, weatherResp] = await Promise.all([
            fetch(MARINE_URL),
            fetch(WEATHER_URL)
        ]);

        if (!marineResp.ok || !weatherResp.ok) throw new Error('API error');

        const marine  = await marineResp.json();
        const weather = await weatherResp.json();

        const c  = marine.current  || {};
        const wc = weather.current || {};

        // ---- Extraer valores ----
        const waveH   = c.wave_height != null ? +c.wave_height.toFixed(1) : null;
        const wavePer = c.wave_period != null ? +c.wave_period.toFixed(0) : null;
        const waveDir = c.wave_direction != null ? +c.wave_direction.toFixed(0) : null;
        const sst     = c.sea_surface_temperature != null ? +c.sea_surface_temperature.toFixed(1) : null;

        const windSpd   = wc.wind_speed_10m       != null ? +wc.wind_speed_10m.toFixed(0) : null;
        const windDir   = wc.wind_direction_10m   != null ? +wc.wind_direction_10m.toFixed(0) : null;
        const airTemp   = wc.temperature_2m       != null ? +wc.temperature_2m.toFixed(1) : null;
        const feelTemp  = wc.apparent_temperature != null ? +wc.apparent_temperature.toFixed(1) : null;
        const cloudPct  = wc.cloud_cover          != null ? Math.round(wc.cloud_cover) : null;
        const wmoCode   = wc.weather_code         != null ? wc.weather_code : null;
        const uvIndex   = wc.uv_index             != null ? wc.uv_index : null;

        // ---- Actualizar panel UI ----
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        const wmoInfo = weatherCodeToDescription(wmoCode);
        const cloudInfo = cloudCoverText(cloudPct);

        // Temp. Aire
        let airTempStr = airTemp != null ? `${airTemp} °C` : '–';
        if (airTemp != null && feelTemp != null && Math.abs(airTemp - feelTemp) >= 2) {
            airTempStr = `${airTemp} °C (ST: ${feelTemp}°)`;
        }
        set('oc-airtemp-val', airTempStr);
        const tempIconEl = document.getElementById('oc-airtemp-icon');
        if (tempIconEl) {
            tempIconEl.textContent = airTemp != null
                ? (airTemp <= 8 ? '🥶' : airTemp <= 14 ? '🧥' : airTemp <= 20 ? '😊' : '🌞')
                : '🌡️';
        }

        // Nubosidad
        set('oc-clouds-val', wmoInfo.text + (cloudPct != null ? ` · ${cloudPct}%` : ''));
        const cloudsIconEl = document.getElementById('oc-clouds-icon');
        if (cloudsIconEl) cloudsIconEl.textContent = wmoInfo.icon || cloudInfo.icon;

        // Índice UV
        let uvStatus = 'Bajo';
        if (uvIndex >= 11) uvStatus = 'Extremo';
        else if (uvIndex >= 8) uvStatus = 'Muy Alto';
        else if (uvIndex >= 6) uvStatus = 'Alto';
        else if (uvIndex >= 3) uvStatus = 'Moderado';
        set('oc-uv-val', uvIndex != null ? `${uvIndex.toFixed(1)} (${uvStatus})` : '–');

        // Viento
        set('oc-wind-val', windSpd != null ? `${windEmoji(windSpd)} ${windSpd} km/h ${degreesToCompass(windDir)}` : '–');

        // Océano
        set('oc-sst-val', sst != null ? `${sst} °C` : '–');

        if (mosSst)  mosSst.textContent  = airTemp != null ? `${wmoInfo.icon} ${airTemp} °C` : `🌡️ ${sst != null ? sst + ' °C' : '–'}`;
        if (mosWind) mosWind.textContent = `💨 ${windSpd != null ? windSpd + ' km/h' : '–'}`;

        if (DOT) {
            DOT.className = 'ocean-dot ocean-dot-ok';
            DOT.title = `Actualizado: ${new Date().toLocaleTimeString()}`;
        }
    } catch (err) {
        console.error('[OCEAN] Error:', err);
        if (DOT) DOT.className = 'ocean-dot ocean-dot-error';
    }
}

fetchOceanData();
setInterval(fetchOceanData, 30 * 60 * 1000);

// ============================================================
// 🗺️ CAPAS WMS OCEANOGRÁFICAS
// ============================================================
let activeOceanLayer = null;
let oceanWmsLayer = null;

const OCEAN_LAYERS = {
    sst: {
        url:    'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
        layer:  'GHRSST_L4_MUR_Sea_Surface_Temperature',
        name:   'TSM',
        emoji:  '🌡️',
        id:     'btn-layer-sst',
        legend: 'TSM MUR (NASA GIBS)',
        style:  '' // NASA GIBS usa paleta térmica por defecto
    }
};

function toggleOceanLayer(type) {
    if (!leafletMap) return;
    const layerDef = OCEAN_LAYERS[type];
    if (activeOceanLayer === type) {
        leafletMap.removeLayer(oceanWmsLayer);
        oceanWmsLayer = null;
        activeOceanLayer = null;
        document.getElementById(layerDef.id).classList.remove('active');
        document.getElementById('ocean-layer-legend').style.display = 'none';
        
        // Al desactivar una capa oceánica amplia, volvemos a centrar en el usuario
        centerMapOnUser();
        return;
    }
    if (oceanWmsLayer) leafletMap.removeLayer(oceanWmsLayer);
    
    Object.values(OCEAN_LAYERS).forEach(l => document.getElementById(l.id).classList.remove('active'));
    
    oceanWmsLayer = L.tileLayer.wms(layerDef.url, {
        layers:      layerDef.layer,
        styles:      layerDef.style || '', 
        format:      'image/png',
        transparent: true,
        opacity:     0.65,
        version:     '1.3.0',
        zIndex:      400,
        crossOrigin: true,
        attribution: `Data: ${layerDef.legend}`
    }).addTo(leafletMap);

    const leg = document.getElementById('ocean-layer-legend');
    const legN = document.getElementById('ocean-layer-legend-name');
    leg.style.display = 'flex';
    legN.textContent = `${layerDef.name} (cargando...)`;
    oceanWmsLayer.on('load', () => legN.textContent = layerDef.legend);
    oceanWmsLayer.on('tileerror', () => {
        legN.textContent = `❌ Error en capa ${layerDef.name}`;
        showToast(`No se pudo cargar la capa de ${layerDef.name}. Intenta más tarde.`);
    });

    activeOceanLayer = type;
    document.getElementById(layerDef.id).classList.add('active');

    // ---- Lógica de visibilidad Regional ----
    if (type === 'sst' || type === 'chlor') {
        // En modo regional (TSM), ocultamos la leyenda de micros y mostramos la escala de temp
        document.querySelector('.map-legend').classList.add('regional-mode-hidden');
        document.getElementById('sst-legend').classList.remove('hidden');
        
        // Ocultar marcadores de sedes para limpiar el mapa
        sedeMarkers.forEach(m => leafletMap.removeLayer(m));

        // Vista amplia costera 30°S a 36°S
        leafletMap.setView([-33.0, -73.5], 7, { animate: true, duration: 1.5 });
    } else {
        // Al desactivar o cambiar a otra, limpiamos el modo regional
        resetRegionalUI();
        centerMapOnUser();
    }
}
window.toggleOceanLayer = toggleOceanLayer;

function resetRegionalUI() {
    if (!leafletMap) return;
    
    // Mostrar leyenda de micros
    document.querySelector('.map-legend').classList.remove('regional-mode-hidden');
    // Ocultar escala de temp
    document.getElementById('sst-legend').classList.add('hidden');
    
    // Mostrar marcadores de sedes de nuevo
    sedeMarkers.forEach(m => m.addTo(leafletMap));
}

/**
 * Centra el mapa en la última posición conocida del usuario
 */
function centerMapOnUser() {
    // Resetear UI regional primero por seguridad
    resetRegionalUI();
    
    if (!leafletMap) return;
    // Si tenemos marcador de usuario, usamos su posición registrada en Firebase
    if (window.myMarker) {
        leafletMap.setView(window.myMarker.getLatLng(), 15, { animate: true });
    } else {
        // Fallback a Montemar
        leafletMap.setView([OCEAN_LAT, OCEAN_LNG], 15, { animate: true });
    }
}
window.centerMapOnUser = centerMapOnUser;

// ============================================================
// 💨 VIENTO ESTILO WINDY — leaflet-velocity
// ============================================================
let windVelActive = false;
let windVelLayer = null;
// Expandimos la malla para cubrir de 30°S a 36°S (costa central de Chile)
const WV_GRID = { 
    la1: -30.0, // Latitud Norte
    la2: -36.0, // Latitud Sur
    lo1: -75.0, // Longitud Oeste (Mar)
    lo2: -71.0, // Longitud Este (Costa)
    dx: 0.5, 
    dy: 0.5, 
    nx: 9,      // (-71 - (-75)) / 0.5 + 1
    ny: 13      // (-30 - (-36)) / 0.5 + 1
};

function windToUV(speedKmh, dirDeg) {
    const rad = dirDeg * Math.PI / 180;
    return { u: -speedKmh * Math.sin(rad), v: -speedKmh * Math.cos(rad) };
}

async function fetchWindGrid() {
    const points = [];
    for (let r = 0; r < WV_GRID.ny; r++) {
        for (let c = 0; c < WV_GRID.nx; c++) {
            points.push({ lat: WV_GRID.la1 - r * WV_GRID.dy, lng: WV_GRID.lo1 + c * WV_GRID.dx });
        }
    }
    const results = await Promise.all(points.map(pt => 
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pt.lat}&longitude=${pt.lng}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`)
        .then(r => r.json())
    ));
    const uData = [], vData = [];
    results.forEach(d => {
        const {u, v} = windToUV(d.current.wind_speed_10m, d.current.wind_direction_10m);
        uData.push(+u.toFixed(2)); vData.push(+v.toFixed(2));
    });
    return { uData, vData };
}

async function drawWindStreamlines() {
    if (!leafletMap || !windVelActive) return;
    try {
        const {uData, vData} = await fetchWindGrid();
        // Ajustamos el header para que coincida con la nueva malla 30-36S
        const header = { 
            parameterCategory: 2, 
            dx: WV_GRID.dx, 
            dy: WV_GRID.dy, 
            la1: WV_GRID.la1, 
            lo1: WV_GRID.lo1, 
            la2: WV_GRID.la2, 
            lo2: WV_GRID.lo2, 
            nx: WV_GRID.nx, 
            ny: WV_GRID.ny, 
            refTime: new Date().toISOString() 
        };
        const data = [
            { header: { ...header, parameterNumber: 2 }, data: uData },
            { header: { ...header, parameterNumber: 3 }, data: vData }
        ];
        if (windVelLayer) leafletMap.removeLayer(windVelLayer);
        windVelLayer = L.velocityLayer({
            displayValues: true,
            displayOptions: { velocityType: 'Viento', speedUnit: 'km/h' },
            data: data,
            maxVelocity: 50,
            particleMultiplier: 1/800, 
            lineWidth: 1.5,            
            particleAge: 120,
            opacity: 0.8,              
            colorScale: [
                "#ffffff", "#f8fafc", "#f1f5f9", "#e2e8f0", "#ffffff" 
            ]
        }).addTo(leafletMap);
    } catch(e) { console.error(e); }
}

function toggleWindArrows() {
    windVelActive = !windVelActive;
    const btn = document.getElementById('btn-layer-wind');
    if (windVelActive) {
        btn.classList.add('active');
        drawWindStreamlines();
        
        // Modo regional para vientos
        document.querySelector('.map-legend').classList.add('regional-mode-hidden');
        sedeMarkers.forEach(m => leafletMap.removeLayer(m));

        // Ajustamos la vista para este rango amplio solicitado (30-36°S)
        if (leafletMap) leafletMap.setView([-33.0, -73.5], 7, { animate: true, duration: 1.5 });
    } else {
        if (windVelLayer) {
            leafletMap.removeLayer(windVelLayer);
            windVelLayer = null;
        }
        btn.classList.remove('active');
        // Al apagar, regresamos al usuario y restauramos UI
        resetRegionalUI();
        centerMapOnUser();
    }
}
window.toggleWindArrows = toggleWindArrows;

// Radar removido por incompatibilidad de zoom en área local

// ============================================================
// 🌬️ MODAL WINDY
// ============================================================
const WINDY_BASE = `https://embed.windy.com/embed2.html?lat=${OCEAN_LAT}&lon=${OCEAN_LNG}&zoom=10&level=surface&product=ecmwf&metricWind=km%2Fh&metricTemp=%C2%B0C`;

function openWindyModal() {
    document.getElementById('windy-modal-overlay').classList.remove('hidden');
    document.getElementById('windy-modal').classList.remove('hidden');
    document.getElementById('windy-iframe').src = WINDY_BASE + '&overlay=wind';
}
window.openWindyModal = openWindyModal;

function closeWindyModal() {
    document.getElementById('windy-modal-overlay').classList.add('hidden');
    document.getElementById('windy-modal').classList.add('hidden');
}
window.closeWindyModal = closeWindyModal;

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeWindyModal();
        closeShareModal();
        closeTideModal();
    }
});

// ============================================================
// 📏 NIVEL DEL MAR (MAREA) — IOC Sea Level Monitoring
// ============================================================
async function fetchTideData() {
    // Pedimos periodo de 3 días para asegurar tener siempre un día completo incluso con alta frecuencia
    const url = 'https://www.ioc-sealevelmonitoring.org/bgraph.php?code=valp2&output=tab&period=3';
    // Usamos corsproxy.io por mayor robustez comparado con allorigins
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    
    try {
        const resp = await fetch(proxyUrl);
        const html = await resp.text();
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const rows = doc.querySelectorAll('tr');
        
        let tideData = [];
        // La tabla tiene headers en las primeras dos filas
        for (let i = 2; i < rows.length; i++) {
            const cols = rows[i].querySelectorAll('td');
            if (cols.length >= 3) {
                const timeStr = cols[0].textContent.trim();
                const valPrs  = cols[1].textContent.trim();
                const valRad  = cols[2].textContent.trim();
                // Rad(m) suele ser más fiable. Si no hay, prs(m).
                let val = valRad || valPrs;
                // Limpieza de caracteres raros si los hay
                val = val.replace(/[^0-9.]/g, ''); 
                if (timeStr && val) tideData.push({ timeUTC: timeStr, val });
            }
        }
        
        if (tideData.length > 0) {
            tideData.reverse(); // Mas recientes primero
            const latest = tideData[0];
            
            // Actualizar card en la pantalla principal
            const tideEl = document.getElementById('oc-tide-val');
            if (tideEl) tideEl.textContent = `${latest.val} m`;
            
            // Guardar para el modal
            window.latestTideData = tideData;
            
            const updateTimeEl = document.getElementById('tide-update-time');
            if (updateTimeEl) {
                const localDate = new Date(latest.timeUTC.replace(' ', 'T') + "Z");
                const localTime = localDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
                updateTimeEl.textContent = `Actualizado: ${localTime} CLT`;
            }
        }
    } catch (e) {
        console.warn('[MICS] Error fetching tide data:', e);
    }
}
window.fetchTideData = fetchTideData;

function toggleTideModal() {
    const modal = document.getElementById('tide-modal');
    if (!modal) return;
    
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        renderTideTable();
    } else {
        closeTideModal();
    }
}
window.toggleTideModal = toggleTideModal;

function closeTideModal() {
    const modal = document.getElementById('tide-modal');
    if (modal) modal.classList.add('hidden');
}
window.closeTideModal = closeTideModal;

function renderTideTable() {
    const container = document.getElementById('tide-table-container');
    if (!container) return;
    
    if (!window.latestTideData || window.latestTideData.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:2rem; color:var(--text-muted)">Cargando datos históricos...</p>';
        fetchTideData().then(() => renderTideTable());
        return;
    }
    
    let html = `
        <table class="tide-table">
            <thead>
                <tr>
                    <th>Hora (Local)</th>
                    <th>Nivel (m)</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    // Mostramos hasta 1000 registros para asegurar ver todo el día y los ciclos de llenante/vaciante
    window.latestTideData.slice(0, 1000).forEach(d => {
        // Corrección de formato para iOS/Safari: el espacio suele fallar, usar T
        const isoStr = d.timeUTC.replace(' ', 'T') + "Z"; 
        const localDate = new Date(isoStr);
        const timeStr   = localDate.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
        const dateStr   = localDate.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
        
        html += `
            <tr>
                <td>
                    <strong style="color:#fff">${timeStr}</strong>
                    <span class="tide-time-local">${dateStr} (Local)</span>
                </td>
                <td class="tide-val-recent">${d.val} m</td>
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
    renderTideChart(window.latestTideData);
}
let tideChartInstance = null;
function renderTideChart(data) {
    const canvas = document.getElementById('tide-chart');
    if (!canvas) return;

    // Usamos los últimos 240 puntos (aprox 24 horas) para el gráfico solicitado
    const points = Array.from(data).slice(0, 240).reverse();
    const labels = points.map(p => {
        const iso = p.timeUTC.replace(' ', 'T') + "Z";
        return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    });
    const values = points.map(p => parseFloat(p.val));

    if (tideChartInstance) tideChartInstance.destroy();

    tideChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Nivel (m)',
                data: values,
                borderColor: '#0ea5e9',
                backgroundColor: 'rgba(14, 165, 233, 0.15)',
                borderWidth: 2,
                fill: true,
                tension: 0.3, // Menos tensión para curvas largas
                pointRadius: 0,
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(2, 12, 27, 0.95)',
                    titleColor: '#7dd3fc',
                    bodyColor: '#fff',
                    borderColor: 'rgba(14, 165, 233, 0.3)',
                    borderWidth: 1,
                    padding: 10,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                    ticks: { color: '#64748b', font: { size: 10 } }
                }
            }
        }
    });
}


// ============================================================
// 🚦 CAPA DE TRÁFICO EN TIEMPO REAL (Valparaíso / Viña)
// ============================================================
let trafficTileLayer = null;

function toggleTrafficLayer() {
    const btn = document.getElementById('btn-layer-traffic');
    if (trafficTileLayer) {
        leafletMap.removeLayer(trafficTileLayer);
        trafficTileLayer = null;
        if (btn) btn.classList.remove('active');
    } else {
        // Overlay de tráfico de Google (sin etiquetas de calles para no saturar)
        trafficTileLayer = L.tileLayer('https://{s}.google.com/vt/lyrs=m@221000000,traffic&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            opacity: 0.8
        }).addTo(leafletMap);
        if (btn) btn.classList.add('active');
    }
}
window.toggleTrafficLayer = toggleTrafficLayer;
