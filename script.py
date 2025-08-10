from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
import geopandas as gpd
import requests
import io
from sklearn.cluster import DBSCAN
import numpy as np

app = Flask(__name__)
CORS(app)

processed_fire_data = None

def fetch_and_process_data():
    global processed_fire_data
    print("Fetching and processing new fire data...")
    
    fire_data_url = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/65306165019b61030df1883a79b8a495/MODIS_NRT/world/1/"
    
    try:
        response = requests.get(fire_data_url)
        response.raise_for_status()
        fires_df = pd.read_csv(io.StringIO(response.text))
    except requests.RequestException as e:
        print(f"Error fetching live CSV data: {e}")
        return None

    try:
        if fires_df.empty:
            print("No fire data was returned from the source.")
            processed_fire_data = {"fire_areas": [], "fire_points": []}
            return processed_fire_data

        fires_gdf = gpd.GeoDataFrame(
            fires_df,
            geometry=gpd.points_from_xy(fires_df['longitude'], fires_df['latitude']),
            crs="EPSG:4326"
        )
        
        countries = gpd.read_file("ne_110m_admin_0_countries.shp")
        countries = countries[['ADMIN', 'CONTINENT', 'geometry']].rename(columns={'ADMIN': 'country', 'CONTINENT': 'continent'})

        city_cols = ['geonameid', 'name', 'asciiname', 'alternatenames', 'latitude', 'longitude', 'feature_class', 'feature_code', 'country_code', 'cc2', 'admin1_code', 'admin2_code', 'admin3_code', 'admin4_code', 'population', 'elevation', 'dem', 'timezone', 'modification_date']
        cities = pd.read_csv('cities1000.txt', sep='\t', header=None, names=city_cols, low_memory=False)
        cities_gdf = gpd.GeoDataFrame(cities, geometry=gpd.points_from_xy(cities.longitude, cities.latitude), crs="EPSG:4326")
        cities_gdf = cities_gdf[['name', 'geometry']].rename(columns={'name': 'city'})
        
        fires_with_country = gpd.sjoin(fires_gdf, countries, how="left", predicate='within')
        if 'index_right' in fires_with_country.columns:
            fires_with_country = fires_with_country.drop(columns=['index_right'])

        fires_proj_for_cities = fires_with_country.to_crs("EPSG:3395")
        cities_proj = cities_gdf.to_crs("EPSG:3395")
        
        fires_with_city = gpd.sjoin_nearest(fires_proj_for_cities, cities_proj, how="left", max_distance=200000)
        
        fires_with_city['city'] = fires_with_city['city'].fillna('Remote Area')
        fires_with_city['country'] = fires_with_city['country'].fillna('In Ocean')
        fires_with_city['continent'] = fires_with_city['continent'].fillna('Ocean')
        
        fires_with_city['location'] = fires_with_city.apply(
            lambda row: f"{row['city']}, {row['country']}" if row['country'] != 'In Ocean' else 'In Ocean',
            axis=1
        )

        fires_proj_for_areas = fires_with_city.to_crs("EPSG:3395")
        coords = np.array(list(zip(fires_proj_for_areas.geometry.x, fires_proj_for_areas.geometry.y)))
        db = DBSCAN(eps=10000, min_samples=5).fit(coords)
        fires_proj_for_areas['cluster'] = db.labels_

        fire_areas = []
        for cluster_id in fires_proj_for_areas['cluster'].unique():
            if cluster_id != -1:
                cluster_points = fires_proj_for_areas[fires_proj_for_areas['cluster'] == cluster_id]
                if len(cluster_points) >= 3:
                    hull = cluster_points.union_all().convex_hull
                    hull_geo = gpd.GeoSeries([hull], crs="EPSG:3395").to_crs("EPSG:4326")

                    area_country = cluster_points['country'].mode()[0] if not cluster_points['country'].mode().empty else 'Unknown'
                    
                    fire_areas.append({"country": area_country, "geojson": gpd.GeoSeries(hull_geo).to_json()})

        fire_points_df = fires_with_city.drop(columns=['geometry'])
        fire_points_df = fire_points_df.replace({np.nan: None})
        fire_points = fire_points_df.to_dict(orient='records')

        processed_fire_data = {
            "fire_areas": fire_areas,
            "fire_points": fire_points
        }
        print("\nData processed and cached successfully.")

    except Exception as e:
        print(f"Error during local data processing: {e}")
        return None

    return processed_fire_data


@app.route('/api/fires')
def get_fire_data():
    if processed_fire_data is None:
        fetch_and_process_data()

    if processed_fire_data is None:
        return jsonify({"error": "Could not retrieve or process fire data"}), 500

    return jsonify(processed_fire_data)

if __name__ == '__main__':
    app.run(debug=True)
