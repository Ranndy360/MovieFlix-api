import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProfileStatsResponseDto } from './dto/profile-stats-response.dto';
import { ProfileService } from './profile.service';

@ApiTags('profile')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
@Controller({ path: 'profile', version: '1' })
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** Always scoped to the caller — there is no route for another user's stats. */
  @Get('stats')
  @ApiOperation({ summary: 'My personal stats: total watched and average rating given' })
  @ApiOkResponse({ type: ProfileStatsResponseDto })
  getStats(@CurrentUser('id') userId: string): Promise<ProfileStatsResponseDto> {
    return this.profileService.getStats(userId);
  }
}
