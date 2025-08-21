const BASE_LAYERS = {
    "Street": L.tileLayer('https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Street Dark": L.tileLayer('https://api.maptiler.com/maps/streets-v2-dark/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Street Light": L.tileLayer('https://api.maptiler.com/maps/streets-v2-light/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Street Pastel": L.tileLayer('https://api.maptiler.com/maps/streets-v2-pastel/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Hybrid": L.tileLayer('https://api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Satellite": L.tileLayer('https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22,
    }),
    "Basic": L.tileLayer('https://api.maptiler.com/maps/basic-v2/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Basic Dark": L.tileLayer('https://api.maptiler.com/maps/basic-v2-dark/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Basic Light": L.tileLayer('https://api.maptiler.com/maps/basic-v2-light/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Outdoor": L.tileLayer('https://api.maptiler.com/maps/outdoor-v2/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Outdoor Dark": L.tileLayer('https://api.maptiler.com/maps/outdoor-v2-dark/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Topo": L.tileLayer('https://api.maptiler.com/maps/topo-v2/256/{z}/{x}/{y}@2x.png?key=M5oddZtB9rr0EdbaCglK', {
        minZoom: 2,
        maxZoom: 22
    }),
    "Real-Time": L.esri.tiledMapLayer({
        url: "https://gis.nnvl.noaa.gov/arcgis/rest/services/TRUE/TRUE_current/ImageServer",
        minZoom: 2,
        maxZoom: 8
    })
};

let map;
let baseLayerControl;
let fireDataLayerControl;
let riskLayerControl;
let portugalGeometry;
let concelhosGeoJSON;
let currentWorker = null;
let currentOverlays = {};
let currentRiskLegend = null;

let fireDataLoaded = false;
let riskDataLoaded = false;
let noneRiskLayer;

function initializeMap() {
    map = L.map('map', {
        center: [39.557191, -7.8536599],
        zoom: 7,
        layers: BASE_LAYERS['Street']
    });
    L.control.locate({
        flyTo: true,
        locateOptions: {
            enableHighAccuracy: true
        }
    }).addTo(map);

    baseLayerControl = L.control.layers(BASE_LAYERS, null, {
        collapsed: false,
        position: 'topright'
    }).addTo(map);

    fireDataLayerControl = L.control.layers(null, {}, {
        collapsed: false,
        position: 'topright'
    });

    riskLayerControl = L.control.layers(null, null, {
        collapsed: false,
        position: 'topright'
    });

    noneRiskLayer = L.layerGroup();

    map.on('baselayerchange', onBaseLayerChange);
    map.setMaxBounds([
        [-90, -180],
        [90, 180]
    ]);
}

function resetOverlays() {
    for (const key in currentOverlays) {
        if (map.hasLayer(currentOverlays[key])) {
            map.removeLayer(currentOverlays[key]);
        }
        fireDataLayerControl.removeLayer(currentOverlays[key]);
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
        fireDataLayerControl.addOverlay(modisCombinedLayer, 'MODIS');
        currentOverlays.modis = modisCombinedLayer;
        allFeaturesLayers.push(hotspots, areas);
    }

    if (data.viirs) {
        const { hotspots, areas } = createFireLayers(data.viirs);
        const viirsCombinedLayer = L.layerGroup([hotspots, areas]);
        fireDataLayerControl.addOverlay(viirsCombinedLayer, 'VIIRS');
        currentOverlays.viirs = viirsCombinedLayer;
        allFeaturesLayers.push(hotspots, areas);
    }

    fireDataLoaded = true;
    console.log('Fire data loaded:', fireDataLoaded);
    checkAndAddControl('fireData');
    checkAllLoaded();
}

function checkAllLoaded() {
    if (fireDataLoaded && riskDataLoaded) {
        document.getElementById('loader').style.display = 'none';
        console.log('All data loaded. Hiding loader.');
    } else {
        console.log('Not all data loaded yet. Fire:', fireDataLoaded, 'Risk:', riskDataLoaded);
    }
}

function checkAndAddControl(controlType) {
    console.log(`Attempting to add control for ${controlType}. Fire loaded: ${fireDataLoaded}, Risk loaded: ${riskDataLoaded}`);
    if (controlType === 'fireData' && fireDataLoaded && !fireDataLayerControl._map) {
        fireDataLayerControl.addTo(map);
        console.log('Fire data control added to map.');
    } else if (controlType === 'riskData' && riskDataLoaded && !riskLayerControl._map) {
        riskLayerControl.addTo(map);
        console.log('Risk data control added to map.');
    } else {
        console.log(`Control for ${controlType} not added. Conditions not met or already on map. Fire control map status: ${fireDataLayerControl._map !== null}, Risk control map status: ${riskLayerControl._map !== null}`);
    }
}

