import { Injectable } from '@nestjs/common';

import { ReviewsService } from '../reviews/reviews.service';
import { WatchlistStatus } from '../watchlist/entities/watchlist-entry.entity';
import { WatchlistService } from '../watchlist/watchlist.service';
import { ProfileStatsResponseDto } from './dto/profile-stats-response.dto';

/**
 * Read-only aggregation over the other modules.
 *
 * It owns no tables and holds no rules of its own — it composes what
 * `WatchlistService` and `ReviewsService` already expose, so the counting logic
 * has exactly one home per concern.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly watchlistService: WatchlistService,
    private readonly reviewsService: ReviewsService,
  ) {}

  async getStats(userId: string): Promise<ProfileStatsResponseDto> {
    // Independent queries — run them concurrently rather than in sequence.
    const [byStatus, ratings] = await Promise.all([
      this.watchlistService.countByStatus(userId),
      this.reviewsService.getRatingStats(userId),
    ]);

    const want = byStatus[WatchlistStatus.Want];
    const watching = byStatus[WatchlistStatus.Watching];
    const watched = byStatus[WatchlistStatus.Watched];

    return {
      totalWatched: watched,
      averageRatingGiven: ratings.averageRating,
      totalReviews: ratings.totalReviews,
      watchlist: { want, watching, watched, total: want + watching + watched },
    };
  }
}
