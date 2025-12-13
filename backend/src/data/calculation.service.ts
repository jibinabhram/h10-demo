// src/data/calculation.service.ts

import { Injectable } from '@nestjs/common';
import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';

// ================= CONFIG =================
const V_HSR_MS = 4.0;       // High-speed running threshold
const V_SPRINT_MS = 5.0;   // ✅ Sprint threshold (FIXED)
const A_EVENT_TH = 3.0;
const HR_RED_ZONE_PERCENT = 0.9;
const PL_SCALE = 100;

@Injectable()
export class CalculationService {

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

  // ================= MAIN METRICS =================
  computeMetrics(raw: RawData[]): CalculatedData {
    const result = new CalculatedData();

    if (!raw || raw.length < 2) return result;

    // 🔑 CRITICAL: sort by time
    raw.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() -
        new Date(b.timestamp).getTime()
    );

    result.player_id = raw[0].player_id;
    result.created_at = raw[0].timestamp;

    let totalDistance = 0;
    let hsrDistance = 0;
    let sprintDistance = 0;

    let sprintCount = 0;
    let inSprint = false; // ✅ KEY FIX

    let accelCount = 0;
    let decelCount = 0;

    let maxSpeed = 0;
    let maxAccel = 0;
    let maxDecel = 0;

    let totalPL = 0;

    const heartrates = raw
      .map(r => r.heartrate)
      .filter(h => h > 0);

    // ================= LOOP =================
    for (let i = 1; i < raw.length; i++) {
      const prev = raw[i - 1];
      const curr = raw[i];

      const dt =
        (new Date(curr.timestamp).getTime() -
          new Date(prev.timestamp).getTime()) / 1000;

      if (dt <= 0) continue;

      // ESP32 sends cumulative distance → use delta
      const deltaDistance = Math.max(
        0,
        curr.distance - prev.distance
      );

      const v = curr.speed;
      const prevV = prev.speed;
      const a = (v - prevV) / dt;

      totalDistance += deltaDistance;

      // ================= SPEED ZONES =================
      if (v >= V_HSR_MS) {
        hsrDistance += deltaDistance;
      }

      // 🚀 SPRINT LOGIC (ENTRY-BASED)
      if (v >= V_SPRINT_MS) {
        sprintDistance += deltaDistance;

        if (!inSprint) {
          sprintCount++;     // ✅ count ONCE per sprint
          inSprint = true;
        }
      } else {
        inSprint = false;
      }

      // ================= ACCEL / DECEL =================
      if (a > A_EVENT_TH) accelCount++;
      if (a < -A_EVENT_TH) decelCount++;

      maxSpeed = Math.max(maxSpeed, v);
      maxAccel = Math.max(maxAccel, a);
      maxDecel = Math.min(maxDecel, a);

      // ================= PLAYER LOAD =================
      totalPL += this.playerLoadDelta(
        prev.x, prev.y, prev.z,
        curr.x, curr.y, curr.z
      );
    }

    // ================= HEART RATE =================
    const hrMax = heartrates.length
      ? Math.max(...heartrates)
      : 0;

    const redZoneCount = heartrates.filter(
      h => h >= hrMax * HR_RED_ZONE_PERCENT
    ).length;

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
    result.power_score = +(maxSpeed * hrMax / 10).toFixed(2);

    result.hr_max = hrMax;
    result.time_in_red_zone = redZoneCount;
    result.percent_in_red_zone = heartrates.length
      ? +((redZoneCount / heartrates.length) * 100).toFixed(2)
      : 0;

    result.hr_recovery_time = +(hrMax / 10).toFixed(2);

    return result;
  }
}
