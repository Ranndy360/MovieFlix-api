import { ApiProperty } from '@nestjs/swagger';

export class WatchlistBreakdownDto {
  @ApiProperty({ example: 4, description: 'Movies marked WANT.' })
  want!: number;

  @ApiProperty({ example: 2, description: 'Movies marked WATCHING.' })
  watching!: number;

  @ApiProperty({ example: 11, description: 'Movies marked WATCHED.' })
  watched!: number;

  @ApiProperty({ example: 17, description: 'Every entry, regardless of status.' })
  total!: number;
}

export class ProfileStatsResponseDto {
  @ApiProperty({ example: 11, description: 'Movies the user has marked as watched.' })
  totalWatched!: number;

  @ApiProperty({
    example: 4.27,
    nullable: true,
    type: Number,
    description:
      'Mean of the ratings this user has given, to two decimals. Null when they have not ' +
      'reviewed anything — distinct from an average of 0.',
  })
  averageRatingGiven!: number | null;

  @ApiProperty({ example: 9, description: 'Reviews the user has written.' })
  totalReviews!: number;

  @ApiProperty({ type: WatchlistBreakdownDto })
  watchlist!: WatchlistBreakdownDto;
}
