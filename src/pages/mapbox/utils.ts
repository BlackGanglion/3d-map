import mapboxgl from "mapbox-gl";
import * as d3 from 'd3';
import * as turf from '@turf/turf';
import { Feature, LineString } from "geojson";

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
  var bearingInRadian = bearing * (Math.PI / 180);
  var pitchInRadian = (90 - pitch) * (Math.PI / 180);

  var lngDiff =
    ((altitude / Math.tan(pitchInRadian)) *
      Math.sin(-bearingInRadian)) /
    (111320 * Math.cos(targetPosition.lat * (Math.PI / 180)));
  var latDiff =
    ((altitude / Math.tan(pitchInRadian)) *
      Math.cos(-bearingInRadian)) /
    111320;

  var correctedLng = targetPosition.lng + lngDiff;
  var correctedLat = targetPosition.lat - latDiff;

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

const animatePath = async ({
  map,
  altitude,
  pitch,
  bearingList,
  trackData,
  speed
}: {
  map: any;
  altitude: number,
  pitch: number,
  bearingList: Array<{ l: number, r: number, bearing: number }>,
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

      const { l, r, bearing: currentBearing } = bearingList[nextBearingIndex - 1];
      const nextBearing = bearingList?.[nextBearingIndex]?.bearing;

      // 进入下一个拐弯
      let bearing = currentBearing;
      const ratio = 0.1;
      const lRange = (l + (r - l) * (1 - ratio)) / coordinates.length;
      if (r / coordinates.length <= animationPhase) {
        nextBearingIndex++;
        bearing = nextBearing;
      } else if (nextBearing && animationPhase < r / coordinates.length && lRange <= animationPhase) {
        const normalizedTime = (animationPhase - lRange) / ((r - l) / coordinates.length * ratio);
        bearing = currentBearing + (nextBearing - currentBearing) * normalizedTime;
        console.log('======', bearing, currentBearing, nextBearing);
      }

      const alongPath = turf.along(trackData, distance * animationPhase).geometry
        .coordinates;

      const lngLat = {
        lng: alongPath[0],
        lat: alongPath[1],
      };

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
        true // smooth
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

export { flyInAndRotate, getBearing, animatePath };