// --- src/data/csv.service.ts ---

import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';
import { CalculationService } from './calculation.service';
import { Readable } from 'stream';
import csvParser from 'csv-parser';

@Injectable()
export class CsvService {
  constructor(
    @InjectRepository(RawData)
    private rawRepo: Repository<RawData>,

    @InjectRepository(CalculatedData)
    private calcRepo: Repository<CalculatedData>,

    private readonly calculationService: CalculationService,
  ) {}

  async importCsvFromEsp32(ip: string, filename: string) {
    const url = `http://${ip}/download?file=${filename}`;
    console.log(`📥 Fetching CSV: ${url}`);

    let responseText = '';
    try {
      const response = await axios.get(url, { responseType: 'text' });
      responseText = response.data;
      console.log(`📄 CSV LENGTH = ${responseText.length}`);
    } catch (err) {
      throw new Error('ESP32 unreachable or file missing');
    }

    if (!responseText.trim()) {
      throw new Error('CSV file empty');
    }

    const rows: any[] = [];
    const stream = Readable.from([responseText]);

    return new Promise(async (resolve, reject) => {
      stream
        .pipe(csvParser({ mapHeaders: ({ header }) => header.trim() }))
        .on('data', (row) => rows.push(row))
        .on('end', async () => {
          if (rows.length === 0) {
            return reject(new Error('CSV parsed but header mismatch.'));
          }

          // ---------------- FORMAT RAW DATA ----------------
          const formatted = rows.map((r) => ({
            player_id: Number(r.player_id),

            latitude: Number(r.lat),
            longitude: Number(r.lon),

            w: Number(r.gyro_w) || 0,
            x: Number(r.gyro_x) || 0,
            y: Number(r.gyro_y) || 0,
            z: Number(r.gyro_z) || 0,

            distance: Number(r.distance) || 0,
            speed: Number(r.speed) || 0,

            timestamp: r.timestamp
              ? new Date(Number(r.timestamp) * 1000)
              : new Date(),

            heartrate: Number(r.heartrate) || 0,
          }));

          const rawEntities = this.rawRepo.create(formatted);
          await this.rawRepo.save(rawEntities);

          // ---------------- GROUP BY PLAYER ----------------
          const grouped: Record<number, RawData[]> = {};
          for (const row of rawEntities) {
            if (!grouped[row.player_id]) grouped[row.player_id] = [];
            grouped[row.player_id].push(row);
          }

          let processed = 0;

          // ---------------- CALCULATE + SAVE ----------------
          for (const pid in grouped) {
            const calc = this.calculationService.computeMetrics(grouped[pid]);
            const entity = this.calcRepo.create(calc);
            await this.calcRepo.save(entity);
            processed++;
          }

          resolve({
            message: 'CSV imported + metrics calculated successfully',
            rowsInserted: rawEntities.length,
            playersCalculated: processed,
            filename,
          });
        })
        .on('error', () => reject(new Error('CSV parsing failed')));
    });
  }
}
