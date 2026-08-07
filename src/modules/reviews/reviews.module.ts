import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { Movie } from '../movies/entities/movie.entity';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { Review } from './entities/review.entity';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  // Depends on WatchlistModule for the "watched" precondition. The dependency
  // runs one way only, so the module graph stays acyclic.
  imports: [SequelizeModule.forFeature([Review, Movie]), WatchlistModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
