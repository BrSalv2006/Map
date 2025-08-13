var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
});

var osmHOT = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team hosted by OpenStreetMap France'
});

var openTopoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)'
});


var map = L.map('map', {
    center: [0, 0],
    zoom: 2,
    layers: [osm],
});

L.control.locate({
    flyTo: true,
    locateOptions: {
        enableHighAccuracy: true
    }
}).addTo(map);

var baseTree = {
    label: 'Base Layers',
    children: [{
        label: 'OpenStreetMap',
        layer: osm
    }, {
        label: 'OpenStreetMap HOT',
        layer: osmHOT
    }, {
        label: 'OpenTopoMap',
        layer: openTopoMap
    }]
};

var overlaysTree;

var treeControl = L.control.layers.tree(baseTree, null, {
    collapsed: true,
});

treeControl.addTo(map);

let allCountriesGeoJSON;

function resetOverlays() {
    if (overlaysTree && overlaysTree.children) {
        overlaysTree.children.forEach(continent => {
            if (continent.children) {
                continent.children.forEach(country => {
                    map.removeLayer(country.layer);
                });
            }
        });
    }
    overlaysTree = {
        label: 'Fires by Region',
        selectAllCheckbox: 'All Fires',
        children: [],
        collapsed: true
    };
}

function populateMap(data) {
    document.getElementById('loader').style.display = 'none';
    resetOverlays();

    const allLeafLayers = [];

    for (const continent of Object.keys(data).sort()) {
        const countryLayersForTree = [];
        for (const country of Object.keys(data[continent]).sort()) {
            const countryData = data[continent][country];
            const combinedLayer = L.layerGroup([countryData.hotspots, countryData.areas]);
            countryLayersForTree.push({
                label: `${country} (${countryData.points.length})`,
                layer: combinedLayer
            });
            allLeafLayers.push(countryData.hotspots);
            allLeafLayers.push(countryData.areas);
        }
        overlaysTree.children.push({
            label: continent,
            selectAllCheckbox: true,
            children: countryLayersForTree,
            collapsed: true
        });
    }

    treeControl.setOverlayTree(overlaysTree);
    const allFeatures = L.featureGroup(allLeafLayers);
    if (allFeatures.getLayers().length > 0) {
        map.fitBounds(allFeatures.getBounds().pad(0.1));
    }
}

