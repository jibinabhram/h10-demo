import {
  Controller,
  Post,
  Body,
  Get,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CalculationService } from './calculation.service';
import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';

@Controller('data')
export class DataController {
  constructor(
    private readonly calculationService: CalculationService,

    @InjectRepository(RawData)
    private readonly rawRepo: Repository<RawData>,

    @InjectRepository(CalculatedData)
    private readonly calcRepo: Repository<CalculatedData>,
  ) {}

  // ===========================================================
  // POST /data/upload-csv
  // ===========================================================
  @Post('upload-csv')
  async uploadCsvFromMobile(@Body() body: any) {
    const { filename, rows } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new BadRequestException('Rows array is empty or invalid');
    }

    // ✅ FILTER + MAP (CRITICAL FIX)
    const rawRows = rows
      .filter(
        (r) =>
          r.player_id &&
          r.lat &&
          r.lon &&
          r.timestamp &&
          !isNaN(Number(r.timestamp))
      )
      .map((r) => ({
        player_id: Number(r.player_id),
        latitude: Number(r.lat),
        longitude: Number(r.lon),

        w: Number(r.gyro_w) || 0,
        x: Number(r.gyro_x) || 0,
        y: Number(r.gyro_y) || 0,
        z: Number(r.gyro_z) || 0,

        speed: Number(r.speed) || 0,
        distance: Number(r.distance) || 0,
        heartrate: Number(r.heartrate) || 0,

        timestamp: new Date(Number(r.timestamp) * 1000),
      }));

    if (rawRows.length === 0) {
      throw new BadRequestException('No valid rows after filtering');
    }

    // 1️⃣ Save RAW data
    const savedRaw = await this.rawRepo.save(rawRows);

    // 2️⃣ Group by player_id
    const grouped = new Map<number, RawData[]>();
    for (const row of savedRaw) {
      if (!grouped.has(row.player_id)) {
        grouped.set(row.player_id, []);
      }
      grouped.get(row.player_id)!.push(row);
    }

    // 3️⃣ Calculate + Save
    for (const [, playerRows] of grouped) {
      if (playerRows.length < 2) continue;

      const calculated =
        this.calculationService.computeMetrics(playerRows);

      await this.calcRepo.save(calculated);
    }

    return {
      message: 'CSV uploaded and processed successfully',
      filename,
      rawInserted: rawRows.length,
      players: grouped.size,
    };
  }

  // ===========================================================
  // GET /data/match-dates
  // ===========================================================
  @Get('match-dates')
  async getMatchDates() {
    const rows = await this.calcRepo
      .createQueryBuilder('c')
      .select("DATE_TRUNC('day', c.created_at)::date::text", 'match_day')
      .distinct(true)
      .orderBy('match_day', 'DESC')
      .getRawMany();

    return rows.map((r) => r.match_day);
  }
}
