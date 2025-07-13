import { imagesController } from '@api/controllers';
import express from 'express';

const imagesRouter = express.Router();

imagesRouter.post('/process', imagesController.processImage);

export default imagesRouter;
