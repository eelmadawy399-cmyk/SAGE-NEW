// SAGE Egypt - Map Module
// Handles Leaflet map initialization and EE tile layers

var map;
var currentLayers = {};
var currentMarker = null;

function initMap() {
    map = L.map('map', {
        center: CONFIG.MAP_CENTER,
        zoom: CONFIG.MAP_ZOOM,
        zoomControl: true,
        attributionControl: false
    });

    // Add satellite base layer
    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        attribution: '© Google'
    }).addTo(map);

    // Map click handler
    map.on('click', function (e) {
        if (window.mapClickEnabled) {
            onMapClick(e.latlng.lat, e.latlng.lng);
        }
    });

    console.log('🗺️ Map initialized');
}

// Add EE image as tile layer
function addEELayer(eeImage, visParams, name) {
    showLoading('جاري تحميل الطبقة...');

    eeImage.getMap(visParams, function (mapObj) {
        // Remove old layer with same name
        if (currentLayers[name]) {
            map.removeLayer(currentLayers[name]);
        }

        var tileLayer = L.tileLayer(mapObj.urlFormat, {
            maxZoom: 20,
            opacity: 0.7
        });

        tileLayer.addTo(map);
        currentLayers[name] = tileLayer;
        hideLoading();
    });
}

// Remove a layer by name
function removeEELayer(name) {
    if (currentLayers[name]) {
        map.removeLayer(currentLayers[name]);
        delete currentLayers[name];
    }
}

// Clear all EE layers
function clearEELayers() {
    for (var name in currentLayers) {
        map.removeLayer(currentLayers[name]);
    }
    currentLayers = {};
}

// Add a marker
function addMarker(lat, lng, label) {
    if (currentMarker) {
        map.removeLayer(currentMarker);
    }
    currentMarker = L.marker([lat, lng])
        .addTo(map)
        .bindPopup(label || '📍 الموقع المحدد')
        .openPopup();
    return currentMarker;
}

// Add a circle (buffer area)
function addBufferCircle(lat, lng, radius) {
    return L.circle([lat, lng], {
        radius: radius,
        color: '#4CAF50',
        fillColor: '#4CAF5044',
        fillOpacity: 0.3,
        weight: 2
    }).addTo(map);
}

// Center map on location
function centerMap(lat, lng, zoom) {
    map.setView([lat, lng], zoom || 14);
}
