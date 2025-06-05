/**
 * Mapbox 中 Zoom 与 Camera Height 的换算工具（考虑 pitch）
 */
export class MapboxZoomHeightConverter {
  private static readonly EARTH_CIRCUMFERENCE = 40075016.68; // 地球赤道周长（米）
  private static readonly EARTH_RADIUS = 6378137; // Web Mercator 投影的地球半径（米）

  /**
   * 根据 zoom 和 pitch 计算相机高度（altitude，单位：米）
   * @param zoom - 地图缩放级别
   * @param pitch - 相机倾斜角度（度数，默认 0）
   */
  public static zoomToHeight(zoom: number, pitch: number = 0): number {
    const zoomFactor = Math.pow(2, zoom);
    const height = this.EARTH_RADIUS / zoomFactor;
    return pitch === 0 ? height : height / Math.cos(this.degreesToRadians(pitch));
  }

  /**
   * 根据相机高度（altitude）和 pitch 计算 zoom
   * @param height - 相机高度（米）
   * @param pitch - 相机倾斜角度（度数，默认 0）
   */
  public static heightToZoom(height: number, pitch: number = 0): number {
    const adjustedHeight = pitch === 0 ? height : height * Math.cos(this.degreesToRadians(pitch));
    return Math.log2(this.EARTH_RADIUS / adjustedHeight);
  }

  /** 度数转弧度 */
  private static degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
