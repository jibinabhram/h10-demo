// backend/src/data/data.controller.ts

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

import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';

@Controller('data')
export class DataController {
  constructor(
    private readonly wifiService: WifiService,
    private readonly csvService: CsvService,

    @InjectRepository(RawData)
    private readonly rawRepo: Repository<RawData>,

    @InjectRepository(CalculatedData)
    private readonly calcRepo: Repository<CalculatedData>,
  ) {}

  // ===========================================================
  // POST /data/upload (ESP32 → Live JSON Upload)
  // ===========================================================
  @Post('upload')
  async uploadFromESP(@Body() body: any) {
    return this.wifiService.receiveDataFromESP32(body);
  }

  // ===========================================================
  // POST /data/upload-csv (Mobile App → CSV Upload)
  // FIXED: Save RAW sensor data into RawData table
  // ===========================================================
  @Post('upload-csv')
  async uploadCsvFromMobile(@Body() body: any) {
    const { filename, rows } = body;

    if (!rows || !Array.isArray(rows)) {
      throw new BadRequestException('Invalid or missing "rows" array');
    }

    const mappedRows = rows.map((r) => ({
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

      timestamp: new Date(Number(r.timestamp) * 1000), // UNIX → Date
    }));

    await this.rawRepo.save(mappedRows);

    return { message: `Saved ${rows.length} raw rows` };
  }

  // ===========================================================
  // GET /data/import-csv → ESP32 fetch CSV
  // ===========================================================
  @Get('import-csv')
  async importCsv(@Query('ip') ip: string, @Query('file') filename: string) {
    if (!ip || !filename) {
      throw new BadRequestException('ip and file are required');
    }
    return this.csvService.importCsvFromEsp32(ip, filename);
  }

  // ===========================================================
  // GET /data/players → From CalculatedData Only
  // ===========================================================
  @Get('players')
  async getAllPlayers() {
    const uniquePlayers = await this.calcRepo
      .createQueryBuilder('c')
      .select('c.player_id', 'player_id')
      .distinct(true)
      .orderBy('player_id', 'ASC')
      .getRawMany();

    return uniquePlayers.map((p) => ({
      player_id: Number(p.player_id),
    }));
  }

  // ===========================================================
  // GET /data/player-match-dates
  // ===========================================================
  @Get('player-match-dates')
  async getMatchDatesByPlayer(@Query('playerId') playerId: string) {
    if (!playerId || isNaN(Number(playerId))) {
      throw new BadRequestException('Valid "playerId" required');
    }

    const uniqueDates = await this.calcRepo
      .createQueryBuilder('c')
      .select("DATE_TRUNC('day', c.created_at)::date::text", 'match_day')
      .distinct(true)
      .where('c.player_id = :playerId', { playerId: Number(playerId) })
      .orderBy('match_day', 'DESC')
      .getRawMany();

    return uniqueDates.map((d) => d.match_day);
  }

  // ===========================================================
  // GET /data/calculated
  // ===========================================================
  @Get('calculated')
  async getCalculatedData(
    @Query('created_at') created_at: string,
    @Query('playerIds') playerIdsString: string,
  ) {
    if (!created_at || !playerIdsString) {
      return this.calcRepo.find({ order: { created_at: 'DESC' } });
    }

    const matchDate = new Date(created_at);
    if (isNaN(matchDate.getTime())) {
      throw new BadRequestException('Invalid date');
    }

    const playerIds = playerIdsString
      .split(',')
      .map((id) => Number(id))
      .filter((id) => !isNaN(id));

    if (playerIds.length === 0) return [];

    const start = new Date(matchDate);
    const end = new Date(matchDate);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);

    return this.calcRepo
      .createQueryBuilder('c')
      .where('c.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('c.player_id IN (:...playerIds)', { playerIds })
      .orderBy('c.player_id', 'ASC')
      .getMany();
  }

  // ===========================================================
  // GET /data/match-dates
  // ===========================================================
  @Get('match-dates')
  async getMatchDates() {
    const uniqueDates = await this.calcRepo
      .createQueryBuilder('c')
      .select("DATE_TRUNC('day', c.created_at)::date::text", 'match_day')
      .distinct(true)
      .orderBy('match_day', 'DESC')
      .getRawMany();

    return uniqueDates.map((d) => d.match_day);
  }

  // ===========================================================
  // GET /data/match-players
  // ===========================================================
  @Get('match-players')
  async getPlayersByMatch(@Query('created_at') created_at: string) {
    if (!created_at) throw new BadRequestException('created_at required');

    const date = new Date(created_at);
    const start = new Date(date);
    const end = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);

    const players = await this.calcRepo
      .createQueryBuilder('c')
      .select('c.player_id', 'player_id')
      .distinct(true)
      .where('c.created_at BETWEEN :start AND :end', { start, end })
      .orderBy('player_id', 'ASC')
      .getRawMany();

    return players.map((p) => ({ player_id: Number(p.player_id) }));
  }

  // ===========================================================
  // GET /data/player-metrics
  // ===========================================================
  @Get('player-metrics')
  async getPlayerMetrics(
    @Query('created_at') created_at: string,
    @Query('playerId') playerId: string,
  ) {
    if (!created_at || !playerId)
      throw new BadRequestException('Both created_at and playerId required');

    const date = new Date(created_at);
    const start = new Date(date);
    const end = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);

    return this.calcRepo
      .createQueryBuilder('c')
      .where('c.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('c.player_id = :pid', { pid: Number(playerId) })
      .getMany();
  }

  // ===========================================================
  // GET /data/player-history
  // ===========================================================
// ===========================================================
// GET /data/player-history
// ===========================================================
@Get('player-history')
async getPlayerHistory(
  @Query('playerId') playerId: string,
  @Query('dates') dates: string,
) {
  if (!playerId || !dates)
    throw new BadRequestException('playerId and dates required');

  const id = Number(playerId);
  const dateList = dates.split(',');

  const filters = dateList
    .map((d) => {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;

      const start = new Date(dt);
      const end = new Date(dt);
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(23, 59, 59, 999);

      return { start, end };
    })
    .filter((item): item is { start: Date; end: Date } => item !== null); // ✔ FIX 1: type guard

  if (filters.length === 0) return [];

  const whereClauses = filters
    .map((_, i) => `(c.created_at BETWEEN :start${i} AND :end${i})`)
    .join(' OR ');

  const params = filters.reduce((acc, f, i) => {
    if (!f) return acc; // ✔ FIX 2 (safety)
    acc[`start${i}`] = f.start;
    acc[`end${i}`] = f.end;
    return acc;
  }, {} as Record<string, Date>);

  return this.calcRepo
    .createQueryBuilder('c')
    .where('c.player_id = :id', { id })
    .andWhere(`(${whereClauses})`, params)
    .orderBy('created_at', 'DESC')
    .getMany();
}

}