import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Test, type TestingModule } from '@nestjs/testing';
import { Op } from 'sequelize';

import { SortDirection } from '../../common/dto/pagination-query.dto';
import { createMockModel, type MockModel } from '../../testing/mock-model';
import { seedFaker } from '../../testing/factory';
import { MovieSortBy, QueryMoviesDto } from './dto/query-movies.dto';
import { Movie, MovieGenre } from './entities/movie.entity';
import type { AuthenticatedUser } from '../auth/auth.constants';
import { RoleName } from '../roles/entities/role.entity';
import { StorageService, type UploadedFile } from '../storage/storage.service';
import { MoviesService } from './movies.service';
import {
  asMovie,
  buildMovieStub,
  buildMovieStubs,
  createMovieDtoFactory,
} from './testing/movie.factory';

const buildQuery = (overrides: Partial<QueryMoviesDto> = {}): QueryMoviesDto =>
  Object.assign(new QueryMoviesDto(), overrides);

const principal = (role: RoleName, id = 'user-1'): AuthenticatedUser => ({
  id,
  email: `${role.toLowerCase()}@test.io`,
  role,
  tokenId: 'jti-1',
});

const ADMIN = principal(RoleName.Admin, 'admin-1');
const PROVIDER = principal(RoleName.Provider, 'provider-1');
const USER = principal(RoleName.User, 'user-1');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);

const buildPoster = (): UploadedFile => ({
  buffer: JPEG,
  originalname: 'poster.jpg',
  mimetype: 'image/jpeg',
  size: JPEG.length,
});

