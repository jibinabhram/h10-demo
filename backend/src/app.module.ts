import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataModule } from './data/data.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,   // ✅ REQUIRED FOR RENDER POSTGRESQL
      },
      autoLoadEntities: true,
      synchronize: true,
    }),
    DataModule,
  ],
})
export class AppModule {}
