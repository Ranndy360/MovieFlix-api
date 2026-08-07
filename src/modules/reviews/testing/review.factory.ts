import { faker } from '@faker-js/faker';

import { defineFactory } from '../../../testing/factory';
import {
  MAX_REVIEW_RATING,
  MIN_REVIEW_RATING,
  type Review,
  type ReviewAttributes,
} from '../entities/review.entity';

export const reviewAttributesFactory = defineFactory<ReviewAttributes>(() => {
  const createdAt = faker.date.past({ years: 1 });

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    movieId: faker.string.uuid(),
    rating: faker.number.int({ min: MIN_REVIEW_RATING, max: MAX_REVIEW_RATING }),
    comment: faker.lorem.sentences(2),
    createdAt,
    updatedAt: faker.date.between({ from: createdAt, to: new Date() }),
    deletedAt: null,
  };
});

export interface ReviewStub extends ReviewAttributes {
  movie?: unknown;
  /** The eager-loaded author, shaped like the columns the query asks for. */
  user?: { id: string; firstName: string; lastName: string; fullName: string };
  update: jest.Mock;
  destroy: jest.Mock;
}

type ReviewStubOverrides = Partial<ReviewAttributes> & {
  user?: { id?: string; firstName?: string; lastName?: string };
};

export const buildReviewStub = (overrides: ReviewStubOverrides = {}): ReviewStub => {
  const { user, ...attributeOverrides } = overrides;
  const attributes = reviewAttributesFactory.build(attributeOverrides);

  const stub: ReviewStub = {
    ...attributes,
    update: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  };

  if (user) {
    const firstName = user.firstName ?? faker.person.firstName();
    const lastName = user.lastName ?? faker.person.lastName();
    // `fullName` is a getter on the real model; the stub spells it out.
    stub.user = {
      id: user.id ?? attributes.userId,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
    };
  }

  stub.update.mockImplementation((patch: Partial<ReviewAttributes>) => {
    Object.assign(stub, patch);
    return Promise.resolve(stub);
  });

  return stub;
};

export const asReview = (stub: ReviewStub): Review => stub as unknown as Review;
