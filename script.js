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
                label: country,
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

async function fetchAndProcessData(countryAbbreviations, dayRange) {
    const loader = document.getElementById('loader');
    loader.style.display = 'block';
    loader.innerText = `Fetching data for ${countryAbbreviations.length} countries...`;

    try {
        const satellites = ['MODIS_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT'];
        const fireDataPromises = [];

        countryAbbreviations.forEach(abbr => {
            satellites.forEach(satellite => {
                const fireDataUrl = `https://firms.modaps.eosdis.nasa.gov/api/country/csv/65306165019b61030df1883a79b8a495/${satellite}/${abbr}/${dayRange}`;
                fireDataPromises.push(
                    fetch(fireDataUrl).then(res => {
                        if (!res.ok) {
                            console.warn(`Failed to fetch data for ${abbr} from ${satellite}: ${res.statusText}`);
                            return '';
                        }
                        return res.text();
                    })
                );
            });
        });
        
        const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const shapefilePath = `${baseUrl}/ne_110m_admin_0_countries`;


        const [countriesGeoJSON, citiesResponse, ...fireDataResponses] = await Promise.all([
            shp(shapefilePath),
            fetch('cities1000.txt'),
            ...fireDataPromises
        ]);

        loader.innerText = 'Processing data...';

        let combinedCsvText = "";
        let isFirstCsv = true;
        fireDataResponses.forEach((csvText) => {
            if (csvText && csvText.trim() !== '') {
                const lines = csvText.trim().split('\n');
                if (isFirstCsv) {
                    combinedCsvText += lines.join('\n');
                    isFirstCsv = false;
                } else {
                    combinedCsvText += "\n" + lines.slice(1).join('\n');
                }
            }
        });

        const firesData = Papa.parse(combinedCsvText, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true
        }).data;
        
        const validFiresData = firesData.filter(f => f && typeof f.latitude === 'number' && typeof f.longitude === 'number');

        if (validFiresData.length === 0) {
            window.alert("No recent fire data found for the selected country/countries.");
            loader.style.display = 'none';
            return;
        }

        const firePoints = validFiresData.map(f => turf.point([f.longitude, f.latitude], f.acq_date ? f : {...f, acq_date: 'N/A', acq_time: 'N/A'}));

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
            for (const country of countriesGeoJSON.features) {
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
            firePoint.properties.location = firePoint.properties.country !== 'In Ocean' ?
                `${firePoint.properties.city}, ${firePoint.properties.country}` :
                'In Ocean';
            
            const continentName = firePoint.properties.continent;
            const countryName = firePoint.properties.country;

            if (!finalData[continentName]) finalData[continentName] = {};
            if (!finalData[continentName][countryName]) {
                finalData[continentName][countryName] = {
                    hotspots: L.markerClusterGroup(),
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
                    const popupContent = `<b>Location:</b> ${p.location}<br><hr style="margin: 4px 0;"><b>Brightness:</b> ${p.brightness} K<br><b>Acquired:</b> ${p.acq_date} ${String(p.acq_time).padStart(4, '0')} UTC<br><b>Satellite:</b> ${p.satellite}<br><b>Confidence:</b> ${p.confidence}%<br><b>Day/Night:</b> ${p.daynight === 'D' ? 'Day' : 'Night'}<br><b>FRP:</b> ${p.frp} MW`;
                    marker.bindPopup(popupContent);
                    countryData.hotspots.addLayer(marker);
                });

                if (countryData.points.length > 0) {
                    const bufferedPolygons = countryData.points.map(point => turf.buffer(point, 1000, { units: 'meters' }));
                    
                    if (bufferedPolygons.length > 0) {
                        let unionedPolygon = bufferedPolygons[0];
                        for (let i = 1; i < bufferedPolygons.length; i++) {
                            try {
                                const result = turf.union(unionedPolygon, bufferedPolygons[i]);
                                if (result) {
                                    unionedPolygon = result;
                                }
                            } catch (e) {
                                console.error("Error during turf.union:", e);
                            }
                        }

                        if (unionedPolygon && unionedPolygon.geometry && unionedPolygon.geometry.coordinates) {
                            const expanded = turf.buffer(unionedPolygon, 500, { units: 'meters' });
                            if (expanded) {
                                const smoothedPolygon = turf.buffer(expanded, -500, { units: 'meters' });
                                const area_sq_km = turf.area(smoothedPolygon) / 1000000;
                                const areaLayer = L.geoJSON(smoothedPolygon, {
                                    style: { color: "#ff0000", weight: 2, opacity: 0.8, fillColor: "#ff0000", fillOpacity: 0.2 }
                                }).bindPopup(`Burnt Area: ${Math.round(area_sq_km)} KM2`);
                                countryData.areas.addLayer(areaLayer);
                            }
                        }
                    }
                }
            }
        }
        
        populateMap(finalData);

    } catch (e) {
        console.error("Error during processing:", e);
        loader.innerText = 'Error processing data. Check the console.';
        window.alert(`An error occurred: ${e.message}. Please check the console for more details.`);
    } finally {
        loader.style.display = 'none';
    }
}

async function initializeApp() {
    const countrySelector = document.getElementById('country-selector');
    const dayRangeSelector = document.getElementById('day-range-selector');
    const loadBtn = document.getElementById('load-data-btn');
    const loader = document.getElementById('loader');

    dayRangeSelector.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
            e.preventDefault();
        }
    });

    try {
        loader.style.display = 'block';
        loader.innerText = 'Fetching available countries...';
        const response = await fetch('https://firms.modaps.eosdis.nasa.gov/api/countries/');
        const textData = await response.text();
        const countries = textData.split('\n').slice(1).map(line => {
            const parts = line.split(';');
            return {
                abbr: parts[1],
                name: parts[2]
            };
        }).filter(c => c.name && c.abbr);

        countries.sort((a, b) => a.name.localeCompare(b.name));

        countries.forEach(country => {
            const option = document.createElement('option');
            option.value = country.abbr;
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
        const selectedAbbreviations = selectedOptions.map(opt => opt.value);
        const dayRange = dayRangeSelector.value;

        if (selectedAbbreviations.length === 0) {
            window.alert('Please select at least one country.');
            return;
        }
        
        fetchAndProcessData(selectedAbbreviations, dayRange);
    });
}

window.onload = initializeApp;