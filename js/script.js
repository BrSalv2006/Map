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
let portugalGeometry;
let concelhosGeoJSON;
let currentWorker = null;
let currentOverlays = {};
let currentRiskLegend = null;
let currentWeatherLegend = null;
let weatherLegendsData = {};

let fireDataLoaded = false;
let riskDataLoaded = false;
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
        editBackgroundImages();
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

function generateWeatherLegend(title, stops, unit) {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function (map) {
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


function addWeatherLayers(map) {
    noneWeatherLayer = L.layerGroup();
    const OWM_APP_ID = '89ae8b33d0bde5d8a89a7f5550e87869';

    var cloudinessLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'CL',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var precipitationConvectiveLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'PAC0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var precipitationIntensityLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'PR0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var accumulatedPrecipitationLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'PA0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var accumulatedPrecipitationRainLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'PAR0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var accumulatedPrecipitationSnowLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'PAS0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var snowDepthLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'SD0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var windSpeed10mLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'WS10',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var jointWindLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'WND',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var atmosphericPressureLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'APM',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var airTemperature2mLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'TA2',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var dewPointTemperatureLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'TD2',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var soilTemperature0_10cmLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'TS0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var soilTemperatureGt10cmLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'TS10',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });
    var relativeHumidityLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: 'HRD0',
        appId: OWM_APP_ID,
        pane: 'weatherPane'
    });

    var baseLayers = {
        'Nenhum ': noneWeatherLayer,
        'Temperatura do Ar (2m)': airTemperature2mLayer,
        'Temperatura do Ponto de Orvalho': dewPointTemperatureLayer,
        'Temperatura do Solo (0-10cm)': soilTemperature0_10cmLayer,
        'Temperatura do Solo (>10cm)': soilTemperatureGt10cmLayer,
        'Pressão Atmosférica': atmosphericPressureLayer,
        'Vento (Velocidade & Direção)': jointWindLayer,
        'Velocidade Vento (10m)': windSpeed10mLayer,
        'Humidade Relativa': relativeHumidityLayer,
        'Nebulosidade': cloudinessLayer,
        'Precipitação Convectiva': precipitationConvectiveLayer,
        'Intensidade Precipitação': precipitationIntensityLayer,
        'Precipitação Acumulada': accumulatedPrecipitationLayer,
        'Precipitação Acumulada - Chuva': accumulatedPrecipitationRainLayer,
        'Precipitação Acumulada - Neve': accumulatedPrecipitationSnowLayer,
        'Profundidade Neve': snowDepthLayer
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

            riskLayerControl = L.control.layers(riskBaseLayers, null, { collapsed: true, position: 'topright' });

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

async function loadWeatherLegendsData() {
    try {
        const response = await fetch('json/weather_legends.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        weatherLegendsData = await response.json();
        console.log('weather_legends.json loaded successfully.');
    } catch (error) {
        console.error('Error loading weather_legends.json:', error);
    }
}

window.onload = async () => {
    console.log('Window loaded. Initializing map...');
    initializeMap();
    await loadWeatherLegendsData();
    await setupControls();
    console.log('Setup controls initiated.');
    addWeatherLayers(map);
    console.log('Weather Layers initiated.');
};