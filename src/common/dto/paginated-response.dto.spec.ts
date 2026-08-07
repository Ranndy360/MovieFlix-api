import { PaginatedResponseDto } from './paginated-response.dto';

describe('PaginatedResponseDto.from', () => {
  it('computes totalPages by rounding up', () => {
    expect(PaginatedResponseDto.from([], 45, 1, 20).meta.totalPages).toBe(3);
    expect(PaginatedResponseDto.from([], 40, 1, 20).meta.totalPages).toBe(2);
    expect(PaginatedResponseDto.from([], 1, 1, 20).meta.totalPages).toBe(1);
  });

  it('flags neighbours on a middle page', () => {
    const { meta } = PaginatedResponseDto.from([], 100, 3, 10);

    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('has no previous page on page 1', () => {
    expect(PaginatedResponseDto.from([], 100, 1, 10).meta.hasPreviousPage).toBe(false);
  });

  it('has no next page on the last page', () => {
    expect(PaginatedResponseDto.from([], 100, 10, 10).meta.hasNextPage).toBe(false);
  });

  it('reports an empty set without a previous page', () => {
    const { meta } = PaginatedResponseDto.from([], 0, 1, 20);

    expect(meta).toMatchObject({ totalItems: 0, totalPages: 0, hasPreviousPage: false });
  });

  it('guards against a zero page size', () => {
    expect(PaginatedResponseDto.from([], 10, 1, 0).meta.totalPages).toBe(0);
  });

  it('carries the items through untouched', () => {
    const items = [{ id: 'a' }, { id: 'b' }];

    expect(PaginatedResponseDto.from(items, 2, 1, 20).items).toBe(items);
  });
});
