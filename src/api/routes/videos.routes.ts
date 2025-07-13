import { videosController } from 'api/controllers';
import express from 'express';

const videosRouter = express.Router();

videosRouter.post('/', videosController.createVideoHandler);

videosRouter.get('/', videosController.getVideosMetaHandler);

videosRouter.delete('/', videosController.deleteVideosMetaHandler);

videosRouter.post('/create-raw-assets', videosController.createRawAssetsHandler);

export default videosRouter;