async function fetchAndProcessData(selectedCountryNames, dayRange, selectedSatellite) {
    const loader = document.getElementById('loader');
    loader.style.display = 'block';
    loader.innerText = `Fetching data for ${selectedCountryNames.length} countries...`;

    try {
        const selectedFeatures = allCountriesGeoJSON.features.filter(f => selectedCountryNames.includes(f.properties.ADMIN));
        const combinedBbox = turf.bbox(turf.featureCollection(selectedFeatures));

        const endDate = new Date().getTime();
        const startDate = endDate - (dayRange * 86400000);

        const geometryParam = {
            xmin: combinedBbox[0],
            ymin: combinedBbox[1],
            xmax: combinedBbox[2],
            ymax: combinedBbox[3],
            spatialReference: {
                "wkid": 4326
            }
        };

        const baseParams = {
            returnGeometry: true,
            time: `${startDate}, ${endDate}`,
            outSR: 4326,
            outFields: '*',
            inSR: 4326,
            geometry: JSON.stringify(geometryParam),
            geometryType: 'esriGeometryEnvelope',
            spatialRel: 'esriSpatialRelIntersects',
            f: 'geojson'
        };

        const apiEndpoints = {
            modis: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/MODIS_Thermal_v1/FeatureServer/0/query',
            viirs: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0/query'
        };

        const fetchPromises = [];

        if (selectedSatellite === 'modis' || selectedSatellite === 'both') {
            const modisParams = new URLSearchParams(baseParams);
            fetchPromises.push(fetch(`${apiEndpoints.modis}?${modisParams.toString()}`).then(res => res.json()));
        }
        if (selectedSatellite === 'viirs' || selectedSatellite === 'both') {
            const viirsParams = new URLSearchParams(baseParams);
            fetchPromises.push(fetch(`${apiEndpoints.viirs}?${viirsParams.toString()}`).then(res => res.json()));
        }
        
        const [citiesResponse, ...fireDataResponses] = await Promise.all([
            fetch('cities1000.txt'),
            ...fetchPromises
        ]);

        loader.innerText = 'Processing data...';

        let fireFeatures = [];
        fireDataResponses.forEach(response => {
            if (response.features) {
                fireFeatures = fireFeatures.concat(response.features);
            }
        });


        if (!fireFeatures || fireFeatures.length === 0) {
            alert("No recent fire data found for the selected country/countries and satellite(s).");
            loader.style.display = 'none';
            return;
        }

        const firePoints = fireFeatures.map(f => {
            const props = f.properties;

            const acq_date = props.ACQ_DATE || props.acq_date;
            const acq_time = props.ACQ_TIME || props.acq_time;
            const brightness = props.BRIGHTNESS || props.bright_ti4;
            const satellite = props.SATELLITE || props.satellite;
            const confidence = props.CONFIDENCE || props.confidence;
            const daynight = props.DAYNIGHT || props.daynight;
            const frp = props.FRP || props.frp;

            const date = new Date(acq_date);
            const time = String(acq_time || '0000').padStart(4, '0');

            const properties = {
                latitude: f.geometry.coordinates[1],
                longitude: f.geometry.coordinates[0],
                brightness: brightness,
                acq_date: date.toISOString().split('T')[0],
                acq_time: time,
                satellite: satellite,
                confidence: confidence,
                daynight: daynight,
                frp: frp,
            };
            return turf.point(f.geometry.coordinates, properties);
        });

        const citiesText = await citiesResponse.text();
        const cityCols = ['geonameid', 'name', 'asciiname', 'alternatenames', 'latitude', 'longitude', 'feature_class', 'feature_code', 'country_code', 'cc2', 'admin1_code', 'admin2_code', 'admin3_code', 'admin4_code', 'population', 'elevation', 'dem', 'timezone', 'modification_date'];
        const citiesData = Papa.parse(citiesText, {
            delimiter: '\t',
            header: false,
            skipEmptyLines: true,
            comments: false
        }).data.map(row => {
            const cityObj = {};
            cityCols.forEach((col, i) => cityObj[col] = row[i]);
            return cityObj;
        });

        const cityPoints = turf.featureCollection(citiesData.map(c => turf.point([c.longitude, c.latitude], {
            name: c.name
        })));

        const finalData = {};

        firePoints.forEach(firePoint => {
            let foundCountry = false;
            for (const country of allCountriesGeoJSON.features) {
                if (turf.booleanPointInPolygon(firePoint, country)) {
                    firePoint.properties.country = country.properties.ADMIN;
                    firePoint.properties.continent = country.properties.CONTINENT;
                    foundCountry = true;
                    break;
                }
            }

            if (!foundCountry) {
                firePoint.properties.country = 'In Ocean';
                firePoint.properties.continent = 'Ocean';
            }

            const nearestCity = turf.nearestPoint(firePoint, cityPoints);
            const distance = turf.distance(firePoint, nearestCity, {
                units: 'kilometers'
            });
            if (distance < 200) {
                firePoint.properties.city = nearestCity.properties.name;
            } else {
                firePoint.properties.city = 'Remote Area';
            }
            firePoint.properties.location = firePoint.properties.country !== 'In Ocean' ? `${firePoint.properties.city}, ${firePoint.properties.country}` : 'In Ocean';


            const continentName = firePoint.properties.continent;
            const countryName = firePoint.properties.country;

            if (!finalData[continentName]) finalData[continentName] = {};
            if (!finalData[continentName][countryName]) {
                finalData[continentName][countryName] = {
                    hotspots: L.markerClusterGroup({maxClusterRadius: 40}),
                    areas: L.featureGroup(),
                    points: []
                };
            }
            finalData[continentName][countryName].points.push(firePoint);
        });

        for (const continent of Object.keys(finalData)) {
            for (const country of Object.keys(finalData[continent])) {
                const countryData = finalData[continent][country];

                countryData.points.forEach(point => {
                    const marker = L.marker([point.geometry.coordinates[1], point.geometry.coordinates[0]]);
                    const p = point.properties;
                    const popupContent = `<b>Location:</b> ${p.location}<br><hr style="margin: 4px 0;"><b>Brightness:</b> ${p.brightness} K<br><b>Acquired:</b> ${p.acq_date} ${p.acq_time} UTC<br><b>Satellite:</b> ${p.satellite}<br><b>Confidence:</b> ${p.confidence}<br><b>Day/Night:</b> ${p.daynight}<br><b>FRP:</b> ${p.frp} MW`;
                    marker.bindPopup(popupContent);
                    countryData.hotspots.addLayer(marker);
                });

                if (countryData.points.length > 1) {
                    const bufferedPolygons = countryData.points.map(point => turf.buffer(point, 1000, {
                        units: 'meters'
                    }));
                    
                    try {
                        let unionedPolygon = bufferedPolygons[0];
                        for (let i = 1; i < bufferedPolygons.length; i++) {
                            if (bufferedPolygons[i]) {
                                const result = turf.union(unionedPolygon, bufferedPolygons[i]);
                                if (result) {
                                    unionedPolygon = result;
                                }
                            }
                        }

                        if (unionedPolygon && unionedPolygon.geometry && unionedPolygon.geometry.coordinates) {
                            const expanded = turf.buffer(unionedPolygon, 500, { units: 'meters' });
                            if (expanded) {
                                const smoothedPolygon = turf.buffer(expanded, -500, { units: 'meters' });
                                if (smoothedPolygon) {
                                    const area_sq_km = turf.area(smoothedPolygon) / 1000000;
                                    const areaLayer = L.geoJSON(smoothedPolygon, {
                                        style: {
                                            color: "#ff0000",
                                            weight: 2,
                                            opacity: 0.8,
                                            fillColor: "#ff0000",
                                            fillOpacity: 0.2
                                        }
                                    }).bindPopup(`Burnt Area: ${Math.round(area_sq_km)} KM²`);
                                    countryData.areas.addLayer(areaLayer);
                                }
                            }
                        }
                    } catch (e) {
                         console.error("Error during turf.union, likely due to complex geometry:", e);
                    }
                }
            }
        }
        populateMap(finalData);
    } catch (e) {
        console.error("Error during processing:", e);
        loader.innerText = 'Error processing data. Check the console.';
        alert(`An error occurred: ${e.message}. Please check the console for more details.`);
    } finally {
        loader.style.display = 'none';
    }
}


