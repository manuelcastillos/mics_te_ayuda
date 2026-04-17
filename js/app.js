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
let listenerActive   = false; // Guard: evitar listeners duplicados en Firebase
let pendingListenerInit = false; // Si auth terminó antes que el mapa, activar listener al abrir mapa
const DEMO_MODE      = false; // Falso para producción con Firebase


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
        if (id === 'map-screen') initMapIfNeeded();
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
                avatar: u.avatar || '🚌'
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
                    html: `<div style="width:${sizeWidth}px;height:${sizeHeight}px;filter:drop-shadow(0 0 6px ${color})">${getBusIconHTML(color, c.count, c.avatar)}</div>`,
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
            html: `<div style="width:${sizeWidth}px;height:${sizeHeight}px;">${getBusIconHTML(color, c.count, c.avatar)}</div>`,
            iconSize: [sizeWidth, sizeHeight],
            iconAnchor: [sizeWidth/2, sizeHeight/2]
        });

        let popupText = `🚌 Micro ${c.micro} · ${timeAgo(c.lastUpdate)}`;
        if (c.count > 1) popupText = `🚌 Micro ${c.micro} · ${c.count} personas enviando señal juntas.`;

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
            html: `<div style="width:${sizeWidth}px;height:${sizeHeight}px;filter:drop-shadow(0 0 6px ${color})">${getBusIconHTML(color, 1, myAvatar)}</div>`,
            iconSize: [sizeWidth, sizeHeight],
            iconAnchor: [sizeWidth/2, sizeHeight/2]
        });
        if (myMarker) leafletMap.removeLayer(myMarker);
        myMarker = L.marker([lat, lng], { icon }).addTo(leafletMap)
            .bindPopup(`<strong>📍 Tú</strong><br>Micro ${micro}<br><small>${lastSyncTime}</small>`);
    }

    // Enviar a Firebase si está activo
    if (db && myUserId) {
        const selAvatarOpt = document.querySelector('input[name="avatar"]:checked');
        const myAvatar = selAvatarOpt ? selAvatarOpt.value : '🚌';
        
        db.ref("viajeros/" + myUserId).set({
            lat, lng, micro, avatar: myAvatar,
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

    showToast('👋 ¡Gracias! Tu posición fue retirada del mapa.');
}
window.stopTracking = stopTracking;

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
                        showToast('🔄 Nueva actualización (v19) detectada. Reiniciando App...');
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
    // Prevenir que Chrome muestre el prompt por defecto
    e.preventDefault();
    // Guardar el evento
    deferredPrompt = e;
    
    // Mostrar nuestro botón de instalación
    const installBtn = document.getElementById('btn-install-pwa');
    if (installBtn) {
        installBtn.classList.remove('hidden');
        installBtn.onclick = () => {
            installBtn.classList.add('hidden');
            // Mostrar prompt de instalación
            deferredPrompt.prompt();
            // Esperar resultado
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

