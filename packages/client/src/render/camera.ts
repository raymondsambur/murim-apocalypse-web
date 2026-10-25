/** Smooth follow camera with zoom and temporary drag-pan detachment. Pure (unit tested). */
import { clampZoom } from './iso';

export class Camera {
  /** Centre in world px. */
  x = 0;
  y = 0;
  zoom = 1;
  targetZoom = 1;
  /** When detached, the camera ignores the follow target until re-attached. */
  detached = false;
  /** Optional fixed target (centerOn) used when there is no follow target. */
  goalX: number | null = null;
  goalY: number | null = null;
  /** Zoom anchor in world px (keeps the point under the cursor fixed while zooming when detached). */
  private anchor: { wx: number; wy: number; sx: number; sy: number } | null = null;

  setZoomTarget(z: number, anchor?: { wx: number; wy: number; sx: number; sy: number }): void {
    this.targetZoom = clampZoom(z);
    this.anchor = anchor && this.detached ? anchor : null;
  }

  panBy(dxWorld: number, dyWorld: number): void {
    this.detached = true;
    this.x += dxWorld;
    this.y += dyWorld;
    this.goalX = null;
    this.goalY = null;
  }

  attach(): void {
    this.detached = false;
  }

  centerOn(wx: number, wy: number, instant: boolean, attach = true): void {
    this.goalX = wx;
    this.goalY = wy;
    this.detached = !attach;
    if (instant) {
      this.x = wx;
      this.y = wy;
    }
  }

  /**
   * Advance by dt ms toward the follow target (world px) if any.
   * Uses critically-damped style exponential smoothing that is frame-rate independent.
   */
  update(dt: number, follow: { x: number; y: number } | null): void {
    const k = 1 - Math.exp(-dt / 140);
    {
      const gx = this.detached ? this.goalX : follow ? follow.x : this.goalX;
      const gy = this.detached ? this.goalY : follow ? follow.y : this.goalY;
      if (gx !== null && gy !== null) {
        const dx = gx - this.x;
        const dy = gy - this.y;
        if (Math.abs(dx) > 2000 || Math.abs(dy) > 2000) {
          this.x = gx;
          this.y = gy;
        } else {
          this.x += dx * k;
          this.y += dy * k;
          if (Math.abs(dx) < 0.05) this.x = gx;
          if (Math.abs(dy) < 0.05) this.y = gy;
        }
      }
    }
    const zk = 1 - Math.exp(-dt / 90);
    const prevZoom = this.zoom;
    if (Math.abs(this.targetZoom - this.zoom) < 0.002) this.zoom = this.targetZoom;
    else this.zoom += (this.targetZoom - this.zoom) * zk;
    if (this.anchor && prevZoom !== this.zoom) {
      // Keep anchor world point under the same screen offset.
      this.x = this.anchor.wx - this.anchor.sx / this.zoom;
      this.y = this.anchor.wy - this.anchor.sy / this.zoom;
    }
    if (this.zoom === this.targetZoom) this.anchor = null;
  }
}
