/**
 * 根据 zoom，pitch 与 center，求得相机高度
 * @param map 
 * @returns 
 */
export function getCameraHeight(map: mapboxgl.Map): number {
  const center = map.getCenter();
  const latitude = center.lat;

  const viewportHeight = map.getContainer().clientHeight;

  const zoom = map.getZoom();
  const earthCircumference = 40075016.686; // 米
  const pitchRad = map.getPitch() * Math.PI / 180;
  const metersPerPixel = (earthCircumference * Math.cos(latitude * Math.PI / 180)) / Math.pow(2, zoom) / 512;

  const halfViewHeightInMeters = metersPerPixel * (viewportHeight / 2);
  const cameraHeight = halfViewHeightInMeters / Math.cos(pitchRad);

  return cameraHeight;
}

const initial = {
  speed: 5/3,
  zoom: 0,
  lat: 22.412646042481583,
  pitch: 60,
};

/**
 * 计算保持视觉速度恒定所需的缩放级别
 * @param initial 初始状态对象
 *   - speed: 初始速度 (km/s)
 *   - zoom: 初始缩放级别
 *   - lat: 初始纬度 (度)
 *   - pitch: 初始俯角 (度)
 * @param current 当前状态对象
 *   - speed: 当前速度 (km/s)
 *   - lat: 当前纬度 (度)
 *   - pitch: 当前俯角 (度)
 * @param minZoom 允许的最小缩放级别 (默认: 0)
 * @param maxZoom 允许的最大缩放级别 (默认: 22)
 * @returns 计算后的缩放级别 (限制在 minZoom~maxZoom 之间)
 */
function calculateZoomForConstantSpeed(
  current: { speed: number; lat: number; pitch: number },
  minZoom: number = 0,
  maxZoom: number = 22
): number {
  // 角度转弧度转换函数
  const degToRad = (deg: number) => deg * (Math.PI / 180);
  
  // 安全余弦计算（避免数值问题）
  const safeCos = (rad: number) => {
    const value = Math.cos(rad);
    // 处理接近 90 度的情况（余弦接近 0）
    return Math.abs(value) < 1e-5 ? Math.sign(value) * 1e-5 : value;
  };

  // 转换初始状态值
  const initialLatRad = degToRad(initial.lat);
  const initialPitchRad = degToRad(initial.pitch);
  const cosInitialLat = safeCos(initialLatRad);
  const cosInitialPitch = safeCos(initialPitchRad);

  // 转换当前状态值
  const currentLatRad = degToRad(current.lat);
  const currentPitchRad = degToRad(current.pitch);
  const cosCurrentLat = safeCos(currentLatRad);
  const cosCurrentPitch = safeCos(currentPitchRad);

  // 计算缩放级别变化量
  const speedRatio = initial.speed / current.speed;
  const latFactor = cosCurrentLat / cosInitialLat;
  const pitchFactor = cosCurrentPitch / cosInitialPitch;
  
  // 应用公式：z = z0 + log2(x0/x) + log2(cosφ/cosφ0) + log2(cosp/cosp0)
  const zoomDelta = 
    Math.log2(speedRatio) + 
    Math.log2(latFactor) + 
    Math.log2(pitchFactor);

  // 计算最终缩放级别
  let resultZoom = initial.zoom + zoomDelta;
  
  // 限制在有效范围内
  return Math.min(maxZoom, Math.max(minZoom, resultZoom));
}
