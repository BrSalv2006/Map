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
let loader = document.getElementById('loader');
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

    map.on('click', function() {
        $('.sidebar').removeClass('active');
        // Reset map width to 100% when sidebar is hidden
        $('#map').css('width', '100%');
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
    return { hotspots, areas };
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
        const { hotspots, areas } = createSatelliteLayers(data.modis);
        const modisCombinedLayer = L.layerGroup([hotspots, areas]);
        satelliteLayerControl.addOverlay(modisCombinedLayer, 'MODIS');
        currentOverlays.modis = modisCombinedLayer;
    }

    if (data.viirs) {
        const { hotspots, areas } = createSatelliteLayers(data.viirs);
        const viirsCombinedLayer = L.layerGroup([hotspots, areas]);
        satelliteLayerControl.addOverlay(viirsCombinedLayer, 'VIIRS');
        currentOverlays.viirs = viirsCombinedLayer;
    }

    satelliteDataProcessed = true;
    addOrRemoveControl(satelliteLayerControl, 'satelliteData');
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

    baseLayerControl = L.control.layers(baseLayers, null, {
        collapsed: true,
        position: 'topright',
    }).addTo(map);
};

function addWeatherLayers() {
    noneWeatherLayer = L.layerGroup();
    const appId = '89ae8b33d0bde5d8a89a7f5550e87869';

    const createWeatherTileLayer = (layerName) => L.tileLayer('http://maps.openweathermap.org/maps/2.0/weather/{layer}/{z}/{x}/{y}?appid={appId}', {
        minZoom: 2,
        layer: layerName,
        appId: appId,
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
    var importanceSize;

    if (statusCode == 11 || statusCode == 12) {
        return 0.6;
    }
    if (importance > fireImportanceData.average) {
        var topPercentage = importance / fireImportanceData.topImportance;
        topPercentage *= 2.3;
        topPercentage += 0.5;

        var avgPercentage = fireImportanceData.average / importance;

        importanceSize = topPercentage - avgPercentage;

        if (importanceSize > 1.75) {
            importanceSize = 1.75;
        }

        if (importanceSize < 1) {
            importanceSize = 1;
        }
    }

    if (importance < fireImportanceData.average) {
        var avgPercentage = importance / fireImportanceData.average * 0.8;
        if (avgPercentage < 0.5) {
            importanceSize = 0.5;
        } else {
            importanceSize = avgPercentage;
        }
    }
    return importanceSize;
}

function changeElementSizeById(id, size) {
    var markerHtml = document.getElementById(id);
    markerHtml.style.height = size + 'px';
    markerHtml.style.width = size + 'px';
}

function addFireMarker(fire, map, fireImportanceData) {
    const lat = fire.lat;
    const lng = fire.lng;
    const status = fire.status;
    const fireId = fire.id;

    if (lat && lng && status) {
        const marker = L.marker([lat, lng]);

        let layerIndex = getLayerIndexByStatus(status);

        marker.properties = {};
        marker.properties.fire = fire;

        isActive = window.location.pathname.split('/')[2];

        iconHtml = '<i class="dot status-';
        if (fire.important && [7, 8, 9].includes(fire.statusCode)) {
            iconHtml += '99-r';
        } else if (fire.important) {
            iconHtml += '99';
        } else {
            iconHtml += fire.statusCode;
        }

        if (isActive && isActive === fire.id) {
            iconHtml += ' active';
            map.setView(coords, 10);
        }

        iconHtml += '" id=' + fire.id + '></i>';
        var sizeFactor = getPonderatedImportanceFactor(fire.importance, fire.statusCode, fireImportanceData);
        marker.sizeFactor = sizeFactor;
        var size = sizeFactor * baseSize;

        marker.setIcon(L.divIcon({
            className: 'count-icon-emergency',
            html: iconHtml,
            iconSize: [size, size],
            forceZIndex: fire.importance
        }));


        marker.id = fireId;

        //if (isActive && isActive === fire.id) {
        //    changeElementSizeById(fire.id, 48 + sizeFactor);
        //} else {
        //    changeElementSizeById(fire.id, size);
        //}

        marker.on('click', function (e) {
            var activeIcon = e.target._icon.children[0];
            var previouslyActiveIcon = document.querySelector('.active');

            if (previouslyActiveIcon) {
                changeElementSizeById(previouslyActiveIcon.id, (parseFloat(previouslyActiveIcon.style.height) - 48) * baseSize);
                previouslyActiveIcon.classList.remove('active');
            }

            changeElementSizeById(marker.id, 48 + marker.sizeFactor);
            activeIcon.classList.add('active');
            map.setView(e.latlng, 10);

            var momentDate = new Date(fire.updated.sec * 1000).toLocaleString();
            
            var location = '<a href="https://www.google.com/maps/search/' + lat + ',' + lng + '" target="_blank"><i class="far fa-map"></i> ' + lat + ',' + lng + '</a>';

            var locationText = fire.location;
            if (fire.localidade) {
                locationText += ' - ' + fire.localidade;
            }

            $('.sidebar').addClass('active').scrollTop(0);
            if (window.innerWidth >= 992) {
                $('#map').css('width', $('.sidebar.active').css('flex-basis') === '25%' ? '75%' : '75%');
            }

            locationText += ' <a href="/?fogo=' + fire.id + '/detalhe">Mais detalhes</a>';
            $('.sidebar').addClass('active').scrollTop(0);
            $('.f-local').html(locationText);
            $('.f-man').text(fire.man);
            $('.f-aerial').text(fire.aerial);
            $('.f-terrain').text(fire.terrain);
            $('.f-location').html(location);
            $('.f-nature').text(fire.natureza);
            $('.f-update').text(momentDate);
            $('.f-start').text(fire.date + ' ' + fire.hour);
            $('.click-notification').data('id', fire.id);

            //if (notificationsAuth) {
            //    $('.notification-container').css({
            //        'display': 'inline-block'
            //    });
            //    let notifyFire = store.get('fire-' + fire.id);
            //    if (notifyFire) {
            //        $('.notification-container').find('i').removeClass('far').addClass('fas');
            //    } else {
            //        $('.notification-container').find('i').removeClass('fas').addClass('far');
            //    }
            //}


            window.history.pushState('obj', 'newtitle', '?fogo=' + fire.id);
            //status(fire.id)
            //plot(fire.id);
            danger(fire.id);
            meteo(fire.id);
            extra(fire.id);
            addPageview();
        });
        marker.addTo(fogosLayers[layerIndex]);
    }
}

let detailsChart;

function plot(id) {
    var url = 'https://api-dev.fogos.pt/fires/data?id=' + id;
    $.ajax({
        url: url,
        method: 'GET',
        success: function (data) {
            if (data.success && data.data.length) {
                labels = [];
                var man = [];
                var terrain = [];
                var aerial = [];
                for (d in data.data) {
                    labels.push(data.data[d].label);
                    man.push(data.data[d].man);
                    terrain.push(data.data[d].terrain);
                    aerial.push(data.data[d].aerial);
                }

                var ctx = document.getElementById('myChart');

                if (detailsChart)
                    detailsChart.destroy();

                detailsChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Operacionais',
                            data: man,
                            fill: false,
                            backgroundColor: '#EFC800',
                            borderColor: '#EFC800'
                        },
                        {
                            label: 'Terrestres',
                            data: terrain,
                            fill: false,
                            backgroundColor: '#6D720B',
                            borderColor: '#6D720B'
                        }, {
                            label: 'Aéreos',
                            data: aerial,
                            fill: false,
                            backgroundColor: '#4E88B2',
                            borderColor: '#4E88B2'
                        }
                        ]
                    },
                    options: {
                        elements: {
                            line: {
                                tension: 0 // disables bezier curves
                            }
                        },
                        scales: {
                            yAxes: [{
                                ticks: {}
                            }]
                        }
                    }
                });
            } else {
                $('#info').find('canvas').remove();
                $('#info').append('<p>Não há dados disponiveis</p> ');
            }
        }
    });

}

