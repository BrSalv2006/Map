importScripts('https://unpkg.com/@turf/turf@6.5.0/turf.min.js');

async function fetchFireData(baseParams, selectedSatellite) {
    const apiEndpoints = {
        modis: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/MODIS_Thermal_v1/FeatureServer/0/query',
        viirs: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0/query'
    };

    const fetchPromises = [];
    if (selectedSatellite === 'modis' || selectedSatellite === 'both') {
        fetchPromises.push(fetch(`${apiEndpoints.modis}?${new URLSearchParams(baseParams)}`).then(res => res.json()));
    }
    if (selectedSatellite === 'viirs' || selectedSatellite === 'both') {
        fetchPromises.push(fetch(`${apiEndpoints.viirs}?${new URLSearchParams(baseParams)}`).then(res => res.json()));
    }

    const fireDataResponses = await Promise.all(fetchPromises);
    let fireFeatures = [];
    fireDataResponses.forEach(response => {
        if (response && response.features) {
            fireFeatures = fireFeatures.concat(response.features);
        }
    });
    return fireFeatures;
}

function processFirePoints(fireFeatures, allCountriesGeoJSON) {
    const firePoints = fireFeatures.map(f => {
        const props = f.properties;
        const date = new Date(props.ACQ_DATE || props.acq_time);
        const properties = {
            brightness: props.BRIGHTNESS || props.bright_ti4,
            acq_date: date.toLocaleString(),
            satellite: props.SATELLITE || props.satellite,
            confidence: props.CONFIDENCE || props.confidence,
            daynight: (props.DAYNIGHT || props.daynight) == 'D' ? 'Day' : 'Night',
            frp: props.FRP || props.frp,
        };
        return turf.point(f.geometry.coordinates, properties);
    });

    const finalData = {};
    firePoints.forEach(firePoint => {
        let foundCountry = false;
        for (const country of allCountriesGeoJSON.features) {
            if (turf.booleanPointInPolygon(firePoint, country)) {
                firePoint.properties.country = country.properties.admin;
                firePoint.properties.continent = country.properties.continent;
                foundCountry = true;
                break;
            }
        }
        if (!foundCountry) {
            firePoint.properties.country = 'In Ocean';
            firePoint.properties.continent = 'Ocean';
        }
        firePoint.properties.location = firePoint.properties.country;

        const {
            continent,
            country
        } = firePoint.properties;
        if (!finalData[continent]) finalData[continent] = {};
        if (!finalData[continent][country]) {
            finalData[continent][country] = {
                points: [],
                areas: null
            };
        }
        finalData[continent][country].points.push(firePoint);
    });
    return finalData;
}

function calculateBurntAreas(finalData) {
    for (const continent in finalData) {
        for (const country in finalData[continent]) {
            const countryData = finalData[continent][country];
            if (countryData.points.length < 3) continue;

            const pointsForClustering = turf.featureCollection(countryData.points);
            const clustered = turf.clustersDbscan(pointsForClustering, 15, {
                minPoints: 3
            });

            const clusters = {};
            turf.featureEach(clustered, (feature) => {
                const clusterId = feature.properties.cluster;
                if (clusterId === undefined) return;
                if (!clusters[clusterId]) clusters[clusterId] = [];
                clusters[clusterId].push(feature);
            });

            const areaPolygons = [];
            for (const clusterId in clusters) {
                const clusterPoints = clusters[clusterId];
                if (clusterPoints.length > 0) {
                    const buffers = clusterPoints.map(point => turf.buffer(point, 1, {
                        units: 'kilometers'
                    }));
                    let mergedArea = buffers.reduce((merged, buffer) => turf.union(merged, buffer));
                    if (mergedArea) {
                        let smoothedArea = turf.buffer(mergedArea, 1, {
                            units: 'kilometers'
                        });
                        if (smoothedArea) {
                            smoothedArea = turf.buffer(smoothedArea, -1, {
                                units: 'kilometers'
                            });
                        }
                        if (smoothedArea) {
                            areaPolygons.push(smoothedArea);
                        }
                    }
                }
            }
            if (areaPolygons.length > 0) {
                countryData.areas = turf.featureCollection(areaPolygons);
            }
        }
    }
}

self.onmessage = async function (e) {
    const {
        selectedCountryNames,
        dayRange,
        selectedSatellite,
        allCountriesGeoJSON
    } = e.data;

    try {
        self.postMessage({
            type: 'progress',
            message: `Fetching fire data for ${selectedCountryNames.length} countries...`
        });

        const selectedFeatures = allCountriesGeoJSON.features.filter(f => selectedCountryNames.includes(f.properties.admin));
        const combinedBbox = turf.bbox(turf.featureCollection(selectedFeatures));
        const endDate = new Date().getTime();
        const startDate = endDate - (dayRange * 86400000);

        const baseParams = {
            returnGeometry: true,
            time: `${startDate}, ${endDate}`,
            outSR: 4326,
            outFields: '*',
            inSR: 4326,
            geometry: JSON.stringify({
                xmin: combinedBbox[0],
                ymin: combinedBbox[1],
                xmax: combinedBbox[2],
                ymax: combinedBbox[3],
                spatialReference: {
                    "wkid": 4326
                }
            }),
            geometryType: 'esriGeometryEnvelope',
            spatialRel: 'esriSpatialRelIntersects',
            f: 'geojson'
        };

        const fireFeatures = await fetchFireData(baseParams, selectedSatellite);
        if (fireFeatures.length === 0) {
            self.postMessage({
                type: 'error',
                message: "No recent fire data found for the selected country/countries and satellite(s)."
            });
            return;
        }

        self.postMessage({
            type: 'progress',
            message: 'Processing and enriching fire data...'
        });
        const finalData = processFirePoints(fireFeatures, allCountriesGeoJSON);

        self.postMessage({
            type: 'progress',
            message: 'Calculating burnt areas...'
        });
        calculateBurntAreas(finalData);

        self.postMessage({
            type: 'result',
            data: finalData
        });

    } catch (err) {
        console.error("Error in worker:", err);
        self.postMessage({
            type: 'error',
            message: `An error occurred: ${err.message}`
        });
    }
};