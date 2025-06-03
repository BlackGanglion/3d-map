/**
 * Converts degrees to radians
 */
function degreesToRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

/**
 * Converts radians to degrees
 */
function radiansToDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}

/**
 * Converts latitude and longitude to Cartesian coordinates (unit sphere)
 */
function latLonToCartesian(lat: number, lon: number): [number, number, number] {
  const latRad = degreesToRadians(lat);
  const lonRad = degreesToRadians(lon);
  const x = Math.cos(latRad) * Math.cos(lonRad);
  const y = Math.cos(latRad) * Math.sin(lonRad);
  const z = Math.sin(latRad);
  return [x, y, z];
}

/**
 * Converts Cartesian coordinates (unit sphere) to latitude and longitude
 */
function cartesianToLatLon(x: number, y: number, z: number): [number, number] {
  const latRad = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lonRad = Math.atan2(y, x);
  return [radiansToDegrees(latRad), radiansToDegrees(lonRad)];
}

/**
 * Projects point C onto the great circle line connecting A and B
 * @returns The projected point C' as [latitude, longitude]
 */
function projectPointToGreatCircle(
  latA: number, lonA: number,
  latB: number, lonB: number,
  latC: number, lonC: number
): [number, number] {
  // Convert all points to Cartesian coordinates
  const A = latLonToCartesian(latA, lonA);
  const B = latLonToCartesian(latB, lonB);
  const C = latLonToCartesian(latC, lonC);

  // Calculate the normal vector to the great circle plane (A × B)
  const n = [
    A[1] * B[2] - A[2] * B[1],
    A[2] * B[0] - A[0] * B[2],
    A[0] * B[1] - A[1] * B[0]
  ];

  // Calculate C · n
  const dotCN = C[0] * n[0] + C[1] * n[1] + C[2] * n[2];

  // Calculate |n|^2
  const nNormSq = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];

  // Handle the case where A and B are the same or antipodal
  if (nNormSq < 1e-12) {
    // A and B are the same or antipodal, projection is undefined
    throw new Error('Points A and B are coincident or antipodal - great circle is not unique');
  }

  // Calculate the projection C' = C - ((C · n)/|n|^2) * n
  const Cprime = [
    C[0] - (dotCN / nNormSq) * n[0],
    C[1] - (dotCN / nNormSq) * n[1],
    C[2] - (dotCN / nNormSq) * n[2]
  ];

  // Normalize to unit sphere
  const norm = Math.sqrt(Cprime[0] * Cprime[0] + Cprime[1] * Cprime[1] + Cprime[2] * Cprime[2]);
  const CprimeNormalized = [
    Cprime[0] / norm,
    Cprime[1] / norm,
    Cprime[2] / norm
  ];

  // Convert back to latitude/longitude
  return cartesianToLatLon(CprimeNormalized[0], CprimeNormalized[1], CprimeNormalized[2]);
}

export default projectPointToGreatCircle;
