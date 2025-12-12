// --- src/data/calculation.service.ts ---

import { Injectable } from '@nestjs/common';
import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';

// ================= CONSTANTS =================
const EARTH_RADIUS_M = 6371000;          // meters
const G_ACCEL = 9.80665;                 // m/s²

const V_HSR_MS = 4.0;                    // 14.4 km/h
const V_SPRINT_MS = 7.0;                 // 25.2 km/h
const A_EVENT_TH = 3.0;                  // m/s²
const T_MIN_ACCEL_S = 1.0;               // minimal duration

const HR_RED_ZONE_PERCENT = 0.9;         // 90%
const PL_SCALE = 100;                    // player load normalization

const C0 = 4.0;                           // Metabolic power baseline
const C1 = 2.0;                           // Metabolic power scaling

// Types for internal processing
interface ProcessedDataPoint {
  dt_k: number;
  d_k: number;
  v_k: number;
  a_k: number;
  hr: number;
  pl_delta: number;
  metabolic_power_k: number;
}

@Injectable()
export class CalculationService {

  // --------------------------------------------------------
  // GPS Distance using Haversine Formula
  // --------------------------------------------------------
  private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = EARTH_RADIUS_M;
    const f1 = lat1 * Math.PI / 180;
    const f2 = lat2 * Math.PI / 180;
    const df = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  // --------------------------------------------------------
  // Player Load Delta (Gyro change)
  // --------------------------------------------------------
  private calculatePlayerLoadDelta(ax1: number, ay1: number, az1: number, ax2: number, ay2: number, az2: number): number {
    const dx = (ax2 ?? 0) - (ax1 ?? 0);
    const dy = (ay2 ?? 0) - (ay1 ?? 0);
    const dz = (az2 ?? 0) - (az1 ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // --------------------------------------------------------
  // MAIN METRICS CALCULATION
  // --------------------------------------------------------
  computeMetrics(rawData: RawData[]): CalculatedData {
    const result = new CalculatedData();

    if (!rawData || rawData.length < 2) {
      result.player_id = rawData?.[0]?.player_id ?? 0;
      return result;
    }

    result.player_id = rawData[0].player_id;

    const processed: ProcessedDataPoint[] = [];
    let totalTime = 0;
    let totalPL = 0;
    let totalMetPower = 0;

    for (let i = 0; i < rawData.length - 1; i++) {
      const A = rawData[i];
      const B = rawData[i + 1];

      const tA = new Date(A.timestamp).getTime();
      const tB = new Date(B.timestamp).getTime();

      if (isNaN(tA) || isNaN(tB)) continue;

      const dt = (tB - tA) / 1000;
      if (dt <= 0) continue;

      totalTime += dt;

      const d = this.haversine(A.latitude, A.longitude, B.latitude, B.longitude);
      const v = d / dt;

      const vPrev = processed.length ? processed[processed.length - 1].v_k : 0;
      const a = (v - vPrev) / dt;

      const pl = this.calculatePlayerLoadDelta(
        A.x ?? 0, A.y ?? 0, A.z ?? 0,
        B.x ?? 0, B.y ?? 0, B.z ?? 0,
      );
      totalPL += pl;

      const mp = v * (C0 + C1 * (a / G_ACCEL));
      totalMetPower += mp * dt;

      processed.push({
        dt_k: dt,
        d_k: d,
        v_k: v,
        a_k: a,
        hr: A.heartrate ?? 0,
        pl_delta: pl,
        metabolic_power_k: mp,
      });
    }

    // ================= DISTANCES =================
    const totalDistance = processed.reduce((s, d) => s + d.d_k, 0);
    const hsrDistance = processed.filter(d => d.v_k > V_HSR_MS).reduce((s, d) => s + d.d_k, 0);
    const sprintDistance = processed.filter(d => d.v_k > V_SPRINT_MS).reduce((s, d) => s + d.d_k, 0);

    // ================= SPEED =================
    const topSpeed = Math.max(...processed.map(d => d.v_k));

    // ================= SPRINTS =================
    let sprintCount = 0, inSprint = false, sprintTime = 0;

    for (const d of processed) {
      if (d.v_k > V_SPRINT_MS) {
        sprintTime += d.dt_k;
        if (!inSprint) inSprint = true;
      } else if (inSprint) {
        if (sprintTime >= T_MIN_ACCEL_S) sprintCount++;
        sprintTime = 0;
        inSprint = false;
      }
    }

    // ================= ACCEL / DECEL COUNT =================
    let accel = 0, decel = 0;
    let inA = false, inD = false;
    let tA = 0, tD = 0;

    for (const d of processed) {
      if (d.a_k > A_EVENT_TH) {
        tA += d.dt_k;
        if (!inA) inA = true;
      } else if (inA) {
        if (tA >= T_MIN_ACCEL_S) accel++;
        tA = 0; inA = false;
      }

      if (d.a_k < -A_EVENT_TH) {
        tD += d.dt_k;
        if (!inD) inD = true;
      } else if (inD) {
        if (tD >= T_MIN_ACCEL_S) decel++;
        tD = 0; inD = false;
      }
    }

    // ================= MAX ACCEL / DECEL =================
    const maxAccel = Math.max(...processed.map(d => d.a_k));
    const maxDecel = Math.min(...processed.map(d => d.a_k));

    // ================= PLAYER LOAD =================
    const playerLoad = totalPL / PL_SCALE;

    // ================= METABOLIC POWER =================
    const powerScore = totalTime > 0 ? totalMetPower / totalTime : 0;

    // ================= HR METRICS =================
    const hr = rawData.map(r => r.heartrate).filter(h => h > 0);
    const hrMax = hr.length ? Math.max(...hr) : 0;
    const hrThresh = hrMax * HR_RED_ZONE_PERCENT;

    const redSamples = hr.filter(h => h >= hrThresh).length;
    const percentRed = hr.length ? (redSamples / hr.length) * 100 : 0;

    // ================= RESULT =================
    result.total_distance = +totalDistance.toFixed(2);
    result.hsr_distance = +hsrDistance.toFixed(2);
    result.sprint_distance = +sprintDistance.toFixed(2);
    result.top_speed = +topSpeed.toFixed(2);
    result.sprint_count = sprintCount;

    result.accelerations = accel;
    result.decelerations = decel;

    result.max_acceleration = +maxAccel.toFixed(2);
    result.max_deceleration = +maxDecel.toFixed(2);

    result.player_load = +playerLoad.toFixed(2);
    result.power_score = +powerScore.toFixed(2);

    result.hr_max = hrMax;
    result.time_in_red_zone = redSamples;
    result.percent_in_red_zone = +percentRed.toFixed(2);
    result.hr_recovery_time = +(hrMax / 10).toFixed(2);

    return result;
  }
}
