const MAP_CONFIG = {
    center: [0, 0],
    zoom: 2,
    layers: [
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        })
    ]
};

const BASE_LAYERS = {
    label: 'Base Layers',
    children: [{
        label: 'OpenStreetMap',
        layer: MAP_CONFIG.layers[0]
    }, {
        label: 'OpenStreetMap HOT',
        layer: L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team hosted by OpenStreetMap France'
        })
    }, {
        label: 'OpenTopoMap',
        layer: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)'
        })
    }]
};

let map;
let treeControl;
let allCountriesGeoJSON;
let currentWorker = null;
let currentOverlayTree = null;

function initializeMap() {
    map = L.map('map', MAP_CONFIG);

    L.control.locate({
        setView: true,
        flyTo: true,
        locateOptions: {
            enableHighAccuracy: true
        }
    }).addTo(map);

    treeControl = L.control.layers.tree(BASE_LAYERS, {}, {
        collapsed: true,
        sortLayers: true
    }).addTo(map);
}

function displayMessage(message, type = 'info') {
    const loader = document.getElementById('loader');
    loader.style.display = 'block';
    loader.innerText = message;
    if (type === 'error') {
        loader.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
    } else {
        loader.style.backgroundColor = 'var(--loader-bg)';
    }
}

function hideMessage() {
    const loader = document.getElementById('loader');
    loader.style.display = 'none';
    loader.style.backgroundColor = 'var(--loader-bg)'; // Reset to default
}

function startWorker(params) {
    if (currentWorker) {
        currentWorker.terminate();
    }
    displayMessage('Loading fire data...');
    currentWorker = new Worker('worker.js');

    currentWorker.onmessage = (e) => {
        if (e.data.type === 'progress') {
            displayMessage(e.data.message);
        } else if (e.data.type === 'result') {
            hideMessage();
            renderFireData(e.data.data);
        } else if (e.data.type === 'error') {
            displayMessage(e.data.message, 'error');
            console.error("Worker error:", e.data.message);
        }
    };

    currentWorker.onerror = (e) => {
        displayMessage('An error occurred during data processing.', 'error');
        console.error("Worker encountered an error:", e);
    };

    currentWorker.postMessage(params);
}


function renderFireData(fireData) {
    if (currentOverlayTree) {
        treeControl.removeLayer(currentOverlayTree);
    }

    const fireMarkers = L.markerClusterGroup();
    fireData.firePoints.forEach(point => {
        const marker = L.marker([point.latitude, point.longitude]);
        marker.bindPopup(`
            <b>Confidence:</b> ${point.confidence}<br>
            <b>Brightness:</b> ${point.brightness}<br>
            <b>Date:</b> ${new Date(point.acquisitionDate).toLocaleDateString()}<br>
            <b>Time:</b> ${point.acquisitionTime}<br>
            <b>Satellite:</b> ${point.satellite}<br>
            <b>Country:</b> ${point.countryName || 'N/A'}
        `);
        fireMarkers.addLayer(marker);
    });
    map.addLayer(fireMarkers);

    const countryLayers = {};
    Object.keys(fireData.countryGeoJSONs).forEach(countryName => {
        const geojsonLayer = L.geoJSON(fireData.countryGeoJSONs[countryName], {
            style: {
                color: 'blue',
                weight: 2,
                opacity: 0.5,
                fillOpacity: 0.1
            }
        });
        countryLayers[countryName] = geojsonLayer;
        map.fitBounds(geojsonLayer.getBounds());
    });

    const overlayTree = {
        label: 'Fire Data Overlays',
        children: []
    };

    if (fireMarkers.getLayers().length > 0) {
        overlayTree.children.push({
            label: `Fire Hotspots (${fireMarkers.getLayers().length})`,
            layer: fireMarkers
        });
    }

    Object.keys(countryLayers).forEach(countryName => {
        if (fireData.burntAreas[countryName]) {
            overlayTree.children.push({
                label: `${countryName} Burnt Area: ${fireData.burntAreas[countryName].toFixed(2)} sq km`,
                layer: countryLayers[countryName]
            });
        } else {
            overlayTree.children.push({
                label: countryName,
                layer: countryLayers[countryName]
            });
        }
    });

    currentOverlayTree = overlayTree;
    treeControl.addOverlay(overlayTree);
    treeControl.expandAll();
}


document.addEventListener('DOMContentLoaded', async () => {
    initializeMap();
    const countrySelector = document.getElementById('country-selector');
    const dayRangeSelector = document.getElementById('day-range-selector');
    const satelliteSelector = document.getElementById('satellite-selector');
    const loadBtn = document.getElementById('load-data-btn');

    async function loadInitialData() {
        displayMessage('Loading initial data...');
        try {
            const response = await fetch('countries.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            allCountriesGeoJSON = await response.json();

            const countries = allCountriesGeoJSON.features
                .map(f => f.properties.name) // Use 'name' property from countries.json
                .filter(name => name && name !== "-99")
                .sort((a, b) => a.localeCompare(b));

            countries.forEach(country => {
                const option = document.createElement('option');
                option.value = country;
                option.textContent = country;
                countrySelector.appendChild(option);
            });

            hideMessage();
        } catch (error) {
            displayMessage('Could not load initial data.', 'error');
            console.error("Failed to load initial data:", error);
        }
    }

    loadInitialData();

    loadBtn.addEventListener('click', () => {
        const selectedCountryNames = Array.from(countrySelector.selectedOptions).map(opt => opt.value);
        if (selectedCountryNames.length === 0) {
            displayMessage('Please select at least one country.', 'info');
            return;
        }
        startWorker({
            selectedCountryNames,
            dayRange: dayRangeSelector.value,
            selectedSatellite: satelliteSelector.value,
            allCountriesGeoJSON // Pass the loaded GeoJSON object
        });
    });
});