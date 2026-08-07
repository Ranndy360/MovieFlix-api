import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ImageOptimizerService } from './image-optimizer.service';
import { StorageService } from './storage.service';

/**
 * Object storage. Nothing in here knows about movies — callers pass the folder
 * they want, so the same service serves any future upload (avatars, backdrops).
 */
@Module({
  imports: [ConfigModule],
  providers: [StorageService, ImageOptimizerService],
  exports: [StorageService],
})
export class StorageModule {}
