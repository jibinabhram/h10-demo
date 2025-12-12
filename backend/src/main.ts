import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap(){
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.use(json({ limit: '30mb' }));
  app.use(urlencoded({ extended: true, limit: '30mb' }));
  await app.listen(3000);
  console.log('Server running');
}
bootstrap();
