import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('app')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Plain-text greeting (smoke test)' })
  @ApiOkResponse({ type: String, description: 'Hello World!' })
  getHello(): string {
    return this.appService.getHello();
  }
}
