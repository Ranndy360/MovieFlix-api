import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { StorageModule } from '../storage/storage.module';
import { Movie } from './entities/movie.entity';
import { MoviesController } from './movies.controller';
import { MoviesService } from './movies.service';

@Module({
  imports: [SequelizeModule.forFeature([Movie]), StorageModule],
  controllers: [MoviesController],
  providers: [MoviesService],
  exports: [MoviesService],
})
export class MoviesModule {}
