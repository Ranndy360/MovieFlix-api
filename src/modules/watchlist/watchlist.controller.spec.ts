import { Test, type TestingModule } from '@nestjs/testing';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { QueryWatchlistDto, type WatchlistEntryResponseDto } from './dto/watchlist.dto';
import { WatchlistStatus } from './entities/watchlist-entry.entity';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';

const USER_ID = 'user-1';
const MOVIE_ID = '30ed0258-5799-44e4-a51e-5282fe408826';

const buildDto = (): WatchlistEntryResponseDto => ({
  id: 'entry-1',
  movieId: MOVIE_ID,
  status: WatchlistStatus.Want,
  watchedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('WatchlistController', () => {
  let controller: WatchlistController;
  let service: jest.Mocked<Pick<WatchlistService, 'add' | 'findMine' | 'updateStatus' | 'remove'>>;

  beforeEach(async () => {
    service = {
      add: jest.fn(),
      findMine: jest.fn(),
      updateStatus: jest.fn(),
      remove: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WatchlistController],
      providers: [{ provide: WatchlistService, useValue: service }],
    }).compile();

    controller = moduleRef.get(WatchlistController);
  });

  it('adds using the id from the token, never from the payload', async () => {
    const dto = buildDto();
    service.add.mockResolvedValue(dto);

    await expect(controller.add(USER_ID, { movieId: MOVIE_ID })).resolves.toBe(dto);
    expect(service.add).toHaveBeenCalledWith(USER_ID, { movieId: MOVIE_ID });
  });

  it('lists only the caller entries', async () => {
    const page = PaginatedResponseDto.from([buildDto()], 1, 1, 20);
    service.findMine.mockResolvedValue(page);
    const query = new QueryWatchlistDto();

    await expect(controller.findMine(USER_ID, query)).resolves.toBe(page);
    expect(service.findMine).toHaveBeenCalledWith(USER_ID, query);
  });

  it('updates the status of one movie', async () => {
    const dto = buildDto();
    service.updateStatus.mockResolvedValue(dto);

    await controller.updateStatus(USER_ID, MOVIE_ID, { status: WatchlistStatus.Watched });

    expect(service.updateStatus).toHaveBeenCalledWith(USER_ID, MOVIE_ID, WatchlistStatus.Watched);
  });

  it('removes an entry and resolves to void', async () => {
    service.remove.mockResolvedValue(undefined);

    await expect(controller.remove(USER_ID, MOVIE_ID)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(USER_ID, MOVIE_ID);
  });
});
