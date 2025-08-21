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
    "OpenStreetMap": MAP_CONFIG.layers[0],
    "OpenStreetMap HOT": L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team hosted by OpenStreetMap France'
    }),
    "OpenTopoMap": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)'
    })
};

let map;
let layerControl;
let allCountriesGeoJSON;
let currentWorker = null;
let currentOverlays = {}; // To store current MODIS and VIIRS layers

function initializeMap() {
    map = L.map('map', MAP_CONFIG);
    L.control.locate({
        flyTo: true,
        locateOptions: {
            enableHighAccuracy: true
        }
    }).addTo(map);
    layerControl = L.control.layers(BASE_LAYERS, null).addTo(map);
}

function resetOverlays() {
    for (const key in currentOverlays) {
        if (map.hasLayer(currentOverlays[key])) {
            map.removeLayer(currentOverlays[key]);
        }
        layerControl.removeLayer(currentOverlays[key]);
    }
    currentOverlays = {};
}

function createFireLayers(fireData) {
    const hotspots = L.markerClusterGroup({
        maxClusterRadius: 40
    });
    const areas = L.featureGroup();

    for (const continent in fireData) {
        for (const country in fireData[continent]) {
            const countryData = fireData[continent][country];
            countryData.points.forEach(point => {
                const marker = L.marker([point.geometry.coordinates[1], point.geometry.coordinates[0]]);
                const p = point.properties;
                const popupContent = `<b>Location:</b> ${p.location}<br><hr style="margin: 4px 0;"><b>Brightness:</b> ${p.brightness} K<br><b>Acquired:</b> ${p.acq_date}<br><b>Satellite:</b> ${p.satellite}<br><b>Confidence:</b> ${p.confidence}<br><b>Day/Night:</b> ${p.daynight}<br><b>FRP:</b> ${p.frp} MW`;
                marker.bindPopup(popupContent);
                hotspots.addLayer(marker);
            });

            if (countryData.areas && countryData.areas.features.length > 0) {
                const areaLayer = L.geoJSON(countryData.areas, {
                    style: {
                        color: "#ff0000",
                        weight: 2,
                        opacity: 0.8,
                        fillColor: "#ff0000",
                        fillOpacity: 0.2
                    },
                    onEachFeature: (feature, layer) => {
                        const area_sq_km = turf.area(feature) / 1000000;
                        layer.bindPopup(`Burnt Area: ${Math.round(area_sq_km)} KM²`);
                    }
                });
                areas.addLayer(areaLayer);
            }
        }
    }
    return { hotspots, areas };
}

function populateMap(data) {
    const loader = document.getElementById('loader');
    loader.innerText = 'Generating map layers...';
    resetOverlays();

    const allFeaturesLayers = [];

    if (data.modis) {
        const { hotspots, areas } = createFireLayers(data.modis);
        const modisCombinedLayer = L.layerGroup([hotspots, areas]);
        layerControl.addOverlay(modisCombinedLayer, 'MODIS Fires');
        currentOverlays.modis = modisCombinedLayer;
        allFeaturesLayers.push(hotspots, areas);
    } 

    if (data.viirs) {
        const { hotspots, areas } = createFireLayers(data.viirs);
        const viirsCombinedLayer = L.layerGroup([hotspots, areas]);
        layerControl.addOverlay(viirsCombinedLayer, 'VIIRS Fires');
        currentOverlays.viirs = viirsCombinedLayer;
        allFeaturesLayers.push(hotspots, areas);
    }

    if (allFeaturesLayers.length > 0) {
        const allFeatures = L.featureGroup(allFeaturesLayers);
        if (allFeatures.getLayers().length > 0) {
            map.fitBounds(allFeatures.getBounds().pad(0.1));
        }
    }
    loader.style.display = 'none';
}

function startWorker(params) {
    if (currentWorker) {
        currentWorker.terminate();
    }
    const loader = document.getElementById('loader');
    loader.style.display = 'block';
    loader.innerText = 'Starting data processing...';
    currentWorker = new Worker('js/worker.js');

    currentWorker.onmessage = (e) => {
        const {
            type,
            message,
            data
        } = e.data;
        if (type === 'progress') {
            loader.innerText = message;
        } else if (type === 'result') {
            populateMap(data);
            currentWorker.terminate();
            currentWorker = null;
        } else if (type === 'error') {
            alert(message);
            loader.style.display = 'none';
            currentWorker.terminate();
            currentWorker = null;
        }
    };

    currentWorker.onerror = (e) => {
        console.error('Error in worker:', e);
        loader.innerText = 'An error occurred during processing.';
        alert('A critical error occurred in the worker. Check the console for details.');
        currentWorker.terminate();
        currentWorker = null;
    };

    currentWorker.postMessage(params);
}

async function setupControls() {
    let response = await fetch('countries.json');
    allCountriesGeoJSON = await response.json();

    startWorker({
        selectedCountryNames: ['Portugal'],
        dayRange: 1,
        allCountriesGeoJSON
    });
}

window.onload = () => {
    initializeMap();
    setupControls();
};