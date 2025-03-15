import mapboxgl from "mapbox-gl";
import * as d3 from 'd3';
import * as turf from '@turf/turf';

const createGeoJSONCircle = (center: Array<any>, radiusInKm: number, points = 64) => {
  const coords = {
    latitude: center[1],
    longitude: center[0],
  };
  const km = radiusInKm;
  const ret = [];
  const distanceX = km / (111.320 * Math.cos((coords.latitude * Math.PI) / 180));
  const distanceY = km / 110.574;
  let theta;
  let x;
  let y;
  for (let i = 0; i < points; i += 1) {
    theta = (i / points) * (2 * Math.PI);
    x = distanceX * Math.cos(theta);
    y = distanceY * Math.sin(theta);
    ret.push([coords.longitude + x, coords.latitude + y]);
  }
  ret.push(ret[0]);
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [ret],
    }
  } as any;
}

// given a bearing, pitch, altitude, and a targetPosition on the ground to look at,
// calculate the camera's targetPosition as lngLat
let previousCameraPosition: { lng: number, lat: number }

// amazingly simple, via https://codepen.io/ma77os/pen/OJPVrP
function lerp(start: number, end: number, amt: number) {
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

const animatePath = async ({
  map,
  duration,
  path,
  startBearing,
  startAltitude,
  pitch
}: {
  map: any;
  duration: number;
  path: any;
  startBearing: number,
  startAltitude: number,
  pitch: number,
}) => {
  return new Promise<null>(async (resolve) => {
    const pathDistance = turf.length(path);
    let startTime: number;

    const frame = async (currentTime: number) => {
      if (!startTime) startTime = currentTime;
      const animationPhase = (currentTime - startTime) / duration;

      // when the duration is complete, resolve the promise and stop iterating
      if (animationPhase > 1) {

        resolve(null);
        return;
      }

      // calculate the distance along the path based on the animationPhase
      const alongPath = turf.along(path, pathDistance * animationPhase).geometry
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

      // slowly rotate the map at a constant rate
      // const bearing = startBearing - animationPhase * 200.0;
      const bearing = startBearing;

      // compute corrected camera ground position, so that he leading edge of the path is in view
      var correctedPosition = computeCameraPosition(
        pitch,
        bearing,
        lngLat,
        startAltitude,
        true // smooth
      );

      // set the pitch and bearing of the camera
      const camera = map.getFreeCameraOptions();
      camera.setPitchBearing(pitch, bearing);

      // set the position and altitude of the camera
      camera.position = mapboxgl.MercatorCoordinate.fromLngLat(
        correctedPosition,
        startAltitude
      );

      // apply the new camera options
      map.setFreeCameraOptions(camera);

      // repeat!
      await window.requestAnimationFrame(frame);
    };

    await window.requestAnimationFrame(frame);
  });
};

export { createGeoJSONCircle, flyInAndRotate, animatePath };