import { Test, type TestingModule } from '@nestjs/testing';

import { ReviewsService } from '../reviews/reviews.service';
import { WatchlistStatus } from '../watchlist/entities/watchlist-entry.entity';
import { WatchlistService } from '../watchlist/watchlist.service';
import { ProfileService } from './profile.service';

const USER_ID = 'user-1';

describe('ProfileService', () => {
  let service: ProfileService;
  let watchlistService: jest.Mocked<Pick<WatchlistService, 'countByStatus'>>;
  let reviewsService: jest.Mocked<Pick<ReviewsService, 'getRatingStats'>>;

  beforeEach(async () => {
    watchlistService = { countByStatus: jest.fn() };
    reviewsService = { getRatingStats: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: WatchlistService, useValue: watchlistService },
        { provide: ReviewsService, useValue: reviewsService },
      ],
    }).compile();

    service = moduleRef.get(ProfileService);
  });

  const arrange = (
    counts: Partial<Record<WatchlistStatus, number>> = {},
    ratings: { totalReviews: number; averageRating: number | null } = {
      totalReviews: 0,
      averageRating: null,
    },
  ): void => {
    watchlistService.countByStatus.mockResolvedValue({
      [WatchlistStatus.Want]: 0,
      [WatchlistStatus.Watching]: 0,
      [WatchlistStatus.Watched]: 0,
      ...counts,
    });
    reviewsService.getRatingStats.mockResolvedValue(ratings);
  };

  it('reports total watched and average rating given', async () => {
    arrange({ [WatchlistStatus.Watched]: 11 }, { totalReviews: 9, averageRating: 4.27 });

    await expect(service.getStats(USER_ID)).resolves.toMatchObject({
      totalWatched: 11,
      averageRatingGiven: 4.27,
      totalReviews: 9,
    });
  });

  it('breaks the watchlist down by status and totals it', async () => {
    arrange({
      [WatchlistStatus.Want]: 4,
      [WatchlistStatus.Watching]: 2,
      [WatchlistStatus.Watched]: 11,
    });

    const stats = await service.getStats(USER_ID);

    expect(stats.watchlist).toEqual({ want: 4, watching: 2, watched: 11, total: 17 });
  });

  it('is all zeroes and a null average for a brand-new account', async () => {
    arrange();

    await expect(service.getStats(USER_ID)).resolves.toEqual({
      totalWatched: 0,
      averageRatingGiven: null,
      totalReviews: 0,
      watchlist: { want: 0, watching: 0, watched: 0, total: 0 },
    });
  });

  it('keeps a null average distinct from a score of zero', async () => {
    arrange({ [WatchlistStatus.Watched]: 3 }, { totalReviews: 0, averageRating: null });

    const stats = await service.getStats(USER_ID);

    expect(stats.averageRatingGiven).toBeNull();
    expect(stats.averageRatingGiven).not.toBe(0);
  });

  it('scopes both lookups to the same user', async () => {
    arrange();

    await service.getStats(USER_ID);

    expect(watchlistService.countByStatus).toHaveBeenCalledWith(USER_ID);
    expect(reviewsService.getRatingStats).toHaveBeenCalledWith(USER_ID);
  });

  it('issues the two independent queries concurrently', async () => {
    let watchlistSettled = false;
    watchlistService.countByStatus.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            watchlistSettled = true;
            resolve({
              [WatchlistStatus.Want]: 0,
              [WatchlistStatus.Watching]: 0,
              [WatchlistStatus.Watched]: 0,
            });
          }, 10),
        ),
    );
    reviewsService.getRatingStats.mockImplementation(() => {
      // If these ran in sequence the watchlist query would already be done.
      expect(watchlistSettled).toBe(false);
      return Promise.resolve({ totalReviews: 0, averageRating: null });
    });

    await service.getStats(USER_ID);

    expect(watchlistSettled).toBe(true);
  });
});
