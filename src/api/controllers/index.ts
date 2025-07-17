import { ImagesController } from './images.controllers';
import { MessagesController } from './messages.controllers';
import { VideosController } from './videos.controllers';

const messagesController = new MessagesController();
const videosController = new VideosController();
const imagesController = new ImagesController();

export { messagesController, videosController, imagesController };
