((window, document) => {
    let map;
    let baseLayerControl;
    let fireLayerControl;
    let satelliteLayerControl;
    let riskLayerControl;
    let weatherLayerControl;
    let currentWorker = null;
    let currentOverlays = {};
    let currentRiskLegend = null;
    let currentWeatherLegend = null;
    let weatherLegendsData = {};
    const loader = document.getElementById('loader');
    let satelliteDataProcessed = false;
    let riskDataProcessed = false;
    let noneRiskLayer;
    let noneWeatherLayer;
    let fogosLayers = [];

    const baseSize = 22;

    function initializeMap() {
        map = L.map('map', {
            center: [39.557191, -7.8536599],
            zoom: 7
        });

        map.createPane('weatherPane');
        map.getPane('weatherPane').style.zIndex = 300;

        L.control.locate({
            flyTo: true,
            locateOptions: {
                enableHighAccuracy: true
            }
        }).addTo(map);

        baseLayerControl = L.control.layers(null, null, {
            collapsed: true,
            position: 'topright',
        });

        fireLayerControl = L.control.layers(null, null, {
            collapsed: true,
            position: 'topright'
        });

        satelliteLayerControl = L.control.layers(null, null, {
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

        map.on('click', () => {
            const previouslyActiveIcon = document.querySelector('.dot-active');
            if (previouslyActiveIcon) {
                changeElementSizeById(previouslyActiveIcon.id, baseSize);
                previouslyActiveIcon.classList.remove('dot-active');
            }
            map.setView([39.557191, -7.8536599], 7);

            document.getElementById('map').style.width = '100%';
            document.querySelector('.sidebar').classList.remove('active');
            window.history.pushState('fogo', '', window.location.href.split('?')[0]);
        });
    }

    function resetOverlays() {
        for (const key in currentOverlays) {
            if (map.hasLayer(currentOverlays[key])) {
                map.removeLayer(currentOverlays[key]);
            }
            satelliteLayerControl.removeLayer(currentOverlays[key]);
        }
        currentOverlays = {};
    }

    function createSatelliteLayers(satelliteData) {
        const hotspots = L.markerClusterGroup({
            maxClusterRadius: 40
        });
        const areas = L.featureGroup();

        for (const continent in satelliteData) {
            for (const country in satelliteData[continent]) {
                const countryData = satelliteData[continent][country];
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
        return {
            hotspots,
            areas
        };
    }

    function addOrRemoveControl(control, type) {
        if ((type === 'satelliteData' && satelliteDataProcessed) || (type === 'riskData' && riskDataProcessed)) {
            if (!control._map) {
                control.addTo(map);
            }
        } else {
            if (control._map) {
                map.removeControl(control);
            }
        }
        if (satelliteDataProcessed && riskDataProcessed) {
            loader.style.display = 'none';
            editBackgroundImages();
        }
    }

    function addSatelliteLayers(data) {
        loader.innerText = 'Generating satellite layers...';
        resetOverlays();

        if (data.modis) {
            const {
                hotspots,
                areas
            } = createSatelliteLayers(data.modis);
            const modisCombinedLayer = L.layerGroup([hotspots, areas]);
            satelliteLayerControl.addOverlay(modisCombinedLayer, 'MODIS');
            currentOverlays.modis = modisCombinedLayer;
        }

        if (data.viirs) {
            const {
                hotspots,
                areas
            } = createSatelliteLayers(data.viirs);
            const viirsCombinedLayer = L.layerGroup([hotspots, areas]);
            satelliteLayerControl.addOverlay(viirsCombinedLayer, 'VIIRS');
            currentOverlays.viirs = viirsCombinedLayer;
        }

        satelliteDataProcessed = true;
        addOrRemoveControl(satelliteLayerControl, 'satelliteData');
    }

    function addRiskLegend(mapInstance) {
        if (currentRiskLegend) {
            mapInstance.removeControl(currentRiskLegend);
        }

        const legend = L.control({
            position: 'bottomright'
        });
        legend.onAdd = function () {
            const div = L.DomUtil.create('div', 'info legend');
            const grades = [1, 2, 3, 4, 5];
            const labels = ['Reduzido', 'Moderado', 'Elevado', 'Muito Elevado', 'Máximo'];
            const colors = ['#509e2f', '#ffe900', '#e87722', '#cb333b', '#6f263d'];
            div.innerHTML += '<h4>Risco de Incêndio</h4>';
            for (let i = 0; i < grades.length; i++) {
                div.innerHTML +=
                    `<i style="background:${colors[i]}" class="${labels[i]}"></i> ${labels[i]}<br>`;
            }
            return div;
        };
        legend.addTo(mapInstance);
        currentRiskLegend = legend;
    }

    function generateWeatherLegend(title, stops, unit) {
        const legend = L.control({
            position: 'bottomright'
        });
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

    function addBaseTileLayers() {
        const createBaseTileLayer = (layerName) => L.tileLayer('https://api.maptiler.com/maps/{layer}/256/{z}/{x}/{y}@2x.png?key={key}', {
            minZoom: 2,
            maxZoom: 22,
            layer: layerName,
            key: 'M5oddZtB9rr0EdbaCglK',
        });

        const baseLayers = {
            'Street': createBaseTileLayer('streets-v2').addTo(map),
            'Street Dark': createBaseTileLayer('streets-v2-dark'),
            'Street Light': createBaseTileLayer('streets-v2-light'),
            'Street Pastel': createBaseTileLayer('streets-v2-pastel'),
            'Hybrid': createBaseTileLayer('hybrid'),
            "Satellite": L.tileLayer('https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.png?key=M5oddZtB9rr0EdbaCglK', {
                minZoom: 2,
                maxZoom: 22,
            }),
            'Basic': createBaseTileLayer('basic-v2'),
            'Basic Dark': createBaseTileLayer('basic-v2-dark'),
            'Basic Light': createBaseTileLayer('basic-v2-light'),
            'Outdoor': createBaseTileLayer('outdoor-v2'),
            'Outdoor Dark': createBaseTileLayer('outdoor-v2-dark'),
            'Topo': createBaseTileLayer('topo-v2'),
            "Real-Time": L.esri.tiledMapLayer({
                url: "https://gis.nnvl.noaa.gov/arcgis/rest/services/TRUE/TRUE_current/ImageServer",
                minZoom: 2,
                maxZoom: 8
            })
        };

        baseLayerControl.addBaseLayer(baseLayers['Street'], 'Street');
        baseLayerControl.addBaseLayer(baseLayers['Street Dark'], 'Street Dark');
        baseLayerControl.addBaseLayer(baseLayers['Street Light'], 'Street Light');
        baseLayerControl.addBaseLayer(baseLayers['Street Pastel'], 'Street Pastel');
        baseLayerControl.addBaseLayer(baseLayers['Hybrid'], 'Hybrid');
        baseLayerControl.addBaseLayer(baseLayers['Satellite'], 'Satellite');
        baseLayerControl.addBaseLayer(baseLayers['Basic'], 'Basic');
        baseLayerControl.addBaseLayer(baseLayers['Basic Dark'], 'Basic Dark');
        baseLayerControl.addBaseLayer(baseLayers['Basic Light'], 'Basic Light');
        baseLayerControl.addBaseLayer(baseLayers['Outdoor'], 'Outdoor');
        baseLayerControl.addBaseLayer(baseLayers['Outdoor Dark'], 'Outdoor Dark');
        baseLayerControl.addBaseLayer(baseLayers['Topo'], 'Topo');
        baseLayerControl.addBaseLayer(baseLayers['Real-Time'], 'Real-Time');
        baseLayerControl.addTo(map);
    }

    function addWeatherLayers() {
        noneWeatherLayer = L.layerGroup();
        const appId = '89ae8b33d0bde5d8a89a7f5550e87869';

        const createWeatherTileLayer = (layerName) => L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
            minZoom: 2,
            layer: layerName,
            appId: appId,
            pane: 'weatherPane'
        });

        const weatherBaseLayers = {
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

        for (const layerName in weatherBaseLayers) {
            weatherLayerControl.addBaseLayer(weatherBaseLayers[layerName], layerName);
        }
        weatherLayerControl.addTo(map);
    }

    function getLayerIndexByStatus(status) {
        switch (status) {
            case 'Despacho':
                return 3;
            case 'Despacho de 1º Alerta':
                return 4;
            case 'Em Curso':
                return 5;
            case 'Chegada ao TO':
                return 6;
            case 'Em Resolução':
                return 7;
            case 'Conclusão':
                return 8;
            case 'Vigilância':
                return 9;
            case 'Encerrada':
                return 10;
            case 'Falso Alarme':
                return 11;
            case 'Falso Alerta':
                return 12;
            default:
                return 81;
        }
    }

    function getPonderatedImportanceFactor(importance, statusCode, fireImportanceData) {
        if (statusCode == 11 || statusCode == 12) {
            return 0.6;
        }
        let importanceSize;
        if (importance > fireImportanceData.average) {
            let topPercentage = (importance / fireImportanceData.topImportance) * 2.3 + 0.5;
            let avgPercentage = fireImportanceData.average / importance;
            importanceSize = topPercentage - avgPercentage;
            if (importanceSize > 1.75) importanceSize = 1.75;
            if (importanceSize < 1) importanceSize = 1;
        } else if (importance < fireImportanceData.average) {
            importanceSize = (importance / fireImportanceData.average) * 0.8;
            if (importanceSize < 0.5) importanceSize = 0.5;
        } else {
            importanceSize = 1;
        }
        return importanceSize;
    }

    function changeElementSizeById(id, size) {
        const markerHtml = document.getElementById(id);
        if (markerHtml) {
            markerHtml.style.height = `${size}px`;
            markerHtml.style.width = `${size}px`;
        }
    }

    function addFireMarker(fire, mapInstance, fireImportanceData) {
        const {
            lat,
            lng,
            status,
            id: fireId
        } = fire;

        if (lat && lng && status) {
            const marker = L.marker([lat, lng]);
            const layerIndex = getLayerIndexByStatus(status);
            const isActive = window.location.href.match(/\?fogo\=(\d+)/);

            marker.properties = {
                fire
            };

            let iconHtml = `<i class="dot status-`;
            if (fire.important && [7, 8, 9].includes(fire.statusCode)) {
                iconHtml += '99-r';
            } else if (fire.important) {
                iconHtml += '99';
            } else {
                iconHtml += fire.statusCode;
            }

            if (isActive && isActive[1] == fireId) {
                iconHtml += ' dot-active';
                mapInstance.setView([lat, lng], 10);
            }

            iconHtml += `" id="${fireId}"></i>`;
            const sizeFactor = getPonderatedImportanceFactor(fire.importance, fire.statusCode, fireImportanceData);
            marker.sizeFactor = sizeFactor;
            const size = sizeFactor * baseSize;

            marker.setIcon(L.divIcon({
                className: 'count-icon-emergency',
                html: iconHtml,
                iconSize: [size, size],
                forceZIndex: fire.importance
            }));

            marker.id = fireId;

            marker.on('click', (e) => {
                const activeIcon = e.target._icon.children[0];
                const previouslyActiveIcon = document.querySelector('.dot-active');

                if (previouslyActiveIcon) {
                    changeElementSizeById(previouslyActiveIcon.id, baseSize);
                    previouslyActiveIcon.classList.remove('dot-active');
                }

                changeElementSizeById(marker.id, 48 + marker.sizeFactor);
                activeIcon.classList.add('dot-active');
                mapInstance.setView(e.latlng, 10);

                const momentDate = new Date(fire.updated.sec * 1000).toLocaleString();

                const locationLink = `<a href="https://www.google.com/maps/search/${lat},${lng}" target="_blank"><i class="far fa-map"></i> ${lat},${lng}</a>`;

                let locationText = fire.location;
                if (fire.localidade) {
                    locationText += ` - ${fire.localidade}`;
                }

                const sidebar = document.querySelector('.sidebar');
                sidebar.classList.add('active');
                sidebar.scrollTop = 0;

                if (window.innerWidth >= 992) {
                    document.getElementById('map').style.width = '75%';
                }

                document.querySelector('.f-local').innerHTML = locationText;
                document.querySelector('.f-man').textContent = fire.man;
                document.querySelector('.f-aerial').textContent = fire.aerial;
                document.querySelector('.f-terrain').textContent = fire.terrain;
                document.querySelector('.f-location').innerHTML = locationLink;
                document.querySelector('.f-nature').textContent = fire.natureza;
                document.querySelector('.f-update').textContent = momentDate;
                document.querySelector('.f-start').textContent = `${fire.date} ${fire.hour}`;

                window.history.pushState('fogo', '', `?fogo=${fireId}`);
                fireStatus(fireId);
                plot(fireId);
                danger(fireId);
                meteo(fireId);
                extra(fireId);
            });
            fogosLayers[layerIndex].addLayer(marker);
        }
    }

    let detailsChart;

    async function plot(id) {
        const url = `https://api-dev.fogos.pt/fires/data?id=${id}`;
        try {
            const response = await fetch(url);
            const data = await response.json();

            const canvas = document.getElementById('myChart');
            if (!canvas) {
                console.error('Canvas element #myChart not found.');
                return;
            }
            const ctx = canvas.getContext('2d');

            if (data.success && data.data && data.data.length) {
                const labels = data.data.map(d => d.label);
                const man = data.data.map(d => d.man);
                const terrain = data.data.map(d => d.terrain);
                const aerial = data.data.map(d => d.aerial);

                if (detailsChart) {
                    detailsChart.destroy();
                }

                detailsChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Operacionais',
                            data: man,
                            fill: false,
                            backgroundColor: '#EFC800',
                            borderColor: '#EFC800',
                        },
                        {
                            label: 'Terrestres',
                            data: terrain,
                            fill: false,
                            backgroundColor: '#6D720B',
                            borderColor: '#6D720B',
                        }, {
                            label: 'Aéreos',
                            data: aerial,
                            fill: false,
                            backgroundColor: '#4E88B2',
                            borderColor: '#4E88B2',
                        }
                        ]
                    }
                });
                canvas.style.display = 'block';
            } else {
                if (detailsChart) {
                    detailsChart.destroy();
                    detailsChart = null;
                }
                canvas.style.display = 'none';
            }
        } catch (error) {
            console.error('Error fetching fire data for plot:', error);
            const canvas = document.getElementById('myChart');
            if (detailsChart) {
                detailsChart.destroy();
                detailsChart = null;
            }
            if (canvas) {
                canvas.style.display = 'none';
            }
        }
    }

    async function fireStatus(id) {
        try {
            const response = await fetch(`https://fogos.pt/views/status/${id}`);
            document.querySelector('.f-status').innerHTML = await response.text();
        } catch (error) {
            console.error('Error fetching fire status:', error);
        }
    }

    async function danger(id) {
        try {
            const response = await fetch(`https://fogos.pt/views/risk/${id}`);
            document.querySelector('.f-danger').innerHTML = await response.text();
        } catch (error) {
            console.error('Error fetching danger info:', error);
        }
    }

    async function meteo(id) {
        try {
            const response = await fetch(`https://fogos.pt/views/meteo/${id}`);
            document.querySelector('.f-meteo').innerHTML = await response.text();
        } catch (error) {
            console.error('Error fetching meteo info:', error);
        }
    }

    async function extra(id) {
        try {
            const response = await fetch(`https://fogos.pt/views/extra/${id}`);
            const data = await response.text();
            const fExtra = document.querySelector('.f-extra');
            const extraRow = document.querySelector('.row.extra');
            if (data && data.trim().length !== 0) {
                fExtra.innerHTML = data;
                extraRow.classList.add('active');
            } else {
                fExtra.innerHTML = '';
                extraRow.classList.remove('active');
            }
        } catch (error) {
            console.error('Error fetching extra info:', error);
        }
    }

    function setupWorker() {
        if (currentWorker) {
            return;
        }

        loader.style.display = 'block';
        loader.innerText = 'Initializing data processing...';
        currentWorker = new Worker('js/worker.js');

        currentWorker.onmessage = (e) => {
            const {
                type,
                message,
                data,
                fireImportanceData
            } = e.data;
            if (type === 'progress') {
                loader.innerText = message;
            } else if (type === 'initDataComplete') {
                loader.innerText = 'Geographical data loaded. Fetching fire and risk data...';
                currentWorker.postMessage({
                    type: 'satelliteData',
                    dayRange: 1
                });
                currentWorker.postMessage({
                    type: 'riskData'
                });
                currentWorker.postMessage({
                    type: 'firesData'
                });
            } else if (type === 'satelliteResult') {
                addSatelliteLayers(data);
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
                riskLayerControl = L.control.layers(riskBaseLayers, null, {
                    collapsed: true,
                    position: 'topright'
                });
                noneRiskLayer.addTo(map);
                riskDataProcessed = true;
                addOrRemoveControl(riskLayerControl, 'riskData');
            } else if (type === 'firesResult') {
                loader.innerText = 'Adding new fires data...';

                const allExpectedLayerIndices = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 80];

                allExpectedLayerIndices.forEach(index => {
                    if (!fogosLayers[index]) {
                        fogosLayers[index] = L.layerGroup();
                    }
                });

                for (const fire of data) {
                    addFireMarker(fire, map, fireImportanceData);
                }

                const fireLayers = {
                    'Despacho': fogosLayers[3].addTo(map),
                    'Despacho de 1º Alerta': fogosLayers[4].addTo(map),
                    'Chegada ao TO': fogosLayers[6].addTo(map),
                    'Em Curso': fogosLayers[5].addTo(map),
                    'Em Resolução': fogosLayers[7].addTo(map),
                    'Conclusão': fogosLayers[8],
                    'Vigilância': fogosLayers[9],
                    'Encerrada': fogosLayers[10],
                    'Falso Alarme': fogosLayers[11],
                    'Falso Alerta': fogosLayers[12]
                };

                fireLayerControl = L.control.layers(null, fireLayers, {
                    collapsed: true,
                    position: 'topright'
                }).addTo(map);

                const res = window.location.href.match(/\?fogo\=(\d+)/);
                if (res && res[1]) {
                    const fireIdFromUrl = res[1];
                    // Defer click event to ensure markers are rendered
                    setTimeout(() => {
                        const fireElement = document.getElementById(fireIdFromUrl);
                        if (fireElement) {
                            fireElement.click();
                        }
                    }, 500);
                }

            } else if (type === 'error') {
                const errorMessage = document.createElement('div');
                errorMessage.className = 'error-message';
                errorMessage.textContent = message;
                document.body.appendChild(errorMessage);
                setTimeout(() => errorMessage.remove(), 5000);
                if (message.includes("fire data")) {
                    satelliteDataProcessed = true;
                } else if (message.includes("risk layers") || message.includes("Concelhos GeoJSON")) {
                    riskDataProcessed = true;
                }
                if (satelliteDataProcessed && riskDataProcessed) {
                    loader.style.display = 'none';
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
            satelliteDataProcessed = true;
            riskDataProcessed = true;
            loader.style.display = 'none';
            editBackgroundImages();
        };
    }

    function editBackgroundImages() {
        if (baseLayerControl && baseLayerControl.getContainer()) {
            baseLayerControl.getContainer().children[0].style.backgroundImage = "url('img/map.png')";
            baseLayerControl.getContainer().children[0].style.backgroundSize = "28px";
        }
        if (satelliteLayerControl && satelliteLayerControl.getContainer()) {
            satelliteLayerControl.getContainer().children[0].style.backgroundImage = "url('img/satellite.png')";
            satelliteLayerControl.getContainer().children[0].style.backgroundSize = "28px";
        }
        if (weatherLayerControl && weatherLayerControl.getContainer()) {
            weatherLayerControl.getContainer().children[0].style.backgroundImage = "url('img/weather.png')";
            weatherLayerControl.getContainer().children[0].style.backgroundSize = "28px";
        }
        if (riskLayerControl && riskLayerControl.getContainer()) {
            riskLayerControl.getContainer().children[0].style.backgroundImage = "url('img/fire_risk.png')";
            riskLayerControl.getContainer().children[0].style.backgroundSize = "28px";
        }
        if (fireLayerControl && fireLayerControl.getContainer()) {
            fireLayerControl.getContainer().children[0].style.backgroundImage = "url('img/fire.png')";
            fireLayerControl.getContainer().children[0].style.backgroundSize = "28px";
        }
    }

    function setupControls() {
        setupWorker();
        currentWorker.postMessage({
            type: 'initData',
            url: window.location.href.split('?')[0]
        });
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
        addBaseTileLayers();
        addWeatherLayers();
        await loadWeatherLegendsData();
        setupControls();
    };
})(window, document);