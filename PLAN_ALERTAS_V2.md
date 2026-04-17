# 🚀 Plan de Implementación v2.0: Alertas Comunitarias (Waze Mode)

Este documento guarda la estructura lógica y el borrador de código para implementar el "Sistema de Alertas" cuando decidas habilitarlo en el futuro. 

Para invocar la creación de esta función, simplemente puedes decirle a la IA en un futuro: **"Implementa el plan de alertas comunitarias que guardaste en los artefactos de la conversación."**

## 1. Modificaciones UX / HTML (`index.html`)
Se debe añadir un grupo de botones rápidos en la pantalla de *tracking* (`.tracking-section`), debajo de los botones principales, para que el usuario pueda establecer su "estado de alerta" actual de forma rápida sin escribir.

```html
<!-- UI para emitir reportes/alertas debajo del botón Ver Mapa / Llegué -->
<div class="alert-box" id="alert-box">
    <p>Reportar en la vía:</p>
    <div class="alert-buttons">
        <button onclick="setAlert('🚦 Taco')">🚦 Taco</button>
        <button onclick="setAlert('💥 Accidente')">💥 Accidente</button>
        <button onclick="setAlert('🌫️ Neblina')">🌫️ Neblina</button>
        <button onclick="setAlert(null)" class="btn-clear-alert">✅ Todo despejado</button>
    </div>
</div>
```

## 2. Modificaciones de Estado (`js/app.js`)
El estado de la alerta es dinámico. Se debe guardar en una variable local y enviarse junto al "pulso" a Firebase.

```javascript
let currentAlert = null;

// Función para cambiar de estado al tocar un botón
function setAlert(alertType) {
    currentAlert = alertType;
    showToast(alertType ? `Alerta enviada: ${alertType}` : 'Has limpiado tus alertas');
    // Forzar actualización inmediata en DB
    if (lastKnownPos) {
        publishMyPosition(lastKnownPos.lat, lastKnownPos.lng, myMicro);
    }
}
```

## 3. Actualización de Firebase (`publishMyPosition`)
Cuando `app.js` empuja los datos al servidor, ahora debe incluir el campo opcional `alert`:

```javascript
// ... dentro de publishMyPosition()
db.ref("viajeros/" + myUserId).set({
    lat, lng, micro, avatar: myAvatar,
    alert: currentAlert || null,         // <--- NUEVO CAMPO AÑADIDO
    lastUpdate: firebase.database.ServerValue.TIMESTAMP
})
```

## 4. Renderizado en Mapa (Marcadores Clientes)
En la función que dibuja a los otros usuarios (`updateMapMarkers`), interceptamos y leemos la propiedad `c.alert`. 
Si la micro tiene una alerta, alteramos el Popup para evidenciar el peligro y adjuntamos un sub-ícono brillante al HTML de Leaflet:

```javascript
// Dentro de updateMapMarkers(), al crear c.alert = u.alert;
let alertTag = c.alert ? `<div class="badge-alert">⚠️ ${c.alert}</div>` : '';
let popupText = `<strong>Micro ${c.micro}</strong><br>${c.alert ? '🚨 Reporta: ' + c.alert : ''}`;

const icon = L.divIcon({
    className: '',
    html: `
      <div style="position:relative;">
         ${getBusIconHTML(color, c.count, c.avatar)}
         ${c.alert ? '<div style="position:absolute; top:-10px; right:-10px; background:white; border-radius:50%; font-size:16px;">⚠️</div>' : ''}
      </div>`,
    iconSize: [sizeWidth, sizeHeight],
    iconAnchor: [sizeWidth/2, sizeHeight/2]
});
```

## 5. Diseño (`css/style.css`)
Reglas rápidas para que luzca "Premium".

```css
.alert-box {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(255, 60, 60, 0.1);
    border: 1px solid rgba(255, 60, 60, 0.4);
    border-radius: 8px;
}
.alert-buttons {
    display: flex; gap: 0.5rem; overflow-x: auto;
}
.alert-buttons button {
    flex-shrink: 0;
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 20px;
    padding: 0.5rem 1rem;
}
.alert-buttons .btn-clear-alert { background: rgba(0, 255, 0, 0.1); }
```

## Resumen del Comportamiento
Al integrar estas líneas, solo se transmitirán alertas vigentes y automanejadas (caducan si la persona sale de la app o apreta "✅ Todo despejado"). Esto mantendrá limpia y transparente la red MICS Te Ayuda.
