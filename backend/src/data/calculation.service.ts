// --- src/data/calculation.service.ts ---

import { Injectable } from '@nestjs/common';
import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';

// ================= CONSTANTS =================
const EARTH_RADIUS_M = 6371000;
const G_ACCEL = 9.80665;

const V_HSR_MS = 4.0;        // High-speed running (m/s)
const V_SPRINT_MS = 7.0;     // Sprint (m/s)
const A_EVENT_TH = 3.0;      // Accel/decel threshold
const T_MIN_ACCEL_S = 1.0;

const HR_RED_ZONE_PERCENT = 0.9;
const PL_SCALE = 100;

const C0 = 4.0;
const C1 = 2.0;

// ------------------------------------------------

@Injectable()
export class CalculationService {

  // ================= GPS DISTANCE =================
  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = EARTH_RADIUS_M;
    const f1 = lat1 * Math.PI / 180;
    const f2 = lat2 * Math.PI / 180;
    const df = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;

    const a =
      Math.sin(df / 2) ** 2 +
      Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // ================= PLAYER LOAD =================
  private playerLoadDelta(
    x1 = 0, y1 = 0, z1 = 0,
    x2 = 0, y2 = 0, z2 = 0
  ): number {
    return Math.sqrt(
      (x2 - x1) ** 2 +
      (y2 - y1) ** 2 +
      (z2 - z1) ** 2
    );
  }

  // ================= MAIN CALCULATION =================
  computeMetrics(raw: RawData[]): CalculatedData {
    const result = new CalculatedData();

    if (!raw || raw.length < 2) {
      result.player_id = raw?.[0]?.player_id ?? 0;
      return result;
    }

    result.player_id = raw[0].player_id;
    result.created_at = raw[0].timestamp;

    let totalDistance = 0;
    let hsrDistance = 0;
    let sprintDistance = 0;
    let totalPL = 0;
    let totalTime = 0;
    let totalMetPower = 0;

    let sprintCount = 0;
    let accelCount = 0;
    let decelCount = 0;

    let inSprint = false;
    let sprintTime = 0;

    let maxSpeed = 0;
    let maxAccel = 0;
    let maxDecel = 0;

    let prevSpeed = 0;

    for (let i = 0; i < raw.length - 1; i++) {
      const A = raw[i];
      const B = raw[i + 1];

      const t1 = +new Date(A.timestamp);
      const t2 = +new Date(B.timestamp);
      const dt = (t2 - t1) / 1000;
      if (dt <= 0) continue;

      totalTime += dt;

      const d = this.haversine(A.latitude, A.longitude, B.latitude, B.longitude);
      const v = d / dt;
      const a = (v - prevSpeed) / dt;

      prevSpeed = v;

      totalDistance += d;
      if (v > V_HSR_MS) hsrDistance += d;
      if (v > V_SPRINT_MS) sprintDistance += d;

      maxSpeed = Math.max(maxSpeed, v);
      maxAccel = Math.max(maxAccel, a);
      maxDecel = Math.min(maxDecel, a);

      // Sprint detection
      if (v > V_SPRINT_MS) {
        sprintTime += dt;
        if (!inSprint) inSprint = true;
      } else if (inSprint) {
        if (sprintTime >= T_MIN_ACCEL_S) sprintCount++;
        sprintTime = 0;
        inSprint = false;
      }

      // Accel / Decel
      if (a > A_EVENT_TH) accelCount++;
      if (a < -A_EVENT_TH) decelCount++;

      // Player load
      totalPL += this.playerLoadDelta(
        A.x, A.y, A.z,
        B.x, B.y, B.z
      );

      // Metabolic power
      const mp = v * (C0 + C1 * (a / G_ACCEL));
      totalMetPower += mp * dt;
    }

    // ================= HR METRICS =================
    const hr = raw.map(r => r.heartrate).filter(h => h > 0);
    const hrMax = hr.length ? Math.max(...hr) : 0;
    const redZone = hr.filter(h => h >= hrMax * HR_RED_ZONE_PERCENT).length;

    // ================= FINAL ASSIGN =================
    result.total_distance = +totalDistance.toFixed(2);
    result.hsr_distance = +hsrDistance.toFixed(2);
    result.sprint_distance = +sprintDistance.toFixed(2);
    result.top_speed = +maxSpeed.toFixed(2);

    result.sprint_count = sprintCount;
    result.accelerations = accelCount;
    result.decelerations = decelCount;

    result.max_acceleration = +maxAccel.toFixed(2);
    result.max_deceleration = +maxDecel.toFixed(2);

    result.player_load = +(totalPL / PL_SCALE).toFixed(2);
    result.power_score = totalTime ? +(totalMetPower / totalTime).toFixed(2) : 0;

    result.hr_max = hrMax;
    result.time_in_red_zone = redZone;
    result.percent_in_red_zone = hr.length
      ? +((redZone / hr.length) * 100).toFixed(2)
      : 0;

    result.hr_recovery_time = +(hrMax / 10).toFixed(2);

    return result;
  }
}
