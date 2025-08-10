const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
});

const map = L.map('map', {
    center: [0, 0],
    zoom: 2,
    layers: osm,
});

const baseTree = {
    label: 'Base Layers',
    children: [{ label: 'OpenStreetMap', layer: osm }]
};
const overlaysTree = {
    label: 'Fires by Region',
    selectAllCheckbox: 'All Fires',
    children: [],
    collapsed: true
};
const treeControl = L.control.layers.tree(baseTree, overlaysTree, {
    collapsed: true,
}).addTo(map);


fetch('http://127.0.0.1:5000/api/fires')
    .then(response => response.json())
    .then(data => {
        const continents = {};
        const areasByCountry = {};

        if (data.fire_areas && data.fire_areas.length > 0) {
            data.fire_areas.forEach(area => {
                if (!areasByCountry[area.country]) {
                    areasByCountry[area.country] = [];
                }
                const areaGeoJson = JSON.parse(area.geojson);
                const areaLayer = L.geoJSON(areaGeoJson, {
                    style: { color: "#ff0000", weight: 2, opacity: 0.8, fillColor: "#ff0000", fillOpacity: 0.2 }
                }).bindPopup("A significant fire area detected.");
                areasByCountry[area.country].push(areaLayer);
            });
        }

        if (data.fire_points && data.fire_points.length > 0) {
            data.fire_points.forEach(fire => {
                if (fire.latitude != null && fire.longitude != null && fire.continent) {
                    const continentName = fire.continent;
                    const countryName = fire.country;

                    if (!continents[continentName]) continents[continentName] = {};
                    if (!continents[continentName][countryName]) {
                        continents[continentName][countryName] = {
                            hotspots: L.markerClusterGroup(),
                            areas: L.featureGroup(areasByCountry[countryName] || [])
                        };
                    }

                    const marker = L.marker([fire.latitude, fire.longitude]);

                    const popupContent = `
                        <b>Location:</b> ${fire.location}<br><hr style="margin: 4px 0;">
                        <b>Brightness:</b> ${fire.brightness} K<br>
                        <b>Acquired:</b> ${fire.acq_date} ${String(fire.acq_time).padStart(4, '0')} UTC<br>
                        <b>Satellite:</b> ${fire.satellite}<br>
                        <b>Confidence:</b> ${fire.confidence}%<br>
                        <b>Day/Night:</b> ${fire.daynight === 'D' ? 'Day' : 'Night'}<br>
                        <b>FRP:</b> ${fire.frp} MW
                    `;
                    marker.bindPopup(popupContent);
                    continents[continentName][countryName].hotspots.addLayer(marker);
                }
            });
        }

        const allCountryLayers = [];
        const allLeafLayers = [];

        for (const continent of Object.keys(continents).sort()) {
            const countryLayersForTree = [];

            for (const country of Object.keys(continents[continent]).sort()) {
                const countryData = continents[continent][country];
                const combinedLayer = L.layerGroup([countryData.hotspots, countryData.areas]);

                countryLayersForTree.push({ label: country, layer: combinedLayer });
                allCountryLayers.push(combinedLayer);

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
    })
    .catch(error => {
        console.error('Error loading fire data:', error);
        document.getElementById('map').innerHTML = `<div style="padding: 20px; text-align: center;"><h2>Could not load fire data.</h2><p>Please ensure your Python server is running and try again.</p></div>`;
    });