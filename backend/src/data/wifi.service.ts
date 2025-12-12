// --- src/data/wifi.service.ts ---

import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';
import { CalculationService } from './calculation.service';

@Injectable()
export class WifiService {
  constructor(
    @InjectRepository(RawData)
    private rawRepo: Repository<RawData>,

    @InjectRepository(CalculatedData)
    private calcRepo: Repository<CalculatedData>,

    private readonly calculationService: CalculationService,
  ) {}

  async receiveDataFromESP32(data: any[]) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new BadRequestException('Invalid ESP32 payload');
    }

    // -------- FORMAT RAW DATA --------
    const formatted = data.map((r) => ({
      player_id: Number(r.player_id) || 0,

      latitude: Number(r.lat) || 0,
      longitude: Number(r.lon) || 0,

      w: Number(r.gyro_w) || 0,
      x: Number(r.gyro_x) || 0,
      y: Number(r.gyro_y) || 0,
      z: Number(r.gyro_z) || 0,

      distance: Number(r.distance) || 0,
      speed: Number(r.speed) || 0,

      heartrate: Number(r.heartrate) || 0,

      timestamp: r.timestamp
        ? new Date(Number(r.timestamp) * 1000)
        : new Date(),
    }));

    const rawEntities = this.rawRepo.create(formatted);
    await this.rawRepo.save(rawEntities);

    // -------- CALCULATE --------
    let calc = this.calculationService.computeMetrics(rawEntities);

    // Prevent null values
    calc = this.calcRepo.create({
      player_id: calc.player_id ?? rawEntities[0].player_id,

      total_distance: calc.total_distance ?? 0,
      hsr_distance: calc.hsr_distance ?? 0,
      sprint_distance: calc.sprint_distance ?? 0,
      top_speed: calc.top_speed ?? 0,
      sprint_count: calc.sprint_count ?? 0,

      accelerations: calc.accelerations ?? 0,
      decelerations: calc.decelerations ?? 0,
      max_acceleration: calc.max_acceleration ?? 0,
      max_deceleration: calc.max_deceleration ?? 0,

      player_load: calc.player_load ?? 0,
      power_score: calc.power_score ?? 0,

      hr_max: calc.hr_max ?? rawEntities[0].heartrate ?? 0,
      time_in_red_zone: calc.time_in_red_zone ?? 0,
      percent_in_red_zone: calc.percent_in_red_zone ?? 0,
      hr_recovery_time: calc.hr_recovery_time ?? 0,
    });

    const savedCalc = await this.calcRepo.save(calc);

    return {
      message: 'ESP32 data processed successfully',
      rowsInserted: rawEntities.length,
      calculated: savedCalc,
    };
  }
}
