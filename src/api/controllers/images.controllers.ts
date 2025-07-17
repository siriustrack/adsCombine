import { processImageService } from '@core/services/images';
import { handleServiceResult } from '@lib/service.types';
import type { Request, Response } from 'express';

export class ImagesController {
  async processImage(req: Request, res: Response) {
    const { imageUrl, imageData, fileName } = req.body;

    return handleServiceResult(res, processImageService.execute({ imageUrl, imageData, fileName }));
  }
}
