importScripts('https://unpkg.com/@turf/turf@6.5.0/turf.min.js');

let workerPortugalGeometry;
let workerConcelhosGeoJSON;

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
        }
        let satellite;
        if (props.SATELLITE == 'A') {
            satellite = 'Aqua';
        } else if (props.SATELLITE == 'T') {
            satellite = 'Terra';
        }
        const properties = {
            brightness: props.BRIGHTNESS || props.bright_ti4,
            acq_date: date.toLocaleString(),
            satellite: satellite || props.satellite,
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
    switch (d) {
        case 1: return '#509e2f';
        case 2: return '#ffe900';
        case 3: return '#e87722';
        case 4: return '#cb333b';
        case 5: return '#6f263d';
        default: return 'rgb(255, 255, 255)';
    }
}

async function fetchRiskData(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        return { success: false, message: "Failed to fetch risk data." };
    }
}

self.onmessage = async function (e) {
    const {
        type,
        url,
        dayRange
    } = e.data;

    try {
        if (type === 'initData') {
            self.postMessage({ type: 'progress', message: 'Loading geographical data...' });
            let responsePortugal = await fetch(url + 'json/portugal.json');
            workerPortugalGeometry = await responsePortugal.json();
            let responseConcelhos = await fetch(url + 'json/concelhos.json');
            workerConcelhosGeoJSON = await responseConcelhos.json();
            self.postMessage({ type: 'initDataComplete' });
        } else if (type === 'fireData') {
            self.postMessage({
                type: 'progress',
                message: `Fetching fire data...`
            });

            if (!workerPortugalGeometry || !workerPortugalGeometry.geometries[0]) {
                self.postMessage({ type: 'error', message: "Portugal geometry not loaded. Cannot fetch fire data." });
                return;
            }
            const featureGeometry = turf.feature(workerPortugalGeometry.geometries[0]);
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
                self.postMessage({ type: 'progress', message: "No recent MODIS fire data found." });
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
                self.postMessage({ type: 'progress', message: "No recent VIIRS fire data found." });
                resultData.viirs = null;
            }
            if (!resultData.modis && !resultData.viirs) {
                self.postMessage({
                    type: 'error',
                    message: "No recent fire data found."
                });
            } else {
                self.postMessage({
                    type: 'result',
                    data: resultData
                });
            }
        } else if (type === 'riskData') {
            if (!workerConcelhosGeoJSON) {
                self.postMessage({ type: 'error', message: "Concelhos GeoJSON not loaded. Cannot add risk layers." });
                return;
            }
            const riskLayers = {};
            self.postMessage({ type: 'progress', message: 'Fetching Risco data...' });
            const riskUrls = [
                'https://api-dev.fogos.pt/v1/risk-today',
                'https://api-dev.fogos.pt/v1/risk-tomorrow',
                'https://api-dev.fogos.pt/v1/risk-after'
            ];
            for (const url of riskUrls) {
                const dataResponse = await fetchRiskData(url);
                if (dataResponse.success) {
                    const date = new Date(dataResponse.data.dataPrev);
                    const geoJson = {
                        type: 'FeatureCollection',
                        features: workerConcelhosGeoJSON.features.map(feature => {
                            const rcm = dataResponse.data.local[feature.properties.DICO]?.data?.rcm;
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
                    riskLayers[`Risco ${date.toLocaleDateString()}`] = geoJson;
                } else {
                    self.postMessage({ type: 'error', message: `Failed to load risk data from ${url}: ${dataResponse.message}` });
                }
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
        self.postMessage({
            type: 'error',
            message: `An error occurred: ${err.message}`
        });
    }
};