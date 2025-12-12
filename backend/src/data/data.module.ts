// backend/src/data/data.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RawData } from './entities/raw-data.entity';
import { CalculatedData } from './entities/calculated-data.entity';

import { WifiService } from './wifi.service';
import { CalculationService } from './calculation.service';
import { CsvService } from './csv.service';

import { DataController } from './data.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RawData, CalculatedData])],
  controllers: [DataController],
  providers: [WifiService, CsvService, CalculationService],
})
export class DataModule {}