function getColor(d) {
    let color;
    switch (d) {
        case 1:
            color = '#509e2f';
            break;
        case 2:
            color = '#ffe900';
            break;
        case 3:
            color = '#e87722';
            break;
        case 4:
            color = '#cb333b';
            break;
        case 5:
            color = '#6f263d';
            break;
        default:
            color = 'rgb(255, 255, 255)';
    }
    return color;
}

function addRiskLegend(map) {
    if (currentRiskLegend) {
        map.removeControl(currentRiskLegend);
    }

    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function (map) {
        const div = L.DomUtil.create('div', 'info legend');
        const grades = [1, 2, 3, 4, 5];
        const labels = ['Reduzido', 'Moderado', 'Elevado', 'Muito Elevado', 'Máximo'];
        div.innerHTML += '<h4>Risco de Incêndio</h4>';
        for (let i = 0; i < grades.length; i++) {
            div.innerHTML +=
                '<i style="background:' + getColor(grades[i]) + '" class="' + labels[i] + '"></i> ' + labels[i] + '<br>';
        }
        return div;
    };
    legend.addTo(map);
    currentRiskLegend = legend;
}

function onBaseLayerChange(e) {
    if (e.name.startsWith('Risco')) {
        addRiskLegend(map);
    } else if (currentRiskLegend && e.name == 'Nenhum') {
        map.removeControl(currentRiskLegend);
        currentRiskLegend = null;
    }
}

function setupWorker() {
    if (currentWorker) {
        return;
    }

    const loader = document.getElementById('loader');
    loader.style.display = 'block';
    loader.innerText = 'Initializing data processing...';
    currentWorker = new Worker('js/worker.js');

    currentWorker.onmessage = (e) => {
        console.log('Message from worker:', e.data.type, e.data.message);
        const {
            type,
            message,
            data
        } = e.data;
        if (type === 'progress') {
            loader.innerText = message;
        } else if (type === 'result') {
            populateMap(data);
        } else if (type === 'riskResult') {
            loader.innerText = 'Adding risk layers...';
            if (riskLayerControl._map !== null) {
                riskLayerControl.remove();
                console.log('Removed existing risk layer control.');
            }
            const riskBaseLayers = {
                "Nenhum": noneRiskLayer
            };
            for (const key in data) {
                const geoJsonData = data[key];
                const riskLayer = L.geoJson(geoJsonData, {
                    style: function (feature) {
                        return {
                            weight: 1.0,
                            color: '#666',
                            fillOpacity: 0.6,
                            fillColor: feature.properties.fillColor
                        };
                    }
                });
                riskBaseLayers[key] = riskLayer;
                console.log(`Added ${key} to riskBaseLayers.`);
            }

            riskLayerControl = L.control.layers(riskBaseLayers, null, { collapsed: false, position: 'topright' });

            noneRiskLayer.addTo(map);
            riskDataLoaded = true;
            console.log('Risk data loaded:', riskDataLoaded);
            checkAndAddControl('riskData');
            checkAllLoaded();
        } else if (type === 'error') {
            console.error('Worker error received:', message);
            const errorMessage = document.createElement('div');
            errorMessage.className = 'error-message';
            errorMessage.textContent = message;
            document.body.appendChild(errorMessage);
            setTimeout(() => errorMessage.remove(), 5000);
            if (message.includes("fire data")) {
                fireDataLoaded = true;
                console.log('Fire data error, setting fireDataLoaded to true.');
            } else if (message.includes("risk layers")) {
                riskDataLoaded = true;
                console.log('Risk data error, setting riskDataLoaded to true.');
            }
            checkAllLoaded();
        }
    };

    currentWorker.onerror = (e) => {
        console.error('Error in worker:', e);
        loader.innerText = 'An error occurred during processing.';
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = 'A critical error occurred in the worker. Check the console for details.';
        document.body.appendChild(errorMessage);
        setTimeout(() => errorMessage.remove(), 5000);
        fireDataLoaded = true;
        riskDataLoaded = true;
        console.log('Worker critical error, setting both dataLoaded flags to true.');
        checkAllLoaded();
    };
}

async function setupControls() {
    console.log('Setting up controls...');
    setupWorker();

    let responsePortugal = await fetch('json/portugal.json');
    portugalGeometry = await responsePortugal.json();
    console.log('portugal.json loaded.');

    let responseConcelhos = await fetch('json/concelhos.json');
    concelhosGeoJSON = await responseConcelhos.json();
    console.log('concelhos.json loaded.');

    currentWorker.postMessage({
        type: 'fireData',
        geometry: portugalGeometry.geometries[0],
        dayRange: 1
    });
    console.log('Sent fireData request to worker.');

    currentWorker.postMessage({
        type: 'riskData',
        concelhosGeoJSON: concelhosGeoJSON
    });
    console.log('Sent riskData request to worker.');
}

function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)');
    const results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

window.onload = async () => {
    console.log('Window loaded. Initializing map...');
    initializeMap();
    await setupControls();
    console.log('Setup controls initiated.');
};