import { Module } from '@nestjs/common';

import { ReviewsModule } from '../reviews/reviews.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [WatchlistModule, ReviewsModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
