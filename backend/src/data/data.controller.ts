import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WifiService } from './wifi.service';
import { CsvService } from './csv.service';
import { CalculationService } from './calculation.service';

import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';

@Controller('data')
export class DataController {
  constructor(
    private readonly wifiService: WifiService,
    private readonly csvService: CsvService,
    private readonly calculationService: CalculationService,

    @InjectRepository(RawData)
    private readonly rawRepo: Repository<RawData>,

    @InjectRepository(CalculatedData)
    private readonly calcRepo: Repository<CalculatedData>,
  ) {}

  // ===========================================================
  // POST /data/upload-csv (Mobile → CSV)
  // ===========================================================
  @Post('upload-csv')
  async uploadCsvFromMobile(@Body() body: any) {
    const { filename, rows } = body;

    if (!rows || !Array.isArray(rows)) {
      throw new BadRequestException('Invalid or missing "rows" array');
    }

    // 1️⃣ Map CSV → RawData
    const rawRows = rows.map((r) => ({
      player_id: Number(r.player_id) || 0,
      latitude: Number(r.lat) || 0,
      longitude: Number(r.lon) || 0,

      w: Number(r.gyro_w) || 0,
      x: Number(r.gyro_x) || 0,
      y: Number(r.gyro_y) || 0,
      z: Number(r.gyro_z) || 0,

      speed: Number(r.speed) || 0,
      distance: Number(r.distance) || 0,
      heartrate: Number(r.heartrate) || 0,

      timestamp: new Date(Number(r.timestamp) * 1000),
    }));

    // 2️⃣ Save RAW rows
    const savedRaw = await this.rawRepo.save(rawRows);

    // 3️⃣ Group by player_id
    const grouped = new Map<number, RawData[]>();
    for (const row of savedRaw) {
      if (!grouped.has(row.player_id)) {
        grouped.set(row.player_id, []);
      }
      grouped.get(row.player_id)!.push(row);
    }

    // 4️⃣ Calculate + Save metrics
for (const [, playerRows] of grouped) {
  const calculated =
    this.calculationService.computeMetrics(playerRows);

  await this.calcRepo.save(calculated);
}


    return {
      message: `Saved ${rows.length} raw rows & calculated metrics`,
      filename,
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
