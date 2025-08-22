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

    fireDataLayerControl = L.control.layers(null, {}, {
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
            if (stop.color.includes('rgba') && nextStop && nextStop.color.includes('rgba')) {
                const gradientStyle = `background: linear-gradient(to right, ${stop.color}, ${nextStop.color});`;
                div.innerHTML +=
                    `<div style="${gradientStyle} width: 100%; height: 18px; line-height: 18px; text-align: center; color: white; font-size: 0.8em;">${stop.value} ${unit} - ${nextStop.value} ${unit}</div>`;
            } else if (stop.color.includes('rgba') && !nextStop) {
                div.innerHTML +=
                    `<div style="background:${stop.color}; width: 100%; height: 18px; line-height: 18px; text-align: center; color: white; font-size: 0.8em;">${stop.value} ${unit}+</div>`;
            }
            else {
                div.innerHTML +=
                    `<i style="background:${stop.color}; width: 18px; height: 18px; float: left; margin-right: 8px;"></i> ${stop.value} ${unit} ${nextStop ? `- ${nextStop.value} ${unit}` : '+'}<br>`;
            }
        }
        return div;
    };
    return legend;
}

function parseStops(stopString) {
    const cleanedStopString = stopString.substring(0, stopString.lastIndexOf('}') + 1);
    const regex = /stop\(([^,]+),\s*(rgba\([^)]+\)|#[0-9a-fA-F]{6}|transparent)\)/g;
    let match;
    const stops = [];

    while ((match = regex.exec(cleanedStopString)) !== null) {
        const value = parseFloat(match[1].trim());
        const color = match[2].trim();
        stops.push({ value, color });
    }
    return stops;
}


function onBaseLayerChange(e) {
    const selectedLayerName = e.name;
    const isRiskLayer = selectedLayerName.startsWith('Risco');
    const isWeatherLayerOption = [
        'Temperatura', 'Pressão', 'Vento', 'Precipitação', 'Nuvens', 'Neve',
        'Precipitação Convectiva', 'Intensidade Precipitação', 'Precipitação Acumulada',
        'Precipitação Acumulada - Chuva', 'Precipitação Acumulada - Neve', 'Profundidade Neve',
        'Velocidade Vento (10m)', 'Vento (Velocidade & Direção)', 'Pressão Atmosférica',
        'Temperatura do Ar (2m)', 'Temperatura do Ponto de Orvalho', 'Temperatura do Solo (0-10cm)',
        'Temperatura do Solo (>10cm)', 'Humidade Relativa', 'Nebulosidade'
    ].includes(selectedLayerName);

    if ((isWeatherLayerOption || selectedLayerName == "Nenhum ") && currentWeatherLegend) {
        map.removeControl(currentWeatherLegend);
        currentWeatherLegend = null;
    }
    if (selectedLayerName == "Nenhum" && currentRiskLegend) {
        map.removeControl(currentRiskLegend);
        currentRiskLegend = null;
    }

    if (isRiskLayer) {
        addRiskLegend(map);
    } else if (isWeatherLayerOption) {
        if (selectedLayerName === 'Temperatura') {
            const stops = parseStops(`
                stop(-65, rgba(130, 22, 146, 1))
                stop(-55, rgba(130, 22, 146, 1))
                stop(-45, rgba(130, 22, 146, 1))
                stop(-40, rgba(130, 22, 146, 1))
                stop(-30, rgba(130, 87, 219, 1))
                stop(-20, rgba(32, 140, 236, 1))
                stop(-10, rgba(32, 196, 232, 1))
                stop(0, rgba(35, 221, 221, 1))
                stop(10, rgba(194, 255, 40, 1))
                stop(20, rgba(255, 240, 40, 1))
                stop(25, rgba(255, 194, 40,1))
                stop(30, rgba(252, 128, 20, 1))
            `);
            currentWeatherLegend = generateWeatherLegend('Temperatura (°C)', stops, '°C');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Pressão') {
            const stops = parseStops(`
                stop(940, rgba(0,115,255,1))
                stop(960, rgba(0,170,255,1))
                stop(980, rgba(75,208,214,1))
                stop(1000, rgba(141,231,199,1))
                stop(1010, rgba(176,247,32,1))
                stop(1020, rgba(240,184,0,1))
                stop(1040, rgba(251,85,21,1))
                stop(1060, rgba(243,54,59,1))
                stop(1080, rgba(198,0,0,1))
            `);
            currentWeatherLegend = generateWeatherLegend('Pressão Atmosférica (hPa)', stops, 'hPa');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Vento' || selectedLayerName === 'Vento (Velocidade & Direção)' || selectedLayerName === 'Velocidade Vento (10m)') {
            const stops = parseStops(`
                stop(1, rgba(255,255,255, 0))
                stop(5, rgba(238,206,206, 0.4))
                stop(15, rgba(179,100,188, 0.7))
                stop(25, rgba(63,33,59, 0.8))
                stop(50, rgba(116,76,172, 0.9))
                stop(100, rgba(70,0,175,1))
                stop(200, rgba(13,17,38,1))
            `);
            currentWeatherLegend = generateWeatherLegend('Vento (m/s)', stops, 'm/s');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Precipitação') { // Classic rain
            const stops = parseStops(`
                stop(0, rgba(225, 200, 100, 0))
                stop(0.1, rgba(200, 150, 150, 0))
                stop(0.2, rgba(150, 150, 170, 0))
                stop(0.5, rgba(120, 120, 190, 0))
                stop(1, rgba(110, 110, 205, 0.3))
                stop(10, rgba(80,80, 225, 0.7))
                stop(140, rgba(20, 20, 255, 0.9))
            `);
            currentWeatherLegend = generateWeatherLegend('Chuva Clássica (mm)', stops, 'mm');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Nuvens' || selectedLayerName === 'Nebulosidade') { // Classic clouds
            const stops = parseStops(`
                stop(0, rgba(255, 255, 255, 0.0))
                stop(10, rgba(253, 253, 255, 0.1))
                stop(20, rgba(252, 251, 255, 0.2))
                stop(30, rgba(250, 250, 255, 0.3))
                stop(40, rgba(249, 248, 255, 0.4))
                stop(50, rgba(247, 247, 255, 0.5))
                stop(60, rgba(246, 245, 255, 0.75))
                stop(70, rgba(244, 244, 255, 1))
                stop(80, rgba(243, 242, 255, 1))
                stop(90, rgba(242, 241, 255, 1))
                stop(100, rgba(240, 240, 255, 1))
            `);
            currentWeatherLegend = generateWeatherLegend('Nuvens Clássicas (0-100%)', stops, '%');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Neve' || selectedLayerName === 'Profundidade Neve' || selectedLayerName === 'Precipitação Acumulada - Neve') { // Snow
            const stops = parseStops(`
                stop(0, transparent)
                stop(5, #00d8ff)
                stop(10, #00b6ff)
                stop(25.076, #9549ff)
            `);
            currentWeatherLegend = generateWeatherLegend('Neve (mm)', stops, 'mm');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Precipitação Convectiva') { // PAC0
            const stops = parseStops(`
                stop(0, rgba(225, 200, 100, 0))
                stop(2, #b3e0ff)
                stop(5, #66b3ff)
                stop(10, #005ce6)
            `);
            currentWeatherLegend = generateWeatherLegend('Precipitação Convectiva (mm)', stops, 'mm');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Intensidade Precipitação') { // PR0
            const stops = parseStops(`
                stop(0, rgba(225, 200, 100, 0))
                stop(0.02, #b3e0ff)
                stop(0.05, #66b3ff)
                stop(0.1, #005ce6)
            `);
            currentWeatherLegend = generateWeatherLegend('Intensidade Precipitação (mm/s)', stops, 'mm/s');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Precipitação Acumulada' || selectedLayerName === 'Precipitação Acumulada - Chuva') { // PA0, PAR0
            const stops = parseStops(`
                stop(0, rgba(225, 200, 100, 0))
                stop(10, #b3e0ff)
                stop(25, #66b3ff)
                stop(50, #005ce6)
            `);
            currentWeatherLegend = generateWeatherLegend('Precipitação Acumulada (mm)', stops, 'mm');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Temperatura do Ar (2m)') { // TA2
            const stops = parseStops(`
                stop(-65, rgba(130, 22, 146, 1))
                stop(-55, rgba(130, 22, 146, 1))
                stop(-45, rgba(130, 22, 146, 1))
                stop(-40, rgba(130, 22, 146, 1))
                stop(-30, rgba(130, 87, 219, 1))
                stop(-20, rgba(32, 140, 236, 1))
                stop(-10, rgba(32, 196, 232, 1))
                stop(0, rgba(35, 221, 221, 1))
                stop(10, rgba(194, 255, 40, 1))
                stop(20, rgba(255, 240, 40, 1))
                stop(25, rgba(255, 194, 40,1))
                stop(30, rgba(252, 128, 20, 1))
            `);
            currentWeatherLegend = generateWeatherLegend('Temperatura do Ar (2m) (°C)', stops, '°C');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Temperatura do Ponto de Orvalho') { // TD2
            const stops = parseStops(`
                stop(-20, #4a75b3)
                stop(0, #8ecae6)
                stop(15, #f4e87c)
                stop(30, #ff8c42)
            `);
            currentWeatherLegend = generateWeatherLegend('Temperatura do Ponto de Orvalho (°C)', stops, '°C');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Temperatura do Solo (0-10cm)') { // TS0
            const stops = parseStops(`
                stop(273, #8f5d3d)
                stop(288, #d4a572)
                stop(303, #ffcc99)
            `);
            currentWeatherLegend = generateWeatherLegend('Temperatura do Solo (0-10cm) (K)', stops, 'K');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Temperatura do Solo (>10cm)') { // TS10
            const stops = parseStops(`
                stop(273, #8f5d3d)
                stop(288, #d4a572)
                stop(303, #ffcc99)
            `);
            currentWeatherLegend = generateWeatherLegend('Temperatura do Solo (>10cm) (K)', stops, 'K');
            currentWeatherLegend.addTo(map);
        } else if (selectedLayerName === 'Humidade Relativa') { // KHRD0
            const stops = parseStops(`
                stop(0, rgba(255,255,255, 0))
                stop(30, #e6f7ff)
                stop(70, #80ccff)
                stop(100, #0066cc)
            `);
            currentWeatherLegend = generateWeatherLegend('Humidade Relativa (%)', stops, '%');
            currentWeatherLegend.addTo(map);
        }
    }
}


function addWeatherLayers(map) {
    noneWeatherLayer = L.layerGroup();
    const OWM_APP_ID = '89ae8b33d0bde5d8a89a7f5550e87869';

    var cloudinessLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'CL',
        appId: OWM_APP_ID
    });
    var precipitationConvectiveLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'PAC0',
        appId: OWM_APP_ID
    });
    var precipitationIntensityLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'PR0',
        appId: OWM_APP_ID
    });
    var accumulatedPrecipitationLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'PA0',
        appId: OWM_APP_ID
    });
    var accumulatedPrecipitationRainLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'PAR0',
        appId: OWM_APP_ID
    });
    var accumulatedPrecipitationSnowLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'PAS0',
        appId: OWM_APP_ID
    });
    var snowDepthLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'SD0',
        appId: OWM_APP_ID
    });
    var windSpeed10mLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'WS10',
        appId: OWM_APP_ID
    });
    var jointWindLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'WND',
        appId: OWM_APP_ID
    });
    var atmosphericPressureLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'APM',
        appId: OWM_APP_ID
    });
    var airTemperature2mLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'TA2',
        appId: OWM_APP_ID
    });
    var dewPointTemperatureLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'TD2',
        appId: OWM_APP_ID
    });
    var soilTemperature0_10cmLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'TS0',
        appId: OWM_APP_ID
    });
    var soilTemperatureGt10cmLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'TS10',
        appId: OWM_APP_ID
    });
    var relativeHumidityLayer = L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        layer: 'HRD0',
        appId: OWM_APP_ID
    });

    var baseLayers = {
        'Nenhum ': noneWeatherLayer,
        'Temperatura do Ar (2m)': airTemperature2mLayer,
        'Temperatura do Ponto de Orvalho': dewPointTemperatureLayer,
        'Temperatura do Solo (0-10cm)': soilTemperature0_10cmLayer,
        'Temperatura do Solo (>10cm)': soilTemperatureGt10cmLayer,
        'Pressão Atmosférica': atmosphericPressureLayer,
        'Vento (Velocidade & Direção)': jointWindLayer, // WND
        'Velocidade Vento (10m)': windSpeed10mLayer, // WS10
        'Humidade Relativa': relativeHumidityLayer, // KHRD0
        'Nebulosidade': cloudinessLayer, // CL
        'Precipitação Convectiva': precipitationConvectiveLayer, // PAC0
        'Intensidade Precipitação': precipitationIntensityLayer, // PR0
        'Precipitação Acumulada': accumulatedPrecipitationLayer, // PA0
        'Precipitação Acumulada - Chuva': accumulatedPrecipitationRainLayer, // PAR0
        'Precipitação Acumulada - Neve': accumulatedPrecipitationSnowLayer, // PAS0
        'Profundidade Neve': snowDepthLayer // SD0
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
    addWeatherLayers(map);
    console.log('Weather Layers initiated.');
};