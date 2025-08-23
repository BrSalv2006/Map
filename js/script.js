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
let weatherLayerControl;
let currentWorker = null;
let currentOverlays = {};
let currentRiskLegend = null;
let currentWeatherLegend = null;
let weatherLegendsData = {};

let fireDataProcessed = false;
let riskDataProcessed = false;
let noneRiskLayer;
let noneWeatherLayer;

function initializeMap() {
    map = L.map('map', {
        center: [39.557191, -7.8536599],
        zoom: 7,
        layers: BASE_LAYERS['Street']
    });

    map.createPane('weatherPane');
    map.getPane('weatherPane').style.zIndex = 300;

    L.control.locate({
        flyTo: true,
        locateOptions: {
            enableHighAccuracy: true
        }
    }).addTo(map);

    baseLayerControl = L.control.layers(BASE_LAYERS, null, {
        collapsed: true,
        position: 'topright'
    }).addTo(map);

    fireDataLayerControl = L.control.layers(null, null, {
        collapsed: true,
        position: 'topright'
    });

    riskLayerControl = L.control.layers(null, null, {
        collapsed: true,
        position: 'topright'
    });

    weatherLayerControl = L.control.layers(null, null, {
        collapsed: true,
        position: 'topright'
    });

    noneRiskLayer = L.layerGroup();
    noneWeatherLayer = L.layerGroup();

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
                const popupContent = `<b>Localização:</b> ${p.location}<br><hr style="margin: 4px 0;"><b>Brilho:</b> ${p.brightness}K<br><b>Data, Hora:</b> ${p.acq_date}<br><b>Satélite:</b> ${p.satellite}<br><b>Confiança:</b> ${p.confidence}<br><b>Dia/Noite:</b> ${p.daynight}<br><b>PRF:</b> ${p.frp}MW`;
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

function addOrRemoveControl(control, type) {
    if ((type === 'fireData' && fireDataProcessed) || (type === 'riskData' && riskDataProcessed)) {
        if (!control._map) {
            control.addTo(map);
        }
    } else {
        if (control._map) {
            map.removeControl(control);
        }
    }
    if (fireDataProcessed && riskDataProcessed) {
        document.getElementById('loader').style.display = 'none';
        editBackgroundImages();
    }
}

function populateMap(data) {
    document.getElementById('loader').innerText = 'Generating map layers...';
    resetOverlays();

    if (data.modis) {
        const { hotspots, areas } = createFireLayers(data.modis);
        const modisCombinedLayer = L.layerGroup([hotspots, areas]);
        fireDataLayerControl.addOverlay(modisCombinedLayer, 'MODIS');
        currentOverlays.modis = modisCombinedLayer;
    }

    if (data.viirs) {
        const { hotspots, areas } = createFireLayers(data.viirs);
        const viirsCombinedLayer = L.layerGroup([hotspots, areas]);
        fireDataLayerControl.addOverlay(viirsCombinedLayer, 'VIIRS');
        currentOverlays.viirs = viirsCombinedLayer;
    }

    fireDataProcessed = true;
    addOrRemoveControl(fireDataLayerControl, 'fireData');
}

function addRiskLegend(map) {
    if (currentRiskLegend) {
        map.removeControl(currentRiskLegend);
    }

    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        const grades = [1, 2, 3, 4, 5];
        const labels = ['Reduzido', 'Moderado', 'Elevado', 'Muito Elevado', 'Máximo'];
        const colors = ['#509e2f', '#ffe900', '#e87722', '#cb333b', '#6f263d'];
        div.innerHTML += '<h4>Risco de Incêndio</h4>';
        for (let i = 0; i < grades.length; i++) {
            div.innerHTML +=
                '<i style="background:' + colors[i] + '" class="' + labels[i] + '"></i> ' + labels[i] + '<br>';
        }
        return div;
    };
    legend.addTo(map);
    currentRiskLegend = legend;
}

