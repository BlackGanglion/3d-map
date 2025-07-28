import mapboxgl from "mapbox-gl";
import * as d3 from 'd3';
import * as turf from '@turf/turf';
import { Feature, LineString, Position } from "geojson";
import projectPointToGreatCircle from "./projectPointToGreatCircle";

// given a bearing, pitch, altitude, and a targetPosition on the ground to look at,
// calculate the camera's targetPosition as lngLat
let previousCameraPosition: { lng: any; lat: any; };

// amazingly simple, via https://codepen.io/ma77os/pen/OJPVrP
const lerp = (start: number, end: number, amt: number) => {
  return (1 - amt) * start + amt * end
}

const computeCameraPosition = (
  pitch: number,
  bearing: number,
  targetPosition: { lng: number, lat: number },
  altitude: number,
  smooth = false
) => {
  const bearingInRadian = bearing * (Math.PI / 180);
  const pitchInRadian = (90 - pitch) * (Math.PI / 180);

  const lngDiff =
    ((altitude / Math.tan(pitchInRadian)) *
      Math.sin(-bearingInRadian)) /
    (111320 * Math.cos(targetPosition.lat * (Math.PI / 180)));
  const latDiff =
    ((altitude / Math.tan(pitchInRadian)) *
      Math.cos(-bearingInRadian)) /
    111320;

  const correctedLng = targetPosition.lng + lngDiff;
  const correctedLat = targetPosition.lat - latDiff;

  const newCameraPosition = {
    lng: correctedLng,
    lat: correctedLat
  };

  if (smooth) {
    if (previousCameraPosition) {
      const SMOOTH_FACTOR = 0.95
      newCameraPosition.lng = lerp(newCameraPosition.lng, previousCameraPosition.lng, SMOOTH_FACTOR);
      newCameraPosition.lat = lerp(newCameraPosition.lat, previousCameraPosition.lat, SMOOTH_FACTOR);
    }
  }

  previousCameraPosition = newCameraPosition

  return newCameraPosition
};

const flyInAndRotate = async ({
  map,
  targetLngLat,
  duration,
  startAltitude,
  endAltitude,
  startBearing,
  endBearing,
  startPitch,
  endPitch,
}: {
  map: any;
  targetLngLat: { lng: number, lat: number },
  duration: number,
  startAltitude: number,
  endAltitude: number,
  startBearing: number,
  endBearing: number,
  startPitch: number,
  endPitch: number,
}) => {
  return new Promise<{
    bearing: number,
    altitude: number,
  }>(async (resolve) => {
    let start: number;

    var currentAltitude;
    var currentBearing;
    var currentPitch;

    // the animation frame will run as many times as necessary until the duration has been reached
    const frame = async (time: number) => {
      if (!start) {
        start = time;
      }

      // otherwise, use the current time to determine how far along in the duration we are
      let animationPhase = (time - start) / duration;

      // because the phase calculation is imprecise, the final zoom can vary
      // if it ended up greater than 1, set it to 1 so that we get the exact endAltitude that was requested
      if (animationPhase > 1) {
        animationPhase = 1;
      }

      currentAltitude = startAltitude + (endAltitude - startAltitude) * d3.easeCubicOut(animationPhase)
      // rotate the camera between startBearing and endBearing
      currentBearing = startBearing + (endBearing - startBearing) * d3.easeCubicOut(animationPhase)

      currentPitch = startPitch + (endPitch - startPitch) * d3.easeCubicOut(animationPhase)

      // compute corrected camera ground position, so the start of the path is always in view
      var correctedPosition = computeCameraPosition(
        currentPitch,
        currentBearing,
        targetLngLat,
        currentAltitude
      );

      // set the pitch and bearing of the camera
      const camera = map.getFreeCameraOptions();
      camera.setPitchBearing(currentPitch, currentBearing);

      // set the position and altitude of the camera
      camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
        correctedPosition,
        currentAltitude
      );

      // apply the new camera options
      map.setFreeCameraOptions(camera);

      // when the animationPhase is done, resolve the promise so the parent function can move on to the next step in the sequence
      if (animationPhase === 1) {
        resolve({
          bearing: currentBearing,
          altitude: currentAltitude,
        });

        // return so there are no further iterations of this frame
        return;
      }

      await window.requestAnimationFrame(frame);
    };

    await window.requestAnimationFrame(frame);
  });
};

