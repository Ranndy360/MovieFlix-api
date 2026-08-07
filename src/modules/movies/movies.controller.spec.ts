import { Test, type TestingModule } from '@nestjs/testing';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { seedFaker } from '../../testing/factory';
import { type MovieResponseDto } from './dto/movie-response.dto';
import { QueryMoviesDto } from './dto/query-movies.dto';
import { MoviesController } from './movies.controller';
import { RoleName } from '../roles/entities/role.entity';
import type { AuthenticatedUser } from '../auth/auth.constants';
import { MoviesService } from './movies.service';

const VIEWER: AuthenticatedUser = {
  id: 'user-1',
  email: 'ada@test.io',
  role: RoleName.Provider,
  tokenId: 'jti-1',
};
import { createMovieDtoFactory, movieResponseFactory } from './testing/movie.factory';

describe('MoviesController', () => {
  let controller: MoviesController;
  let service: jest.Mocked<
    Pick<MoviesService, 'create' | 'findAll' | 'findOne' | 'update' | 'remove'>
  >;

  beforeEach(async () => {
    seedFaker();
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [MoviesController],
      providers: [{ provide: MoviesService, useValue: service }],
    }).compile();

    controller = moduleRef.get(MoviesController);
  });

  it('delegates create to the service', async () => {
    const dto = createMovieDtoFactory.build();
    const expected = movieResponseFactory.build({ title: dto.title });
    service.create.mockResolvedValue(expected);

    await expect(controller.create(VIEWER, dto)).resolves.toBe(expected);
    expect(service.create).toHaveBeenCalledWith(dto, VIEWER, undefined);
  });

  it('forwards an uploaded poster to the service', async () => {
    const dto = createMovieDtoFactory.build();
    const expected = movieResponseFactory.build();
    service.create.mockResolvedValue(expected);

    const poster = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      originalname: 'poster.jpg',
      mimetype: 'image/jpeg',
      size: 4,
    };

    await controller.create(VIEWER, dto, poster);

    expect(service.create).toHaveBeenCalledWith(dto, VIEWER, poster);
  });

  it('passes the parsed query through to findAll', async () => {
    const query = Object.assign(new QueryMoviesDto(), { search: 'dune' });
    const page: PaginatedResponseDto<MovieResponseDto> = PaginatedResponseDto.from(
      movieResponseFactory.buildMany(3),
      3,
      1,
      20,
    );
    service.findAll.mockResolvedValue(page);

    await expect(controller.findAll(VIEWER, query)).resolves.toBe(page);
    expect(service.findAll).toHaveBeenCalledWith(query, VIEWER);
  });

  it('forwards a replacement poster to the service', async () => {
    const expected = movieResponseFactory.build();
    service.update.mockResolvedValue(expected);
    const poster = {
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      originalname: 'new.jpg',
      mimetype: 'image/jpeg',
      size: 4,
    };

    await controller.update(VIEWER, expected.id, { title: 'x' }, poster);

    expect(service.update).toHaveBeenCalledWith(expected.id, { title: 'x' }, VIEWER, poster);
  });

  it('delegates findOne to the service', async () => {
    const expected = movieResponseFactory.build();
    service.findOne.mockResolvedValue(expected);

    await expect(controller.findOne(VIEWER, expected.id)).resolves.toBe(expected);
    expect(service.findOne).toHaveBeenCalledWith(expected.id, VIEWER);
  });

  it('delegates update to the service', async () => {
    const expected = movieResponseFactory.build({ title: 'Renamed' });
    service.update.mockResolvedValue(expected);

    await expect(controller.update(VIEWER, expected.id, { title: 'Renamed' })).resolves.toBe(
      expected,
    );
    expect(service.update).toHaveBeenCalledWith(
      expected.id,
      { title: 'Renamed' },
      VIEWER,
      undefined,
    );
  });

  it('resolves to void on delete', async () => {
    service.remove.mockResolvedValue(undefined);

    await expect(
      controller.remove(VIEWER, 'e6b1e0a4-1c1f-4f6b-9d1a-2f3a4b5c6d7e'),
    ).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('e6b1e0a4-1c1f-4f6b-9d1a-2f3a4b5c6d7e', VIEWER);
  });
});