function generateWeatherLegend(title, stops, unit) {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML += `<h4>${title}</h4>`;
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            const nextStop = stops[i + 1];
            let label = `${stop.value} ${unit}`;
            if (nextStop) {
                label += ` - ${nextStop.value} ${unit}`;
            } else {
                label += '+';
            }
            div.innerHTML +=
                `<i style="background:${stop.color}"></i> ${label}<br>`;
        }
        return div;
    };
    return legend;
}

function onBaseLayerChange(e) {
    map.setMaxBounds([
        [-90, -180],
        [90, 180]
    ]);
    const selectedLayerName = e.name;
    const isRiskLayer = selectedLayerName.startsWith('Risco');

    const weatherLayerMapping = {
        'Temperatura do Ar (2m)': 'TA2',
        'Temperatura do Ponto de Orvalho': 'TD2',
        'Temperatura do Solo (0-10cm)': 'TS0',
        'Temperatura do Solo (>10cm)': 'TS10',
        'Pressão Atmosférica': 'APM',
        'Vento (Velocidade & Direção)': 'WND',
        'Velocidade Vento (10m)': 'WS10',
        'Humidade Relativa': 'HRD0',
        'Nebulosidade': 'CL',
        'Precipitação Convectiva': 'PAC0',
        'Intensidade Precipitação': 'PR0',
        'Precipitação Acumulada': 'PA0',
        'Precipitação Acumulada - Chuva': 'PAR0',
        'Precipitação Acumulada - Neve': 'PAS0',
        'Profundidade Neve': 'SD0'
    };

    const weatherLayerKey = weatherLayerMapping[selectedLayerName];

    if ((weatherLayerKey || selectedLayerName === "Nenhum ") && currentWeatherLegend) {
        map.removeControl(currentWeatherLegend);
        currentWeatherLegend = null;
    }
    if (selectedLayerName === "Nenhum" && currentRiskLegend) {
        map.removeControl(currentRiskLegend);
        currentRiskLegend = null;
    }

    if (isRiskLayer) {
        addRiskLegend(map);
    } else if (weatherLayerKey && weatherLegendsData[weatherLayerKey]) {
        const legendInfo = weatherLegendsData[weatherLayerKey];
        currentWeatherLegend = generateWeatherLegend(legendInfo.name, legendInfo.stops, legendInfo.unit);
        currentWeatherLegend.addTo(map);
    }
}