const getBearing = (p1: Array<number>, p2: Array<number>) => {
  const rad = Math.PI / 180;
  const y = Math.sin((p2[0] - p1[0]) * rad) * Math.cos(p2[1] * rad);
  const x = Math.cos(p1[1] * rad) * Math.sin(p2[1] * rad) -
    Math.sin(p1[1] * rad) * Math.cos(p2[1] * rad) * Math.cos((p2[0] - p1[0]) * rad);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

const getLineRatio = (trackData: Feature<LineString>, point: Position) => {
  const subLine = turf.lineSlice(trackData.geometry.coordinates[0], point, trackData);
  return turf.length(subLine);
}

const animatePath = async ({
  map,
  altitude,
  pitch,
  bearingList,
  trackData,
  speed
}: {
  map: mapboxgl.Map;
  altitude: number,
  pitch: number,
  bearingList: Array<{ l: number, lRatio: number, r: number, rRatio: number, bearing: number }>,
  trackData: Feature<LineString>,
  speed: number,
}) => {
  const coordinates = trackData.geometry.coordinates;
  return new Promise<null>(async (resolve) => {
    // 帧数统计
    let index: number = 0;
    let nextBearingIndex = 1;
    // 总长度
    const distance = turf.length(trackData);

    const frame = async () => {
      const animationPhase = speed * index / (distance * 1000);

      // when the duration is complete, resolve the promise and stop iterating
      if (animationPhase > 1) {
        resolve(null);
        return;
      }

      const alongPath = turf.along(trackData, distance * animationPhase).geometry.coordinates;

      const { l, lRatio, r, rRatio, bearing: currentBearing } = bearingList[nextBearingIndex - 1];
      const nextBearing = bearingList?.[nextBearingIndex]?.bearing;

      // 简化轨迹起始
      const startPoint = coordinates[l];
      const endPoint = coordinates[r];

      const point = projectPointToGreatCircle(
        startPoint[1], startPoint[0],
        endPoint[1], endPoint[0],
        alongPath[1], alongPath[0],
      );

      // 简化轨迹上的位置
      const lngLat = {
        lng: point[1],
        lat: point[0],
      };

      // 进入下一个拐弯
      let bearing = currentBearing;
      const ratio = 0.2;
      const lRangeRatio = lRatio + (rRatio - lRatio) * (1 - ratio);

      if (rRatio <= animationPhase) {
        nextBearingIndex++;
        bearing = nextBearing;
      } else if (nextBearing && animationPhase < rRatio && lRangeRatio <= animationPhase) {
        const normalizedTime = (animationPhase - lRangeRatio) / (rRatio - lRangeRatio);
        const rotation = normalizeBearing(currentBearing, nextBearing);
        bearing = currentBearing + rotation * normalizedTime;
      }

      // Reduce the visible length of the line by using a line-gradient to cutoff the line
      // animationPhase is a value between 0 and 1 that reprents the progress of the animation
      map.setPaintProperty(
        "line-layer",
        "line-gradient",
        [
          "step",
          ["line-progress"],
          "yellow",
          animationPhase,
          "rgba(0, 0, 0, 0)",
        ]
      );

      // compute corrected camera ground position, so that he leading edge of the path is in view
      const correctedPosition = computeCameraPosition(
        pitch,
        bearing,
        lngLat,
        altitude,
      );

      // set the pitch and bearing of the camera
      const camera = map.getFreeCameraOptions();
      camera.setPitchBearing(pitch, bearing);

      // set the position and altitude of the camera
      camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
        correctedPosition,
        altitude,
      );

      // apply the new camera options
      map.setFreeCameraOptions(camera);

      index++;

      // repeat!
      await window.requestAnimationFrame(frame);
    };

    frame();
  });
}

const normalizeBearing = (currentBearing: number, targetBearing: number) => {
  // 将角度归一化到0-360范围
  currentBearing = ((currentBearing % 360) + 360) % 360;
  targetBearing = ((targetBearing % 360) + 360) % 360;

  // 计算两个可能的方向差值
  const diff1 = (targetBearing - currentBearing + 360) % 360;
  const diff2 = diff1 - 360;

  // 返回绝对值较小的差值
  return Math.abs(diff1) <= Math.abs(diff2) ? diff1 : diff2;
}

export { flyInAndRotate, getBearing, animatePath, getLineRatio };