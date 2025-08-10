document.addEventListener('DOMContentLoaded', function () {
    const today_date = new Date().toISOString().split('T')[0];

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });

    const osmHOT = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles style by <a href="https://www.hotosm.org/" target="_blank">Humanitarian OpenStreetMap Team</a> hosted by <a href="https://openstreetmap.fr/" target="_blank">OpenStreetMap France</a>'
    });

    const map = L.map('map', {
        center: [-16.5, 135],
        zoom: 6,
        layers: [osm],
    });

    const baseLayers = {
        'OpenStreetMap': osm,
        'OpenStreetMap.HOT': osmHOT
    };

    const layerControl = L.control.layers(baseLayers).addTo(map);

    const openTopoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    });
    layerControl.addBaseLayer(openTopoMap, 'OpenTopoMap');




    fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/65306165019b61030df1883a79b8a495/MODIS_NRT/world/1/${today_date}`)
        .then(response => response.text())
        .then(csvtext => {
            Papa.parse(csvtext, {
                header: true,
                dynamicTyping: true,
                complete: function (results) {
                    const fireData = results.data;
                    // Create a feature group to hold the markers
                    const fireMarkers = L.featureGroup();

                    fireData.forEach(fire => {
                        if (fire.latitude && fire.longitude) {
                            const marker = L.marker([fire.latitude, fire.longitude]);

                            // Create the popup content
                            const popupContent = `
                            <b>Brightness:</b> ${fire.brightness} K<br>
                            <b>Acquired:</b> ${fire.acq_date} ${String(fire.acq_time).padStart(4, '0')} UTC<br>
                            <b>Satellite:</b> ${fire.satellite} (${fire.instrument})<br>
                            <b>Confidence:</b> ${fire.confidence}%<br>
                            <b>Day/Night:</b> ${fire.daynight === 'D' ? 'Day' : 'Night'}<br>
                            <b>FRP:</b> ${fire.frp} MW
                        `;

                            marker.bindPopup(popupContent);
                            fireMarkers.addLayer(marker);
                        }
                    });

                    // Add the markers to the map and the layer control
                    fireMarkers.addTo(map);
                    layerControl.addOverlay(fireMarkers, "Fires");
                    // Fit the map to the bounds of the markers
                    if (fireMarkers.getLayers().length > 0) {
                        map.fitBounds(fireMarkers.getBounds().pad(0.1));
                    }
                }
            });
        })
        .catch(error => console.error('Error fetching the CSV data:', error));
});