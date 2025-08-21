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

function processFirePoints(fireFeatures, boundaryGeometry) {
    const finalData = {};

    fireFeatures.forEach(f => {
        const props = f.properties;
        const date = new Date(props.ACQ_DATE || props.acq_time);
        let confidence;

        if (props.confidence === 'nominal') {
            confidence = 'Normal';
        } else if (props.confidence === 'low') {
            confidence = 'Baixa';
        } else if (props.confidence === 'high') {
            confidence = 'Alta';
        } else {
            confidence = props.confidence;
        };

        const properties = {
            brightness: props.BRIGHTNESS || props.bright_ti4,
            acq_date: date.toLocaleString(),
            satellite: props.SATELLITE || props.satellite,
            confidence: props.CONFIDENCE || confidence,
            daynight: (props.DAYNIGHT || props.daynight) == 'D' ? 'Dia' : 'Noite',
            frp: props.FRP || props.frp,
        };
        const firePoint = turf.point(f.geometry.coordinates, properties);

        let assignedCountry = 'Unknown';
        let assignedContinent = 'Unknown';
        let pointInsideBoundary = true;
        if (boundaryGeometry) {
            pointInsideBoundary = turf.booleanPointInPolygon(firePoint, boundaryGeometry);
            if (pointInsideBoundary) {
                assignedCountry = 'Portugal';
                assignedContinent = 'Europe';
            }
        }

        if (pointInsideBoundary) {
            firePoint.properties.country = assignedCountry;
            firePoint.properties.continent = assignedContinent;
            firePoint.properties.location = assignedCountry;

            const { continent, country } = firePoint.properties;
            if (!finalData[continent]) finalData[continent] = {};
            if (!finalData[continent][country]) {
                finalData[continent][country] = { points: [], areas: null };
            }
            finalData[continent][country].points.push(firePoint);
        }
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
        geometry,
        dayRange,
        concelhosGeoJSON
    } = e.data;

    try {
        if (type === 'fireData') {
            self.postMessage({
                type: 'progress',
                message: `Fetching fire data for specified geometry...`
            });

            if (!geometry) {
                self.postMessage({ type: 'error', message: "No geometry provided for fire data." });
                return;
            }
            const featureGeometry = (geometry.type && geometry.coordinates) ? turf.feature(geometry) : geometry;

            const combinedBbox = turf.bbox(featureGeometry);

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
                const processedModisData = processFirePoints(modisFeatures, featureGeometry);
                calculateBurntAreas(processedModisData);
                resultData.modis = processedModisData;
            } else {
                self.postMessage({ type: 'progress', message: "No recent MODIS fire data found for the selected area." });
                resultData.modis = null;
            }

            self.postMessage({ type: 'progress', message: 'Fetching VIIRS fire data...' });
            const viirsFeatures = await fetchFireData(baseParams, 'viirs');
            if (viirsFeatures.length > 0) {
                self.postMessage({ type: 'progress', message: 'Processing VIIRS data...' });
                const processedViirsData = processFirePoints(viirsFeatures, featureGeometry);
                calculateBurntAreas(processedViirsData);
                resultData.viirs = processedViirsData;
            } else {
                self.postMessage({ type: 'progress', message: "No recent VIIRS fire data found for the selected area." });
                resultData.viirs = null;
            }

            if (!resultData.modis && !resultData.viirs) {
                self.postMessage({
                    type: 'error',
                    message: "No recent fire data found for the selected area and satellite(s)."
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
            let today = new Date();
            let tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            let aftertomorrow = new Date(today);
            aftertomorrow.setDate(aftertomorrow.getDate() + 2);

            self.postMessage({ type: 'progress', message: `Fetching Risco ${today.toLocaleDateString()} data...` });
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
                riskLayers[`Risco ${today.toLocaleDateString()}`] = geoJsonToday;
            } else {
                console.warn(`Failed to load Risco ${today.toLocaleDateString()} data:`, dataToday.message);
            }

            self.postMessage({ type: 'progress', message: `Fetching Risco ${tomorrow.toLocaleDateString()} data...` });
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
                riskLayers[`Risco ${tomorrow.toLocaleDateString()}`] = geoJsonTomorrow;
            } else {
                console.warn(`Failed to load Risco ${tomorrow.toLocaleDateString()} data:`, dataTomorrow.message);
            }

            self.postMessage({ type: 'progress', message: `Fetching Risco ${aftertomorrow.toLocaleDateString()} data...` });
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
                riskLayers[`Risco ${aftertomorrow.toLocaleDateString()}`] = geoJsonAfter;
            } else {
                console.warn(`Failed to load Risco ${aftertomorrow.toLocaleDateString()} data:`, dataAfter.message);
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