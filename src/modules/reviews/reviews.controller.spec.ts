import { Test, type TestingModule } from '@nestjs/testing';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { QueryReviewsDto, type ReviewResponseDto } from './dto/review.dto';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

const USER_ID = 'user-1';
const REVIEW_ID = '7e621644-bbf8-4618-be26-9c369ed18ae8';
const MOVIE_ID = '30ed0258-5799-44e4-a51e-5282fe408826';

const buildDto = (): ReviewResponseDto => ({
  id: REVIEW_ID,
  movieId: MOVIE_ID,
  userId: USER_ID,
  rating: 4,
  comment: 'Great.',
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('ReviewsController', () => {
  let controller: ReviewsController;
  let service: jest.Mocked<
    Pick<ReviewsService, 'create' | 'findAll' | 'findMine' | 'update' | 'remove'>
  >;

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findMine: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [{ provide: ReviewsService, useValue: service }],
    }).compile();

    controller = moduleRef.get(ReviewsController);
  });

  it('creates using the authenticated id', async () => {
    const dto = buildDto();
    service.create.mockResolvedValue(dto);
    const payload = { movieId: MOVIE_ID, rating: 4 };

    await expect(controller.create(USER_ID, payload)).resolves.toBe(dto);
    expect(service.create).toHaveBeenCalledWith(USER_ID, payload);
  });

  it('lists publicly without any user scoping', async () => {
    const page = PaginatedResponseDto.from([buildDto()], 1, 1, 20);
    service.findAll.mockResolvedValue(page);
    const query = Object.assign(new QueryReviewsDto(), { movieId: MOVIE_ID });

    await expect(controller.findAll(query)).resolves.toBe(page);
    expect(service.findAll).toHaveBeenCalledWith(query);
  });

  it('scopes /reviews/me to the caller', async () => {
    const page = PaginatedResponseDto.from([buildDto()], 1, 1, 20);
    service.findMine.mockResolvedValue(page);
    const query = new QueryReviewsDto();

    await expect(controller.findMine(USER_ID, query)).resolves.toBe(page);
    expect(service.findMine).toHaveBeenCalledWith(USER_ID, query);
  });

  it('passes the owner id to update so the service can authorize', async () => {
    const dto = buildDto();
    service.update.mockResolvedValue(dto);

    await controller.update(USER_ID, REVIEW_ID, { rating: 5 });

    expect(service.update).toHaveBeenCalledWith(USER_ID, REVIEW_ID, { rating: 5 });
  });

  it('passes the owner id to delete', async () => {
    service.remove.mockResolvedValue(undefined);

    await expect(controller.remove(USER_ID, REVIEW_ID)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(USER_ID, REVIEW_ID);
  });
});