describe('MoviesService', () => {
  let service: MoviesService;
  let model: MockModel;
  let storage: jest.Mocked<Pick<StorageService, 'uploadImage' | 'removeQuietly' | 'publicPathOf'>>;

  beforeEach(async () => {
    seedFaker();
    model = createMockModel();
    storage = {
      uploadImage: jest.fn().mockResolvedValue({
        path: 'development/movies/abc.jpg',
        url: 'https://cdn.test/development/movies/abc.jpg',
        bytes: 100,
        savedPercent: 50,
      }),
      removeQuietly: jest.fn().mockResolvedValue(undefined),
      publicPathOf: jest.fn().mockReturnValue(null),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MoviesService,
        { provide: getModelToken(Movie), useValue: model },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = moduleRef.get(MoviesService);
  });

  describe('create', () => {
    it('persists the payload and returns the response shape', async () => {
      const dto = createMovieDtoFactory.build({ title: 'Arrival' });
      const stub = buildMovieStub({ title: 'Arrival' });
      model.create.mockResolvedValue(stub);

      const result = await service.create(dto, PROVIDER);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Arrival',
          genre: dto.genre,
          releaseYear: dto.releaseYear,
          durationMinutes: dto.durationMinutes,
        }),
      );
      expect(result).toMatchObject({ id: stub.id, title: 'Arrival' });
      // The entity must never leak through the boundary.
      expect(result).not.toHaveProperty('deletedAt');
    });

    it('applies defaults for the optional fields', async () => {
      const dto = createMovieDtoFactory.build();
      delete dto.synopsis;
      delete dto.rating;
      delete dto.posterUrl;
      delete dto.isPublished;
      model.create.mockResolvedValue(buildMovieStub());

      await service.create(dto, PROVIDER);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          synopsis: null,
          rating: 0,
          posterUrl: null,
          isPublished: false,
        }),
      );
    });
  });

  describe('create with a poster', () => {
    it('uploads into the movies folder and stores the returned URL', async () => {
      const dto = createMovieDtoFactory.build();
      delete dto.posterUrl;
      model.create.mockResolvedValue(buildMovieStub());

      await service.create(dto, PROVIDER, buildPoster());

      expect(storage.uploadImage).toHaveBeenCalledWith(expect.anything(), 'movies');
      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ posterUrl: 'https://cdn.test/development/movies/abc.jpg' }),
      );
    });

    it('lets an uploaded file win over a posterUrl in the body', async () => {
      const dto = createMovieDtoFactory.build({ posterUrl: 'https://example.test/from-body.jpg' });
      model.create.mockResolvedValue(buildMovieStub());

      await service.create(dto, PROVIDER, buildPoster());

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ posterUrl: 'https://cdn.test/development/movies/abc.jpg' }),
      );
    });

    it('does not touch storage when no file is sent', async () => {
      model.create.mockResolvedValue(buildMovieStub());

      await service.create(createMovieDtoFactory.build(), PROVIDER);

      expect(storage.uploadImage).not.toHaveBeenCalled();
    });

    it('deletes the uploaded object when the insert fails', async () => {
      model.create.mockRejectedValue(new Error('constraint violation'));

      await expect(
        service.create(createMovieDtoFactory.build(), PROVIDER, buildPoster()),
      ).rejects.toThrow('constraint violation');

      // Otherwise every failed create leaks an unreferenced file.
      expect(storage.removeQuietly).toHaveBeenCalledWith('development/movies/abc.jpg');
    });

    it('does not create the movie when the upload fails', async () => {
      storage.uploadImage.mockRejectedValue(new Error('storage down'));

      await expect(
        service.create(createMovieDtoFactory.build(), PROVIDER, buildPoster()),
      ).rejects.toThrow('storage down');
      expect(model.create).not.toHaveBeenCalled();
    });
  });

  describe('catalog visibility', () => {
    /** The AND-ed conditions the service handed to Sequelize. */
    const conditionsOf = (): unknown[] => {
      const { where } = model.findAndCountAll.mock.calls[0][0] as {
        where: Record<symbol, unknown[]>;
      };
      return where[Op.and as unknown as symbol] ?? [];
    };

    it('shows a plain user only published titles', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery(), USER);

      expect(conditionsOf()).toEqual([{ isPublished: true }]);
    });

    it('REGRESSION: a user asking for drafts gets an impossible query, not the drafts', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery({ isPublished: false }), USER);

      // Both conditions must survive. Merging them into a single object let
      // the filter overwrite the visibility rule and leaked every draft.
      expect(conditionsOf()).toEqual([{ isPublished: true }, { isPublished: false }]);
    });

    it('shows a provider everything published plus their own drafts', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery(), PROVIDER);

      expect(conditionsOf()).toEqual([
        { [Op.or]: [{ isPublished: true }, { createdById: 'provider-1' }] },
      ]);
    });

    it('applies no visibility constraint for an admin', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery(), ADMIN);

      expect(model.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('keeps visibility when a provider filters for drafts', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery({ isPublished: false }), PROVIDER);

      // published-or-mine AND not-published === my own drafts.
      expect(conditionsOf()).toEqual([
        { [Op.or]: [{ isPublished: true }, { createdById: 'provider-1' }] },
        { isPublished: false },
      ]);
    });

    it('narrows to the caller when `mine` is set', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery({ mine: true }), PROVIDER);

      expect(conditionsOf()).toContainEqual({ createdById: 'provider-1' });
    });
  });

  describe('findOne visibility', () => {
    it('hides an unpublished movie from a plain user as a 404', async () => {
      model.findByPk.mockResolvedValue(buildMovieStub({ isPublished: false }));

      // 404, not 403: a draft's existence is not disclosed.
      await expect(service.findOne('movie-1', USER)).rejects.toThrow(NotFoundException);
    });

    it('shows a published movie to a plain user', async () => {
      const stub = buildMovieStub({ isPublished: true });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.findOne(stub.id, USER)).resolves.toMatchObject({ id: stub.id });
    });

    it('shows an admin an unpublished movie', async () => {
      const stub = buildMovieStub({ isPublished: false });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.findOne(stub.id, ADMIN)).resolves.toMatchObject({ id: stub.id });
    });

    it('shows a provider their own draft', async () => {
      const stub = buildMovieStub({ isPublished: false, createdById: 'provider-1' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.findOne(stub.id, PROVIDER)).resolves.toMatchObject({ id: stub.id });
    });

    it("hides another provider's draft", async () => {
      const stub = buildMovieStub({ isPublished: false, createdById: 'someone-else' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.findOne(stub.id, PROVIDER)).rejects.toThrow(NotFoundException);
    });
  });

  describe('ownership on write', () => {
    it('stamps the author on create', async () => {
      model.create.mockResolvedValue(buildMovieStub());

      await service.create(createMovieDtoFactory.build(), PROVIDER);

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdById: 'provider-1' }),
      );
    });

    it('lets a provider edit their own movie', async () => {
      const stub = buildMovieStub({ createdById: 'provider-1' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.update(stub.id, { title: 'Mine' }, PROVIDER)).resolves.toBeDefined();
      expect(stub.update).toHaveBeenCalledWith({ title: 'Mine' });
    });

    it("refuses a provider editing someone else's movie", async () => {
      const stub = buildMovieStub({ createdById: 'other-provider' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.update(stub.id, { title: 'Theirs' }, PROVIDER)).rejects.toThrow(
        ForbiddenException,
      );
      expect(stub.update).not.toHaveBeenCalled();
    });

    it('refuses a provider editing an unowned seeded row', async () => {
      const stub = buildMovieStub({ createdById: null });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.update(stub.id, { title: 'x' }, PROVIDER)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets an admin edit anything, including unowned rows', async () => {
      const stub = buildMovieStub({ createdById: null });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.update(stub.id, { title: 'x' }, ADMIN)).resolves.toBeDefined();
    });

    it('lets a provider delete their own movie', async () => {
      const stub = buildMovieStub({ createdById: 'provider-1' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.remove(stub.id, PROVIDER)).resolves.toBeUndefined();
      expect(stub.destroy).toHaveBeenCalled();
    });

    it("refuses a provider deleting someone else's movie", async () => {
      const stub = buildMovieStub({ createdById: 'other' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.remove(stub.id, PROVIDER)).rejects.toThrow(ForbiddenException);
      expect(stub.destroy).not.toHaveBeenCalled();
    });

    it('toggling isPublished goes through the same ownership check', async () => {
      const stub = buildMovieStub({ createdById: 'other' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.update(stub.id, { isPublished: true }, PROVIDER)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('replacing the poster', () => {
    const CDN = 'https://cdn.test/development/movies';

    beforeEach(() => {
      storage.uploadImage.mockResolvedValue({
        path: 'development/movies/new.jpg',
        url: `${CDN}/new.jpg`,
        bytes: 100,
        savedPercent: 50,
      });
      storage.publicPathOf.mockImplementation((url: string | null | undefined) =>
        url && url.startsWith(CDN) ? url.replace('https://cdn.test/', '') : null,
      );
    });

    it('uploads the new file and points the row at it', async () => {
      const stub = buildMovieStub({ posterUrl: `${CDN}/old.jpg` });
      model.findByPk.mockResolvedValue(stub);

      await service.update(stub.id, {}, ADMIN, buildPoster());

      expect(storage.uploadImage).toHaveBeenCalledWith(expect.anything(), 'movies');
      expect(stub.update).toHaveBeenCalledWith(
        expect.objectContaining({ posterUrl: `${CDN}/new.jpg` }),
      );
    });

    it('deletes the previous object once the row has committed', async () => {
      const stub = buildMovieStub({ posterUrl: `${CDN}/old.jpg` });
      model.findByPk.mockResolvedValue(stub);

      await service.update(stub.id, {}, ADMIN, buildPoster());

      expect(storage.removeQuietly).toHaveBeenCalledWith('development/movies/old.jpg');
    });

    it('leaves a third-party poster URL alone', async () => {
      // Seeded rows point at picsum; deleting that path is not ours to do.
      const stub = buildMovieStub({ posterUrl: 'https://picsum.photos/seed/x/400/600' });
      model.findByPk.mockResolvedValue(stub);

      await service.update(stub.id, {}, ADMIN, buildPoster());

      expect(storage.removeQuietly).not.toHaveBeenCalled();
    });

    it('keeps the current poster when no file is sent', async () => {
      const stub = buildMovieStub({ posterUrl: `${CDN}/old.jpg` });
      model.findByPk.mockResolvedValue(stub);

      await service.update(stub.id, { title: 'Renamed' }, ADMIN);

      expect(storage.uploadImage).not.toHaveBeenCalled();
      expect(stub.update).toHaveBeenCalledWith({ title: 'Renamed' });
    });

    it('removes the NEW object when the row fails to save', async () => {
      const stub = buildMovieStub({ posterUrl: `${CDN}/old.jpg` });
      stub.update.mockRejectedValue(new Error('constraint violation'));
      model.findByPk.mockResolvedValue(stub);

      await expect(service.update(stub.id, {}, ADMIN, buildPoster())).rejects.toThrow(
        'constraint violation',
      );

      // The old poster must survive: the movie still points at it.
      expect(storage.removeQuietly).toHaveBeenCalledWith('development/movies/new.jpg');
      expect(storage.removeQuietly).not.toHaveBeenCalledWith('development/movies/old.jpg');
    });

    it('still enforces ownership before touching storage', async () => {
      const stub = buildMovieStub({ createdById: 'someone-else' });
      model.findByPk.mockResolvedValue(stub);

      await expect(service.update(stub.id, {}, PROVIDER, buildPoster())).rejects.toThrow(
        ForbiddenException,
      );
      expect(storage.uploadImage).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns items with correct pagination metadata', async () => {
      const stubs = buildMovieStubs(20);
      model.findAndCountAll.mockResolvedValue({ rows: stubs, count: 45 });

      const result = await service.findAll(buildQuery({ page: 2, pageSize: 20 }), ADMIN);

      expect(result.items).toHaveLength(20);
      expect(result.meta).toEqual({
        page: 2,
        pageSize: 20,
        totalItems: 45,
        totalPages: 3,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('translates page/pageSize into limit and offset', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery({ page: 3, pageSize: 15 }), ADMIN);

      expect(model.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 15, offset: 30 }),
      );
    });

    it('builds a case-insensitive partial match for search', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery({ search: 'blade' }), ADMIN);

      expect(model.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { [Op.and]: [{ title: { [Op.iLike]: '%blade%' } }] } }),
      );
    });

    it('combines every provided filter', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(
        buildQuery({ genre: MovieGenre.Horror, releaseYear: 1980, isPublished: false }),
        ADMIN,
      );

      expect(model.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            [Op.and]: [{ genre: MovieGenre.Horror }, { releaseYear: 1980 }, { isPublished: false }],
          },
        }),
      );
    });

    it('omits filters that were not supplied', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(buildQuery(), ADMIN);

      expect(model.findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });

    it('maps the sort key to its physical column', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.findAll(
        buildQuery({ sortBy: MovieSortBy.Rating, sortDirection: SortDirection.Asc }),
        ADMIN,
      );

      expect(model.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ order: [['rating', 'ASC']] }),
      );
    });

    it('reports no pages for an empty result set', async () => {
      model.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      const result = await service.findAll(buildQuery(), ADMIN);

      expect(result.meta).toMatchObject({
        totalItems: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });
  });

  describe('findOne', () => {
    it('returns the movie when it exists', async () => {
      const stub = buildMovieStub();
      model.findByPk.mockResolvedValue(stub);

      await expect(service.findOne(stub.id, ADMIN)).resolves.toMatchObject({ id: stub.id });
      expect(model.findByPk).toHaveBeenCalledWith(stub.id);
    });

    it('throws NotFoundException naming the id', async () => {
      model.findByPk.mockResolvedValue(null);

      await expect(service.findOne('missing-id', ADMIN)).rejects.toThrow(NotFoundException);
      await expect(service.findOne('missing-id', ADMIN)).rejects.toThrow(/missing-id/);
    });
  });

  describe('update', () => {
    it('patches only the supplied fields', async () => {
      const stub = buildMovieStub({ title: 'Old', isPublished: false });
      model.findByPk.mockResolvedValue(stub);

      const result = await service.update(stub.id, { title: 'New' }, ADMIN);

      expect(stub.update).toHaveBeenCalledWith({ title: 'New' });
      expect(result.title).toBe('New');
    });

    it('does not null out untouched columns on an empty patch', async () => {
      const stub = buildMovieStub();
      model.findByPk.mockResolvedValue(stub);

      await service.update(stub.id, {}, ADMIN);

      expect(stub.update).toHaveBeenCalledWith({});
    });

    it('forwards an explicit null synopsis', async () => {
      const stub = buildMovieStub();
      model.findByPk.mockResolvedValue(stub);

      await service.update(stub.id, { synopsis: undefined, rating: 9.1 }, ADMIN);

      expect(stub.update).toHaveBeenCalledWith({ rating: 9.1 });
    });

    it('throws when the movie is missing', async () => {
      model.findByPk.mockResolvedValue(null);

      await expect(service.update('nope', { title: 'x' }, ADMIN)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes the instance', async () => {
      const stub = buildMovieStub();
      model.findByPk.mockResolvedValue(stub);

      await expect(service.remove(stub.id, ADMIN)).resolves.toBeUndefined();
      expect(stub.destroy).toHaveBeenCalledTimes(1);
    });

    it('throws when the movie is missing', async () => {
      model.findByPk.mockResolvedValue(null);

      await expect(service.remove('nope', ADMIN)).rejects.toThrow(NotFoundException);
    });
  });

  it('accepts a real Movie-typed instance through the cast helper', async () => {
    const stub = buildMovieStub();
    const typed: Movie = asMovie(stub);
    model.findByPk.mockResolvedValue(typed);

    await expect(service.findOne(stub.id, ADMIN)).resolves.toMatchObject({ title: stub.title });
  });
});
