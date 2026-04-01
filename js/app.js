// ============================================================
// MICS TE AYUDA — app.js
// Leaflet.js + OpenStreetMap + Firebase Realtime Database
// ============================================================

// ---- Estado global ----
let myUserId     = 'user_' + Math.random().toString(36).substr(2, 9);
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

// ---- Inicialización de Firebase ----
let db = null;
try {
    if (!DEMO_MODE && typeof firebase !== 'undefined' && FIREBASE_CONFIG.apiKey !== "TU-API-KEY") {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        console.log('[MICS] Firebase Realtime Database conectado ✅');
    }
} catch(e) {
    console.error('[MICS] Error al inicializar Firebase:', e);
}

// Colores por micro
const COLORS = {
    '601': '#f77f00',
    '302': '#06d6a0',
    'default': '#a78bfa'
};
function getColor(micro) {
    return COLORS[micro] || COLORS['default'];
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
    const existingIds = new Set(activeUsers.map(u => u.id));

    // Eliminar markers de usuarios que desaparecieron
    Object.keys(remoteMarkers).forEach(id => {
        if (!existingIds.has(id)) {
            leafletMap.removeLayer(remoteMarkers[id]);
            delete remoteMarkers[id];
        }
    });

    // Actualizar / crear markers
    activeUsers.forEach(u => {
        if (!observerMode && u.id === myUserId) return; // No duplicar mi propio marcador
        if (activeFilter !== 'all' && u.micro !== activeFilter) {
            if (remoteMarkers[u.id]) remoteMarkers[u.id].setOpacity(0);
            return;
        }

        const color = getColor(u.micro);
        const isMe = (u.id === myUserId);
        const size = isMe ? 22 : 16;
        const border = isMe ? '3px solid white' : '2px solid white';
        const icon = L.divIcon({
            className: '',
            html: `<div style="width:${size}px;height:${size}px;background:${color};border:${border};border-radius:50%;box-shadow:0 0 ${isMe ? 14 : 8}px ${color}88;"></div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        });

        const popupText = isMe
            ? `📍 Tú · 🚌 ${u.micro}`
            : `🚌 Micro ${u.micro} · ${timeAgo(u.lastUpdate)}`;

        if (remoteMarkers[u.id]) {
            remoteMarkers[u.id].setLatLng([u.lat, u.lng]);
            remoteMarkers[u.id].setOpacity(1);
            remoteMarkers[u.id].setPopupContent(popupText);
            remoteMarkers[u.id].setIcon(icon);
        } else {
            remoteMarkers[u.id] = L.marker([u.lat, u.lng], { icon })
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

    // Tiles oscuros de CartoDB
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(leafletMap);

    // ---- Marcador FACIMAR destacado ----
    // Círculo de zona de llegada (radio 150m)
    L.circle([FACIMAR_LAT, FACIMAR_LNG], {
        radius: ARRIVAL_RADIUS_M,
        color: '#00b4d8',
        fillColor: '#00b4d8',
        fillOpacity: 0.08,
        weight: 2,
        dashArray: '6 4'
    }).addTo(leafletMap);

    // Ícono grande con animación
    const facimar_icon = L.divIcon({
        className: '',
        html: `
            <div style="position:relative;width:48px;height:48px;">
                <div style="
                    position:absolute;inset:0;
                    background:rgba(0,180,216,0.2);
                    border:2px solid #00b4d8;
                    border-radius:50%;
                    animation:facimar-pulse 2s ease-out infinite;
                "></div>
                <div style="
                    position:absolute;inset:8px;
                    background:#0d1b2e;
                    border:2px solid #00b4d8;
                    border-radius:50%;
                    display:flex;align-items:center;justify-content:center;
                    font-size:18px;
                ">🎓</div>
            </div>`,
        iconSize: [48, 48],
        iconAnchor: [24, 24]
    });

    L.marker([FACIMAR_LAT, FACIMAR_LNG], { icon: facimar_icon })
        .addTo(leafletMap)
        .bindPopup(`
            <div style="font-family:sans-serif; text-align:center;">
                <strong>📍 FACIMAR UV</strong>
            </div>`)
        .openPopup();

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

    // Iniciar escucha de datos reales o simulación
    if (!DEMO_MODE && db) {
        initRealTimeUpdates();
    } else {
        setInterval(updateDemoSimulation, 2000);
    }

    // Badge de modo observador
    const badge = document.getElementById('observer-badge');
    if (badge) badge.style.display = observerMode ? 'flex' : 'none';
}

function initRealTimeUpdates() {
    db.ref("viajeros").on("value", (snapshot) => {
        let counts = {};
        const now = Date.now();
        const activeUsersList = [];

        snapshot.forEach((child) => {
            const data = child.val();
            const lastUpdate = data.lastUpdate || 0;

            if (now - lastUpdate < 900000) {
                activeUsersList.push({ id: child.key, ...data });
                counts[data.micro] = (counts[data.micro] || 0) + 1;
            }
        });

        document.getElementById('travelers-count').textContent = activeUsersList.length;
        
        // Actualizar breakdown dinámicamente
        const container = document.querySelector('.travelers-breakdown');
        container.innerHTML = '';
        Object.keys(counts).sort().forEach(m => {
            const color = getColor(m);
            const tag = document.createElement('span');
            tag.className = 'tag';
            tag.style.background = `${color}22`;
            tag.style.color = color;
            tag.textContent = `${m}: ${counts[m]}`;
            container.appendChild(tag);
        });

        if (leafletMap) {
            updateMapMarkers(activeUsersList);
            updateHeatmap(activeUsersList);
        }
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
        const icon = L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 6px ${color};"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
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

// ---- Iniciar tracking GPS ----
function startTracking(micro) {
    if (!navigator.geolocation) {
        showToast('⚠️ Tu navegador no soporta geolocalización, usando modo demo');
        startDemoTracking(micro);
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            showTrackingUI(micro);
            const { latitude, longitude } = pos.coords;
            publishMyPosition(latitude, longitude, micro);

            // Actualizar cada 3 minutos (180.000 ms)
            watchId = setInterval(() => {
                navigator.geolocation.getCurrentPosition(
                    (p) => publishMyPosition(p.coords.latitude, p.coords.longitude, micro),
                    () => {},
                    { enableHighAccuracy: true }
                );
            }, 180000);
        },
        () => {
            showToast('ℹ️ GPS no disponible — usando posición simulada');
            startDemoTracking(micro);
        },
        { enableHighAccuracy: true, timeout: 8000 }
    );
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
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:20px;height:20px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 0 12px ${color};"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
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
    document.getElementById('tracking-coords').textContent = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    document.getElementById('status-subtitle').textContent = `Última actualización: ${lastSyncTime}`;

    // Dibujar mi propio marcador
    if (leafletMap) {
        const color = getColor(micro);
        const icon = L.divIcon({
            className: '',
            html: `<div style="width:20px;height:20px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 0 12px ${color};"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        if (myMarker) leafletMap.removeLayer(myMarker);
        myMarker = L.marker([lat, lng], { icon }).addTo(leafletMap).bindPopup('📍 Tú');
    }

    // Enviar a Firebase si está activo
    if (!DEMO_MODE && db) {
        db.ref("viajeros/" + myUserId).set({
            lat, lng, micro,
            lastUpdate: firebase.database.ServerValue.TIMESTAMP
        }).catch(err => console.error("Error subiendo posición:", err));
    }

    // ---- Geovalla: detener automáticamente al llegar a FACIMAR ----
    if (!arrivedAtFacimar) {
        const dist = getDistanceMeters(lat, lng, FACIMAR_LAT, FACIMAR_LNG);
        if (dist <= ARRIVAL_RADIUS_M) {
            arrivedAtFacimar = true;
            showToast('🎓 ¡Llegaste a FACIMAR! Seguimiento detenido automáticamente.');
            if (!DEMO_MODE && db) {
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
    clearInterval(trackingTimer);
    if (myMarker && leafletMap) { leafletMap.removeLayer(myMarker); myMarker = null; }

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

// ---- Service Worker Registration (PWA) ----
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const swPath = window.location.pathname.includes('/mics_te_ayuda/') ? '/mics_te_ayuda/sw.js' : 'sw.js';
        navigator.serviceWorker.register(swPath)
            .then(reg => console.log('[PWA] Service Worker registrado', reg))
            .catch(err => console.error('[PWA] Error registrando SW', err));
    });
}