function status(id) {
    $('#status').empty();
    var url = 'https://fogos.pt/views/status/' + id;
    $.ajax({
        url: url,
        method: 'GET',
        success: function (data) {
            $('.f-status').html(data);
        }
    });
}

function danger(id) {
    var url = 'https://fogos.pt/views/risk/' + id;
    $.ajax({
        url: url,
        method: 'GET',
        success: function (data) {
            $('.f-danger').html(data);
        }
    });

}

function meteo(id) {
    var url = 'https://fogos.pt/views/meteo/' + id;
    $.ajax({
        url: url,
        method: 'GET',
        success: function (data) {
            $('.f-meteo').html(data);
        }
    });

}

function extra(id) {
    var url = 'https://fogos.pt/views/extra/' + id;
    $.ajax({
        url: url,
        method: 'GET',
        success: function (data) {
            if (data && data.length !== 0) {
                $('.f-extra').html(data);
                $('.extra').addClass('active');
            } else {
                $('.extra').removeClass('active');
            }

        }
    });

}

function addPageview() {
    if (window.ga) {
        if ('ga' in window) {
            var tracker = window.ga.getAll()[0];
            if (tracker)
                tracker.send('pageview');
        }
    }
}

function extend() {
    for (var o = {}, i = 0; i < arguments.length; i++) {
        for (var k in arguments[i]) {
            if (arguments[i].hasOwnProperty(k)) {
                o[k] = arguments[i][k].constructor === Object ? extend(o[k] || {}, arguments[i][k]) : arguments[i][k];
            }
        }
    }
    return o;
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
        }
        else if (type === 'satelliteResult') {
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
            riskLayerControl = L.control.layers(riskBaseLayers, null, { collapsed: true, position: 'topright' });
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
                'Despacho': fogosLayers[3],
                'Despacho de 1º Alerta': fogosLayers[4],
                'Chegada ao TO': fogosLayers[6],
                'Em Curso': fogosLayers[5],
                'Em Resolução': fogosLayers[7],
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
    let baseLayerControls = baseLayerControl.getContainer().children[0].style;
    baseLayerControls.backgroundImage = "url('img/map.png')";
    baseLayerControls.backgroundSize = "28px";

    let satelliteLayerControls = satelliteLayerControl.getContainer().children[0].style;
    satelliteLayerControls.backgroundImage = "url('img/satellite.png')";
    satelliteLayerControls.backgroundSize = "28px";

    let weatherLayerControls = weatherLayerControl.getContainer().children[0].style;
    weatherLayerControls.backgroundImage = "url('img/weather.png')";
    weatherLayerControls.backgroundSize = "28px";

    let riskLayerControls = riskLayerControl.getContainer().children[0].style;
    riskLayerControls.backgroundImage = "url('img/fire_risk.png')";
    riskLayerControls.backgroundSize = "28px";

    let fireLayerControls = fireLayerControl.getContainer().children[0].style;
    fireLayerControls.backgroundImage = "url('img/fire.png')";
    fireLayerControls.backgroundSize = "28px";
}

function setupControls() {
    setupWorker();
    currentWorker.postMessage({
        type: 'initData',
        url: window.location.origin
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
    var res = window.location.pathname.match(/^\/?fogo=\/(\d+)/);
    if (res && res.length === 2) {
        plot(res[1]);
    }

    initializeMap();
    addBaseTileLayers();
    addWeatherLayers(map);
    await loadWeatherLegendsData();
    setupControls();
};