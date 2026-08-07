import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Movie } from '../movies/entities/movie.entity';
import { WatchlistEntry } from './entities/watchlist-entry.entity';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';

@Module({
  imports: [SequelizeModule.forFeature([WatchlistEntry, Movie])],
  controllers: [WatchlistController],
  providers: [WatchlistService],
  // Consumed by ReviewsModule (the "watched" precondition) and ProfileModule.
  exports: [WatchlistService],
})
export class WatchlistModule {}
