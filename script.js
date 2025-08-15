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
        flyTo: true,
        locateOptions: {
            enableHighAccuracy: true
        }
    }).addTo(map);
    treeControl = L.control.layers.tree(BASE_LAYERS, null, {
        collapsed: true
    });
    treeControl.addTo(map);
}

function resetOverlays() {
    if (currentOverlayTree && currentOverlayTree.children) {
        currentOverlayTree.children.forEach(continent => {
            if (continent.children) {
                continent.children.forEach(country => {
                    if (map.hasLayer(country.layer)) {
                        map.removeLayer(country.layer);
                    }
                });
            }
        });
    }
    currentOverlayTree = null;
}

function createLayersForCountry(countryData) {
    const hotspots = L.markerClusterGroup({
        maxClusterRadius: 40
    });
    const areas = L.featureGroup();

    countryData.points.forEach(point => {
        const marker = L.marker([point.geometry.coordinates[1], point.geometry.coordinates[0]]);
        const p = point.properties;
        const popupContent = `<b>Location:</b> ${p.location}<br><hr style="margin: 4px 0;"><b>Brightness:</b> ${p.brightness} K<br><b>Acquired:</b> ${p.acq_date} ${p.acq_time} UTC<br><b>Satellite:</b> ${p.satellite}<br><b>Confidence:</b> ${p.confidence}<br><b>Day/Night:</b> ${p.daynight}<br><b>FRP:</b> ${p.frp} MW`;
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
    return {
        hotspots,
        areas
    };
}

function populateMap(data) {
    const loader = document.getElementById('loader');
    loader.innerText = 'Generating map layers...';
    resetOverlays();

    const newOverlayTree = {
        label: 'Fires by Region',
        selectAllCheckbox: 'All Fires',
        children: [],
        collapsed: true
    };
    const allLeafLayers = [];

    for (const continent of Object.keys(data).sort()) {
        const countryLayersForTree = [];
        for (const country of Object.keys(data[continent]).sort()) {
            const countryData = data[continent][country];
            const {
                hotspots,
                areas
            } = createLayersForCountry(countryData);
            const combinedLayer = L.layerGroup([hotspots, areas]);

            countryLayersForTree.push({
                label: `${country} (${countryData.points.length})`,
                layer: combinedLayer
            });
            allLeafLayers.push(hotspots, areas);
        }
        newOverlayTree.children.push({
            label: continent,
            selectAllCheckbox: true,
            children: countryLayersForTree,
            collapsed: true
        });
    }

    treeControl.setOverlayTree(newOverlayTree);
    currentOverlayTree = newOverlayTree;

    if (allLeafLayers.length > 0) {
        const allFeatures = L.featureGroup(allLeafLayers);
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
    currentWorker = new Worker('worker.js');

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
    const countrySelector = document.getElementById('country-selector');
    const dayRangeSelector = document.getElementById('day-range-selector');
    const satelliteSelector = document.getElementById('satellite-selector');
    const loadBtn = document.getElementById('load-data-btn');
    const loader = document.getElementById('loader');

    dayRangeSelector.addEventListener('input', () => {
        if (parseInt(dayRangeSelector.value) > 10) dayRangeSelector.value = 10;
    });
    dayRangeSelector.addEventListener('blur', () => {
        if (dayRangeSelector.value === '' || parseInt(dayRangeSelector.value) < 1) dayRangeSelector.value = 1;
    });

    try {
        loader.style.display = 'block';
        loader.innerText = 'Loading initial data...';
        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const shapefilePath = `${baseUrl}/ne_110m_admin_0_countries`;
        allCountriesGeoJSON = await shp(shapefilePath);

        const countries = allCountriesGeoJSON.features
            .map(f => f.properties.ADMIN)
            .filter(name => name && name !== "-99")
            .sort((a, b) => a.localeCompare(b));

        countries.forEach(country => {
            const option = document.createElement('option');
            option.value = country;
            option.textContent = country;
            countrySelector.appendChild(option);
        });

        loader.style.display = 'none';
    } catch (error) {
        console.error("Failed to load initial data:", error);
        loader.innerText = 'Could not load initial data.';
    }

    loadBtn.addEventListener('click', () => {
        const selectedCountryNames = Array.from(countrySelector.selectedOptions).map(opt => opt.value);
        if (selectedCountryNames.length === 0) {
            alert('Please select at least one country.');
            return;
        }
        startWorker({
            selectedCountryNames,
            dayRange: dayRangeSelector.value,
            selectedSatellite: satelliteSelector.value,
            allCountriesGeoJSON
        });
    });
}

window.onload = () => {
    initializeMap();
    setupControls();
};