async function initializeApp() {
    const countrySelector = document.getElementById('country-selector');
    const dayRangeSelector = document.getElementById('day-range-selector');
    const satelliteSelector = document.getElementById('satellite-selector');
    const loadBtn = document.getElementById('load-data-btn');
    const loader = document.getElementById('loader');

    dayRangeSelector.addEventListener('input', () => {
        if (parseInt(dayRangeSelector.value) > 10) {
            dayRangeSelector.value = 10;
        }
    });

    dayRangeSelector.addEventListener('blur', () => {
        if (dayRangeSelector.value === '' || parseInt(dayRangeSelector.value) < 1) {
            dayRangeSelector.value = 1;
        }
    });

    try {
        loader.style.display = 'block';
        loader.innerText = 'Loading country data...';
        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const shapefilePath = `${baseUrl}/ne_110m_admin_0_countries`;
        allCountriesGeoJSON = await shp(shapefilePath);

        const countries = allCountriesGeoJSON.features
            .map(feature => ({
                name: feature.properties.ADMIN,
                abbr: feature.properties.ISO_A3
            }))
            .filter(c => c.name && c.abbr !== "-99");

        countries.sort((a, b) => a.name.localeCompare(b.name));

        countries.forEach(country => {
            const option = document.createElement('option');
            option.value = country.name;
            option.textContent = country.name;
            countrySelector.appendChild(option);
        });
        loader.style.display = 'none';
    } catch (error) {
        console.error("Failed to load country list:", error);
        loader.innerText = 'Could not load country list.';
    }

    loadBtn.addEventListener('click', () => {
        const selectedOptions = Array.from(countrySelector.selectedOptions);
        const selectedCountryNames = selectedOptions.map(opt => opt.value);
        const dayRange = dayRangeSelector.value;
        const selectedSatellite = satelliteSelector.value;

        if (selectedCountryNames.length === 0) {
            alert('Please select at least one country.');
            return;
        }

        fetchAndProcessData(selectedCountryNames, dayRange, selectedSatellite);
    });
}

window.onload = initializeApp;