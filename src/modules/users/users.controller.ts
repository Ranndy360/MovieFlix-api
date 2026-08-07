import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../roles/entities/role.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { UpdateUserRoleDto, UpdateUserStatusDto } from './dto/update-user-role.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

/**
 * User administration. The controller-level `@Roles(RoleName.Admin)` applies to
 * every route here, so a new endpoint is admin-only by default.
 */
@ApiTags('users')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
@ApiForbiddenResponse({ description: 'Requires the ADMIN role' })
@Roles(RoleName.Admin)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a user with any role (admin)',
    description:
      'The only way to mint an ADMIN or PROVIDER besides the seeder — self-service signup is ' +
      'hard-wired to USER.',
  })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: 'Email already registered' })
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser('id') actingUserId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.createAsAdmin(dto, actingUserId);
  }

  @Get()
  @ApiOperation({ summary: 'List users (admin)' })
  @ApiPaginatedResponse(UserResponseDto, 'Paginated user list')
  findAll(@Query() query: QueryUsersDto): Promise<PaginatedResponseDto<UserResponseDto>> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a user (admin)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserResponseDto })
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  /**
   * POST, not PATCH: this deployment's environment rejects PATCH, so the
   * partial-update routes use POST on the same path. Semantically these are
   * still partial updates — hence the explicit 200, since Nest answers 201 to
   * a POST by default and nothing is being created here.
   */
  @Post(':id/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change a user role (admin)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserResponseDto })
  updateRole(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser('id') actingUserId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.updateRole(id, dto.role, actingUserId);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate or deactivate a user (admin)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UserResponseDto })
  updateStatus(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser('id') actingUserId: string,
  ): Promise<UserResponseDto> {
    return this.usersService.setActive(id, dto.isActive, actingUserId);
  }
}
