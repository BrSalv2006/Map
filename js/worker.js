importScripts('https://unpkg.com/@turf/turf@6.5.0/turf.min.js');

async function fetchFireData(baseParams, satelliteType) {
    const apiEndpoints = {
        modis: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/MODIS_Thermal_v1/FeatureServer/0/query',
        viirs: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0/query'
    };

    const response = await fetch(`${apiEndpoints[satelliteType]}?${new URLSearchParams(baseParams)}`);
    const data = await response.json();
    return data && data.features ? data.features : [];
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

async function fetchRiskData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching risk data from ${url}:`, error);
        return { success: false, message: "Failed to fetch risk data." };
    }
}

self.onmessage = async function (e) {
    const {
        type,
        selectedCountryNames,
        dayRange,
        allCountriesGeoJSON,
        concelhosGeoJSON
    } = e.data;

    try {
        if (type === 'fireData') {
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

            const resultData = {};

            self.postMessage({ type: 'progress', message: 'Fetching MODIS fire data...' });
            const modisFeatures = await fetchFireData(baseParams, 'modis');
            if (modisFeatures.length > 0) {
                self.postMessage({ type: 'progress', message: 'Processing MODIS data...' });
                const processedModisData = processFirePoints(modisFeatures, allCountriesGeoJSON);
                calculateBurntAreas(processedModisData);
                resultData.modis = processedModisData;
            } else {
                self.postMessage({ type: 'progress', message: "No recent MODIS fire data found for the selected country/countries." });
                resultData.modis = null;
            }

            self.postMessage({ type: 'progress', message: 'Fetching VIIRS fire data...' });
            const viirsFeatures = await fetchFireData(baseParams, 'viirs');
            if (viirsFeatures.length > 0) {
                self.postMessage({ type: 'progress', message: 'Processing VIIRS data...' });
                const processedViirsData = processFirePoints(viirsFeatures, allCountriesGeoJSON);
                calculateBurntAreas(processedViirsData);
                resultData.viirs = processedViirsData;
            } else {
                self.postMessage({ type: 'progress', message: "No recent VIIRS fire data found for the selected country/countries." });
                resultData.viirs = null;
            }

            if (!resultData.modis && !resultData.viirs) {
                self.postMessage({
                    type: 'error',
                    message: "No recent fire data found for the selected country/countries and satellite(s)."
                });
            } else {
                self.postMessage({
                    type: 'result',
                    data: resultData
                });
            }

        } else if (type === 'riskData') {
            if (!concelhosGeoJSON) {
                self.postMessage({ type: 'error', message: "Concelhos GeoJSON not provided. Cannot add risk layers." });
                return;
            }

            const riskLayers = {};

            self.postMessage({ type: 'progress', message: 'Fetching "Risco Hoje" data...' });
            const dataToday = await fetchRiskData('https://api-dev.fogos.pt/v1/risk-today');
            if (dataToday.success) {
                const geoJsonToday = {
                    type: 'FeatureCollection',
                    features: concelhosGeoJSON.features.map(feature => {
                        const rcm = dataToday.data.local[feature.properties.DICO]?.data?.rcm;
                        return {
                            ...feature,
                            properties: {
                                ...feature.properties,
                                rcm: rcm,
                                fillColor: getColor(rcm)
                            }
                        };
                    })
                };
                riskLayers['Risco Hoje'] = geoJsonToday;
            } else {
                console.warn("Failed to load 'Risco Hoje' data:", dataToday.message);
            }

            self.postMessage({ type: 'progress', message: 'Fetching "Risco Amanhã" data...' });
            const dataTomorrow = await fetchRiskData('https://api-dev.fogos.pt/v1/risk-tomorrow');
            if (dataTomorrow.success) {
                const geoJsonTomorrow = {
                    type: 'FeatureCollection',
                    features: concelhosGeoJSON.features.map(feature => {
                        const rcm = dataTomorrow.data.local[feature.properties.DICO]?.data?.rcm;
                        return {
                            ...feature,
                            properties: {
                                ...feature.properties,
                                rcm: rcm,
                                fillColor: getColor(rcm)
                            }
                        };
                    })
                };
                riskLayers['Risco Amanhã'] = geoJsonTomorrow;
            } else {
                console.warn("Failed to load 'Risco Amanhã' data:", dataTomorrow.message);
            }

            self.postMessage({ type: 'progress', message: 'Fetching "Risco Depois" data...' });
            const dataAfter = await fetchRiskData('https://api-dev.fogos.pt/v1/risk-after');
            if (dataAfter.success) {
                const geoJsonAfter = {
                    type: 'FeatureCollection',
                    features: concelhosGeoJSON.features.map(feature => {
                        const rcm = dataAfter.data.local[feature.properties.DICO]?.data?.rcm;
                        return {
                            ...feature,
                            properties: {
                                ...feature.properties,
                                rcm: rcm,
                                fillColor: getColor(rcm)
                            }
                        };
                    })
                };
                riskLayers['Risco Depois'] = geoJsonAfter;
            } else {
                console.warn("Failed to load 'Risco Depois' data:", dataAfter.message);
            }

            if (Object.keys(riskLayers).length > 0) {
                self.postMessage({
                    type: 'riskResult',
                    data: riskLayers
                });
            } else {
                self.postMessage({
                    type: 'error',
                    message: "No risk layers could be loaded."
                });
            }
        }
    } catch (err) {
        console.error("Error in worker:", err);
        self.postMessage({
            type: 'error',
            message: `An error occurred: ${err.message}`
        });
    }
};