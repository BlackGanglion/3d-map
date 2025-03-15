import { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';

import { token } from '../../../config';
import { data } from '../../../data/450092046183596032';
import { flyInAndRotate, createGeoJSONCircle, animatePath, getFirstBearing, computeCameraPosition } from './utils';

import 'mapbox-gl/dist/mapbox-gl.css';
import styles from './mapbox.less';

mapboxgl.accessToken = token;

const initMap = async () => {
  // get the start of the linestring, to be used for animating a zoom-in from high altitude
  const targetLngLat = {
    lng: data.geometry.coordinates[0][0],
    lat: data.geometry.coordinates[0][1],
  };

  const startPitch = 0;

  const map = new mapboxgl.Map({
    // style: 'mapbox://styles/blackganglion/cm4ps80vc006101su8ofl1z6q', // style URL
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    container: 'map',
    zoom: 4,
    center: targetLngLat,
    pitch: startPitch,
    bearing: 0,
    // Choose from Mapbox's core styles, or make your own style with Mapbox Studio
    // style: 'mapbox://styles/mapbox/standard'
  });

  const addPathSourceAndLayer = (trackGeojson: any) => {
    // Add a line feature and layer. This feature will get updated as we progress the animation
    map.addSource("line", {
      type: "geojson",
      // Line metrics is required to use the 'line-progress' property
      lineMetrics: true,
      data: trackGeojson,
    });
    map.addLayer({
      id: "line-layer",
      type: "line",
      source: "line",
      paint: {
        "line-color": "rgba(0,0,0,0)",
        "line-width": 6,
        "line-opacity": 1,
        // 'line-blur': 10,
      },
      layout: {
        // "line-z-offset": 10,
        "line-cap": "round",
        "line-join": "round",
      },
    });

    /*
    map.addSource("start-pin-base", {
      type: "geojson",
      data: createGeoJSONCircle(trackGeojson.geometry.coordinates[0], 0.04)
    });

    map.addSource("start-pin-top", {
      type: "geojson",
      data: createGeoJSONCircle(trackGeojson.geometry.coordinates[0], 0.25)
    });

    map.addSource("end-pin-base", {
      type: "geojson",
      data: createGeoJSONCircle(trackGeojson.geometry.coordinates.slice(-1)[0], 0.04)
    });

    map.addSource("end-pin-top", {
      type: "geojson",
      data: createGeoJSONCircle(trackGeojson.geometry.coordinates.slice(-1)[0], 0.25)
    });

    map.addLayer({
      id: "start-fill-pin-base",
      type: "fill-extrusion",
      source: "start-pin-base",
      paint: {
        'fill-extrusion-color': '#0bfc03',
        'fill-extrusion-height': 1000
      }
    });
    map.addLayer({
      id: "start-fill-pin-top",
      type: "fill-extrusion",
      source: "start-pin-top",
      paint: {
        'fill-extrusion-color': '#0bfc03',
        'fill-extrusion-base': 1000,
        'fill-extrusion-height': 1200
      }
    });

    map.addLayer({
      id: "end-fill-pin-base",
      type: "fill-extrusion",
      source: "end-pin-base",
      paint: {
        'fill-extrusion-color': '#eb1c1c',
        'fill-extrusion-height': 1000
      }
    });
    map.addLayer({
      id: "end-fill-pin-top",
      type: "fill-extrusion",
      source: "end-pin-top",
      paint: {
        'fill-extrusion-color': '#eb1c1c',
        'fill-extrusion-base': 1000,
        'fill-extrusion-height': 1200
      }
    });
    */
  };

  const playAnimations = async (trackGeojson: any) => {
    return new Promise(async (resolve) => {
      // add a geojson source and layer for the linestring to the map
      addPathSourceAndLayer(trackGeojson);

      const endPitch = 70;
      const duration = 60000;
      const endBearing = getFirstBearing({ duration, path: trackGeojson });

      // animate zooming in to the start point, get the final bearing and altitude for use in the next animation
      // 初始到起点镜头
      const { bearing, altitude } = await flyInAndRotate({
        map,
        targetLngLat,
        duration: 7000,
        startAltitude: 3000000,
        endAltitude: 1000,
        startBearing: 0,
        endBearing,
        startPitch,
        endPitch,
      });

      // follow the path while slowly rotating the camera, passing in the camera bearing and altitude from the previous animation
      await animatePath({
        map,
        // 时间总长
        duration,
        path: trackGeojson,
        startBearing: bearing,
        startAltitude: altitude,
        pitch: endPitch,
      });

      // get the bounds of the linestring, use fitBounds() to animate to a final view
      const bounds = turf.bbox(trackGeojson) as any;
      map.fitBounds(bounds, {
        duration: 3000,
        pitch: startPitch,
        bearing: 0,
        padding: 120,
      });

      setTimeout(() => {
        resolve(null);
      }, 10000)
    });
  }

  const add3D = () => {
    // add map 3d terrain and sky layer and fog
    // Add some fog in the background
    map.setFog({
      range: [0.5, 10],
      color: "white",
      "horizon-blend": 0.2,
    });

    // Add a sky layer over the horizon
    map.addLayer({
      id: "sky",
      type: "sky",
      paint: {
        "sky-type": "atmosphere",
        "sky-atmosphere-color": "rgba(85, 151, 210, 0.5)",
      },
    });

    map.addSource('mapbox-dem', {
      'type': 'raster-dem',
      'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
      'tileSize': 512,
      'maxzoom': 14
    });
    // add the DEM source as a terrain layer with exaggerated height
    map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 2 });
  };

  map.on('style.load', async () => {
    // add 3d, sky and fog
    add3D();

    // wait until the map settles
    await map.once('idle');

    // fetch the geojson for the linestring to be animated
    // kick off the animations
    await playAnimations(data);
  });

  function printMapState() {
    console.log("Zoom: " + map.getZoom());
    console.log("Center: " + JSON.stringify(map.getCenter()));
    console.log("Pitch: " + map.getPitch());
    console.log("Bearing: " + map.getBearing());
  }

  map.on('moveend', printMapState);
}

const Mapbox = () => {

  useEffect(() => {
    initMap();
  }, []);

  return (
    <div id="map" className={styles.map} />
  );
}

export default Mapbox;