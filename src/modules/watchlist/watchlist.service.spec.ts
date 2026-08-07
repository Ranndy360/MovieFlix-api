import { ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test, type TestingModule } from '@nestjs/testing';
import { UniqueConstraintError } from 'sequelize';

import { seedFaker } from '../../testing/factory';
import { createMockModel, type MockModel } from '../../testing/mock-model';
import { Movie } from '../movies/entities/movie.entity';
import { asMovie, buildMovieStub } from '../movies/testing/movie.factory';
import { QueryWatchlistDto, WatchlistSortBy } from './dto/watchlist.dto';
import { WatchlistEntry, WatchlistStatus } from './entities/watchlist-entry.entity';
import {
  asWatchlistEntry,
  buildWatchedEntryStub,
  buildWatchlistEntryStub,
} from './testing/watchlist.factory';
import { WatchlistService } from './watchlist.service';

const USER_ID = 'user-1';
const MOVIE_ID = 'movie-1';

const buildQuery = (overrides: Partial<QueryWatchlistDto> = {}): QueryWatchlistDto =>
  Object.assign(new QueryWatchlistDto(), overrides);

describe('WatchlistService', () => {
  let service: WatchlistService;
  let entryModel: MockModel;
  let movieModel: MockModel;

  beforeEach(async () => {
    seedFaker();
    entryModel = createMockModel();
    movieModel = createMockModel();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        WatchlistService,
        { provide: getModelToken(WatchlistEntry), useValue: entryModel },
        { provide: getModelToken(Movie), useValue: movieModel },
      ],
    }).compile();

    service = moduleRef.get(WatchlistService);
  });

  describe('add', () => {
    it('defaults a new entry to WANT with no watchedAt', async () => {
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub({ id: MOVIE_ID })));
      entryModel.create.mockResolvedValue(asWatchlistEntry(buildWatchlistEntryStub()));

      await service.add(USER_ID, { movieId: MOVIE_ID });

      expect(entryModel.create).toHaveBeenCalledWith({
        userId: USER_ID,
        movieId: MOVIE_ID,
        status: WatchlistStatus.Want,
        watchedAt: null,
      });
    });

    it('stamps watchedAt when added directly as WATCHED', async () => {
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub({ id: MOVIE_ID })));
      entryModel.create.mockResolvedValue(asWatchlistEntry(buildWatchedEntryStub()));

      await service.add(USER_ID, { movieId: MOVIE_ID, status: WatchlistStatus.Watched });

      const payload = entryModel.create.mock.calls[0][0] as { watchedAt: Date | null };
      expect(payload.watchedAt).toBeInstanceOf(Date);
    });

    it('404s for a movie that is not in the catalog', async () => {
      movieModel.findByPk.mockResolvedValue(null);

      await expect(service.add(USER_ID, { movieId: 'ghost' })).rejects.toThrow(NotFoundException);
      expect(entryModel.create).not.toHaveBeenCalled();
    });

    it('translates the unique-index violation into a 409', async () => {
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub()));
      entryModel.create.mockRejectedValue(new UniqueConstraintError({ errors: [] }));

      // The DB index — not a prior SELECT — is what makes "add" idempotent
      // under concurrency, so the error path has to be handled.
      await expect(service.add(USER_ID, { movieId: MOVIE_ID })).rejects.toThrow(ConflictException);
    });

    it('lets an unexpected database error surface unchanged', async () => {
      movieModel.findByPk.mockResolvedValue(asMovie(buildMovieStub()));
      entryModel.create.mockRejectedValue(new Error('connection reset'));

      await expect(service.add(USER_ID, { movieId: MOVIE_ID })).rejects.toThrow('connection reset');
    });

    it('returns the entry with its movie attached', async () => {
      const movie = buildMovieStub({ id: MOVIE_ID, title: 'Arrival' });
      movieModel.findByPk.mockResolvedValue(asMovie(movie));
      entryModel.create.mockResolvedValue(asWatchlistEntry(buildWatchlistEntryStub()));

      const result = await service.add(USER_ID, { movieId: MOVIE_ID });

      expect(result.movie?.title).toBe('Arrival');
    });
  });

  describe('updateStatus', () => {
    it('moves an entry to WATCHED and stamps the time', async () => {
      const entry = buildWatchlistEntryStub({ status: WatchlistStatus.Want, watchedAt: null });
      entryModel.findOne.mockResolvedValue(asWatchlistEntry(entry));

      const result = await service.updateStatus(USER_ID, MOVIE_ID, WatchlistStatus.Watched);

      const patch = entry.update.mock.calls[0][0] as { watchedAt: Date | null };
      expect(patch.watchedAt).toBeInstanceOf(Date);
      expect(result.status).toBe(WatchlistStatus.Watched);
    });

    it('keeps the original watchedAt when re-marking as watched', async () => {
      const firstWatched = new Date('2026-01-01T00:00:00.000Z');
      const entry = buildWatchedEntryStub({ watchedAt: firstWatched });
      entryModel.findOne.mockResolvedValue(asWatchlistEntry(entry));

      await service.updateStatus(USER_ID, MOVIE_ID, WatchlistStatus.Watched);

      // It records when they saw the film, not when the row last changed.
      expect((entry.update.mock.calls[0][0] as { watchedAt: Date }).watchedAt).toBe(firstWatched);
    });

    it('preserves watchedAt when moving back to an unwatched status', async () => {
      const watchedAt = new Date('2026-01-01T00:00:00.000Z');
      const entry = buildWatchedEntryStub({ watchedAt });
      entryModel.findOne.mockResolvedValue(asWatchlistEntry(entry));

      await service.updateStatus(USER_ID, MOVIE_ID, WatchlistStatus.Watching);

      const patch = entry.update.mock.calls[0][0] as { status: string; watchedAt: Date };
      expect(patch.status).toBe(WatchlistStatus.Watching);
      expect(patch.watchedAt).toBe(watchedAt);
    });

    it('404s when the movie is not on the list', async () => {
      entryModel.findOne.mockResolvedValue(null);

      await expect(
        service.updateStatus(USER_ID, MOVIE_ID, WatchlistStatus.Watched),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the lookup to the calling user', async () => {
      entryModel.findOne.mockResolvedValue(asWatchlistEntry(buildWatchlistEntryStub()));

      await service.updateStatus(USER_ID, MOVIE_ID, WatchlistStatus.Watching);

      expect(entryModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID, movieId: MOVIE_ID } }),
      );
    });
  });

  describe('findMine', () => {
    it('only ever returns the calling user rows', async () => {
      entryModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findMine(USER_ID, buildQuery());

      expect(entryModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID } }),
      );
    });

    it('adds the status filter when supplied', async () => {
      entryModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findMine(USER_ID, buildQuery({ status: WatchlistStatus.Watched }));

      expect(entryModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID, status: WatchlistStatus.Watched },
        }),
      );
    });

    it('paginates', async () => {
      entryModel.findAndCountAll.mockResolvedValue({ rows: [], count: 42 });

      const result = await service.findMine(USER_ID, buildQuery({ page: 3, pageSize: 10 }));

      expect(entryModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
      expect(result.meta.totalPages).toBe(5);
    });

    it('maps the sort key to a real column', async () => {
      entryModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findMine(USER_ID, buildQuery({ sortBy: WatchlistSortBy.WatchedAt }));

      expect(entryModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ order: [['watchedAt', 'DESC']] }),
      );
    });

    it('eager-loads the movie so the list is renderable in one call', async () => {
      entryModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findMine(USER_ID, buildQuery());

      expect(entryModel.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ include: [{ model: Movie, required: true }] }),
      );
    });
  });

  describe('remove', () => {
    it('deletes the entry', async () => {
      const entry = buildWatchlistEntryStub();
      entryModel.findOne.mockResolvedValue(asWatchlistEntry(entry));

      await expect(service.remove(USER_ID, MOVIE_ID)).resolves.toBeUndefined();
      expect(entry.destroy).toHaveBeenCalledTimes(1);
    });

    it('404s when there is nothing to remove', async () => {
      entryModel.findOne.mockResolvedValue(null);

      await expect(service.remove(USER_ID, MOVIE_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('hasWatched', () => {
    it('is true only for a WATCHED entry belonging to that user', async () => {
      entryModel.count.mockResolvedValue(1);

      await expect(service.hasWatched(USER_ID, MOVIE_ID)).resolves.toBe(true);
      expect(entryModel.count).toHaveBeenCalledWith({
        where: { userId: USER_ID, movieId: MOVIE_ID, status: WatchlistStatus.Watched },
      });
    });

    it('is false when the movie is on the list but not watched', async () => {
      entryModel.count.mockResolvedValue(0);

      await expect(service.hasWatched(USER_ID, MOVIE_ID)).resolves.toBe(false);
    });
  });

  describe('countByStatus', () => {
    it('returns zeroes for a user with an empty list', async () => {
      entryModel.findAll.mockResolvedValue([]);

      await expect(service.countByStatus(USER_ID)).resolves.toEqual({
        WANT: 0,
        WATCHING: 0,
        WATCHED: 0,
      });
    });

    it('coerces the grouped counts, which pg returns as strings', async () => {
      entryModel.findAll.mockResolvedValue([
        { status: WatchlistStatus.Want, total: '4' },
        { status: WatchlistStatus.Watched, total: '11' },
      ]);

      await expect(service.countByStatus(USER_ID)).resolves.toEqual({
        WANT: 4,
        WATCHING: 0,
        WATCHED: 11,
      });
    });

    it('groups by status for a single user', async () => {
      entryModel.findAll.mockResolvedValue([]);

      await service.countByStatus(USER_ID);

      expect(entryModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID }, group: ['status'] }),
      );
    });
  });
});
