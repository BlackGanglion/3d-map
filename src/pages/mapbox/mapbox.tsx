import { useEffect } from 'react';
import { Feature, LineString, Position } from 'geojson';
import mapboxgl from 'mapbox-gl';
import * as turf from '@turf/turf';

import { token } from '../../../config';
import { data as trackData } from '../../../data/biaoyi';

import 'mapbox-gl/dist/mapbox-gl.css';
import styles from './mapbox.less';
import { animatePath, flyInAndRotate, getBearing, getLineRatio } from './utils';
import { getCameraHeight } from './converter';

mapboxgl.accessToken = token;

// 固定俯角
const PITCH = 60;
// 固定高度
const ALTITUDE = 3000;
const EXAGGERATION = 1;
// 倍速模式（1,2,5,10）
const DoubleSpeed = 1;
// 播放速度，每帧 X 米
const Speed = 1 / 360 * DoubleSpeed * 1000;

interface Data {
  bearingList: Array<{ l: number, lRatio: number, r: number, rRatio: number, bearing: number }>;
  simplifiedData: Feature<LineString>;
  trackData: Feature<LineString>;
}

const initData = async (): Promise<Data> => {
  // 简化转折点，并计算每个转折点之间的 bearing 变化
  const simplifiedData = turf.simplify(trackData as Feature<LineString>, { tolerance: 0.004, highQuality: true });
  const distance = turf.length(trackData as Feature<LineString>);

  let simplifiedIndex = 1;
  let lastIndex = 0;
  const bearingList: { l: number, lRatio: number, r: number, rRatio: number, bearing: number }[] = [];
  const coordinates = trackData.geometry.coordinates;
  coordinates.forEach((coordinate, index) => {
    const [lng, lat] = coordinate;
    const [sLng, sLat] = simplifiedData.geometry.coordinates[simplifiedIndex];
    if (lng === sLng && lat === sLat) {
      bearingList.push({
        l: lastIndex,
        lRatio: getLineRatio(trackData as Feature<LineString>, coordinates[lastIndex]) / distance,
        r: index,
        rRatio: getLineRatio(trackData as Feature<LineString>, coordinates[index]) / distance,
        bearing: getBearing(simplifiedData.geometry.coordinates[simplifiedIndex - 1], coordinate),
      });
      simplifiedIndex++;
      lastIndex = index;
    }
  });

  return {
    bearingList,
    simplifiedData,
    trackData: trackData as Feature<LineString>,
  };
}

const initMap = async (data: Data) => {
  const { trackData, bearingList, simplifiedData } = data;

  const targetLngLat = {
    lng: trackData.geometry.coordinates[0][0],
    lat: trackData.geometry.coordinates[0][1],
  };

  const map = new mapboxgl.Map({
    // style: 'mapbox://styles/blackganglion/cm4ps80vc006101su8ofl1z6q', // style URL
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    container: 'map',
    zoom: 12,
    center: targetLngLat,
    pitch: 0,
    bearing: 0,
    // Choose from Mapbox's core styles, or make your own style with Mapbox Studio
    // style: 'mapbox://styles/mapbox/standard'
  });

  const addPointLayer = (data: Feature<LineString>) => {
    map.addSource('points', {
      type: "geojson",
      data,
    });

    // 添加点图层
    map.addLayer({
      id: 'points-layer',
      type: 'circle',
      source: 'points',
      paint: {
        'circle-radius': 8,
        'circle-color': '#ff0000',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      }
    });
  }

  const addPathSourceAndLayer = (data: Feature<LineString>) => {
    // Add a line feature and layer. This feature will get updated as we progress the animation
    map.addSource('line', {
      type: "geojson",
      // Line metrics is required to use the 'line-progress' property
      lineMetrics: true,
      data,
    });

    map.addLayer({
      id: "line-layer",
      type: "line",
      source: "line",
      paint: {
        "line-color": "rgba(0,0,0,0)",
        "line-width": 6,
        "line-opacity": 1,
      },
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
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
    map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': EXAGGERATION });
  }

  map.on('style.load', async () => {
    // add 3d, sky and fog
    add3D();

    // wait until the map settles
    await map.once('idle');

    // 初始化轨迹
    addPathSourceAndLayer(trackData);
    // addPointLayer(simplifiedData);

    // 动画到初始位置
    const spaceView = {
      duration: 4000 / DoubleSpeed,
      startAltitude: 3000000,
      startPitch: 40,
    };

    await flyInAndRotate({
      map,
      targetLngLat,
      duration: spaceView.duration,
      startAltitude: spaceView.startAltitude,
      endAltitude: ALTITUDE,
      startBearing: 0,
      endBearing: bearingList[0].bearing,
      startPitch: spaceView.startPitch,
      endPitch: PITCH,
    });

    await animatePath({
      map,
      trackData,
      speed: Speed,
      altitude: ALTITUDE,
      pitch: PITCH,
      bearingList,
    });
  });

  const printMapState = () => {
    const zoom = map.getZoom();
    const pitch = map.getPitch();
    const height = getCameraHeight(map);
    console.log("Zoom: " + zoom);
    console.log("Height: " + height);
    console.log("Center: " + JSON.stringify(map.getCenter()));
    console.log("Pitch: " + pitch);
    console.log("Bearing: " + map.getBearing());
  }

  map.on('moveend', printMapState);
}

const init = async () => {
  const data = await initData();
  initMap(data);
}

const Mapbox = () => {

  useEffect(() => {
    init();
  }, []);

  return (
    <div id="map" className={styles.map} />
  );
}

export default Mapbox;