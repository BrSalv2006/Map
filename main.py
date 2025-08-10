import asyncio
from pyodide.http import pyfetch
import pandas as pd
import geopandas as gpd
from sklearn.cluster import DBSCAN
import numpy as np
import io
import json
from js import L, document, populateMap

async def fetch_and_process_data():
    print("Fetching and processing new fire data...")
    
    fire_data_url = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/65306165019b61030df1883a79b8a495/MODIS_NRT/world/2/"
    
    try:
        response = await pyfetch(fire_data_url)
        if response.status != 200:
            raise Exception(f"HTTP error! status: {response.status}")
        
        csv_text = await response.string()
        fires_df = pd.read_csv(io.StringIO(csv_text))

        if fires_df.empty:
            return {"fire_areas": [], "fire_points": []}

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

        return {
            "fire_areas": fire_areas,
            "fire_points": fire_points
        }

    except Exception as e:
        print(f"Error during processing: {e}")
        return None

async def main():
    data = await fetch_and_process_data()
    if data:
        data_json = json.dumps(data)
        populateMap(data_json)
    else:
        document.getElementById('loader').innerText = 'Error processing data. Check the console.'

asyncio.ensure_future(main())