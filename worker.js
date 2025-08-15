importScripts('https://unpkg.com/@turf/turf@6.5.0/turf.min.js');

// Helper function to convert GeoJSON geometry to Esri JSON geometry
function geoJsonToEsriJson(geoJsonGeometry) {
    if (!geoJsonGeometry) return null;

    const esriGeometry = {
        spatialReference: { wkid: 4326 }
    };

    if (geoJsonGeometry.type === 'Polygon') {
        esriGeometry.rings = geoJsonGeometry.coordinates;
        esriGeometry.geometryType = 'esriGeometryPolygon';
    } else if (geoJsonGeometry.type === 'MultiPolygon') {
        // Flatten all rings from all polygons in the MultiPolygon
        esriGeometry.rings = geoJsonGeometry.coordinates.flat();
        esriGeometry.geometryType = 'esriGeometryPolygon'; // ArcGIS usually treats MultiPolygon queries as polygons
    } else {
        // Log a warning for unsupported geometry types.
        console.warn('Unsupported GeoJSON geometry type:', geoJsonGeometry.type);
        return null;
    }

    return esriGeometry;
}


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
    const firePoints = [];
    const countryGeoJSONs = {};

    fireFeatures.forEach(feature => {
        const longitude = feature.geometry.x;
        const latitude = feature.geometry.y;
        const attributes = feature.attributes;

        let countryName = 'Unknown';
        if (allCountriesGeoJSON && allCountriesGeoJSON.features) {
            const point = turf.point([longitude, latitude]);
            for (const countryFeature of allCountriesGeoJSON.features) {
                if (countryFeature.geometry && countryFeature.properties && countryFeature.properties.name) {
                    // Check if the fire point is within the country's geometry
                    if (turf.booleanPointInPolygon(point, countryFeature.geometry)) {
                        countryName = countryFeature.properties.name;
                        if (!countryGeoJSONs[countryName]) {
                            countryGeoJSONs[countryName] = countryFeature.geometry;
                        }
                        break;
                    }
                }
            }
        }

        firePoints.push({
            latitude: latitude,
            longitude: longitude,
            confidence: attributes.Confidence || 'N/A',
            brightness: attributes.Brightness || 'N/A',
            acquisitionDate: attributes.Acquisition_Date ? new Date(attributes.Acquisition_Date).toISOString().split('T')[0] : 'N/A',
            acquisitionTime: attributes.Acquisition_Time || 'N/A',
            satellite: attributes.Satellite || 'N/A',
            countryName: countryName
        });
    });

    return { firePoints, countryGeoJSONs };
}

function calculateBurntAreas(data) {
    data.burntAreas = {};
    // This is a placeholder for actual burnt area calculation.
    // A robust calculation would involve spatial analysis on fire points
    // (e.g., buffering points and then calculating the area of the union).
    // For demonstration, we'll assign a dummy value or a sum of fire points.
    Object.keys(data.countryGeoJSONs).forEach(countryName => {
        // Dummy calculation: For a real app, integrate with more advanced Turf.js functions
        // such as turf.buffer and turf.area, potentially grouping nearby points first.
        data.burntAreas[countryName] = (Math.random() * 100).toFixed(2); // Example: random burnt area
    });
}


self.onmessage = async (e) => {
    const { selectedCountryNames, dayRange, selectedSatellite, allCountriesGeoJSON } = e.data;
    try {
        self.postMessage({ type: 'progress', message: 'Fetching country boundaries...' });

        const selectedCountryFeatures = allCountriesGeoJSON.features.filter(f => selectedCountryNames.includes(f.properties.name));

        if (selectedCountryFeatures.length === 0) {
            self.postMessage({ type: 'error', message: "No GeoJSON data found for the selected country/countries." });
            return;
        }

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - dayRange);

        const allFireFeatures = [];
        for (const countryFeature of selectedCountryFeatures) {
            if (!countryFeature.geometry) {
                console.warn(`Country feature ${countryFeature.properties.name} has no geometry. Skipping.`);
                continue;
            }

            const esriGeometry = geoJsonToEsriJson(countryFeature.geometry);
            if (!esriGeometry) {
                console.warn(`Could not convert geometry for ${countryFeature.properties.name}. Skipping.`);
                continue;
            }

            const baseParams = {
                where: "1=1",
                outFields: "*",
                returnGeometry: true,
                f: "json",
                orderByFields: "Acquisition_Date DESC",
                time: `${startDate.getTime()},${endDate.getTime()}`,
                inSR: 4326,
                geometry: JSON.stringify(esriGeometry), // Pass the full ESRI JSON geometry
                geometryType: esriGeometry.geometryType, // Use the determined geometry type
                spatialRel: 'esriSpatialRelIntersects',
                f: 'geojson' // Still want geojson back
            };

            self.postMessage({ type: 'progress', message: `Fetching fire data for ${countryFeature.properties.name}...` });
            const countryFireFeatures = await fetchFireData(baseParams, selectedSatellite);
            allFireFeatures.push(...countryFireFeatures);
        }

        if (allFireFeatures.length === 0) {
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
        const finalData = processFirePoints(allFireFeatures, allCountriesGeoJSON);

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