function addWeatherLayers() {
    noneWeatherLayer = L.layerGroup();
    const OWM_APP_ID = '89ae8b33d0bde5d8a89a7f5550e87869';

    const createWeatherTileLayer = (layerName) => L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: layerName,
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });

    const baseLayers = {
        'Nenhum ': noneWeatherLayer,
        'Temperatura do Ar (2m)': createWeatherTileLayer('TA2'),
        'Temperatura do Ponto de Orvalho': createWeatherTileLayer('TD2'),
        'Temperatura do Solo (0-10cm)': createWeatherTileLayer('TS0'),
        'Temperatura do Solo (>10cm)': createWeatherTileLayer('TS10'),
        'Pressão Atmosférica': createWeatherTileLayer('APM'),
        'Vento (Velocidade & Direção)': createWeatherTileLayer('WND'),
        'Velocidade Vento (10m)': createWeatherTileLayer('WS10'),
        'Humidade Relativa': createWeatherTileLayer('HRD0'),
        'Nebulosidade': createWeatherTileLayer('CL'),
        'Precipitação Convectiva': createWeatherTileLayer('PAC0'),
        'Intensidade Precipitação': createWeatherTileLayer('PR0'),
        'Precipitação Acumulada': createWeatherTileLayer('PA0'),
        'Precipitação Acumulada - Chuva': createWeatherTileLayer('PAR0'),
        'Precipitação Acumulada - Neve': createWeatherTileLayer('PAS0'),
        'Profundidade Neve': createWeatherTileLayer('SD0')
    };

    noneWeatherLayer.addTo(map);

    weatherLayerControl = L.control.layers(baseLayers, null, {
        collapsed: true,
        position: 'topright'
    }).addTo(map);
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
        const {
            type,
            message,
            data
        } = e.data;
        if (type === 'progress') {
            loader.innerText = message;
        } else if (type === 'initDataComplete') {
            loader.innerText = 'Geographical data loaded. Fetching fire and risk data...';
            currentWorker.postMessage({
                type: 'fireData',
                dayRange: 1
            });
            currentWorker.postMessage({
                type: 'riskData'
            });
        }
        else if (type === 'result') {
            populateMap(data);
        } else if (type === 'riskResult') {
            loader.innerText = 'Adding risk layers...';
            if (riskLayerControl._map !== null) {
                riskLayerControl.remove();
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
            }
            riskLayerControl = L.control.layers(riskBaseLayers, null, { collapsed: true, position: 'topright' });
            noneRiskLayer.addTo(map);
            riskDataProcessed = true;
            addOrRemoveControl(riskLayerControl, 'riskData');
        } else if (type === 'error') {
            const errorMessage = document.createElement('div');
            errorMessage.className = 'error-message';
            errorMessage.textContent = message;
            document.body.appendChild(errorMessage);
            setTimeout(() => errorMessage.remove(), 5000);
            if (message.includes("fire data")) {
                fireDataProcessed = true;
            } else if (message.includes("risk layers") || message.includes("Concelhos GeoJSON")) {
                riskDataProcessed = true;
            }
            if (fireDataProcessed && riskDataProcessed) {
                document.getElementById('loader').style.display = 'none';
                editBackgroundImages();
            }
        }
    };

    currentWorker.onerror = (e) => {
        loader.innerText = 'An error occurred during processing.';
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = 'A critical error occurred in the worker. Check the console for details.';
        document.body.appendChild(errorMessage);
        setTimeout(() => errorMessage.remove(), 5000);
        fireDataProcessed = true;
        riskDataProcessed = true;
        document.getElementById('loader').style.display = 'none';
        editBackgroundImages();
    };
}

function editBackgroundImages() {
    let baseLayerControls = baseLayerControl.getContainer().children[0].style;
    baseLayerControls.backgroundImage = "url('https://cdn-icons-png.flaticon.com/512/592/592245.png')";
    baseLayerControls.backgroundSize = "28px";

    let fireDataLayerControls = fireDataLayerControl.getContainer().children[0].style;
    fireDataLayerControls.backgroundImage = "url('https://cdn-icons-png.flaticon.com/512/17143/17143716.png')";
    fireDataLayerControls.backgroundSize = "28px";

    let weatherLayerControls = weatherLayerControl.getContainer().children[0].style;
    weatherLayerControls.backgroundImage = "url('https://cdn-icons-png.flaticon.com/512/3313/3313888.png')";
    weatherLayerControls.backgroundSize = "28px";

    let riskLayerControls = riskLayerControl.getContainer().children[0].style;
    riskLayerControls.backgroundImage = "url('https://cdn-icons-png.flaticon.com/512/3239/3239831.png')";
    riskLayerControls.backgroundSize = "28px";
}

function setupControls() {
    setupWorker();
    currentWorker.postMessage({ type: 'initData' });
}

async function loadWeatherLegendsData() {
    try {
        const response = await fetch('json/weather_legends.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        weatherLegendsData = await response.json();
    } catch (error) {
        const errorMessage = document.createElement('div');
        errorMessage.className = 'error-message';
        errorMessage.textContent = `Error loading weather legends: ${error.message}`;
        document.body.appendChild(errorMessage);
        setTimeout(() => errorMessage.remove(), 5000);
    }
}

window.onload = async () => {
    initializeMap();
    await loadWeatherLegendsData();
    setupControls();
    addWeatherLayers(map);
};