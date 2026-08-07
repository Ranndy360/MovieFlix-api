import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test, type TestingModule } from '@nestjs/testing';
import { UniqueConstraintError } from 'sequelize';

import { seedFaker } from '../../testing/factory';
import { createMockModel, type MockModel } from '../../testing/mock-model';
import { Movie } from '../movies/entities/movie.entity';
import { asMovie, buildMovieStub } from '../movies/testing/movie.factory';
import { WatchlistService } from '../watchlist/watchlist.service';
import { QueryReviewsDto, ReviewSortBy } from './dto/review.dto';
import { Review } from './entities/review.entity';
import { asReview, buildReviewStub } from './testing/review.factory';
import { ReviewsService } from './reviews.service';

const USER_ID = 'user-1';
const MOVIE_ID = 'movie-1';

const buildQuery = (overrides: Partial<QueryReviewsDto> = {}): QueryReviewsDto =>
  Object.assign(new QueryReviewsDto(), overrides);

describe('ReviewsService', () => {
  let service: ReviewsService;
  let reviewModel: MockModel;
  let movieModel: MockModel;
  let watchlistService: jest.Mocked<Pick<WatchlistService, 'hasWatched'>>;

  beforeEach(async () => {
    seedFaker();
    reviewModel = createMockModel();
    movieModel = createMockModel();
    watchlistService = { hasWatched: jest.fn().mockResolvedValue(true) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: getModelToken(Review), useValue: reviewModel },
        { provide: getModelToken(Movie), useValue: movieModel },
        { provide: WatchlistService, useValue: watchlistService },
      ],
    }).compile();

    service = moduleRef.get(ReviewsService);
  });

  const createDto = { movieId: MOVIE_ID, rating: 4, comment: 'Great.' };

  describe('create — business rules', () => {
    it('RULE: refuses a movie the user has not marked as watched', async () => {
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub({ id: MOVIE_ID })));
      watchlistService.hasWatched.mockResolvedValue(false);

      await expect(service.create(USER_ID, createDto)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(reviewModel.create).not.toHaveBeenCalled();
    });

    it('answers with the author, so a client can render a comment thread', async () => {
      const stub = buildReviewStub({
        rating: 4,
        userId: USER_ID,
        user: { id: USER_ID, firstName: 'Grace', lastName: 'Hopper' },
      });
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub({ id: MOVIE_ID })));
      reviewModel.create.mockResolvedValue(asReview(stub));
      reviewModel.findByPk.mockResolvedValue(asReview(stub));

      const result = await service.create(USER_ID, createDto);

      expect(result.author).toEqual({ id: USER_ID, fullName: 'Grace Hopper' });
      // Reviews are readable by every signed-in user; the address book is not.
      expect(result.author).not.toHaveProperty('email');
    });

    it('checks the watched flag for the calling user and that movie', async () => {
      const stub = buildReviewStub({ userId: USER_ID });
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub()));
      reviewModel.create.mockResolvedValue(asReview(stub));
      reviewModel.findByPk.mockResolvedValue(asReview(stub));

      await service.create(USER_ID, createDto);

      expect(watchlistService.hasWatched).toHaveBeenCalledWith(USER_ID, MOVIE_ID);
    });

    it('RULE: refuses a second review of the same movie', async () => {
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub()));
      reviewModel.create.mockRejectedValue(new UniqueConstraintError({ errors: [] }));

      await expect(service.create(USER_ID, createDto)).rejects.toThrow(ConflictException);
    });

    it('succeeds once the movie is watched', async () => {
      const stub = buildReviewStub({ rating: 4, userId: USER_ID });
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub({ id: MOVIE_ID })));
      reviewModel.create.mockResolvedValue(asReview(stub));
      reviewModel.findByPk.mockResolvedValue(asReview(stub));

      const result = await service.create(USER_ID, createDto);

      expect(reviewModel.create).toHaveBeenCalledWith({
        userId: USER_ID,
        movieId: MOVIE_ID,
        rating: 4,
        comment: 'Great.',
      });
      expect(result.rating).toBe(4);
    });

    it('stores a null comment when none was given', async () => {
      const stub = buildReviewStub({ userId: USER_ID });
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub()));
      reviewModel.create.mockResolvedValue(asReview(stub));
      reviewModel.findByPk.mockResolvedValue(asReview(stub));

      await service.create(USER_ID, { movieId: MOVIE_ID, rating: 3 });

      expect(reviewModel.create).toHaveBeenCalledWith(expect.objectContaining({ comment: null }));
    });

    it('404s for a movie outside the catalog, before any other check', async () => {
      movieModel.findByPk.mockResolvedValue(null);

      await expect(service.create(USER_ID, createDto)).rejects.toThrow(NotFoundException);
      expect(watchlistService.hasWatched).not.toHaveBeenCalled();
    });

    it('lets an unexpected database error surface unchanged', async () => {
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub()));
      reviewModel.create.mockRejectedValue(new Error('deadlock detected'));

      await expect(service.create(USER_ID, createDto)).rejects.toThrow('deadlock detected');
    });
  });

  describe('update', () => {
    it('patches only the supplied fields', async () => {
      const review = buildReviewStub({ userId: USER_ID, rating: 2, comment: 'Meh.' });
      reviewModel.findByPk.mockResolvedValue(asReview(review));

      await service.update(USER_ID, review.id, { rating: 5 });

      expect(review.update).toHaveBeenCalledWith({ rating: 5 });
    });

    it('can clear nothing on an empty patch', async () => {
      const review = buildReviewStub({ userId: USER_ID });
      reviewModel.findByPk.mockResolvedValue(asReview(review));

      await service.update(USER_ID, review.id, {});

      expect(review.update).toHaveBeenCalledWith({});
    });

    it('refuses to touch another user review', async () => {
      const review = buildReviewStub({ userId: 'someone-else' });
      reviewModel.findByPk.mockResolvedValue(asReview(review));

      await expect(service.update(USER_ID, review.id, { rating: 1 })).rejects.toThrow(
        ForbiddenException,
      );
      expect(review.update).not.toHaveBeenCalled();
    });

    it('404s for an unknown review', async () => {
      reviewModel.findByPk.mockResolvedValue(null);

      await expect(service.update(USER_ID, 'ghost', { rating: 1 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes my own review', async () => {
      const review = buildReviewStub({ userId: USER_ID });
      reviewModel.findByPk.mockResolvedValue(asReview(review));

      await expect(service.remove(USER_ID, review.id)).resolves.toBeUndefined();
      expect(review.destroy).toHaveBeenCalledTimes(1);
    });

    it('refuses to delete another user review', async () => {
      const review = buildReviewStub({ userId: 'someone-else' });
      reviewModel.findByPk.mockResolvedValue(asReview(review));

      await expect(service.remove(USER_ID, review.id)).rejects.toThrow(ForbiddenException);
      expect(review.destroy).not.toHaveBeenCalled();
    });

    it('404s for an unknown review', async () => {
      reviewModel.findByPk.mockResolvedValue(null);

      await expect(service.remove(USER_ID, 'ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('returns every review when no filter is given', async () => {
      reviewModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery());

      expect(reviewModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters to one movie', async () => {
      reviewModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery({ movieId: MOVIE_ID }));

      expect(reviewModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { movieId: MOVIE_ID } }),
      );
    });

    it('sorts by rating when asked', async () => {
      reviewModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery({ sortBy: ReviewSortBy.Rating }));

      expect(reviewModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ order: [['rating', 'DESC']] }),
      );
    });
  });

  describe('findMine', () => {
    it('always constrains to the calling user', async () => {
      reviewModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findMine(USER_ID, buildQuery());

      expect(reviewModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID } }),
      );
    });

    it('combines the user constraint with a movie filter', async () => {
      reviewModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findMine(USER_ID, buildQuery({ movieId: MOVIE_ID }));

      expect(reviewModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID, movieId: MOVIE_ID } }),
      );
    });
  });

  describe('getRatingStats', () => {
    it('reports null — not zero — when the user has never reviewed', async () => {
      reviewModel.findOne.mockResolvedValue({ total: '0', average: null });

      await expect(service.getRatingStats(USER_ID)).resolves.toEqual({
        totalReviews: 0,
        averageRating: null,
      });
    });

    it('coerces pg string aggregates and rounds to two decimals', async () => {
      reviewModel.findOne.mockResolvedValue({ total: '3', average: '3.6666666666666667' });

      await expect(service.getRatingStats(USER_ID)).resolves.toEqual({
        totalReviews: 3,
        averageRating: 3.67,
      });
    });

    it('handles a whole-number average', async () => {
      reviewModel.findOne.mockResolvedValue({ total: '2', average: '4.0000000000000000' });

      await expect(service.getRatingStats(USER_ID)).resolves.toEqual({
        totalReviews: 2,
        averageRating: 4,
      });
    });

    it('tolerates the aggregate returning no row at all', async () => {
      reviewModel.findOne.mockResolvedValue(null);

      await expect(service.getRatingStats(USER_ID)).resolves.toEqual({
        totalReviews: 0,
        averageRating: null,
      });
    });

    it('scopes the aggregate to one user', async () => {
      reviewModel.findOne.mockResolvedValue({ total: '0', average: null });

      await service.getRatingStats(USER_ID);

      expect(reviewModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID } }),
      );
    });
  });
});
